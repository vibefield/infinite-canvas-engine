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
 *    layers consume — or, for `surface: "object"` (design-015 D2a-core), the
 *    opaque kind binding and the desk stratum the desk's renderer consumes;
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
  STRATUM_BANDS,
  Selectable,
  Size,
  SnapSource,
  SnapTarget,
  Solid,
  SweepsContained,
  type DeskStratum,
} from "../catalog";
import { defineComponent, defineTag } from "../schema/meta";
import { definePrefab, init, type ComponentInit, type Prefab } from "../schema/prefab";
import type { SurfaceKindValue } from "../surface/contract";
import { SurfaceTarget } from "../catalog/surface";
import { STANDARD_SURFACE_BEHAVIOR_NAMES } from "../surface/standard-behavior-names";
import { alwaysGpu, domAtRest } from "../surface/standard-behaviors";
import { defaultValueOf } from "./props";
import type { JsonSpec, PropSpec, PropsDecl } from "./props";
import type { CanvasType } from "../canvas/define-canvas-type";
import type { FrameProjection } from "../canvas/frame-projection";

/**
 * Which kind of pixels a widget type is authored to produce.
 *
 * RENAMED from `WidgetSurface` at S8 (design-012 §11 Q7). Q7 ratifies
 * `WidgetSurface` as the name of the PRESENTATION CONTRACT — the thing that
 * owns pixels-or-DOM, demand and retention — and this union was sitting on it
 * while meaning something else entirely: not the surface, but the kind of
 * surface. It is a subset of the compositor's `SurfaceKindValue` (the terminal
 * mirror joins later per Q6), and `Extract` says so rather than restating the
 * strings, so a new kind cannot make the two lists silently disagree.
 *
 * ERRATUM (design-013 B6, 2026-09-07): `video` USED to be excluded here, on the
 * ground that it "arrives from a producer, never from `defineWidget`". Half of
 * that is still true — the PIXELS arrive from a producer, which registers a
 * stable texture with VideoIngest — but the CARD does not: Band, Demand and
 * Residency all key off `SurfaceKind = video`, and only equip stamps that, from
 * the type's static recipe. With the kind unspeakable at the door there was no
 * way to spawn a live surface at all. So a video widget is declared like any
 * other and equip gives it `SurfaceTarget = gpu` (the only target it has); what
 * it may not carry is a `component`, because nothing would ever mount one.
 *
 * ADDED (design-015 D2a-core, 2026-09-25): `object` — a widget that is a GPU
 * OBJECT on the desk. Its face is its kind's program, reached through the
 * opaque `object` binding (design-015 §5.2, D-D16); nothing mounts a view for
 * it — no component, no chrome, no island, no DOM host. A literal of its OWN,
 * deliberately outside `SurfaceKindValue` and the `SurfaceKind` component's
 * enum: an object never carries the surface facts, so the compositor's
 * vocabulary never learns the word. The old paths skip it by construction —
 * equip stamps no surface fact for it, no surface behaviour is attached, the
 * mount store makes no mount entry, and a transition asks only the `ground`
 * plane of it. At D5 the other three kinds and the view fields are deleted and
 * this becomes the only binding.
 */
export type WidgetSurfaceKind = Extract<SurfaceKindValue, "dom" | "gl" | "video"> | "object";
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

export interface WidgetPortalInsets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

export interface WidgetContainerDef {
  /** Compatibility-key projection written to the durable Accepts cell. */
  readonly accepts: readonly string[];
  readonly provides?: readonly string[];
  /** Fixed CanvasType binding; omitted by legacy defineWidget({container}). */
  readonly canvas?: CanvasType;
  /** Explicit narrower ingress WidgetTypes, unioned with accepts keys. */
  readonly widgets?: readonly WidgetType[];
  /** Omitted drop policy inherits the complete CanvasType legal set. */
  readonly inheritCanvasPlacement?: boolean;
  /** Card-local portal insets; full widget body when absent. */
  readonly portal?: WidgetPortalInsets;
  /** Opaque instance-preview renderer declaration. */
  readonly framePreview?: unknown;
  /** Optional declared facet projection overriding the CanvasType default. */
  readonly frameProjection?: FrameProjection;
  /** Internal normalized distinction between defineContainer and legacy sugar. */
  readonly typed?: boolean;
}

export interface WidgetContainerEntry {
  readonly canvasTypeId: string;
  readonly canvasSemanticVersion: number;
  readonly accepts: readonly string[];
  readonly widgetTypeIds: readonly string[];
  readonly inheritCanvasPlacement: boolean;
  readonly portal: Readonly<Required<WidgetPortalInsets>>;
  readonly framePreview: unknown;
  readonly frameProjection: FrameProjection | undefined;
  readonly typed: boolean;
}

