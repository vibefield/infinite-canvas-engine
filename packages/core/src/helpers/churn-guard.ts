/**
 * Churn guard — the `runIf` half of the petition-7 gating pattern
 * (design-002 §4 "guards live in runIf, never the body" × strata 0.7.0
 * `world.changes`).
 *
 * `activeMembership` gates by draining a collector INSIDE its tick body
 * (legal there: it declares no writes, so an early-out stamps nothing).
 * Systems that DECLARE `access.write` cannot use that shape — strata
 * blanket-stamps declared writes for any system that RUNS, even one that
 * early-outs (see helpers/version-stamps.ts) — so their gate must be a real
 * `runIf`. But a naive collector-in-runIf would LOSE the drained delta when
 * the body runs: this guard drains in `runIf`, stashes the delta, and hands
 * it to the body via `take()` in the same frame.
 *
 * Contract:
 *  - `runIf` drains the collector every frame (collector creation is lazy —
 *    a guard whose system is never installed never journals) and evaluates
 *    the optional `extra` trigger (a value-compare closure, e.g. "camera
 *    zoom changed"; it is called every frame so it can keep its own cache
 *    current). Returns true iff there is work.
 *  - `take()` (body, same frame) returns the work: `full` means rebuild
 *    everything (first run, `world.reset`, coarse writes, or `extra` fired);
 *    otherwise `changed`/`removed` are the journaled entities. The arrays
 *    alias the collector's internal buffers — valid until the next drain,
 *    i.e. for the body that runs this frame; do not retain them.
 */
import type { CollectOptions, Entity, World } from "@vibecook/strata-ecs";
import type { ChangeCollector } from "@vibecook/strata-ecs";

export interface ChurnWork {
  /** Rebuild everything: first run, reset, coarse writes, or `extra` fired. */
  readonly full: boolean;
  readonly changed: readonly Entity[];
  readonly removed: readonly Entity[];
}

export interface ChurnGuard {
  /** Drop into a system's `runIf`. */
  readonly runIf: () => boolean;
  /** The work stashed by this frame's `runIf` (undefined if it returned false). */
  take(): ChurnWork | undefined;
}

const NO_ENTITIES: readonly Entity[] = [];

export function makeChurnGuard(
  world: World,
  collect: CollectOptions,
  extra?: () => boolean,
): ChurnGuard {
  let collector: ChangeCollector | undefined;
  let seeded = false;
  let stash: ChurnWork | undefined;

  return {
    runIf: () => {
      if (collector === undefined) collector = world.changes.collect(collect);
      const delta = collector.drain();
      const extraFired = extra?.() ?? false;
      const full = !seeded || delta.reset || delta.coarse.length > 0 || extraFired;
      seeded = true;
      if (!full && delta.changed.length === 0 && delta.removed.length === 0) {
        stash = undefined;
        return false;
      }
      stash = full
        ? { full: true, changed: NO_ENTITIES, removed: delta.removed }
        : { full: false, changed: delta.changed, removed: delta.removed };
      return true;
    },
    take: () => {
      const s = stash;
      stash = undefined;
      return s;
    },
  };
}
