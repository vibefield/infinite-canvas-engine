/**
 * `defineWidget` v1 — the flagship compiler (design-005 §2).
 *
 * Sugar over `definePrefab` + registries — nothing here is unavailable to a
 * hand-rolled prefab. Compile output:
 *  - one durable prefab: `PrefabId{type}` + Position/Size + ONE
 *    generated component per conflict group (`<type>:<group>`; ungrouped
 *    fields form the "props" default group) + Accepts/Provides when a
 *    container contract is declared;
 *  - a capability-stamp recipe (RUNTIME tags at projection — the equip system
 *    consumes it; tags stay pure, design-001 §2);
 *  - a view registration (surface, component, sizeMode, sizes) the React/dom
 *    layers consume;
 *  - the migration chain (stored now; the M9 migrator runs it).
 *
 * Definition-time rules enforced: every top-level field defaulted (p.json
 * derives one), group membership total and disjoint, enum defaults among
 * options (checked in the DSL), duplicate types rejected.
 */
import { field, enumOf } from "@vibecook/strata-ecs";
import type { Component, FieldInput, Tag } from "@vibecook/strata-ecs";
import { ensureComponent } from "../schema/meta";
import type { AnyBehaviorAttachSpec, AnyBehaviorDef } from "../behavior/types";
import {
  Accepts,
  ChildOf,
  Container,
  KeyboardExclusive,
  LongPressDrag,
  Movable,
  Opacity,
  Position,
  Provides,
  Resizable,
  Selectable,
  Size,
  SnapSource,
  SnapTarget,
  Solid,
  SweepsContained,
} from "../catalog";
import { defineComponent, defineTag } from "../schema/meta";
import { definePrefab, init, type ComponentInit, type Prefab } from "../schema/prefab";
import { defaultValueOf } from "./props";
import type { JsonSpec, PropSpec, PropsDecl } from "./props";

export type WidgetSurface = "dom" | "gl";
export type SizeMode = "fixed" | "auto-height" | "auto";

export interface WidgetPortDecl {
  readonly id: string;
  readonly side: "n" | "e" | "s" | "w";
  /** Slot index along the side (0-based; anchor spacing is the kernel's). */
  readonly index?: number;
  /** Compatibility keys (empty = connects to anything). */
  readonly accepts?: readonly string[];
}

/**
 * A prior durable id of this widget type (design-008 §3, petition I5). Docs
 * written under the old id fold to this type at open (doc/rename.ts) and via
 * the live zombie sweep (doc/rename-sweep.ts) — replicas converge through
 * ordinary CRDT delivery, retiring offline byte surgery. Declares group-NAME
 * continuity at the rename boundary (the pack runner's existing fence).
 */
export interface WidgetRename {
  /** The old durable type id (`PrefabId.id` in pre-rename docs). */
  readonly type: string;
  /**
   * The pack version old-build writers of `type` were at (default 1). Only
   * the SWEEP consumes it — a late old-shape delivery carries no marker, so
   * its values chain-fold from here; the open-path runner reads the version
   * off the doc's own markers instead (design-008 §6.3).
   */
  readonly atVersion?: number;
}

/** A rename registry entry (doc/rename runner + sweep input). */
export interface WidgetRenameEntry {
  readonly widget: WidgetType;
  readonly oldType: string;
  readonly atVersion: number;
  /** Legacy `<oldType>:<group>` components, index-aligned with `widget.groups`. */
  readonly legacyGroups: readonly Component[];
}

/**
 * A behavior pre-attachment on a widget type: the bare handle for defaults, or
 * `Behavior.with({...})` for a starting value (design-009 §6).
 */
export type WidgetBehaviorDecl = AnyBehaviorDef | AnyBehaviorAttachSpec;

