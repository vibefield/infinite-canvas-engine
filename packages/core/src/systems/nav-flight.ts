/**
 * Nav-flight — the T1 camera-flight half of design-006 (portal zoom).
 *
 * CUT-FIRST, THEN FLY (§3): the nav ops perform the ECS cut synchronously
 * (frame switch, membership resweep, index rebuild) and then hand presentation
 * to this slice — `startNavFlight` snaps the camera to the continuity-solved
 * start `c0` and arms the `NavTransition` resource; the `navFlight` tick
 * system (simulate, beside cameraInertia) advances a closed-form critically-
 * damped progress spring each frame and writes the camera along the log-zoom
 * path until rest. The transition is PURE PRESENTATION: killing it at any
 * moment leaves a fully consistent world in the destination frame.
 *
 * - `NavTransition` is a RESOURCE, not closure state (the CameraInertia
 *   pattern: devtools sees it, no hidden singleton — design-003 §9). Resources
 *   cannot be removed, so `active` is the liveness flag; `epoch` bumps on
 *   every (re)start so the T2 reflector can distinguish retarget from resume.
 * - Camera writes are UNCLAMPED (design-006 §3.1): flight paths transit far
 *   outside the user-gesture zoom band; only the ARRIVAL camera (clamped by
 *   the nav op) bounds where the flight rests.
 * - Gestures always win (§4): any active camera gesture — `Camera.gesturing`,
 *   stamped by cameraControl in ctl:behave, i.e. EARLIER this same frame —
 *   deactivates the flight without touching the camera.
 * - The portal affine (`as/aox/aoy`, departed-frame → destination-frame) and
 *   `frozen` ride the resource for T2's departing-plane reflector; T1's camera
 *   math only needs c0/c1.
 */
import type { Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineTickSystem, enumOf, field } from "@vibecook/strata-ecs";
import type { CameraState, PortalAffine } from "@ice/kernel";
import { capFlightStart, flightCamera, flightOctaves, springStep } from "@ice/kernel";
import { Camera, Viewport } from "../catalog/camera-derived";
import { NavTransitionSettings } from "../catalog/settings-resources";
import { FrameInfo } from "../engine/frame-info";
import { writeRuntimeResource } from "../guards/resource-writer";
import { defineResource } from "../schema/meta";
import { NAV_TRANSITION_DEFAULTS } from "../settings/defaults";

const NAV = NAV_TRANSITION_DEFAULTS;

/** The one in-flight nav transition (design-006 §3.1). Inactive = at rest. */
export const NavTransition = defineResource("NavTransition", {
  active: field("bool", { default: false }),
  kind: field(enumOf(["enter", "exit"]), { default: "enter" }),
  /** Progress spring state (closed-form critically damped, kernel springStep). */
  p: field("f32", { default: 0 }),
  v: field("f32", { default: 0 }),
  /** Depth-capped flight — T2 presents it as a crossfade, not geometry (§5). */
  frozen: field("bool", { default: false }),
  /** Bumps on every flight start; T2 distinguishes retarget from resume. */
  epoch: field("u32", { default: 0 }),
  /** CanvasSession/document identity captured at the authority cut. */
  documentEpoch: field("u32", { default: 0 }),
  fromFrame: field("eid", { default: 0 as Entity }),
  toFrame: field("eid", { default: 0 as Entity }),
  fromTypeId: field("string", { default: "" }),
  toTypeId: field("string", { default: "" }),
  /** Response multiplier from octave distance (locked at start; §4). */
  durMul: field("f32", { default: 1 }),
  c0x: field("f64", { default: 0 }),
  c0y: field("f64", { default: 0 }),
  c0z: field("f64", { default: 1 }),
  c1x: field("f64", { default: 0 }),
  c1y: field("f64", { default: 0 }),
  c1z: field("f64", { default: 1 }),
  /** Portal affine A: departed-frame coords → destination-frame coords (T2). */
  as: field("f64", { default: 1 }),
  aox: field("f64", { default: 0 }),
  aoy: field("f64", { default: 0 }),
});

export interface NavTransitionIdentity {
  readonly documentEpoch: number;
  readonly fromFrame: Entity;
  readonly toFrame: Entity;
  readonly fromTypeId: string;
  readonly toTypeId: string;
}

const identityFields = (
  identity: NavTransitionIdentity | undefined,
): {
  documentEpoch: number;
  fromFrame: Entity;
  toFrame: Entity;
  fromTypeId: string;
  toTypeId: string;
} => ({
  documentEpoch: identity?.documentEpoch ?? 0,
  fromFrame: identity?.fromFrame ?? (0 as Entity),
  toFrame: identity?.toFrame ?? (0 as Entity),
  fromTypeId: identity?.fromTypeId ?? "",
  toTypeId: identity?.toTypeId ?? "",
});

/**
 * Arm a flight from the already-cut world: continuity-solve was done by the
 * caller (`exact` = c0 in destination-frame coords), the arrival `c1` is
 * already clamped. Applies the depth cap (§5), snaps the camera to c0, and
 * activates the resource. Callers guarantee a live Viewport — headless/no-
 * viewport paths snap to the arrival instead and never reach here.
 */
