/**
 * Prefabs — sovereignty at the entity level (design-001 §2, rev 2).
 *
 * A prefab declares an entity kind's ESSENTIAL component set, its
 * durable-ELIGIBLE extras, and its class; the class IS the spawn path:
 *   durable → tx.spawn · runtime → world/ctx.spawn · ephemeral → eph.spawn
 *
 * Validation set (design-005 §1, all DEV-throw at definition time):
 *  - eligible components eid-free (durable prefabs)
 *  - every essential component's required fields supplied by its init value
 *  - ephemeral prefabs: components + tags only (no relations)
 *  - owner:"derive" only on runtime prefabs
 *  - prefab ids unique
 */
import type { Component, Entity, EntityKey, Relation, Tag } from "@vibecook/strata-ecs";
import { defineComponent, schemaMeta } from "./meta";

/** Durable identity stamp (design-001 §2 rule 5) — subsumes WidgetType. */
export const PrefabId = defineComponent("PrefabId", { id: "string" });

export type PrefabClass = "durable" | "runtime" | "ephemeral";

/** Scalar shapes strata accepts as field writes at spawn. */
export type FieldWrite = string | number | boolean | Entity | EntityKey | null;

export type ComponentInit = readonly [Component, Record<string, FieldWrite>];

/**
 * Typed component-init pair: `init(Position, { x: 0, y: 0 })` gets full
 * compile-time field checking (missing/extra/mistyped fields error) before
 * erasing to the registry's loose `ComponentInit`. Prefer this in every
 * prefab definition and instantiate override; raw pairs remain legal for
 * dynamic construction (review finding B4).
 */
export function init<S extends Record<string, FieldWrite>>(c: Component<S>, v: S): ComponentInit {
  return [c as Component, v];
}

export interface PrefabDef {
  store: PrefabClass;
  /** Essential set: spawned with, committed for durable prefabs. */
  components: readonly ComponentInit[];
  tags?: readonly Tag[];
  /** Durable-eligible beyond essential (attachable later via tx); facets for ephemeral. */
  optional?: readonly Component[];
  /** Eligible outgoing relations (durable prefabs; runtime relations are unrestricted). */
  relations?: readonly Relation[];
  /** Write-ownership badge (devtools) — runtime prefabs only. */
  owner?: "derive";
  /**
   * Pack version for the document version gate (design-001 §5.2, design-005
   * §6.3): stamped as an `engine.pack.<id>.<v>` marker key at doc creation and
   * compared at open. Bump when the prefab's durable shape changes. Default 1.
   */
  version?: number;
}

export interface Prefab extends PrefabDef {
  id: string;
  /** Eligible component set = essential ∪ optional ∪ {PrefabId}. */
  eligible: ReadonlySet<Component>;
  eligibleRelations: ReadonlySet<Relation>;
}

const registry = new Map<string, Prefab>();

export function definePrefab(id: string, def: PrefabDef): Prefab {
  if (registry.has(id)) {
    throw new Error(`ice: prefab "${id}" is already defined — prefab ids are unique per process.`);
  }
  if (def.owner === "derive" && def.store !== "runtime") {
    throw new Error(`ice: prefab "${id}": owner "derive" is only valid on runtime prefabs.`);
  }
  if (def.store === "ephemeral" && def.relations && def.relations.length > 0) {
    throw new Error(
      `ice: prefab "${id}": the presence store supports components + tags only — no relations (design-001 §1).`,
    );
  }

  const eligible = new Set<Component>();
  for (const [c] of def.components) eligible.add(c);
  for (const c of def.optional ?? []) eligible.add(c);
  eligible.add(PrefabId as Component);

  if (def.store === "durable") {
    for (const c of eligible) {
      const meta = schemaMeta.component(c);
      if (meta && meta.eidFields.length > 0) {
        throw new Error(
          `ice: prefab "${id}": component "${meta.name}" carries eid field(s) [${meta.eidFields.join(", ")}] — eid is banned in durable cells; use keys or relations (design-001 §2 rule 3).`,
        );
      }
    }
  }

  for (const [c, value] of def.components) {
    const meta = schemaMeta.component(c);
    if (!meta) continue; // defined outside @ice/core wrappers — validation is best-effort
    for (const f of meta.requiredFields) {
      if (!(f in value)) {
        throw new Error(
          `ice: prefab "${id}": essential component "${meta.name}" is missing required field "${f}" (no default declared — strata would throw at spawn; supply it in the prefab).`,
        );
      }
    }
  }

  const prefab: Prefab = {
    ...def,
    id,
    eligible,
    eligibleRelations: new Set(def.relations ?? []),
  };
  registry.set(id, prefab);
  return prefab;
}

export const prefabs = {
  get(id: string): Prefab | undefined {
    return registry.get(id);
  },
  /** Every registered prefab (the version gate stamps/compares the full set). */
  all(): Prefab[] {
    return [...registry.values()];
  },
};

/**
 * TEST-ONLY registry wipe. Deliberately a standalone export that the public
 * barrel does NOT re-export (review finding A8) — tests import it from this
 * module path directly.
 */
export function __resetPrefabsForTests(): void {
  registry.clear();
}
