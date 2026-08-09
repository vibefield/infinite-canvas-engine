/**
 * The prefab rename runner (design-008 §5, petition I5) — the open-path half.
 *
 * Runs in doc-kit's migrate branch AFTER the structural schema steps and
 * BEFORE the M9 pack runner, under the same SINGLE-WRITER LAW (solo-open
 * only; live joiners pass migrate:false and stay read-only). For each old id
 * the gate reported (`report.renamedInDoc` — old id → its doc pack version):
 *
 *  1. PLAN: every durable entity whose `PrefabId.id` is the old id; its
 *     legacy `<old>:<group>` cells read through the world — they PROJECT
 *     because `renamedFrom` registered same-shaped components under the old
 *     names (design-008 §1.1: projection is name-registry-driven).
 *  2. WRITE, one non-undoable transaction per old id: PrefabId → new id;
 *     each legacy value moved to the new-name group cell (absolute writes;
 *     a defensively-present new cell wins — §6.2); legacy cells removed.
 *     NO version-chain folding here — that is the pack runner's job, right
 *     after, on the new names.
 *  3. STAMP (write-once): the tombstone `engine.renamed.<old>` = newId, and
 *     the carried pack marker `engine.pack.<new>.<docOldV>`. The tombstone
 *     makes the gate skip the undeletable old markers forever; the carried
 *     marker preserves the doc's version evidence under the NEW id — without
 *     it the fresh report would show no `olderInDoc` entry and the pack
 *     runner would silently skip the migrate chain over v-old cells.
 *
 * Idempotence/convergence: absolute cell writes + write-once markers — two
 * solo peers folding the same doc produce identical cells that merge LWW
 * (the migrate.ts argument). A fault mid-plan writes nothing; a fault after
 * the fold but before the stamps re-runs cleanly (folded entities no longer
 * match the old id).
 */
import { defineQuery } from "@vibecook/strata-ecs";
import type { Component, Entity } from "@vibecook/strata-ecs";
import { PrefabId } from "../schema/prefab";
import { renames } from "../widget/define-widget";
import type { MigrationCtx } from "./migrate";
import type { DocVersionReport } from "./version-gate";

const PACK_PREFIX = "engine.pack.";
const RENAMED_PREFIX = "engine.renamed.";

const allDurableQ = defineQuery([PrefabId]);

export interface RenameOutcome {
  /** Old ids folded and tombstoned this open (marker-only docs still stamp). */
  readonly renamed: string[];
}

interface EntityRenamePlan {
  readonly e: Entity;
  /** Legacy value per group index (undefined = cell absent on this entity). */
  readonly legacyValues: readonly (Record<string, unknown> | undefined)[];
  /** New-name cell already present per group index (defensive new-wins). */
  readonly newPresent: readonly boolean[];
}

export function runRenames(ctx: MigrationCtx, report: DocVersionReport): RenameOutcome {
  const { store, world } = ctx;
  const renamed: string[] = [];

  for (const [oldId, docOldV] of Object.entries(report.renamedInDoc)) {
    const entry = renames.get(oldId);
    if (entry === undefined) continue; // registry changed mid-open — defensive
    const { widget, legacyGroups } = entry;

    // --- plan (reads only; a throw leaves the doc byte-identical) ---
    const plans: EntityRenamePlan[] = [];
    world.query(allDurableQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (world.read(e, PrefabId).id !== oldId) continue;
        const legacyValues: (Record<string, unknown> | undefined)[] = [];
        const newPresent: boolean[] = [];
        for (let i = 0; i < widget.groups.length; i++) {
          const legacy = world.get(e, legacyGroups[i] as Component);
          legacyValues.push(legacy as Record<string, unknown> | undefined);
          newPresent.push(world.get(e, (widget.groups[i] as { component: Component }).component) !== undefined);
        }
        plans.push({ e, legacyValues, newPresent });
      }
    });

    // --- write: ONE non-undoable transaction per old id ---
    if (plans.length > 0) {
      store.transaction(
        (tx) => {
          for (const { e, legacyValues, newPresent } of plans) {
            tx.edit(e).set(PrefabId, { id: widget.type });
            for (let i = 0; i < widget.groups.length; i++) {
              const value = legacyValues[i];
              if (value === undefined) continue;
              if (!newPresent[i]) {
                tx.addComponent(e, (widget.groups[i] as { component: Component }).component, value);
              }
              tx.removeComponent(e, legacyGroups[i] as Component);
            }
          }
        },
        { undoable: false },
      );
    }

    // --- stamp: tombstone + carried pack version (write-once, after the fold) ---
    store.metaTransaction((meta) => {
      const tomb = `${RENAMED_PREFIX}${oldId}`;
      if (meta.get(tomb) === undefined) meta.set(tomb, widget.type);
      const pack = `${PACK_PREFIX}${widget.type}.${docOldV}`;
      if (meta.get(pack) === undefined) meta.set(pack, true);
    });
    renamed.push(oldId);
  }

  return { renamed };
}
