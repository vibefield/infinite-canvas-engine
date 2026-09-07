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
import { defineQuery, defineTickSystem, enumOf, field } from "@vibecook/strata-ecs";
import type { CameraState, PortalAffine } from "@ice/kernel";
import { capFlightStart, flightCamera, flightOctaves, outgoingCamera, springStep } from "@ice/kernel";
import { Camera, Viewport } from "../catalog/camera-derived";
import { Container } from "../catalog/graph";
import { ChildOf, Position, Size } from "../catalog/scene";
import { NavTransitionSettings } from "../catalog/settings-resources";
import { Retained } from "../catalog/surface";
import { FrameInfo } from "../engine/frame-info";
import { writeRuntimeResource } from "../guards/resource-writer";
import { defineResource } from "../schema/meta";
import { PrefabId } from "../schema/prefab";
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
  /**
   * The DEPARTED frame's camera at the cut (design-013 §8 B7, D-B7.1): what it renders under
   * at p = 0 — bit for bit, never through the affine and back — and throughout a frozen
   * flight. `departedCameraOf` is the one reader.
   */
  fromX: field("f64", { default: 0 }),
  fromY: field("f64", { default: 0 }),
  fromZ: field("f64", { default: 1 }),
  /**
   * Ticks the spring has stepped. The FIRST tick after the cut holds at p = 0 (B7): one frame
   * is drawn with the camera at the exact `c0` — the arriving frame IS the portal's last frame,
   * the departed frame IS its pre-cut frame — so the cut changes no pixel and the motion begins
   * from a frame that exists. The oracle's `p = 0` still is a product frame, not a fiction.
   */
  ticks: field("u32", { default: 0 }),
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

/** The one in-flight transition's field values, as `departedCameraOf` reads them. */
export interface DepartedCameraInputs {
  readonly frozen: boolean;
  readonly c0x: number;
  readonly c0y: number;
  readonly c0z: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly fromZ: number;
  readonly as: number;
  readonly aox: number;
  readonly aoy: number;
}

/**
 * The camera the DEPARTED frame renders under this frame (design-013 §8 B7, D-B7.1; the
 * ground's `departedCamera`, moved onto the resource). Riding the flight through the affine
 * (`outgoingCamera`) — except at the cut itself, where it is the pre-cut camera bit for bit
 * (the affine and its inverse round-trip to within an ulp, and at zoom 1 an ulp is the other
 * side of a decade), and throughout a FROZEN flight, where the departed frame stays at its
 * pre-cut appearance and fades (design-006 §5: the cap broke the geometry, so the story is a
 * dissolve, not a portal). Every presenter of the departed frame — the ground's second slot,
 * the DOM's departing plane — reads this one rule, so they agree to the bit.
 */
export function departedCameraOf(t: DepartedCameraInputs, cam: CameraState): CameraState {
  if (t.frozen || (cam.x === t.c0x && cam.y === t.c0y && cam.zoom === t.c0z)) return { x: t.fromX, y: t.fromY, zoom: t.fromZ };
  return outgoingCamera({ s: t.as, ox: t.aox, oy: t.aoy }, cam);
}

// Every equipped widget, Active or not — the departed frame's cards are culled at the cut.
const widgetsQ = defineQuery([Position, Size, PrefabId]);
const retainedQ = defineQuery([Retained]);

/** The nav frame a widget belongs to: its first `Container` ancestor on the `ChildOf` chain; `undefined` = the root (nested-canvas's membership rule). */
function navFrameOf(world: World, e: Entity): Entity | undefined {
  let cur = world.getRelation(e, ChildOf);
  let hops = 0;
  while (cur !== undefined && hops < 64) {
    if (world.hasTag(cur, Container)) return cur;
    cur = world.getRelation(cur, ChildOf);
    hops += 1;
  }
  return undefined;
}

