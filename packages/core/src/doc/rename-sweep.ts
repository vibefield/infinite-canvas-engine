/**
 * The rename zombie sweep (design-008 §6, petition I5) — the live half.
 *
 * The open-path runner (rename.ts) folds a doc once, solo. The CRDT layer
 * then converges BYTES with any stale replica — but it cannot know that
 * `comp:old:props` and `comp:new:props` are the same cell, so three shapes of
 * pre-rename traffic can land post-rename as ordinary deliveries:
 *
 *  - a value set on an old cell winning LWW over the fold's delete
 *    (resurrection);
 *  - a `PrefabId = old` set winning over the fold's rewrite;
 *  - a whole LATE ENTITY spawned old-shape by an offline pre-rename peer.
 *
 * The sweep folds all three, deterministically, on EVERY writable current
 * peer — identical absolute writes converge (the migrate.ts argument), so
 * "zero zombies" is a sweep property the replicas share, not a CRDT freebie.
 *
 * MECHANISM (frame-contract-legal): `observeQuery` watchers on the legacy
 * components and on `PrefabId` fire at notify (in-frame) and only SCHEDULE —
 * `queueMicrotask` runs the fold after the rAF task, between frames, the same
 * slot ops occupy. Bursts coalesce on a pending flag; the fold's own writes
 * re-fire the watchers into one empty pass, then quiet. Steady state is free
 * (zero-match chunk skip), and the first-party observers arm strata's write
 * enforcement as a side effect. Why not fold inside `applyRemote`? The
 * delivery has not PROJECTED yet — world queries see it exactly when the
 * observer fires.
 *
 * CONFLICT RULE (design-008 §6.2, stated honestly): a legacy value moves into
 * an ABSENT new cell (chain-folded per §6.3); a legacy value beside a PRESENT
 * new cell is dropped — NEW WINS. The true LWW order between a stale edit and
 * post-rename edits lives in Loro's clocks, which the engine cannot consult
 * per cell; any fixed rule converges, and new-wins is the only one that never
 * clobbers post-rename work with pre-rename state. Late entities lose
 * nothing.
 *
 * VERSIONING (§6.3): legacy cells are only ever written by old builds, so a
 * moved value is shaped at `renamedFrom.atVersion`. When the widget's migrate
 * chain covers atVersion → current, the flat record chain-folds before the
 * per-group write (the migrate.ts fold, per entity); a gap leaves that
 * entity's legacy cells in place with a dev warning — the per-entity analogue
 * of the pack runner's skip-stays-read-only, because the sweep must not guess
 * a transform.
 */
import { Any, defineQuery } from "@vibecook/strata-ecs";
import type { Component, Entity, Query, World } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { PrefabId } from "../schema/prefab";
import { renames, type WidgetRenameEntry } from "../widget/define-widget";

const RENAMED_PREFIX = "engine.renamed.";

const prefabQ = defineQuery([PrefabId]);

// Legacy queries interned per old id (defineQuery identity is the cache key;
// sessions re-arm on the same process-global registries).
const legacyQByOldId = new Map<string, Query>();
function legacyQueryOf(entry: WidgetRenameEntry): Query | undefined {
  if (entry.legacyGroups.length === 0) return undefined;
  let q = legacyQByOldId.get(entry.oldType);
  if (q === undefined) {
    q =
      entry.legacyGroups.length === 1
        ? defineQuery([entry.legacyGroups[0] as Component])
        : defineQuery([Any(...(entry.legacyGroups as Component[]))]);
    legacyQByOldId.set(entry.oldType, q);
  }
  return q;
}

/** Chain coverage atVersion..widget.version (the migrate.ts contiguity rule). */
function chainCovered(entry: WidgetRenameEntry): boolean {
  for (let v = entry.atVersion; v < entry.widget.version; v++) {
    if (typeof entry.widget.migrate[v] !== "function") return false;
  }
  return true;
}

interface FoldPlan {
  readonly e: Entity;
  readonly rewriteId: boolean;
  /** Chain-folded flat record spanning the entity's legacy groups (write source). */
  readonly folded: Record<string, unknown>;
  /** Group indices whose new cell is absent → written from `folded`. */
  readonly writeGroups: readonly number[];
  /** Legacy components present on the entity → removed. */
  readonly removeLegacy: readonly Component[];
}

