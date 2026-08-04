/**
 * "Is a gesture in flight?" — the one read, shared by every subsystem that
 * must not act mid-interaction (design-003 §8 terminal phases).
 *
 * Extracted from `doc/autosave.ts` on 2026-08-04 when the frame gate needed
 * the same question: autosave defers a save so it never captures a half-
 * applied interaction, and a freeze walks its settle until the gesture it
 * cancelled has reached its commit tick. One definition of "in flight", so the
 * two can never drift apart.
 */
import { Any, defineQuery } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { Camera, Drag, GesturePhases, LongPress, Pinch, Tap, WheelPan, WheelZoom } from "../catalog";

const gestureQ = defineQuery([Any(Tap, LongPress, Drag, Pinch, WheelPan, WheelZoom)]);
const P = GesturePhases;

/**
 * Any recognizer NOT in a terminal phase ⇒ a gesture is in flight (mirrors the
 * cleanup.ts terminal definition: Failed/Cancelled/Ended, plus Recognized-Tap).
 */
export function anyGestureNonTerminal(world: World): boolean {
  let active = false;
  world.query(gestureQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const terminal =
        world.hasTag(e, P.tags.Failed) ||
        world.hasTag(e, P.tags.Cancelled) ||
        world.hasTag(e, P.tags.Ended) ||
        (world.hasTag(e, P.tags.Recognized) && world.has(e, Tap));
      if (!terminal) {
        active = true;
        return;
      }
    }
  });
  return active;
}

/**
 * The full mid-interaction read: a live camera gesture (pan/zoom, which writes
 * `Camera.gesturing` without a recognizer entity of its own) OR any recognizer
 * still walking its phases. Either means runtime edits are outstanding and the
 * durable transaction that will carry them has not been sealed yet.
 */
export function isMidGesture(world: World): boolean {
  return world.getResource(Camera)?.gesturing === true || anyGestureNonTerminal(world);
}
