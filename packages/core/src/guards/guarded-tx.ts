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
import type { Component, Entity, OrderPlace, Relation, Resource, Tag, World } from "@vibecook/strata-ecs";
import type { Mutator } from "@vibecook/strata-ecs/durable";
import { behaviors } from "../behavior/define-behavior";
import { Grab, Position, TransformTween } from "../catalog";
import { instantiate } from "../engine/instantiate";
import { schemaMeta } from "../schema/meta";
import { PrefabId, type ComponentInit, type Prefab } from "../schema/prefab";
import { devGuardsEnabled } from "./dev";
import type { LiveWriter } from "./live-writer";
import { durablePrefabFor } from "../canvas/engine-catalog";

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
  setRelation(e: Entity, r: Relation, target: Entity, place?: OrderPlace): void;
  addRelation(e: Entity, r: Relation, target: Entity): void;
  removeRelation(e: Entity, r: Relation, target?: Entity): void;
  /** Reorder within the current parent's sibling sequence — ordered relations only (petition 8). */
  moveRelation(e: Entity, r: Relation, place: OrderPlace): void;
  setResource<S>(res: Resource<S>, v: S): void;
  /**
   * Animation-integrated write (petition I15): ONE commit owns the capture, the
   * durable final, and the glide. `from` is read AT CALL TIME (pre-commit by
   * construction), the final lands in THIS transaction — inheriting its
   * `undoable` — and after a successful seal the tail installs the verified
   * public-surface glide: `TransformTween` (which GRANTS the divergence) then a
   * live rewind to `from`. One commit, one undo entry, no double-write.
   *
   * `animateMs` absent/0 = snap (no tween attached at all). A `Grab`-held
   * entity is SKIPPED — the gesture owns its divergence. An entity already
   * tweening is RETARGETED (its `toX/toY` rewritten) rather than restarted, so
   * a re-layout mid-glide re-aims instead of completing at a stale target.
   *
   * Requires `opts.live` (the session's LiveWriter) — without it the rewind
   * could not be divergence-guarded, so the call refuses rather than writing
   * around the guard.
   */
  move(e: Entity, to: { x: number; y: number }, opts?: { animateMs?: number }): void;
}

interface GuardedEditor {
  set<S>(c: Component<S>, v: S): GuardedEditor;
}

interface TxDoc {
  transaction(fn: (tx: Mutator) => void, opts?: { undoable?: boolean; meta?: Record<string, unknown> }): void;
}

export interface GuardedTxOpts {
  /**
   * strata 0.3.0 passthrough: `false` excludes this commit from the LOCAL
   * undo stack (batch seeds, janitorial writes — retires the cardboard
   * first-⌘Z-removes-a-seed quirk). Default true: one tx = one undo step.
   */
  readonly undoable?: boolean;
  /**
   * The session's live writer. Required by {@link GuardedTx.move} (its
   * post-commit rewind is a live write to a doc cell, legal only under the
   * tween grant) and by the post-seal retarget sweep below.
   */
  readonly live?: LiveWriter;
  /** Optional entity → doc-key probe; when absent every entity is treated as
   *  durable-if-Position-eligible. Used to skip runtime-only movers' tx write. */
  readonly keyOf?: (e: Entity) => string | undefined;
  /**
   * Per-commit PROVENANCE (strata 0.12.0, petition 9): a small record carried
   * in-CRDT with the batch, so a receiving peer can say who wrote this and why.
   * The behavior framework stamps `{ behavior, label }` on every `ctx.commit`
   * (design-009 §4.4 — `label` is a stable machine id, never display text).
   * Note that shallow saves erase provenance below the compaction boundary, so
   * it is diagnostics, never a data dependency.
   */
  readonly meta?: Record<string, unknown>;
}

/**
 * Retarget a live tween onto `to`, or start one from `from`.
 * Returns false when the entity is Grab-held (the gesture owns its divergence).
 */
