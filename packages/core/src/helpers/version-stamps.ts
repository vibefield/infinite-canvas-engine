/**
 * Version-stamp resources + the runIf guard built on them (design-002 §4).
 *
 * These are the same-tick laziness lever: a writing system bumps a version as a plain value
 * write (v1's callback back-channels become world state — Laws 1/4), and a downstream system
 * gates on {@link makeVersionGuard} in its `runIf`. The guard rule (design-002 §4): guards
 * live in `runIf`, never the body — a `runIf`-skipped system runs no body and so blanket-stamps
 * NONE of its declared writes (strata over-fires stampWrites for any system that RUNS, even one
 * that early-outs). Bump/guard therefore form the "writer stamps → reader skips wholesale" pair.
 *
 * Resources are runtime (not durable): they are derived engine state, never persisted.
 */

import type { Resource, World } from "@vibecook/strata-ecs";
import { defineResource } from "../schema/meta";

/** The shared shape of every version stamp — a wrap-around unsigned tick counter. */
export interface VersionValue {
  v: number;
}

/** A resource carrying a {@link VersionValue}. */
export type VersionResource = Resource<VersionValue>;

/** Bumped by `pointerIngest` when the input queue drained anything (design-003 §2). */
export const PointerVersion = defineResource("PointerVersion", { v: "u32" }, { durable: false });
/** Bumped by `setSelection`/selection edits (design-003 §5). */
export const SelectionVersion = defineResource("SelectionVersion", { v: "u32" }, { durable: false });
/** Bumped when the spatial index changes (inserts/moves/removes). */
export const SpatialVersion = defineResource("SpatialVersion", { v: "u32" }, { durable: false });

/**
 * Increment a version stamp as a value write. Unset counts as 0, so the first bump lands 1.
 * Wraps at 2^32 via `>>> 0` — a wrapped counter still compares unequal frame-to-frame, which
 * is all the guard needs. Systems write resources through the closed-over `world.setResource`
 * (there is no `ctx` resource API — design-002 §3).
 */
export function bumpVersion(world: World, res: VersionResource): void {
  const cur = world.getResource(res);
  const v = cur === undefined ? 0 : cur.v;
  world.setResource(res, { v: (v + 1) >>> 0 });
}

/**
 * A `runIf`-compatible guard. Returns `true` iff any watched version differs from the value it
 * last observed, and records the new values each call. The first invocation always returns
 * `true` (it establishes the baseline — the gated system runs once at startup). A skipped system
 * stamps nothing, so pairing this guard with narrow `access.write` is the whole laziness win.
 *
 * Typed `() => boolean` so callers (and tests) can invoke it directly; it is width-assignable to
 * strata's `Condition` (`(ctx) => boolean`), so it drops straight into `runIf`.
 */
export type VersionGuard = () => boolean;

export function makeVersionGuard(world: World, resources: readonly VersionResource[]): VersionGuard {
  const watched = [...resources];
  const last: (number | undefined)[] = watched.map(() => undefined);
  let primed = false;
  return () => {
    let changed = !primed;
    for (let i = 0; i < watched.length; i++) {
      const res = watched[i];
      if (res === undefined) continue;
      const cur = world.getResource(res)?.v;
      if (cur !== last[i]) changed = true;
      last[i] = cur;
    }
    primed = true;
    return changed;
  };
}
