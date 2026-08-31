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
import type { Entity, World } from "@vibecook/strata-ecs";
import { ChildOf } from "../catalog";
import type { CommitIntent, CommitSink } from "../engine/commit-sink";
import { init } from "../schema/prefab";
import { WireFrom, WirePorts, WirePrefab, WireTo } from "../catalog/graph";
import { attachSpawnParent, widgetSpawnInits } from "../widget/spawn";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { guardedTransaction } from "../guards/guarded-tx";

/**
 * Out-of-ECS hand-off for `CommitCreate.select` (the marquee-buffer precedent:
 * plain JS state written mid-tick, consumed by a system in a later phase —
 * never observed, never ECS). The sink appends the spawned twin here; the
 * insert-ghost reap system drains it and applies the selection ONE tick later,
 * when the twin's projection is alive. Keyed per world so parallel test
 * engines never cross-talk.
 */
const pendingSelects = new WeakMap<World, Entity[]>();

export function drainCreatedSelections(world: World): Entity[] {
  const list = pendingSelects.get(world);
  if (list === undefined || list.length === 0) return [];
  pendingSelects.set(world, []);
  return list;
}

export interface DocCommitSinkOpts {
  /** Whole-intent final authority; undefined means reject without a transaction. */
  readonly guard?: (intent: CommitIntent) => CommitIntent | undefined;
}

export function createDocCommitSink(
  store: DurableStore,
  world: World,
  opts: DocCommitSinkOpts = {},
): CommitSink {
  return {
    commit(input: CommitIntent): boolean {
      const intent = opts.guard?.(input) ?? (opts.guard === undefined ? input : undefined);
      if (intent === undefined) return false;
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
      // Creates re-guard their PARENT (a consume-insert whose folder a remote
      // deleted mid-gesture): the container-local x/y are meaningless without
      // the container, so the create is dropped whole — the same
      // divergence-is-the-signal posture as a dead reparent target. Unknown
      // types are dropped too (never a throw inside the gesture's tx).
      const creates = (intent.creates ?? []).filter(
        (c) =>
          widgetTypeFor(world, c.type) !== undefined &&
          (c.parent === undefined || store.keyOf(c.parent) !== undefined),
      );
      if (
        liveWrites.length === 0 &&
        liveReparents.length === 0 &&
        liveOrders.length === 0 &&
        liveWires.length === 0 &&
        creates.length === 0
      ) {
        return false;
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
        // Draw-tool / tray-insert creations: one prefab spawn per entry,
        // through the SAME override builder as ops.spawnWidget — and the same
        // frame-parent edge attach, so the spawn paths cannot diverge. An
        // explicit `parent` (consume-insert) hangs the edge on the container
        // instead — x/y are container-local by that convention.
        for (const c of creates) {
          const widget = widgetTypeFor(world, c.type);
          if (widget === undefined) continue;
          const { prefab, overrides } = widgetSpawnInits(c.type, {
            x: c.x,
            y: c.y,
            w: c.w,
            h: c.h,
            ...(c.props !== undefined ? { props: c.props } : {}),
          }, widget);
          const spawned = tx.spawnPrefab(prefab, overrides);
          attachSpawnParent(tx, world, spawned, c.parent !== undefined ? { parent: c.parent } : undefined);
          if (c.select === true) {
            let list = pendingSelects.get(world);
            if (list === undefined) {
              list = [];
              pendingSelects.set(world, list);
            }
            list.push(spawned);
          }
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
      return true;
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
      return false;
    },
  };
}
