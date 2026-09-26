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
 *
 * The KEYBOARD is a continuous gesture too (design-015 §6.1, D2c): an object
 * carrying the runtime `Editing` rider is claimed by the one focused editor's
 * typing session, which live-writes its text and commits it once at the
 * session's end — a third SOURCE of the gesture claim, not a third kind of
 * grant (design-009 §3's divergence law stands: a claim or a tween).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { Editing } from "../catalog/desk";
import { Captures, Drags, GestureActive, TransformTween } from "../catalog/gesture";

export function makeDefaultMayDiverge(world: World): (e: Entity) => boolean {
  return (e) => {
    if (world.has(e, TransformTween)) return true;
    if (world.hasTag(e, Editing)) return true;
    for (const claimant of world.getReverse(e, Captures)) {
      if (world.hasTag(claimant, GestureActive)) return true;
    }
    for (const claimant of world.getReverse(e, Drags)) {
      if (world.hasTag(claimant, GestureActive)) return true;
    }
    return false;
  };
}
