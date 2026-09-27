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
 *  - the opaque `object` kind binding and the desk stratum the desk's renderer
 *    consumes (design-015 §5.2, D2a-core) — since D5b the ONE face a widget can
 *    have (the view registration — surface, component, sizeMode — is gone);
 *  - the migration chain (stored now; the M9 migrator runs it).
 *
 * Definition-time rules enforced: every top-level field defaulted (p.json
 * derives one), group membership total and disjoint, enum defaults among
 * options (checked in the DSL), duplicate types rejected.
 */
import { field, enumOf } from "@vibecook/strata-ecs";
import type { Component, Entity, FieldInput, Tag, World } from "@vibecook/strata-ecs";
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
  WheelTurns,
  type DeskStratum,
} from "../catalog";
import { defineComponent, defineTag } from "../schema/meta";
import { definePrefab, init, type ComponentInit, type Prefab } from "../schema/prefab";
import { defaultValueOf } from "./props";
import type { JsonSpec, PropSpec, PropsDecl } from "./props";
import { type HeldToolDef, validateHeldTools } from "./held-tools";
import { hangError, type TrayHang } from "@ice/kernel";
import type { CanvasType } from "../canvas/define-canvas-type";
import type { FrameProjection } from "../canvas/frame-projection";

// `WidgetSurfaceKind` (`dom` · `gl` · `video` · `object`) and `SizeMode` left at design-015 D5b:
// a widget's face is its `object` kind's program or nothing, and its size is its `Size`. The
// fields that named a view — `surface`, `component`, `chrome`, `animated`, `preview`,
// `instancePreview`, `sizeMode` — are refused below for the JS caller TypeScript cannot stop.

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
   * The wheel TURNS it while a press holds it (design-015 §6's photo, D3t-a — the `WheelTurns` capability): the wheel on
   * that pointer is the widget's, never the camera's; its deltas add up in the pointer's `PressWheel`. Default false.
   */
  readonly wheelTurns?: boolean;
  /**
   * Keyboard claim (design-007 §3.1, petitions I1/I4). `"exclusive"`: while a
   * node inside this widget's claim holds browser focus, the engine keymap and
   * the adapter's Space pan modifier stand down — keys flow to the widget's own
   * handlers (the engine stops competing; it never delivers behavior). The claim
   * is a `data-canvas-keyboard` host in screen space (the desk's one focused
   * editor carries it), and plain wheel over its scrollable content cedes to
   * native scroll (ctrl/pinch stays canvas zoom always). Default `"shared"`.
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
  /**
   * The KIND BINDING (design-015 §5.2, D-D16) — the widget's FACE: what the
   * desk's renderer dispatches on through `widgetTypeFor`: the kind's program,
   * its pick mirror, its opening. Opaque to core: it carries it and never reads
   * it. Optional — a widget without one (a port, a test fixture) is a type the
   * desk draws nothing for; since D5b there is no other face a widget can have.
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
   * An object that OPENS (design-015 §8, D4b): its kind declares an `open` binding — an open
   * extent, an open motion, the held bar's tools — and `ops.open(entity)` picks it up into the
   * hand (the double-tap, ⏎). A kind without one is refused by the op: a note is written where it
   * lies, a mini mat is entered, a print has nothing to open. Refused without an `object` binding.
   */
  readonly openable?: boolean;
  /**
   * The held bar's tools of an object that opens (design-015 §8; D3t-a — widget/held-tools.ts): each a mode (the
   * object's active tool in hand) or an action (an op), with its keys. The keymap and the bar reach them through the
   * engine; `ops.useHeldTool` uses one. Refused on anything that does not open.
   */
  readonly heldTools?: readonly HeldToolDef[];
  /** The mode in hand when the object is picked up, from its props (the board: its capped marker's ink). Default: the first mode, else none. */
  readonly heldTool?: (props: Readonly<Record<string, unknown>>) => string;
  /**
   * What RIDES with the widget when a gesture moves it (design-015 D3t-c — the desk calendar's stuck notes): widgets of the same
   * frame the move claim adds to its dragged set, so they move with it live and land in the SAME transaction (one undo step).
   * Read from the world at the claim; a taped rider stays put, as a taped member of a selection does.
   */
  readonly riders?: (world: World, entity: Entity) => readonly Entity[];
  /**
   * The object's DATA prefabs (design-015 §5.1; D3t-a): durable children `ChildOf` it that are never widgets — the board's
   * strokes. An engine catalog that registers the widget tracks them as it tracks the widget's own: their packs are stamped on
   * a new document and gated at open, a guarded transaction resolves them, and one whose version moved migrates by its own
   * `migrate` chain (doc/migrate.ts).
   */
  readonly data?: readonly Prefab[];
  readonly defaultSize?: { readonly w: number; readonly h: number };
  readonly minSize?: { readonly w: number; readonly h: number };
  readonly interaction?: WidgetInteraction;
  /**
   * Node-editor port schema (design-005 §2; design-001 §5.3): wires bind to
   * widget + port ID — port ENTITIES are runtime and on-demand. `accepts` is
   * the compatibility key list the connect gesture checks.
   */
  readonly ports?: readonly WidgetPortDecl[];
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
  /**
   * The widget's TRAY ENTRY (design-017 §8; K5a — K-L2: a plugin kind declares the same): a specimen of the object hangs on the
   * pegboard tray, drawn by its own kind. No list in the engine names a kind — the catalog's widgets that carry an entry ARE the
   * tray's contents. Only an object has one (a specimen is its face).
   */
  readonly tray?: TrayEntry;
}