export function armRenameSweep(world: World, store: DurableStore): () => void {
  const entries = renames.all();
  if (entries.length === 0) return () => {};

  let pending = false;
  let disposed = false;
  const warnedGap = new Set<string>();

  const sweep = (): void => {
    for (const entry of entries) {
      const { widget, legacyGroups, oldType } = entry;
      const covered = chainCovered(entry);

      // --- plan: entities carrying the old id and/or any legacy cell ---
      const seen = new Set<Entity>();
      const plans: FoldPlan[] = [];
      const consider = (e: Entity): void => {
        if (seen.has(e)) return;
        seen.add(e);
        const id = world.get(e, PrefabId)?.id;
        const rewriteId = id === oldType;
        let anyLegacy = false;
        const flat: Record<string, unknown> = {};
        const removeLegacy: Component[] = [];
        for (let i = 0; i < widget.groups.length; i++) {
          const legacy = world.get(e, legacyGroups[i] as Component);
          if (legacy === undefined) continue;
          anyLegacy = true;
          Object.assign(flat, legacy as Record<string, unknown>);
          removeLegacy.push(legacyGroups[i] as Component);
        }
        if (!rewriteId && !anyLegacy) return;
        // A foreign-typed entity carrying legacy cells is unfoldable — leave it visible.
        if (!rewriteId && anyLegacy && id !== widget.type) return;
        if (anyLegacy && !covered) {
          if (!warnedGap.has(oldType)) {
            warnedGap.add(oldType);
            console.warn(
              `ice: rename sweep — "${oldType}" values are at pack v${entry.atVersion} but "${widget.type}"'s migrate chain has a gap; leaving legacy cells in place (design-008 §6.3).`,
            );
          }
          return;
        }
        let folded = flat;
        for (let v = entry.atVersion; v < widget.version; v++) {
          const step = widget.migrate[v];
          if (typeof step === "function") folded = step(folded);
        }
        const writeGroups: number[] = [];
        if (anyLegacy) {
          for (let i = 0; i < widget.groups.length; i++) {
            const present = world.get(e, (widget.groups[i] as { component: Component }).component) !== undefined;
            if (!present) writeGroups.push(i); // new-wins: present cells keep their value
          }
        }
        plans.push({ e, rewriteId, folded, writeGroups, removeLegacy });
      };

      world.query(prefabQ).each((batch) => {
        for (const row of batch) {
          const e = batch.entity(row);
          if (world.read(e, PrefabId).id === oldType) consider(e);
        }
      });
      const legacyQ = legacyQueryOf(entry);
      if (legacyQ !== undefined) {
        world.query(legacyQ).each((batch) => {
          for (const row of batch) consider(batch.entity(row));
        });
      }
      if (plans.length === 0) continue;

      // --- write: one non-undoable transaction per old id, then tombstone ---
      store.transaction(
        (tx) => {
          for (const plan of plans) {
            if (plan.rewriteId) tx.edit(plan.e).set(PrefabId, { id: widget.type });
            for (const i of plan.writeGroups) {
              tx.addComponent(plan.e, (widget.groups[i] as { component: Component }).component, plan.folded);
            }
            for (const legacy of plan.removeLegacy) tx.removeComponent(plan.e, legacy);
          }
        },
        { undoable: false },
      );
      store.metaTransaction((meta) => {
        const tomb = `${RENAMED_PREFIX}${oldType}`;
        if (meta.get(tomb) === undefined) meta.set(tomb, widget.type);
      });
    }
  };

  const schedule = (): void => {
    if (pending || disposed) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!disposed) sweep();
    });
  };

  const watchers: Array<() => void> = [];
  for (const entry of entries) {
    const q = legacyQueryOf(entry);
    if (q !== undefined) {
      watchers.push(world.reactive.observeQuery(q, schedule, { cols: [...(entry.legacyGroups as Component[])] }));
    }
  }
  // PrefabId writes are rare (spawns + renames) — one wide watcher covers the
  // late-entity and id-zombie shapes for every registered rename.
  watchers.push(world.reactive.observeQuery(prefabQ, schedule, { cols: [PrefabId] }));

  return () => {
    disposed = true;
    for (const u of watchers) u();
  };
}
