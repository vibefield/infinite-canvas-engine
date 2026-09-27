/**
 * THE INTERACTION STACK'S REGISTERED WAKE (2026-09-27, ICE M21 K7a — engine/frame-control.ts's sleep). A sleeping loop asks
 * after every step when the stack is next due; it is due EVERY frame while any of its time-driven work is pending, and
 * otherwise never on its own (the next input wakes the loop through the queue). Each pending state is a fact in the world
 * (the engine's law: all interaction state lives there), read O(1) — a queue's length, a resource, `firstOf` a query:
 *  - input waiting in the queue;
 *  - a gesture RECOGNIZER alive (systems/l2-recognize.ts): a press held (the long-press timer), a tap's multi-tap window
 *    after its release, a drag, a pinch, a wheel gesture's end silence (`wheelEndSilenceMs`) — each reaped once it ended;
 *  - the camera gesturing, or its inertia still moving (systems/camera-sim.ts `cameraInertia`);
 *  - a transform tween running (`TransformTween`, camera-sim.ts `tweenSystem`);
 *  - a nav flight (`NavTransition.active`, systems/nav-flight.ts);
 *  - the pegboard's band stretched (systems/tray.ts: it lets go `letGoMs` after the last wheel);
 *  - ports materialized (systems/l3-ports.ts: staged over frames, reaped `portReapGraceMs` after their trigger lapsed).
 * The one-tick protocols after an input (the tags `oneTickClear` clears, a recognizer reaped a tick after it ended) are the
 * sleep's tail (`SLEEP_TAIL`), not this reporter's.
 */
import type { World } from "@vibecook/strata-ecs";
import { Any, defineQuery } from "@vibecook/strata-ecs";
import { Camera } from "../catalog/camera-derived";
import { Tray } from "../catalog/desk";
import { Drag, LongPress, Pinch, Tap, TransformTween, WheelPan, WheelZoom } from "../catalog/gesture";
import { Port } from "../catalog/graph";
import type { InputQueue } from "../input/queue";
import { CameraInertia } from "../systems/camera-sim";
import { NavTransition } from "../systems/nav-flight";

const recognizersQ = defineQuery([Any(Tap, LongPress, Drag, Pinch, WheelPan, WheelZoom)]);
const tweensQ = defineQuery([TransformTween]);
const traysQ = defineQuery([Tray]);
const portsQ = defineQuery([Port]);

/** Which of the stack's time-driven work is pending now — the first found, or undefined when the stack is at rest. */
export function interactionPending(world: World, queue: InputQueue): string | undefined {
  if (queue.size() > 0) return "input";
  if (world.firstOf(recognizersQ) !== undefined) return "recognizer";
  const cam = world.getResource(Camera);
  if (cam?.gesturing === true) return "gesture";
  const inertia = world.getResource(CameraInertia);
  if (inertia !== undefined && (inertia.vx !== 0 || inertia.vy !== 0)) return "inertia";
  if (world.getResource(NavTransition)?.active === true) return "flight";
  if (world.firstOf(tweensQ) !== undefined) return "tween";
  const tray = world.firstOf(traysQ);
  if (tray !== undefined && (world.get(tray, Tray)?.stretch ?? 0) !== 0) return "band";
  if (world.firstOf(portsQ) !== undefined) return "ports";
  return undefined;
}

/** The stack's registered wake: `now` (the next frame) while anything is pending, else never on its own. */
export function interactionDue(world: World, queue: InputQueue): (now: number) => number {
  return (now) => (interactionPending(world, queue) === undefined ? Number.POSITIVE_INFINITY : now);
}

/** The input queue, waking the loop on every enqueue (Law 2: the adapters only enqueue — this is the one door they share). */
export function wakefulQueue(queue: InputQueue, wake: () => void): InputQueue {
  return {
    enqueue(event) {
      queue.enqueue(event);
      wake();
    },
    drain: () => queue.drain(),
    size: () => queue.size(),
  };
}