export function startNavFlight(
  world: World,
  kind: "enter" | "exit",
  A: PortalAffine,
  exact: CameraState,
  c1: CameraState,
  identity?: NavTransitionIdentity,
): void {
  const vp = world.getResource(Viewport);
  const vpW = vp?.w ?? 0;
  const vpH = vp?.h ?? 0;
  const { c0, capped } = capFlightStart(exact, c1, vpW, vpH, NAV.freezeOctaves, NAV.capFactor);
  const octaves = flightOctaves(c0, c1);
  const prev = world.getResource(NavTransition);
  writeRuntimeResource(world, Camera, { x: c0.x, y: c0.y, zoom: c0.zoom, gesturing: false });
  world.setResource(NavTransition, {
    active: true,
    kind,
    p: 0,
    v: 0,
    frozen: capped,
    epoch: (prev?.epoch ?? 0) + 1,
    ...identityFields(identity),
    durMul: 1 + NAV.durationPerOctave * Math.max(0, octaves - NAV.baseOctaves),
    c0x: c0.x,
    c0y: c0.y,
    c0z: c0.zoom,
    c1x: c1.x,
    c1y: c1.y,
    c1z: c1.zoom,
    as: A.s,
    aox: A.ox,
    aoy: A.oy,
  });
}

/** Publish an epoch-bound logical switch even when geometry is deliberately cut. */
export function publishNavCut(
  world: World,
  kind: "enter" | "exit",
  from: CameraState,
  to: CameraState,
  identity?: NavTransitionIdentity,
  A: PortalAffine = { s: 1, ox: 0, oy: 0 },
): void {
  const prev = world.getResource(NavTransition);
  world.setResource(NavTransition, {
    active: false,
    kind,
    p: 1,
    v: 0,
    frozen: false,
    epoch: (prev?.epoch ?? 0) + 1,
    ...identityFields(identity),
    durMul: 1,
    c0x: from.x,
    c0y: from.y,
    c0z: from.zoom,
    c1x: to.x,
    c1y: to.y,
    c1z: to.zoom,
    as: A.s,
    aox: A.ox,
    aoy: A.oy,
  });
}

/** Deactivate without touching the camera (integrity pops, gesture yields). */
export function abortNavFlight(world: World): void {
  const t = world.getResource(NavTransition);
  if (t?.active) world.setResource(NavTransition, { ...t, active: false });
}

/**
 * Is a nav flight driving the camera right now? THE gate for flight-time
 * GPU/paint duty (design-006 §8.2, answered by field testing 2026-07-16):
 * heavy-motion consumers treat `Camera.gesturing ∨ navFlightActive` as one
 * "camera in transient motion" signal — composite DPR drop, band-repaint
 * suppression, Hot-island freeze, breakpoint retier deferral. `gesturing`
 * itself stays a pure user-gesture fact (the inertia precedent): flights
 * never stamp it, consumers OR the two.
 */
export function navFlightActive(world: World): boolean {
  return world.getResource(NavTransition)?.active === true;
}

export function createNavFlight(world: World): TickSystem {
  return defineTickSystem(
    () => {
      const t = world.getResource(NavTransition);
      if (t === undefined || !t.active) return;
      const cam = world.getResource(Camera);
      if (cam?.gesturing === true) {
        // Touch always wins (§4): yield instantly; the camera stays wherever
        // the flight left it and the gesture composes from there.
        world.setResource(NavTransition, { ...t, active: false });
        return;
      }
      const vp = world.getResource(Viewport);
      const c1: CameraState = { x: t.c1x, y: t.c1y, zoom: t.c1z };
      if (vp === undefined || vp.w <= 0) {
        // Viewport died mid-flight (teardown) — settle instantly.
        writeRuntimeResource(world, Camera, { ...c1, gesturing: false });
        world.setResource(NavTransition, { ...t, p: 1, v: 0, active: false });
        return;
      }
      const dtMs = world.getResource(FrameInfo)?.dt ?? 16;
      const responseMs =
        (world.getResource(NavTransitionSettings)?.responseMs ?? NAV.responseMs) *
        (t.kind === "exit" ? NAV.exitResponseFactor : 1) *
        t.durMul;
      const omega = (2 * Math.PI) / (responseMs / 1000);
      const { p, v } = springStep(t.p, t.v, omega, dtMs / 1000);
      if (p > NAV.settleP && Math.abs(v) < NAV.settleV) {
        writeRuntimeResource(world, Camera, { ...c1, gesturing: false }); // land EXACTLY
        world.setResource(NavTransition, { ...t, p: 1, v: 0, active: false });
        return;
      }
      const c0: CameraState = { x: t.c0x, y: t.c0y, zoom: t.c0z };
      const c = flightCamera(c0, c1, Math.min(1, Math.max(0, p)), vp.w, vp.h);
      writeRuntimeResource(world, Camera, { x: c.x, y: c.y, zoom: c.zoom, gesturing: false });
      world.setResource(NavTransition, { ...t, p, v });
    },
    {
      name: "navFlight",
      runIf: () => world.getResource(NavTransition)?.active === true,
    },
  );
}
