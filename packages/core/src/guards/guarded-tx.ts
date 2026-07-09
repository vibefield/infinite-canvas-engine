/**
 * Eligibility-guarded transactions (design-001 §2 rule 3): `tx.*` structural
 * writes are validated against the target entity's prefab — a component
 * outside the eligible set, a relation outside the eligible relations, or a
 * runtime-declared resource in a tx is a DEV error.
 *
 * Prefab resolution: entities spawned in THIS tx via `spawnPrefab` are known
 * from a tx-local map; pre-existing durable entities resolve via their
 * projected `PrefabId`. Entities from raw `tx.spawn` are unknown → checks
 * skip (the guard is best-effort by design; `spawnPrefab` is the paved road).
 * Tags are not eligibility-checked in M2 (essential tags spawn with the
 * prefab; optional-tag modeling is future work — documented).
 */
import type { Component, Entity, Relation, Resource, Tag, World } from "@vibecook/strata-ecs";
import type { Mutator } from "@vibecook/strata-ecs/durable";
import { instantiate } from "../engine/instantiate";
import { schemaMeta } from "../schema/meta";
import { prefabs, PrefabId, type ComponentInit, type Prefab } from "../schema/prefab";
import { devGuardsEnabled } from "./dev";

export interface GuardedTx {
  spawnPrefab(prefab: Prefab, overrides?: readonly ComponentInit[]): Entity;
  /** Raw spawn — entity is unknown to the guard (prefer spawnPrefab). */
  spawn: Mutator["spawn"];
  destroy(e: Entity): void;
  addComponent<S>(e: Entity, c: Component<S>, v: S): void;
  removeComponent(e: Entity, c: Component): void;
  edit(e: Entity): { set<S>(c: Component<S>, v: S): GuardedEditor };
  addTag(e: Entity, t: Tag): void;
  removeTag(e: Entity, t: Tag): void;
  setRelation(e: Entity, r: Relation, target: Entity): void;
  addRelation(e: Entity, r: Relation, target: Entity): void;
  removeRelation(e: Entity, r: Relation, target?: Entity): void;
  setResource<S>(res: Resource<S>, v: S): void;
}

interface GuardedEditor {
  set<S>(c: Component<S>, v: S): GuardedEditor;
}

interface TxDoc {
  transaction(fn: (tx: Mutator) => void): void;
}

export function guardedTransaction(doc: TxDoc, world: World, run: (tx: GuardedTx) => void): void {
  doc.transaction((tx) => {
    const spawned = new Map<Entity, Prefab>();

    const prefabOf = (e: Entity): Prefab | undefined => {
      const local = spawned.get(e);
      if (local) return local;
      const id = world.get(e, PrefabId)?.id;
      return typeof id === "string" ? prefabs.get(id) : undefined;
    };

    const checkComponent = (e: Entity, c: Component, op: string): void => {
      if (!devGuardsEnabled()) return;
      const prefab = prefabOf(e);
      if (prefab && !prefab.eligible.has(c)) {
        const name = schemaMeta.component(c)?.name ?? "<component>";
        throw new Error(
          `ice: tx.${op}: component "${name}" is not durable-eligible on prefab "${prefab.id}" — declare it in the prefab's essential or optional set (design-001 §2 rule 3).`,
        );
      }
    };

    const checkRelation = (e: Entity, r: Relation, op: string): void => {
      if (!devGuardsEnabled()) return;
      const prefab = prefabOf(e);
      if (prefab && !prefab.eligibleRelations.has(r)) {
        const name = schemaMeta.relation(r)?.name ?? "<relation>";
        throw new Error(
          `ice: tx.${op}: relation "${name}" is not durable-eligible on prefab "${prefab.id}" — declare it in the prefab's relations (design-001 §2 rule 6).`,
        );
      }
    };

    const guarded: GuardedTx = {
      spawnPrefab(prefab, overrides) {
        const e = instantiate(prefab, { into: "tx", tx }, overrides);
        spawned.set(e, prefab);
        return e;
      },
      spawn: (init) => tx.spawn(init),
      destroy: (e) => tx.destroy(e),
      addComponent(e, c, v) {
        checkComponent(e, c as Component, "addComponent");
        tx.addComponent(e, c, v);
      },
      removeComponent: (e, c) => tx.removeComponent(e, c),
      edit(e) {
        const editor: GuardedEditor = {
          set(c, v) {
            checkComponent(e, c as Component, "edit().set");
            tx.edit(e).set(c, v);
            return editor;
          },
        };
        return editor;
      },
      addTag: (e, t) => tx.addTag(e, t),
      removeTag: (e, t) => tx.removeTag(e, t),
      setRelation(e, r, target) {
        checkRelation(e, r, "setRelation");
        tx.setRelation(e, r, target);
      },
      addRelation(e, r, target) {
        checkRelation(e, r, "addRelation");
        tx.addRelation(e, r, target);
      },
      removeRelation: (e, r, target) => tx.removeRelation(e, r, target),
      setResource(res, v) {
        if (devGuardsEnabled()) {
          const meta = schemaMeta.resource(res as Resource);
          if (meta && !meta.durable) {
            throw new Error(
              `ice: tx.setResource: resource "${meta.name}" is declared runtime — durable resources opt in at definition (design-001 §2 rule 7).`,
            );
          }
        }
        tx.setResource(res, v);
      },
    };

    run(guarded);
  });
}