/** Normalized pre-attachment (registry truth for the spawn + equip paths). */
export interface WidgetBehaviorEntry {
  readonly behavior: AnyBehaviorDef;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface WidgetInteraction {
  readonly selectable?: boolean;
  readonly movable?: boolean;
  readonly resizable?: boolean;
  readonly snap?: "source" | "target" | "both" | "none";
  /** Drop-REJECTING target: widgets dropped onto this one fly back (v1 iOS-card contract). */
  readonly solid?: boolean;
  /** "longPress": hold-to-lift dragging (iOS home-screen model); default "press". */
  readonly dragOn?: "press" | "longPress";
  /**
   * UE-Blueprint comment-box drag (2026-07-18): a move claim on this widget
   * also claims every widget FULLY INSIDE its bounds at claim time (spatial
   * membership — never reparenting). Default false.
   */
  readonly sweepContained?: boolean;
  /**
   * Keyboard claim (design-007 §3.1, petitions I1/I4). `"exclusive"`: while a
   * node inside this widget holds browser focus, the engine keymap and the
   * adapter's Space pan modifier stand down — keys flow to the widget's own
   * handlers (the engine stops competing; it never delivers behavior). The
   * dom-widgets reflector marks the host `data-canvas-keyboard` + `tabindex=-1`
   * so a click anywhere in the widget acquires focus, and plain wheel over the
   * widget's scrollable content cedes to native scroll (ctrl/pinch stays
   * canvas zoom always). Default `"shared"` — today's behavior, byte-identical.
   */
  readonly keyboard?: "shared" | "exclusive";
  /**
   * Escape ownership under an exclusive claim (design-007 §3.3 / §7-Q1).
   * `"release"` (default): Escape is the engine-reserved release gesture — it
   * blurs the widget; the NEXT Escape, with focus gone, cancels gestures.
   * `"widget"`: even Escape flows to the widget (vim-grade terminals); release
   * is click-away or `blurFocus()`. Ignored unless `keyboard: "exclusive"`.
   */
  readonly keyboardEscape?: "release" | "widget";
}

export interface WidgetDef {
  readonly type: string;
  readonly version?: number;
  /** Top-level props: a plain record, or the DSL's `p.object(...)` result. */
  readonly props?: PropsDecl | { readonly kind: "object"; readonly fields: Readonly<Record<string, unknown>> };
  /** Conflict groups: group name → prop names. Ungrouped props → "props". */
  readonly groups?: Readonly<Record<string, readonly string[]>>;
  readonly surface: WidgetSurface;
  /** Framework component (opaque to core — the react package narrows it). */
  readonly component: unknown;
  /**
   * GL only: a DOM chrome component portaled into the widget's CONTENT-plane
   * host (P1), which stacks UNDER the GL canvas (P2) — v1's proven
   * CardChrome-beneath-the-canvas sandwich. The island renders ONLY the 3D
   * content; the card body (gradient, radius, ring, shadow, lift spring,
   * hover/overlap glow) is DOM and shares the app's CSS with DOM widgets.
   * Opaque to core — the react package narrows it. Ignored for dom-surface
   * widgets (their component IS the chrome).
   */
  readonly chrome?: unknown;
  readonly sizeMode?: SizeMode;
  readonly defaultSize?: { readonly w: number; readonly h: number };
  readonly minSize?: { readonly w: number; readonly h: number };
  /**
   * GL only: the island repaints every frame while visible (design-004 §3
   * animation contract — the EXPLICIT opt-in; plain `useFrame` inside a
   * portal cannot be attributed to an island, so it never drives repaints;
   * content-driven animation goes through `useIslandFrame`).
   */
  readonly animated?: boolean;
  readonly interaction?: WidgetInteraction;
  /**
   * Node-editor port schema (design-005 §2; design-001 §5.3): wires bind to
   * widget + port ID — port ENTITIES are runtime and on-demand. `accepts` is
   * the compatibility key list the connect gesture checks.
   */
  readonly ports?: readonly WidgetPortDecl[];
  /**
   * Palette/tray preview (design-005 §2 amendment, 2026-07-19). ENGINE-FREE
   * BY CONTRACT: a preview renders with no world, no entity, no ops — a pure
   * picture the host mounts inert (that is what makes it portable: trays,
   * docs sites, a widget store). Authored at `defaultSize`; hosts scale.
   * Three tiers, least effort first:
   *  - absent            → the REAL component mounts with default props in
   *                        the framework's preview sandbox (dom surfaces;
   *                        truthful by construction);
   *  - `{ props: {…} }`  → same sandbox mount with curated props;
   *  - a component, or `{ component }` → author-owned preview (a static
   *    mockup, a live self-ticking clock — the author's call). In P1 all
   *    declared previews are DOM components — the sanctioned escape hatch
   *    for GL widgets too (P2 adds the r3f snapshot pipeline).
   * Opaque to core — the react package narrows it (`component` precedent).
   */
  readonly preview?: unknown;
  readonly container?: { readonly accepts: readonly string[]; readonly provides?: readonly string[] };
  /**
   * Provides-keys WITHOUT container semantics (nodeboard field finding): a
   * leaf that only offers itself to containers must not become a Container
   * (drop target + Enter affordance). Ignored when `container` is present
   * (its `provides` wins).
   */
  readonly provides?: readonly string[];
  /**
   * Prior durable ids folded to this type (design-008; petition I5). Additive:
   * registers read-only LEGACY group components under the old names so
   * pre-rename cells project, gates pre-rename docs "migrate" instead of
   * read-only, and arms the live zombie sweep on every writable session.
   */
  readonly renamedFrom?: readonly WidgetRename[];
  /**
   * Behaviors every instance of this type carries (design-009 §6). The store
   * class routes HOW, exactly as it routes everything else:
   *  - `durable` behaviors are attached as post-spawn `addComponent` calls in
   *    the SAME spawn transaction — document truth, so they sync and undo with
   *    the widget. (Not spawn-init overrides: those hit the prefab's
   *    all-builds eligibility throw in `instantiate.ts`.)
   *  - `runtime` behaviors are stamped at PROJECTION by the equip system,
   *    beside the capability tags. That is the only mechanism that also equips
   *    a widget arriving from a remote peer or a restored file, which a rider
   *    attached at spawn time would miss on every peer but the author's.
   * Ephemeral behaviors are refused: an ephemeral instance IS the local
   * presence peer, so it cannot ride a widget at all.
   */
  readonly behaviors?: readonly WidgetBehaviorDecl[];
  /**
   * fromVersion → idempotent absolute transform (M9's `runMigrations` runs the
   * chain at open; `prev`/return are flat prop records spanning every group).
   *
   * No parallel `legacy` schema field is needed for field-level changes: strata
   * is field-tolerant within a known component name (extra stored fields dropped,
   * missing default-filled — every generated field carries a default), so a v1
   * cell projects into the v2 group component of the same name and the transform
   * reads the already-v2-shaped value. See doc/migrate.ts for the as-built note;
   * migrating data out of a group REMOVED wholesale in v2 is vNext (design-005
   * §6.4 cross-schema movement).
   */
  readonly migrate?: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>>;
}

export interface WidgetGroup {
  readonly name: string;
  readonly component: Component;
  /** prop name → spec (field order = component field order). */
  readonly fields: Readonly<Record<string, PropSpec>>;
}

export interface WidgetType {
  readonly type: string;
  readonly version: number;
  readonly prefab: Prefab;
  readonly groups: readonly WidgetGroup[];
  readonly propToGroup: Readonly<Record<string, string>>;
  readonly surface: WidgetSurface;
  readonly component: unknown;
  /** GL widgets: DOM chrome under the canvas (see WidgetDef.chrome). */
  readonly chrome: unknown;
  readonly sizeMode: SizeMode;
  readonly defaultSize: { readonly w: number; readonly h: number };
  readonly minSize: { readonly w: number; readonly h: number };
  /** GL islands: repaint every visible frame (design-004 §3). */
  readonly animated: boolean;
  /** Node-editor ports (empty when not a node). */
  readonly ports: readonly WidgetPortDecl[];
  /** Runtime capability tags the equip system stamps at projection. */
  readonly capabilityTags: readonly Tag[];
  /** Keyboard claim (design-007): the dom layer reads THIS (registry truth), not the tag. */
  readonly keyboard: "shared" | "exclusive";
  /** Escape ownership under an exclusive claim ("release" = engine-reserved). */
  readonly keyboardEscape: "release" | "widget";
  readonly migrate: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>>;
  /** Pre-attached behaviors, normalized (spawn tx for durable, equip for runtime). */
  readonly behaviors: readonly WidgetBehaviorEntry[];
  /** Normalized author preview component (opaque; react narrows). null = none declared. */
  readonly previewComponent: unknown;
  /** Prop overrides for the default real-component preview mount (validated names). */
  readonly previewProps?: Readonly<Record<string, unknown>>;
}

/** Stamped by the equip system once a projected widget carries its capability tags. */
export const WidgetEquipped = defineTag("WidgetEquipped");

const registry = new Map<string, WidgetType>();
const renameRegistry = new Map<string, WidgetRenameEntry>();

export const widgets = {
  get(type: string): WidgetType | undefined {
    return registry.get(type);
  },
  all(): WidgetType[] {
    return [...registry.values()];
  },
};

/** The rename registry (design-008 §3): old durable id → fold target. */
export const renames = {
  get(oldType: string): WidgetRenameEntry | undefined {
    return renameRegistry.get(oldType);
  },
  all(): WidgetRenameEntry[] {
    return [...renameRegistry.values()];
  },
};

function normalizeProps(props: WidgetDef["props"]): PropsDecl {
  if (props === undefined) return {};
  if ("kind" in props && props.kind === "object") {
    return props.fields as PropsDecl; // p.object(...) authored form
  }
  return props as PropsDecl;
}

function strataFieldOf(name: string, spec: PropSpec) {
  switch (spec.kind) {
    case "string":
      return field("string", { default: spec.default ?? "" });
    case "number":
      return field("f64", { default: spec.default ?? 0 });
    case "boolean":
      return field("bool", { default: spec.default ?? false });
    case "enum": {
      const fallback = spec.default ?? spec.options[0] ?? ""; // p.enum enforces non-empty
      return field(enumOf([...spec.options]), { default: fallback });
    }
    case "json":
      return field("string", { default: (spec as JsonSpec).default ?? "null" });
    case "entityKey":
      // A doc key is a string cell — `p.entityKey` is the DECLARED meaning, not
      // a distinct storage type (design-009 §4.2).
      return field("string", { default: spec.default ?? "" });
    default:
      throw new Error(`ice: defineWidget prop "${name}" has an unknown spec kind.`);
  }
}

/**
 * Chain-coverage check (design-005 §6.4): to upgrade a doc written by ANY pack
 * version in `1..version-1`, the migrate chain needs an entry for every one of
 * those fromVersions. A gap means docs at the uncovered version stay read-only
 * (the M9 runner skips a type it cannot reach `version` from), so warn rather
 * than throw — a partial chain is a live-with-it degradation, not a definition
 * error. Keys ≥ `version` or ≤ 0 are meaningless fromVersions; flag them too.
 */
function validateMigrateChain(
  type: string,
  version: number,
  migrate: Readonly<Record<number, unknown>>,
): void {
  const keys = Object.keys(migrate).map(Number);
  if (keys.length === 0) return;
  const gaps: number[] = [];
  for (let v = 1; v < version; v++) {
    if (typeof migrate[v] !== "function") gaps.push(v);
  }
  if (gaps.length > 0) {
    console.warn(
      `ice: defineWidget("${type}") migrate chain has gaps at fromVersion(s) [${gaps.join(", ")}] — ` +
        `docs written at those versions cannot reach v${version} and will open read-only (design-005 §6.4).`,
    );
  }
  const stray = keys.filter((v) => v <= 0 || v >= version);
  if (stray.length > 0) {
    console.warn(
      `ice: defineWidget("${type}") migrate declares transform(s) for fromVersion(s) [${stray.join(", ")}] ` +
        `outside the migratable range 1..${version - 1} — they never run.`,
    );
  }
}

/**
 * Normalize the `preview` declaration: a bare component (function, or a
 * memo/forwardRef exotic — an object carrying `$$typeof`) vs. the options
 * form `{ component?, props? }`. Core never renders either — shape only.
 */
function normalizePreview(preview: unknown): {
  component: unknown;
  props?: Readonly<Record<string, unknown>>;
} {
  if (preview === undefined || preview === null) return { component: null };
  const isComponent =
    typeof preview === "function" || (typeof preview === "object" && "$$typeof" in (preview as object));
  if (isComponent) return { component: preview };
  const opts = preview as { component?: unknown; props?: Readonly<Record<string, unknown>> };
  return {
    component: opts.component ?? null,
    ...(opts.props !== undefined ? { props: opts.props } : {}),
  };
}

export function defineWidget(def: WidgetDef): WidgetType {
  if (registry.has(def.type)) {
    throw new Error(`ice: widget type "${def.type}" is already defined.`);
  }
  const props = normalizeProps(def.props);
  const portIds = new Set<string>();
  for (const port of def.ports ?? []) {
    if (portIds.has(port.id)) throw new Error(`ice: widget "${def.type}" declares duplicate port id "${port.id}".`);
    portIds.add(port.id);
  }

  // Group membership: total and disjoint; ungrouped → the "props" group.
  const propToGroup: Record<string, string> = {};
  for (const [group, names] of Object.entries(def.groups ?? {})) {
    for (const name of names) {
      if (!(name in props)) {
        throw new Error(`ice: widget "${def.type}" group "${group}" lists unknown prop "${name}".`);
      }
      if (propToGroup[name] !== undefined) {
        throw new Error(`ice: widget "${def.type}" prop "${name}" is in two groups — groups must be disjoint.`);
      }
      propToGroup[name] = group;
    }
  }
  for (const name of Object.keys(props)) {
    propToGroup[name] ??= "props";
  }

  // One generated component per group, named `<type>:<group>`.
  const byGroup = new Map<string, Record<string, PropSpec>>();
  for (const [name, spec] of Object.entries(props)) {
    const g = propToGroup[name] as string;
    let fields = byGroup.get(g);
    if (fields === undefined) {
      fields = {};
      byGroup.set(g, fields);
    }
    fields[name] = spec;
  }
  const groups: WidgetGroup[] = [];
  // Raw strata field specs per group, kept for rename legacy compilation —
  // the legacy `<oldType>:<group>` components must be BYTE-IDENTICAL shapes.
  const rawByGroup = new Map<string, Record<string, FieldInput>>();
  for (const [g, fields] of byGroup) {
    const raw: Record<string, ReturnType<typeof strataFieldOf>> = {};
    for (const [name, spec] of Object.entries(fields)) raw[name] = strataFieldOf(name, spec);
    rawByGroup.set(g, raw);
    groups.push({ name: g, component: defineComponent(`${def.type}:${g}`, raw) as Component, fields });
  }

  // Rename declarations (design-008 §3): validate, then compile one legacy
  // component per CURRENT group under each old id. `ensureComponent` makes
  // re-evals (tests, hot reload) reuse instead of tripping strata's
  // duplicate-name throw; a same-name different-shape collision still throws.
  const renameDecls = def.renamedFrom ?? [];
  const legacyByOld = new Map<string, Component[]>();
  for (const decl of renameDecls) {
    if (decl.type === def.type) {
      throw new Error(`ice: widget "${def.type}" lists itself in renamedFrom.`);
    }
    if (registry.has(decl.type)) {
      throw new Error(`ice: widget "${def.type}" renamedFrom "${decl.type}" — that type is still a registered widget.`);
    }
    const holder = renameRegistry.get(decl.type);
    if (holder !== undefined && holder.widget.type !== def.type) {
      throw new Error(`ice: widget "${def.type}" renamedFrom "${decl.type}" — already claimed by "${holder.widget.type}".`);
    }
    if (legacyByOld.has(decl.type)) {
      throw new Error(`ice: widget "${def.type}" lists renamedFrom "${decl.type}" twice.`);
    }
    const legacy: Component[] = [];
    for (const g of groups) {
      legacy.push(ensureComponent(`${decl.type}:${g.name}`, rawByGroup.get(g.name) as Record<string, FieldInput>));
    }
    legacyByOld.set(decl.type, legacy);
  }

  // Essential set: geometry + every group at its defaults (+ container cells).
  const defaultSize = def.defaultSize ?? { w: 240, h: 160 };
  const essential: ComponentInit[] = [
    init(Position, { x: 0, y: 0 }),
    init(Size, { w: defaultSize.w, h: defaultSize.h }),
    // No StackZ (petition 8): stacking is the frame parent's ChildOf sibling
    // sequence — the spawn path hangs the edge (attachSpawnParent). Not a
    // group component, so no prefab-pack version bump rides its removal.
  ];
  for (const g of groups) {
    const defaults: Record<string, string | number | boolean> = {};
    for (const [name, spec] of Object.entries(g.fields)) defaults[name] = defaultValueOf(spec);
    essential.push([g.component, defaults] as ComponentInit);
  }
  if (def.container !== undefined) {
    essential.push(init(Accepts, { list: JSON.stringify(def.container.accepts) }));
    essential.push(init(Provides, { list: JSON.stringify(def.container.provides ?? []) }));
  } else if (def.provides !== undefined && def.provides.length > 0) {
    essential.push(init(Provides, { list: JSON.stringify(def.provides) })); // leaf: no Container tag
  }

  // Pre-attached behaviors: normalize the two authored forms and refuse the
  // one store class that cannot ride an entity.
  const behaviorEntries: WidgetBehaviorEntry[] = [];
  for (const decl of def.behaviors ?? []) {
    const entry: WidgetBehaviorEntry =
      "behavior" in (decl as AnyBehaviorAttachSpec)
        ? {
            behavior: (decl as AnyBehaviorAttachSpec).behavior as AnyBehaviorDef,
            data: ((decl as AnyBehaviorAttachSpec).data ?? {}) as Readonly<Record<string, unknown>>,
          }
        : { behavior: decl as AnyBehaviorDef, data: {} };
    if (entry.behavior?.__behavior !== true) {
      throw new Error(`ice: defineWidget("${def.type}") behaviors: entry is not a defineBehavior handle.`);
    }
    if (entry.behavior.store === "ephemeral") {
      throw new Error(
        `ice: defineWidget("${def.type}") lists ephemeral behavior "${entry.behavior.name}" — an ephemeral instance IS the local presence peer, so it cannot be pre-attached to a widget (design-009 §4.4).`,
      );
    }
    if (behaviorEntries.some((x) => x.behavior === entry.behavior)) {
      throw new Error(`ice: defineWidget("${def.type}") lists behavior "${entry.behavior.name}" twice.`);
    }
    behaviorEntries.push(entry);
  }

  const version = def.version ?? 1;
  if (def.migrate !== undefined) validateMigrateChain(def.type, version, def.migrate);

  // Preview declaration: fail FAST on unknown previewProps names — a typo
  // would otherwise surface as a spawn throw inside the preview host's error
  // boundary (a silent placeholder), the worst place to find it.
  const previewDecl = normalizePreview(def.preview);
  for (const name of Object.keys(previewDecl.props ?? {})) {
    if (propToGroup[name] === undefined) {
      throw new Error(`ice: defineWidget("${def.type}") preview.props names unknown prop "${name}".`);
    }
  }

  const prefab = definePrefab(def.type, {
    store: "durable",
    components: essential,
    // Every widget may carry a durable Opacity (design-004 §3: `{opacity}` is
    // the whole per-widget composite fact) — optional, not essential: widgets
    // pay no storage until one is attached, and readers default absent to 1.
    optional: [Opacity],
    // Every widget is containment-eligible: drop-to-consume commits
    // `ChildOf(widget → container)` in the SAME tx as the final position
    // (design-003 §5.5), and an undeclared relation throws at commit — the
    // widgetlab folder-drop field report (2026-07-12) hit exactly that.
    relations: [ChildOf],
    version,
  });

  // Capability recipe → runtime tags at projection (equip system).
  const interaction = def.interaction ?? {};
  const capabilityTags: Tag[] = [];
  if (interaction.selectable !== false) capabilityTags.push(Selectable);
  if (interaction.movable !== false) capabilityTags.push(Movable);
  if (interaction.resizable === true) capabilityTags.push(Resizable);
  if (interaction.solid === true) capabilityTags.push(Solid);
  if (interaction.dragOn === "longPress") capabilityTags.push(LongPressDrag);
  if (interaction.sweepContained === true) capabilityTags.push(SweepsContained);
  if (interaction.keyboard === "exclusive") capabilityTags.push(KeyboardExclusive);
  const snap = interaction.snap ?? "target";
  if (snap === "source" || snap === "both") capabilityTags.push(SnapSource);
  if (snap === "target" || snap === "both") capabilityTags.push(SnapTarget);
  if (def.container !== undefined) capabilityTags.push(Container);

  const widget: WidgetType = {
    type: def.type,
    version,
    prefab,
    groups,
    propToGroup,
    surface: def.surface,
    component: def.component,
    chrome: def.chrome,
    sizeMode: def.sizeMode ?? "fixed",
    defaultSize,
    minSize: def.minSize ?? { w: 40, h: 40 },
    animated: def.animated === true,
    ports: def.ports ?? [],
    capabilityTags,
    keyboard: interaction.keyboard ?? "shared",
    keyboardEscape: interaction.keyboardEscape ?? "release",
    migrate: def.migrate ?? {},
    behaviors: behaviorEntries,
    previewComponent: previewDecl.component,
    ...(previewDecl.props !== undefined ? { previewProps: previewDecl.props } : {}),
  };
  registry.set(def.type, widget);
  for (const decl of renameDecls) {
    renameRegistry.set(decl.type, {
      widget,
      oldType: decl.type,
      atVersion: decl.atVersion ?? 1,
      legacyGroups: legacyByOld.get(decl.type) as Component[],
    });
  }
  return widget;
}

/** TEST-ONLY wipe (mirrors __resetPrefabsForTests; not on the barrel). */
export function __resetWidgetsForTests(): void {
  registry.clear();
  renameRegistry.clear();
}
