/**
 * The DEFAULT divergence predicate for the live-write guard (design-001 §3):
 * an entity's doc cells may diverge iff
 *   - some recognizer in `GestureActive` currently `Captures` or `Drags` it, or
 *   - it carries a live `TransformTween` (fly-back holds the claim after the
 *     recognizer is reaped — design-003 review M3 / design-001 §3 amendment).
 *
 * This replaces the "inject a stub" posture (review finding A2): engines wire
 * `createLiveWriter(world, { keyOf, mayDiverge: makeDefaultMayDiverge(world), … })`
 * by default; tests and special hosts may still inject their own predicate.
 * Discrete claims (`GestureRecognized`) deliberately do NOT grant divergence —
 * design-001 §3 live-writes happen only under continuous Active gestures.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { Captures, Drags, GestureActive, TransformTween } from "../catalog/gesture";

export function makeDefaultMayDiverge(world: World): (e: Entity) => boolean {
  return (e) => {
    if (world.has(e, TransformTween)) return true;
    for (const claimant of world.getReverse(e, Captures)) {
      if (world.hasTag(claimant, GestureActive)) return true;
    }
    for (const claimant of world.getReverse(e, Drags)) {
      if (world.hasTag(claimant, GestureActive)) return true;
    }
    return false;
  };
}