/** Normalized pre-attachment (registry truth for the spawn + equip paths). */
export interface WidgetBehaviorEntry {
  readonly behavior: AnyBehaviorDef;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface WidgetInteraction {
  readonly selectable?: boolean;
  readonly movable?: boolean;
  /**
   * May this widget be dropped INTO an accepting container (design-015 §9, D-D6 — D2b)?
   * `"into"` (default): yes — for a GPU object, when its centre is let go over the container's
   * FACE, at the point where it lay in the inside's own units (it takes the inside's scale), ⌥
   * held at the release keeping it out. `"never"`: a root object always (D-D18: the notebook, the
   * whiteboard, the calendar) — the widget offers itself to no container (no `Provides`).
   */
  readonly drop?: "into" | "never";
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
  readonly surface: WidgetSurfaceKind;
  /**
   * Framework component (opaque to core — the react package narrows it). The
   * view of a `dom`/`gl` widget (`null` = declared without one); an `object`
   * has none, so for it this is absent or `null` and anything else is refused.
   * Optional since design-015 D2a-core so an object can omit it; a view
   * widget's authors keep passing it as before.
   */
  readonly component?: unknown;
  /**
   * The KIND BINDING of an `object` widget (design-015 §5.2, D-D16) — what the
   * desk's renderer dispatches on through `widgetTypeFor`: the kind's program,
   * its pick mirror, its opening. Opaque to core, exactly as `component` is: core
   * carries it and never reads it. Required when `surface` is `"object"` and
   * refused on every other surface.
   */
  readonly object?: unknown;
  /**
   * Which stratum of the desk instances lie in (design-015 §4.2, D-D4):
   * `pads` under everything, `sheets` flat on the mat holding a desk, `things`
   * above both. Equip stamps it as the runtime `Stratum` rider, and
   * `compareStackOrder` ranks by it before sibling order, so pick order is paint
   * order across kinds. An `object` that declares none is a `things`; any other
   * widget that declares none gets no `Stratum` at all (and sorts as a thing).
   */
  readonly stratum?: DeskStratum;
  /**
   * An `object` that OPENS (design-015 §8, D4b): its kind declares an `open` binding — an open
   * extent, an open motion, the held bar's tools — and `ops.open(entity)` picks it up into the
   * hand (the double-tap, ⏎). A kind without one is refused by the op: a note is written where it
   * lies, a mini mat is entered, a print has nothing to open. Refused on every other surface.
   */
  readonly openable?: boolean;
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
  /**
   * Curated live values exposed inside a container's semantic instance
   * preview. This is distinct from the engine-free tray preview above: names
   * are validated against declared props and observed only while subscribed.
   */
  readonly instancePreview?: { readonly props: readonly string[] };
  readonly container?: WidgetContainerDef;
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
  readonly surface: WidgetSurfaceKind;
  readonly component: unknown;
  /** The `object` kind binding (design-015 §5.2) — opaque; `undefined` on every other surface. */
  readonly object: unknown;
  /**
   * The desk stratum equip stamps as `Stratum` (design-015 §4.2): the declared
   * one, `things` for an `object` that declared none, `undefined` (no rider) for
   * any other widget that declared none.
   */
  readonly stratum: DeskStratum | undefined;
  /** An object whose kind opens — `ops.open` picks it up (design-015 §8); false on every other widget. */
  readonly openable: boolean;
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
  /** Normalized capability advertisement; never re-read from durable cells. */
  readonly provides: readonly string[];
  /** Fixed nested-frame binding and ingress/portal metadata, when a container. */
  readonly container: WidgetContainerEntry | undefined;
  /** Keyboard claim (design-007): the dom layer reads THIS (registry truth), not the tag. */
  readonly keyboard: "shared" | "exclusive";
  /** Escape ownership under an exclusive claim ("release" = engine-reserved). */
  readonly keyboardEscape: "release" | "widget";
  /** May instances be dropped INTO an accepting container (design-015 §9; `"never"` = a root object always, D-D18)? The drop system reads THIS. */
  readonly drop: "into" | "never";
  readonly migrate: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>>;
  /** Pre-attached behaviors, normalized (spawn tx for durable, equip for runtime). */
  readonly behaviors: readonly WidgetBehaviorEntry[];
  /** Normalized author preview component (opaque; react narrows). null = none declared. */
  readonly previewComponent: unknown;
  /** Prop overrides for the default real-component preview mount (validated names). */
  readonly previewProps?: Readonly<Record<string, unknown>>;
  /** Validated prop names admitted to FramePreviewChild.previewModel. */
  readonly instancePreviewProps: readonly string[];
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
  // `interaction.drop: "never"` (design-015 D-D18): the widget offers itself to no container — its
  // Provides cell is empty, so no drop ever matches and a release over a container is a plain move.
  const dropNever = def.interaction?.drop === "never";
  if (def.container !== undefined) {
    essential.push(init(Accepts, { list: JSON.stringify(def.container.accepts) }));
    essential.push(init(Provides, { list: JSON.stringify(dropNever ? [] : (def.container.provides ?? [])) }));
  } else if (!dropNever && def.provides !== undefined && def.provides.length > 0) {
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

  // `presentation` is RETIRED (design-013 A1, §5). Where a card presents is a
  // world fact written by its kind's behaviour, so the declaration moved onto
  // the behaviours door — the same door a pack uses. TypeScript already
  // refuses the field; this is for the JS callers and the stale build that
  // would otherwise pass an object nothing reads and get a card that silently
  // ignores its own pin.
  if ((def as { presentation?: unknown }).presentation !== undefined) {
    throw new Error(
      `ice: defineWidget("${def.type}") presentation is retired (design-013 A1) — attach ice:surface.alwaysDom / alwaysGpu / alwaysGpu.with({ paused: true }) through behaviors:`,
    );
  }

  // A VIDEO widget has no view of its own (design-013 §9 Q5, B6): its pixels are
  // a producer's, copied into the stable texture it registered with VideoIngest.
  // Nothing mounts a `component` for it — `WidgetRoot` portals the CHROME for
  // every non-dom kind and `GLViews` takes only `gl` — so a component passed here
  // would be silently dead code, which is the same class as the `presentation`
  // above: a declaration that compiles, reads as wired, and is never consulted.
  if (def.surface === "video" && def.component !== null && def.component !== undefined) {
    throw new Error(
      `ice: defineWidget("${def.type}") is a video surface and carries a component — a video card's pixels come from a producer's registered texture, and nothing mounts its component. Pass component: null (chrome: is still yours).`,
    );
  }

  // An OBJECT (design-015 §5.2, D2a-core) is drawn by its kind's program and by
  // nothing else, so every view field on it is the same class as the two above:
  // a declaration that compiles, reads as wired, and is never consulted. Its
  // binding is the one thing it must carry — and the one thing no other surface
  // may, since the dom/gl/video paths would carry it past every reader. `null`
  // (and `false` for `animated`) is how a caller says "none", so it passes.
  const isObject = def.surface === "object";
  if (isObject) {
    if (def.object === undefined || def.object === null) {
      throw new Error(
        `ice: defineWidget("${def.type}") is an object surface and carries no object binding — an object's face is its kind's program, and the binding is how the desk finds it (design-015 §5.2). Pass object: <the kind binding>.`,
      );
    }
    const views: string[] = [];
    if (def.component !== undefined && def.component !== null) views.push("component");
    if (def.chrome !== undefined && def.chrome !== null) views.push("chrome");
    if (def.animated !== undefined && def.animated !== false) views.push("animated");
    if (views.length > 0) {
      throw new Error(
        `ice: defineWidget("${def.type}") is an object surface and declares ${views.join(", ")} — nothing mounts a view for an object (its face is its kind's program, design-015 §5.2). Drop ${views.length > 1 ? "them" : "it"}.`,
      );
    }
  } else if (def.object !== undefined && def.object !== null) {
    throw new Error(
      `ice: defineWidget("${def.type}") is a ${def.surface} surface and carries an object binding — only surface: "object" is drawn by a kind's program (design-015 §5.2). Use surface: "object", or drop the binding.`,
    );
  } else if (def.openable === true) {
    throw new Error(
      `ice: defineWidget("${def.type}") is a ${def.surface} surface and declares openable — only an object is picked up into the hand (design-015 §8). Use surface: "object" with a kind that opens, or drop it.`,
    );
  }
  if (def.stratum !== undefined && !Object.hasOwn(STRATUM_BANDS, def.stratum)) {
    throw new Error(
      `ice: defineWidget("${def.type}") declares stratum "${String(def.stratum)}" — a desk stratum is "pads", "sheets" or "things" (design-015 §4.2).`,
    );
  }

  // WHO WRITES THIS TYPE'S `SurfaceTarget` — exactly one behaviour, always.
  //
  // "Chose for itself" is broader than "listed an `ice:surface.*`",
  // deliberately: the question is whether anything already owns this entity's
  // `SurfaceTarget`, and design-013 §0's whole point is that a kind may write
  // its OWN behaviour rather than take a standard one. Appending `domAtRest`
  // beside a pack's `mypack:surface.kiosk` would put TWO writers on one
  // component of one entity, which §5's table forbids. So a listed behaviour
  // counts as a chooser if it is one of the standard three OR declares
  // `SurfaceTarget` in its `writes:`.
  const standardNames: readonly string[] = STANDARD_SURFACE_BEHAVIOR_NAMES;
  const targetWriters = behaviorEntries.filter(
    (x) => standardNames.includes(x.behavior.name) || x.behavior.writes.includes(SurfaceTarget),
  );
  // TWO of them is the same defect from the other side, and it was ACCEPTED
  // (A3b fix 3): `behaviors: [alwaysDom, alwaysGpu]` compiled, both wrote
  // `SurfaceTarget` in `present`, and the compiler's own `orderIndependent`
  // attestation for the standard three silenced the strata advisory that
  // would otherwise have reported the pair. The card's target was then
  // whichever behaviour happened to run last. An entity has ONE kind and that
  // kind's behaviour is the sole writer of its choice components (§5), so the
  // second one is refused where it was written, not diagnosed at runtime.
  if (targetWriters.length > 1) {
    throw new Error(
      `ice: defineWidget("${def.type}") lists ${targetWriters.length} behaviors that write SurfaceTarget (${targetWriters
        .map((x) => `"${x.behavior.name}"`)
        .join(", ")}) — an entity has ONE kind and that kind's behavior is the sole writer of its target (design-013 §5). Keep one.`,
    );
  }
  // An object carries no `SurfaceTarget` (equip stamps none of the six facts on
  // it), so a behaviour that writes one would write a component the entity does
  // not have — refused here rather than at its first write. And none is
  // attached for it below: there is no second place for an object to present.
  if (isObject && targetWriters.length > 0) {
    throw new Error(
      `ice: defineWidget("${def.type}") is an object surface and lists ${targetWriters
        .map((x) => `"${x.behavior.name}"`)
        .join(", ")}, which write${targetWriters.length > 1 ? "" : "s"} SurfaceTarget — an object has no surface facts to choose between (design-015 §5.2). Drop it.`,
    );
  }
  if (targetWriters.length === 0 && !isObject) {
    // dom rests in the DOM and promotes under a gesture (design-012 §11 Q5,
    // re-read by design-013 §0 as a default rather than a law); every other
    // kind IS a GPU texture and has no second mode to choose between.
    behaviorEntries.push({ behavior: def.surface === "dom" ? domAtRest : alwaysGpu, data: {} });
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
  const instancePreviewProps = [...(def.instancePreview?.props ?? [])];
  const instancePreviewSeen = new Set<string>();
  for (const name of instancePreviewProps) {
    if (propToGroup[name] === undefined) {
      throw new Error(
        `ice: defineWidget("${def.type}") instancePreview.props names unknown prop "${name}".`,
      );
    }
    if (instancePreviewSeen.has(name)) {
      throw new Error(
        `ice: defineWidget("${def.type}") instancePreview.props repeats "${name}".`,
      );
    }
    instancePreviewSeen.add(name);
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
    object: isObject ? def.object : undefined,
    stratum: def.stratum ?? (isObject ? "things" : undefined),
    openable: isObject && def.openable === true,
    chrome: def.chrome,
    sizeMode: def.sizeMode ?? "fixed",
    defaultSize,
    minSize: def.minSize ?? { w: 40, h: 40 },
    animated: def.animated === true,
    ports: def.ports ?? [],
    capabilityTags,
    provides: Object.freeze([...(def.container?.provides ?? def.provides ?? [])]),
    container:
      def.container === undefined
        ? undefined
        : Object.freeze({
            canvasTypeId: def.container.canvas?.id ?? "ice.default",
            canvasSemanticVersion: def.container.canvas?.semanticVersion ?? 1,
            accepts: Object.freeze([...def.container.accepts]),
            widgetTypeIds: Object.freeze((def.container.widgets ?? []).map((w) => w.type)),
            inheritCanvasPlacement: def.container.inheritCanvasPlacement === true,
            portal: Object.freeze({
              top: def.container.portal?.top ?? 0,
              right: def.container.portal?.right ?? 0,
              bottom: def.container.portal?.bottom ?? 0,
              left: def.container.portal?.left ?? 0,
            }),
            framePreview: def.container.framePreview,
            frameProjection: def.container.frameProjection,
            typed: def.container.typed === true,
          }),
    keyboard: interaction.keyboard ?? "shared",
    keyboardEscape: interaction.keyboardEscape ?? "release",
    drop: interaction.drop ?? "into",
    migrate: def.migrate ?? {},
    behaviors: behaviorEntries,
    previewComponent: previewDecl.component,
    ...(previewDecl.props !== undefined ? { previewProps: previewDecl.props } : {}),
    instancePreviewProps: Object.freeze(instancePreviewProps),
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