function glide(
  world: World,
  live: LiveWriter,
  e: Entity,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs: number,
): boolean {
  if (!world.isAlive(e) || world.has(e, Grab)) return false;
  const existing = world.get(e, TransformTween);
  if (existing !== undefined) {
    // RETARGET, never restart: the ease continues from its captured origin at
    // current progress, so a re-layout mid-glide re-aims smoothly.
    world.edit(e).set(TransformTween, { ...existing, toX: to.x, toY: to.y });
    return true;
  }
  world.addComponent(e, TransformTween, {
    toX: to.x,
    toY: to.y,
    durationMs,
    elapsedMs: 0,
  });
  live.set(e, Position, { x: from.x, y: from.y });
  return true;
}

export function guardedTransaction(
  doc: TxDoc,
  world: World,
  run: (tx: GuardedTx) => void,
  opts?: GuardedTxOpts,
): void {
  // Post-commit work: the glide tail (tx.move) and the retarget sweep. Both
  // run ONLY if the seal succeeded — a throwing body propagates and skips them,
  // so a rolled-back transaction never leaves a tween pointing anywhere.
  const tail: Array<() => void> = [];
  /** Entities this tx moved through `move` — exempt from the sweep below. */
  const moved = new Set<Entity>();
  /** Entities whose Position this tx wrote by any OTHER path. */
  const positionWrites = new Map<Entity, { x: number; y: number }>();

  doc.transaction((tx) => {
    const spawned = new Map<Entity, Prefab>();

    const prefabOf = (e: Entity): Prefab | undefined => {
      const local = spawned.get(e);
      if (local) return local;
      const id = world.get(e, PrefabId)?.id;
      return typeof id === "string" ? durablePrefabFor(world, id) : undefined;
    };

    const checkComponent = (e: Entity, c: Component, op: string): void => {
      if (!devGuardsEnabled()) return;
      // BF-D6 (design-001 amendment): a registered DURABLE behavior's own data
      // component is universally durable-eligible. Behaviors attach to any
      // entity the host's write gate allows, so per-prefab eligibility cannot
      // express them — and design-001's eligibility rationale ("typo/schema
      // safety") is met a different way here, by definition-time name
      // registration: an unregistered component simply is not a behavior.
      //
      // This branch is LOAD-BEARING IN PRODUCTION, not a dev nicety: guards are
      // opt-OUT (guards/dev.ts), so without it every durable behavior write
      // would throw in a shipped build.
      if (behaviors.isBehaviorComponent(c) && behaviors.forComponent(c)?.store === "durable") return;
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
        if ((c as Component) === (Position as Component)) {
          positionWrites.set(e, v as { x: number; y: number });
        }
        tx.addComponent(e, c, v);
      },
      removeComponent: (e, c) => tx.removeComponent(e, c),
      edit(e) {
        const editor: GuardedEditor = {
          set(c, v) {
            checkComponent(e, c as Component, "edit().set");
            if ((c as Component) === (Position as Component)) {
              positionWrites.set(e, v as { x: number; y: number });
            }
            tx.edit(e).set(c, v);
            return editor;
          },
        };
        return editor;
      },
      addTag: (e, t) => tx.addTag(e, t),
      removeTag: (e, t) => tx.removeTag(e, t),
      setRelation(e, r, target, place) {
        checkRelation(e, r, "setRelation");
        tx.setRelation(e, r, target, place);
      },
      addRelation(e, r, target) {
        checkRelation(e, r, "addRelation");
        tx.addRelation(e, r, target);
      },
      removeRelation: (e, r, target) => tx.removeRelation(e, r, target),
      moveRelation(e, r, place) {
        checkRelation(e, r, "moveRelation");
        tx.moveRelation(e, r, place);
      },
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

      move(e, to, mopts) {
        const live = opts?.live;
        if (live === undefined) {
          throw new Error(
            "ice: tx.move requires the session's live writer — pass `live` in the transaction options (the post-commit rewind is a guarded live write, not a raw one).",
          );
        }
        if (!world.isAlive(e)) return;
        // A gesture already owns this entity's divergence; re-aiming it here
        // would fight the drag (arrange's own rule).
        if (world.has(e, Grab)) return;

        const from = world.get(e, Position) as { x: number; y: number } | undefined;
        if (from === undefined) return;
        const start = { x: from.x, y: from.y }; // captured PRE-commit, by construction

        // The durable final rides THIS transaction (inheriting its undoable);
        // runtime-only movers get their value write in the tail instead.
        const durable = opts?.keyOf === undefined || opts.keyOf(e) !== undefined;
        if (durable) {
          checkComponent(e, Position as Component, "move");
          tx.edit(e).set(Position, { x: to.x, y: to.y });
        }
        moved.add(e);

        const ms = mopts?.animateMs ?? 0;
        tail.push(() => {
          if (!world.isAlive(e)) return;
          if (ms > 0) {
            glide(world, live, e, start, to, ms);
            return;
          }
          // SNAP. If a glide is in flight it must END here, or the stale tween
          // would keep easing the runtime cell toward its old target and undo
          // the very write this call just committed. Order matters: write the
          // value FIRST (the tween still grants divergence, so the guard admits
          // it), THEN drop the tween — which leaves runtime == durable == `to`,
          // converged, with no divergence left to strand.
          const inFlight = world.get(e, TransformTween) !== undefined;
          if (inFlight) {
            live.set(e, Position, { x: to.x, y: to.y });
            world.removeComponent(e, TransformTween);
            return;
          }
          // No tween: a durable mover already landed via the commit's
          // write-through; a runtime-only one still needs its value write.
          if (!durable) world.edit(e).set(Position, { x: to.x, y: to.y });
        });
      },
    };

    run(guarded);
  }, opts);

  // ── THE POST-SEAL RETARGET CHOKEPOINT (petition I15) ──────────────────────
  // A durable Position write that did NOT come through `move` must retarget any
  // live tween on that entity. Without it the tween keeps gliding to a stale
  // target and lands there: runtime ≠ baseline with nothing banked, which is
  // divergence that NEVER reconciles (strata's `(own, value)` branch advances
  // the baseline alone) and poisons the cell against later remote updates.
  const live = opts?.live;
  if (live !== undefined) {
    for (const [e, to] of positionWrites) {
      if (moved.has(e)) continue;
      if (!world.isAlive(e) || world.get(e, TransformTween) === undefined) continue;
      const existing = world.get(e, TransformTween);
      if (existing === undefined) continue;
      world.edit(e).set(TransformTween, { ...existing, toX: to.x, toY: to.y });
    }
  }

  for (const t of tail) t();
}

/**
 * Retarget every live tween onto its DURABLE truth — the undo/redo chokepoint
 * (petition I15). Undo does not pass through {@link guardedTransaction}: it is
 * strata's own local batch, so a glide in flight when ⌘Z lands would otherwise
 * complete at the pre-undo target and strand the cell exactly as above.
 *
 * `durablePositionOf` reads the committed value (the doc's, not the runtime's).
 * A tween whose entity has no durable Position is left alone — nothing to
 * reconcile against.
 */
export function retargetTweensToDoc(
  world: World,
  entities: Iterable<Entity>,
  durablePositionOf: (e: Entity) => { x: number; y: number } | undefined,
): void {
  for (const e of entities) {
    if (!world.isAlive(e)) continue;
    const tw = world.get(e, TransformTween);
    if (tw === undefined) continue;
    const doc = durablePositionOf(e);
    if (doc === undefined) continue;
    if (tw.toX === doc.x && tw.toY === doc.y) continue;
    world.edit(e).set(TransformTween, { ...tw, toX: doc.x, toY: doc.y });
  }
}