/**
 * Pin the DEPARTED frame's cards for the flight (design-013 §4, §5: `Retained` — "the nav
 * crossfade" writes it; Residency's LRU never evicts a retained key, so the departed slot's
 * records keep their textures until the landing). An op-time write: `startNavFlight` runs
 * outside the tick. `fromFrame` is the departed frame — a container, or the board root.
 */
function retainDeparted(world: World, fromFrame: Entity | undefined): number {
  if (fromFrame === undefined || fromFrame === (0 as Entity)) return 0;
  const frame = world.isAlive(fromFrame) && world.hasTag(fromFrame, Container) ? fromFrame : undefined;
  const set: Entity[] = [];
  world.query(widgetsQ).each((b) => { for (const r of b) { const e = b.entity(r); if (navFrameOf(world, e) === frame) set.push(e); } });
  for (const e of set) if (!world.hasTag(e, Retained)) world.addTag(e, Retained);
  return set.length;
}

/** The flight is over (settled, aborted, yielded): nothing is retained any more. Two-phase — collect, then mutate. */
function releaseRetained(w: { query: World["query"] }, untag: (e: Entity) => void): number {
  const set: Entity[] = [];
  w.query(retainedQ).each((b) => { for (const r of b) set.push(b.entity(r)); });
  for (const e of set) untag(e);
  return set.length;
}

/**
 * Arm a flight from the already-cut world: continuity-solve was done by the
 * caller (`exact` = c0 in destination-frame coords — from a LIVE PORTAL the
 * camera the inside was already rendering under, `outgoingCamera(M, camPre)`,
 * so the cut changes no pixel; D-B7.1), the arrival `c1` is
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
  // the departed frame's camera at the cut: the Camera resource BEFORE this write (the cut itself moves it to c0)
  const pre = world.getResource(Camera);
  const from: CameraState = pre === undefined ? c0 : { x: pre.x, y: pre.y, zoom: pre.zoom };
  retainDeparted(world, identity?.fromFrame);
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
    fromX: from.x,
    fromY: from.y,
    fromZ: from.zoom,
    ticks: 0,
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
    fromX: from.x,
    fromY: from.y,
    fromZ: from.zoom,
    ticks: 1,
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
  releaseRetained(world, (e) => world.removeTag(e, Retained));
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
    (ctx) => {
      const t = world.getResource(NavTransition);
      if (t === undefined || !t.active) return;
      const release = (): void => { releaseRetained(ctx, (e) => ctx.removeTag(e, Retained)); };
      const cam = world.getResource(Camera);
      if (cam?.gesturing === true) {
        // Touch always wins (§4): yield instantly; the camera stays wherever
        // the flight left it and the gesture composes from there.
        world.setResource(NavTransition, { ...t, active: false });
        release();
        return;
      }
      const vp = world.getResource(Viewport);
      const c1: CameraState = { x: t.c1x, y: t.c1y, zoom: t.c1z };
      if (vp === undefined || vp.w <= 0) {
        // Viewport died mid-flight (teardown) — settle instantly.
        writeRuntimeResource(world, Camera, { ...c1, gesturing: false });
        world.setResource(NavTransition, { ...t, p: 1, v: 0, active: false });
        release();
        return;
      }
      if (t.ticks === 0) {
        // the cut frame (B7): held at p = 0 with the camera at the exact c0 — drawn once, then the spring runs
        world.setResource(NavTransition, { ...t, ticks: 1 });
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
        release();
        return;
      }
      const c0: CameraState = { x: t.c0x, y: t.c0y, zoom: t.c0z };
      const c = flightCamera(c0, c1, Math.min(1, Math.max(0, p)), vp.w, vp.h);
      writeRuntimeResource(world, Camera, { x: c.x, y: c.y, zoom: c.zoom, gesturing: false });
      world.setResource(NavTransition, { ...t, p, v, ticks: t.ticks + 1 });
    },
    {
      name: "navFlight",
      runIf: () => world.getResource(NavTransition)?.active === true,
    },
  );
}
