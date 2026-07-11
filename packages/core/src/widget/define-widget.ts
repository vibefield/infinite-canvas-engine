/**
 * `defineWidget` v1 — the flagship compiler (design-005 §2).
 *
 * Sugar over `definePrefab` + registries — nothing here is unavailable to a
 * hand-rolled prefab. Compile output:
 *  - one durable prefab: `PrefabId{type}` + Position/Size/StackZ + ONE
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
import type { Component, Tag } from "@vibecook/strata-ecs";
import {
  Accepts,
  Container,
  Movable,
  Position,
  Provides,
  Resizable,
  Selectable,
  Size,
  SnapSource,
  SnapTarget,
  StackZ,
} from "../catalog";
import { defineComponent, defineTag } from "../schema/meta";
import { definePrefab, init, type ComponentInit, type Prefab } from "../schema/prefab";
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

export interface WidgetInteraction {
  readonly selectable?: boolean;
  readonly movable?: boolean;
  readonly resizable?: boolean;
  readonly snap?: "source" | "target" | "both" | "none";
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
  readonly container?: { readonly accepts: readonly string[]; readonly provides?: readonly string[] };
  /**
   * Provides-keys WITHOUT container semantics (nodeboard field finding): a
   * leaf that only offers itself to containers must not become a Container
   * (drop target + Enter affordance). Ignored when `container` is present
   * (its `provides` wins).
   */
  readonly provides?: readonly string[];
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
  readonly sizeMode: SizeMode;
  readonly defaultSize: { readonly w: number; readonly h: number };
  readonly minSize: { readonly w: number; readonly h: number };
  /** GL islands: repaint every visible frame (design-004 §3). */
  readonly animated: boolean;
  /** Node-editor ports (empty when not a node). */
  readonly ports: readonly WidgetPortDecl[];
  /** Runtime capability tags the equip system stamps at projection. */
  readonly capabilityTags: readonly Tag[];
  readonly migrate: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>>;
}

/** Stamped by the equip system once a projected widget carries its capability tags. */
export const WidgetEquipped = defineTag("WidgetEquipped");

const registry = new Map<string, WidgetType>();

export const widgets = {
  get(type: string): WidgetType | undefined {
    return registry.get(type);
  },
  all(): WidgetType[] {
    return [...registry.values()];
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
  for (const [g, fields] of byGroup) {
    const raw: Record<string, ReturnType<typeof strataFieldOf>> = {};
    for (const [name, spec] of Object.entries(fields)) raw[name] = strataFieldOf(name, spec);
    groups.push({ name: g, component: defineComponent(`${def.type}:${g}`, raw) as Component, fields });
  }

  // Essential set: geometry + every group at its defaults (+ container cells).
  const defaultSize = def.defaultSize ?? { w: 240, h: 160 };
  const essential: ComponentInit[] = [
    init(Position, { x: 0, y: 0 }),
    init(Size, { w: defaultSize.w, h: defaultSize.h }),
    init(StackZ, { z: 0 }),
  ];
  for (const g of groups) {
    const defaults: Record<string, string | number | boolean> = {};
    for (const [name, spec] of Object.entries(g.fields)) {
      if (spec.kind === "json") defaults[name] = (spec as JsonSpec).default ?? "null";
      else if (spec.kind === "enum") defaults[name] = spec.default ?? spec.options[0] ?? "";
      else defaults[name] = spec.default ?? (spec.kind === "string" ? "" : spec.kind === "number" ? 0 : false);
    }
    essential.push([g.component, defaults] as ComponentInit);
  }
  if (def.container !== undefined) {
    essential.push(init(Accepts, { list: JSON.stringify(def.container.accepts) }));
    essential.push(init(Provides, { list: JSON.stringify(def.container.provides ?? []) }));
  } else if (def.provides !== undefined && def.provides.length > 0) {
    essential.push(init(Provides, { list: JSON.stringify(def.provides) })); // leaf: no Container tag
  }

  const version = def.version ?? 1;
  if (def.migrate !== undefined) validateMigrateChain(def.type, version, def.migrate);

  const prefab = definePrefab(def.type, {
    store: "durable",
    components: essential,
    version,
  });

  // Capability recipe → runtime tags at projection (equip system).
  const interaction = def.interaction ?? {};
  const capabilityTags: Tag[] = [];
  if (interaction.selectable !== false) capabilityTags.push(Selectable);
  if (interaction.movable !== false) capabilityTags.push(Movable);
  if (interaction.resizable === true) capabilityTags.push(Resizable);
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
    sizeMode: def.sizeMode ?? "fixed",
    defaultSize,
    minSize: def.minSize ?? { w: 40, h: 40 },
    animated: def.animated === true,
    ports: def.ports ?? [],
    capabilityTags,
    migrate: def.migrate ?? {},
  };
  registry.set(def.type, widget);
  return widget;
}

/** TEST-ONLY wipe (mirrors __resetPrefabsForTests; not on the barrel). */
export function __resetWidgetsForTests(): void {
  registry.clear();
}