/**
 * A tray entry (design-017 §8): `label` — the specimen's name tag; `props` — the specimen's props over the widget's defaults: its FACE
 * on the board (K5b — a note with a word on it, a print with a picture); `take` — what one taken off the board is made with (K5b,
 * D-K5b.1): absent, the widget's own defaults (a taken note is blank, a taken calendar shows its today's month); `"face"`, the
 * specimen's props; a record, those props (each valid as `props`'); `hang` — how it hangs (kernel `TrayHang`: its size on the board in
 * CSS px, its pegs in pitches from its hang point, its accessory); `category`, then `order`, then the type — its place in the lattice
 * law's order.
 */
export interface TrayEntry {
  readonly label: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly take?: "face" | Readonly<Record<string, unknown>>;
  readonly hang: TrayHang;
  readonly order?: number;
  readonly category?: string;
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
  /** The `object` kind binding (design-015 §5.2) — the face; opaque; `undefined` for a widget the desk draws nothing for. */
  readonly object: unknown;
  /**
   * The desk stratum equip stamps as `Stratum` (design-015 §4.2): the declared
   * one, `things` for an object that declared none, `undefined` (no rider) for
   * a faceless widget that declared none.
   */
  readonly stratum: DeskStratum | undefined;
  /** An object whose kind opens — `ops.open` picks it up (design-015 §8); false on every other widget. */
  readonly openable: boolean;
  /** The held bar's tools (design-015 §8, D3t-a); empty for anything that does not open. */
  readonly heldTools: readonly HeldToolDef[];
  /** The mode in hand at the pick-up, from the object's props; undefined = the first mode. */
  readonly heldTool: ((props: Readonly<Record<string, unknown>>) => string) | undefined;
  /** What rides with the widget when a gesture moves it (design-015 D3t-c); undefined = nothing. */
  readonly riders: ((world: World, entity: Entity) => readonly Entity[]) | undefined;
  /** The object's data prefabs (design-015 §5.1, D3t-a) — the catalog tracks them with the widget; empty for most. */
  readonly data: readonly Prefab[];
  readonly defaultSize: { readonly w: number; readonly h: number };
  readonly minSize: { readonly w: number; readonly h: number };
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
  /** The tray entry (design-017 §8; K5a), validated and frozen; undefined = the widget hangs nothing on the tray. */
  readonly tray: TrayEntry | undefined;
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

  // THE RETIRED VIEW (design-015 §1, D5b). TypeScript already refuses these
  // fields; this is for the JS caller and the stale build that would otherwise
  // pass a declaration nothing reads — the `presentation` precedent (design-013
  // A1). `surface` chose between DOM, GL and video faces; `component`, `chrome`,
  // `animated`, `preview`, `instancePreview` and `sizeMode` described them.
  // A widget's face is its `object` kind's program now, or nothing.
  const retired = ["presentation", "surface", "component", "chrome", "animated", "preview", "instancePreview", "sizeMode"]
    .filter((k) => (def as unknown as Record<string, unknown>)[k] !== undefined);
  if (retired.length > 0) {
    throw new Error(
      `ice: defineWidget("${def.type}") declares ${retired.join(", ")} — the view half of a widget is retired (design-015 D5b): a widget's face is its object kind's program (\`object:\`), and nothing mounts a component, a chrome, a preview or a surface for it. Drop ${retired.length > 1 ? "them" : "it"}.`,
    );
  }
  if ((def.container as { framePreview?: unknown } | undefined)?.framePreview !== undefined) {
    throw new Error(
      `ice: defineWidget("${def.type}") container declares framePreview — the container's preview renderer is retired (design-015 D5b): a mini mat's inside is drawn by the desk.`,
    );
  }

  // The FACE: an `object` binding, or none. `null` is how a caller says "none".
  const hasObject = def.object !== undefined && def.object !== null;
  if (!hasObject && def.openable === true) {
    throw new Error(
      `ice: defineWidget("${def.type}") declares openable and carries no object binding — only an object is picked up into the hand (design-015 §8). Pass object: <a kind that opens>, or drop it.`,
    );
  }
  // the held bar's tools belong to what is held (design-015 §8, D3t-a)
  if ((def.heldTools?.length ?? 0) > 0 || def.heldTool !== undefined) {
    if (!(hasObject && def.openable === true)) {
      throw new Error(`ice: defineWidget("${def.type}") declares held tools but does not open — only an object picked up into the hand has a held bar (design-015 §8).`);
    }
    validateHeldTools(def.type, def.heldTools ?? []);
  }
  for (const d of def.data ?? []) {
    if (d.store !== "durable") throw new Error(`ice: defineWidget("${def.type}") data prefab "${d.id}" is ${d.store} — an object's data children live in the document (durable).`);
    if (d.id === def.type) throw new Error(`ice: defineWidget("${def.type}") names itself as its own data prefab.`);
  }
  if (def.stratum !== undefined && !Object.hasOwn(STRATUM_BANDS, def.stratum)) {
    throw new Error(
      `ice: defineWidget("${def.type}") declares stratum "${String(def.stratum)}" — a desk stratum is "pads", "sheets" or "things" (design-015 §4.2).`,
    );
  }

