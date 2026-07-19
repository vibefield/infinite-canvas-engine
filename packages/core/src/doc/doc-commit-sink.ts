/**
 * The doc-backed CommitSink — the M5 half of the commit seam (design-001 §3
 * step 3a; design-002 decision 4).
 *
 * One intent = ONE `guardedTransaction` = one undo step. Behaviors already
 * filtered their write sets to live `Drags` edges; the sink re-guards anyway —
 * the doc is the authority (design-001 §3: `keyOf(w) === undefined ⇒ skip` —
 * one dead widget must not roll back the gesture). Value writes go through
 * `tx.edit().set` on PRE-EXISTING cells (the synchronous agreement point);
 * consume's reparent is a relation write in the SAME transaction.
 *
 * Read-only sessions (version gate) swap in `createReadOnlyCommitSink`: the
 * gesture still runs (runtime feels live) but nothing commits — the runtime
 * cells reconverge with the baseline at the next remote sweep, exactly like a
 * cancel, and a DEV warn says why.
 */
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import type { World } from "@vibecook/strata-ecs";
import { ChildOf } from "../catalog";
import type { CommitIntent, CommitSink } from "../engine/commit-sink";
import { init } from "../schema/prefab";
import { WireFrom, WirePorts, WirePrefab, WireTo } from "../catalog/graph";
import { attachSpawnParent, widgetSpawnInits } from "../widget/spawn";
import { guardedTransaction } from "../guards/guarded-tx";

export function createDocCommitSink(store: DurableStore, world: World): CommitSink {
  return {
    commit(intent: CommitIntent): void {
      const liveWrites = intent.writes.filter((w) => store.keyOf(w.entity) !== undefined);
      const liveReparents = (intent.reparents ?? []).filter(
        (r) => store.keyOf(r.entity) !== undefined && store.keyOf(r.container) !== undefined,
      );
      // Wires bind widgets + port ids (design-001 §5.3): both ENDPOINT widgets
      // must still be durable-live at commit (the same divergence-is-the-signal
      // re-guard as writes — a remote delete mid-gesture drops the spawn).
      const liveWires = (intent.wires ?? []).filter(
        (w) => store.keyOf(w.from) !== undefined && store.keyOf(w.to) !== undefined,
      );
      // Order ops (petition 8): both ends re-guarded — a dead parent must not
      // roll back the gesture any more than a dead widget does.
      const liveOrders = (intent.orders ?? []).filter(
        (o) => store.keyOf(o.entity) !== undefined && store.keyOf(o.parent) !== undefined,
      );
      const creates = intent.creates ?? [];
      if (
        liveWrites.length === 0 &&
        liveReparents.length === 0 &&
        liveOrders.length === 0 &&
        liveWires.length === 0 &&
        creates.length === 0
      ) {
        return;
      }

      guardedTransaction(store, world, (tx) => {
        for (const w of liveWrites) {
          tx.edit(w.entity).set(w.component, w.value);
        }
        for (const r of liveReparents) {
          // Placeless set on the ordered ChildOf appends "last" — a consumed
          // widget lands on top of the container's sequence (petition 8).
          tx.setRelation(r.entity, ChildOf, r.container);
        }
        // Sibling placements land in the SAME transaction as the gesture's
        // value writes — one gesture, one undo step (petition 8).
        for (const o of liveOrders) {
          tx.setRelation(o.entity, ChildOf, o.parent, o.place);
        }
        // Draw-tool creations: one prefab spawn per rect (design-005 §3),
        // through the SAME override builder as ops.spawnWidget — and the same
        // frame-parent edge attach, so the two spawn paths cannot diverge.
        for (const c of creates) {
          const { prefab, overrides } = widgetSpawnInits(c.type, { x: c.x, y: c.y, w: c.w, h: c.h });
          const spawned = tx.spawnPrefab(prefab, overrides);
          attachSpawnParent(tx, world, spawned);
        }
        for (const w of liveWires) {
          // The paved prefab path: PrefabId + Wire tag ride the prefab, and
          // WireFrom/WireTo pass its eligibility contract (raw spawn skipped
          // those checks entirely — 2026-07-13 review).
          const wire = tx.spawnPrefab(WirePrefab, [init(WirePorts, { from: w.fromPort, to: w.toPort })]);
          tx.setRelation(wire, WireFrom, w.from);
          tx.setRelation(wire, WireTo, w.to);
        }
      });
    },
  };
}

/** The version-gate's read-only posture: gestures run, nothing commits. */
export function createReadOnlyCommitSink(): CommitSink {
  return {
    commit(intent) {
      console.warn(
        `ice: read-only document — dropped a "${intent.kind}" commit (${intent.writes.length} writes); runtime cells reconverge with the baseline.`,
      );
    },
  };
}
