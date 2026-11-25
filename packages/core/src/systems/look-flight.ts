/**
 * The LOOK FLIGHT (petition I58) — `ops.lookAt`'s camera move inside the frame: the camera flies from
 * where it is to the look camera (kernel `lookCamera`, computed by the op) and lands EXACTLY on it.
 *
 * It is the nav flight's motion without the nav: the progress spring is the kernel's closed-form
 * critically damped `springStep`, at the nav flight's own response (the live
 * `NavTransitionSettings.responseMs`, else NAV_TRANSITION_DEFAULTS'), scaled by octave distance as an
 * enter's is (`durMul`, locked at the start); the camera rides `flightCamera(c0, c1, p, vpW, vpH)`, zoom
 * in log space with the view centre linear in 1/zoom; the landing writes c1 itself, once the spring is
 * past the nav flight's own settle thresholds (NAV's `settleP` and `settleV`).
 *
 * - `LookFlight` is a RESOURCE, not closure state (the `NavTransition` / `CameraInertia` pattern:
 *   devtools sees it, no hidden singleton — design-003 §9). Resources cannot be removed, so `active`
 *   is the liveness flag; `epoch` bumps on every start (a retarget is a new start from the camera where
 *   it is).
 * - It is an ORDINARY camera move. It writes the `Camera` and itself, nothing else: no frame switch, no
 *   portal, no `Retained` set, no `NavTransition` — so the desk draws it as it draws a pan, the
 *   presentation coordinator never hears of it, and `Camera.gesturing` stays the user's own fact (the
 *   inertia precedent: a flight never stamps it).
 * - It YIELDS without touching the camera — the frame it was in keeps the camera where it is — to:
 *   an active camera gesture (`Camera.gesturing`, stamped by `cameraControl` in ctl:behave, EARLIER
 *   this same frame: touch always wins, design-006 §4); any other writer of the camera (the camera is
 *   not where this flight left it: an op, a host, a restore); and a NAV SWITCH (`NavTransition.epoch`
 *   moved since the start — every cut, every nav flight and every integrity pop bumps it — so the
 *   camera is another frame's now).
 * - Its FIRST TICK HOLDS at p = 0 (the nav flight's cut-frame rule, B7, here for its other half): a
 *   loop that slept wakes for the op on a long frame (dt clamps at 64 ms), and a spring stepped across
 *   it would jump a quarter of the way at once. The held frame draws the camera the person already sees.
 * - Camera writes go through `writeRuntimeResource`, change-guarded: an unchanged camera writes nothing.
 * - The viewport dying mid-flight settles it at once (navFlight's rule).
 */
import type { TickSystem, World } from "@vibecook/strata-ecs";
import { defineTickSystem, field } from "@vibecook/strata-ecs";
import type { CameraState } from "@ice/kernel";
import { flightCamera, flightOctaves, springStep } from "@ice/kernel";
import { Camera, Viewport } from "../catalog/camera-derived";
import { NavTransitionSettings } from "../catalog/settings-resources";
import { FrameInfo } from "../engine/frame-info";
import { writeRuntimeResource } from "../guards/resource-writer";
import { defineResource } from "../schema/meta";
import { NAV_TRANSITION_DEFAULTS } from "../settings/defaults";
import { NavTransition } from "./nav-flight";

const NAV = NAV_TRANSITION_DEFAULTS;

/** The one look flight in progress (petition I58). Inactive = at rest. */
export const LookFlight = defineResource(
  "LookFlight",
  {
    active: field("bool", { default: false }),
    /** Progress spring state (closed-form critically damped, kernel springStep). */
    p: field("f64", { default: 0 }),
    v: field("f64", { default: 0 }),
    /** Ticks the flight has run; the first holds at p = 0. */
    ticks: field("u32", { default: 0 }),
    /** Bumps on every start. */
    epoch: field("u32", { default: 0 }),
    /** `NavTransition.epoch` at the start: a nav switch since ends the flight. */
    navEpoch: field("u32", { default: 0 }),
    /** Response multiplier from octave distance (locked at the start, as the nav flight's). */
    durMul: field("f64", { default: 1 }),
    /** Where it flies from (the camera at the start) and to (the look camera). */
    c0x: field("f64", { default: 0 }),
    c0y: field("f64", { default: 0 }),
    c0z: field("f64", { default: 1 }),
    c1x: field("f64", { default: 0 }),
    c1y: field("f64", { default: 0 }),
    c1z: field("f64", { default: 1 }),
    /** The camera this flight last left — anything else found there is another writer's, and the flight yields to it. */
    atX: field("f64", { default: 0 }),
    atY: field("f64", { default: 0 }),
    atZ: field("f64", { default: 1 }),
  },
  { durable: false },
);