  const tray = def.tray === undefined ? undefined : compileTrayEntry(def.type, def.tray, hasObject, props);

  const version = def.version ?? 1;
  if (def.migrate !== undefined) validateMigrateChain(def.type, version, def.migrate);


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
  if (interaction.wheelTurns === true) capabilityTags.push(WheelTurns);
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
    object: hasObject ? def.object : undefined,
    stratum: def.stratum ?? (hasObject ? "things" : undefined),
    openable: hasObject && def.openable === true,
    heldTools: Object.freeze([...(def.heldTools ?? [])]),
    heldTool: def.heldTool,
    riders: def.riders,
    data: Object.freeze([...(def.data ?? [])]),
    defaultSize,
    minSize: def.minSize ?? { w: 40, h: 40 },
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
            frameProjection: def.container.frameProjection,
            typed: def.container.typed === true,
          }),
    keyboard: interaction.keyboard ?? "shared",
    keyboardEscape: interaction.keyboardEscape ?? "release",
    drop: interaction.drop ?? "into",
    migrate: def.migrate ?? {},
    behaviors: behaviorEntries,
    tray,
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

/**
 * A tray entry, checked and frozen (design-017 §8): an object's only; a name tag; its props the widget's own, each valid under its
 * spec; a hang the lattice law can lay (kernel `hangError`); a finite order and a string category if given.
 */
function compileTrayEntry(type: string, entry: TrayEntry, hasObject: boolean, props: PropsDecl): TrayEntry {
  const fail = (why: string): never => { throw new Error(`ice: defineWidget("${type}") tray entry — ${why} (design-017 §8).`); };
  if (!hasObject) fail("only an object hangs on the tray: a specimen is its kind's own drawing, and this widget has no object binding");
  if (typeof entry !== "object" || entry === null) fail("an entry is { label, props?, hang, order?, category? }");
  if (typeof entry.label !== "string" || entry.label.trim() === "") fail("its label (the specimen's name tag) is not a non-empty string");
  const valid = (given: unknown, what: string): Readonly<Record<string, unknown>> => {
    if (typeof given !== "object" || given === null || Array.isArray(given)) return fail(`its ${what} are not a record`);
    for (const [name, value] of Object.entries(given)) {
      const spec = props[name];
      if (spec === undefined) fail(`its ${what} name "${name}", which the widget does not declare`);
      const result = (spec as PropSpec)["~standard"].validate(value);
      if ("issues" in result && result.issues !== undefined) fail(`its ${what === "props" ? "prop" : "take prop"} "${name}" is invalid — ${result.issues[0]?.message}`);
    }
    return given as Readonly<Record<string, unknown>>;
  };
  const given = valid(entry.props ?? {}, "props");
  const take = entry.take === undefined || entry.take === "face" ? entry.take : valid(entry.take, "take props");
  const why = hangError(entry.hang);
  if (why !== null) fail(`its hang: ${why}`);
  if (entry.order !== undefined && !Number.isFinite(entry.order)) fail(`its order ${String(entry.order)} is not a finite number`);
  if (entry.category !== undefined && typeof entry.category !== "string") fail("its category is not a string");
  const hang = entry.hang;
  return Object.freeze({
    label: entry.label,
    props: Object.freeze({ ...given }),
    ...(take !== undefined ? { take: take === "face" ? take : Object.freeze({ ...take }) } : {}),
    hang: Object.freeze({ w: hang.w, h: hang.h, accessory: hang.accessory, pegs: Object.freeze(hang.pegs.map((p) => Object.freeze([p[0], p[1]] as const))) }),
    ...(entry.order !== undefined ? { order: entry.order } : {}),
    ...(entry.category !== undefined ? { category: entry.category } : {}),
  });
}

/** What one taken off the tray is made with (design-017 §9; K5b, D-K5b.1): the entry's `take` — the face's props, its own, or none (the widget's defaults). */
export function trayTakeProps(entry: TrayEntry): Readonly<Record<string, unknown>> | undefined {
  if (entry.take === undefined) return undefined;
  return entry.take === "face" ? entry.props : entry.take;
}

/** TEST-ONLY wipe (mirrors __resetPrefabsForTests; not on the barrel). */
export function __resetWidgetsForTests(): void {
  registry.clear();
  renameRegistry.clear();
}