/**
 * Arm a look flight from the camera now to `c1` (the look camera, already clamped by the caller). The
 * facade's `ops.lookAt` is its one caller: it has put the hand down, cancelled live gestures, stopped
 * the inertia and ended any nav flight first, and it snaps instead under reduced motion or `"none"`.
 */
export function startLookFlight(world: World, c1: CameraState): void {
  const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
  const prev = world.getResource(LookFlight);
  const octaves = flightOctaves(cam, c1);
  world.setResource(LookFlight, {
    active: true,
    p: 0,
    v: 0,
    ticks: 0,
    epoch: (prev?.epoch ?? 0) + 1,
    navEpoch: world.getResource(NavTransition)?.epoch ?? 0,
    durMul: 1 + NAV.durationPerOctave * Math.max(0, octaves - NAV.baseOctaves),
    c0x: cam.x,
    c0y: cam.y,
    c0z: cam.zoom,
    c1x: c1.x,
    c1y: c1.y,
    c1z: c1.zoom,
    atX: cam.x,
    atY: cam.y,
    atZ: cam.zoom,
  });
}

/** Stop a look flight where it is, without touching the camera (a retarget, a snap, a cut into another frame). */
export function abortLookFlight(world: World): void {
  const t = world.getResource(LookFlight);
  if (t?.active === true) world.setResource(LookFlight, { ...t, active: false });
}

/** Is a look flight driving the camera right now? */
export function lookFlightActive(world: World): boolean {
  return world.getResource(LookFlight)?.active === true;
}

/** The camera to `c`, written only when it moves (change-guarded, as every camera writer is). */
function writeCamera(world: World, c: CameraState): void {
  const cur = world.getResource(Camera);
  if (cur !== undefined && cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom && !cur.gesturing) return;
  writeRuntimeResource(world, Camera, { x: c.x, y: c.y, zoom: c.zoom, gesturing: false });
}

export function createLookFlight(world: World): TickSystem {
  return defineTickSystem(
    () => {
      const t = world.getResource(LookFlight);
      if (t === undefined || !t.active) return;
      const cam = world.getResource(Camera);
      const navEpoch = world.getResource(NavTransition)?.epoch ?? 0;
      if (
        cam === undefined ||
        cam.gesturing ||
        navEpoch !== t.navEpoch ||
        cam.x !== t.atX ||
        cam.y !== t.atY ||
        cam.zoom !== t.atZ
      ) {
        // a gesture, another writer of the camera, a nav switch: they win, and the camera stays where they put it
        world.setResource(LookFlight, { ...t, active: false });
        return;
      }
      const c1: CameraState = { x: t.c1x, y: t.c1y, zoom: t.c1z };
      const land = (): void => {
        writeCamera(world, c1); // land EXACTLY
        world.setResource(LookFlight, { ...t, p: 1, v: 0, active: false, atX: c1.x, atY: c1.y, atZ: c1.zoom });
      };
      const vp = world.getResource(Viewport);
      if (vp === undefined || !(vp.w > 0) || !(vp.h > 0)) {
        land(); // the viewport died mid-flight (teardown): settle at once
        return;
      }
      if (t.ticks === 0) {
        // the first tick holds: the frame it draws is the camera the person already sees, and the long frame a woken loop
        // starts on is spent here, never on the spring
        world.setResource(LookFlight, { ...t, ticks: 1 });
        return;
      }
      const dtMs = world.getResource(FrameInfo)?.dt ?? 16;
      const responseMs = (world.getResource(NavTransitionSettings)?.responseMs ?? NAV.responseMs) * t.durMul;
      const omega = (2 * Math.PI) / (responseMs / 1000);
      const { p, v } = springStep(t.p, t.v, omega, dtMs / 1000);
      if (p > NAV.settleP && Math.abs(v) < NAV.settleV) {
        land();
        return;
      }
      const c = flightCamera({ x: t.c0x, y: t.c0y, zoom: t.c0z }, c1, Math.min(1, Math.max(0, p)), vp.w, vp.h);
      writeCamera(world, c);
      world.setResource(LookFlight, { ...t, p, v, ticks: t.ticks + 1, atX: c.x, atY: c.y, atZ: c.zoom });
    },
    {
      name: "lookFlight",
      runIf: () => world.getResource(LookFlight)?.active === true,
    },
  );
}
