/**
 * Nav-flight math (design-006 §2/§4 — the portal zoom, T1 camera-flight half).
 *
 * Pure math, no ECS/DOM. Conventions are coords.ts's (Law 13): camera {x,y} =
 * world point at the viewport top-left, zoom = screen px per world unit,
 * `screen = (world − cam)·zoom`.
 *
 * The portal embedding: a container's content coordinates are FRAME-LOCAL
 * (design-001 §5.1) — the transition DEFINES the embedding by mapping the
 * arrival camera's visible rect onto the container's body rect (`portalAffine`,
 * aspect-fit, centers aligned). With that affine fixed, both transition layers
 * ride ONE camera: the destination frame renders under `c(t)` directly; the
 * departed frame renders under `c(t) ∘ A` where A maps departed-frame coords
 * into destination-frame coords. Continuity at the cut is exact by
 * construction (`solveFlightStart`), and no drift is possible mid-flight —
 * there is no second clock.
 *
 * Numerics locked by the mock (2026-07-15, three rounds of field testing):
 *  - the progress spring uses the CLOSED-FORM critically-damped solution —
 *    semi-implicit Euler diverges once ω·dt nears 1 (a fast exit response on
 *    one dropped frame sent the mock's camera to zoom 1501);
 *  - the path interpolates zoom in LOG space (constant perceived zoom
 *    velocity — van Wijk & Nuij) with the view center linear in 1/zoom, which
 *    is exactly an anchored zoom whenever a fixed screen point exists;
 *  - flights beyond `maxOctaves` must be depth-capped (`capFlightStart`):
 *    sweeping a DOM plane's raster scale ~30× in one flight outruns
 *    Chromium's async tile re-raster (stale/missing tiles, persisting at
 *    rest) — the capped flight is presented as a crossfade-through-zoom.
 */
import type { CameraState } from "./coords";
import type { Rect } from "./shapes";

/** Uniform scale + translate: `A(q) = o + q·s`. */
export interface PortalAffine {
  readonly s: number;
  readonly ox: number;
  readonly oy: number;
}

/** The world rect a camera shows through a viewport. */
export function visibleRect(cam: CameraState, vpW: number, vpH: number): Rect {
  return { x: cam.x, y: cam.y, width: vpW / cam.zoom, height: vpH / cam.zoom };
}

/**
 * The portal embedding: map `arrival` (the world rect the arrival camera will
 * show, in the CHILD frame's coords) onto `portal` (the container's body rect,
 * in the PARENT frame's coords). Aspect-FIT with centers aligned (design-006
 * §8.3 — the card chrome absorbs the letterbox).
 */
export function portalAffine(arrival: Rect, portal: Rect): PortalAffine {
  const s = Math.min(portal.width / arrival.width, portal.height / arrival.height);
  return {
    s,
    ox: portal.x + portal.width / 2 - (arrival.x + arrival.width / 2) * s,
    oy: portal.y + portal.height / 2 - (arrival.y + arrival.height / 2) * s,
  };
}

export function invertAffine(a: PortalAffine): PortalAffine {
  return { s: 1 / a.s, ox: -a.ox / a.s, oy: -a.oy / a.s };
}

/** `(outer ∘ inner)(q) = outer(inner(q))` — for multi-level exit portals. */
export function composeAffine(outer: PortalAffine, inner: PortalAffine): PortalAffine {
  return { s: outer.s * inner.s, ox: outer.ox + inner.ox * outer.s, oy: outer.oy + inner.oy * outer.s };
}

/**
 * Continuity solve: the camera `c0` (in the DESTINATION frame) under which
 * departed-frame content mapped through `A` (departed → destination coords)
 * renders EXACTLY as it did under `camPre` (in the departed frame) the instant
 * before the cut. Derivation: a departed point q renders at
 * `(A(q) − c0)·z0 = q·(A.s·z0) + (A.o − c0)·z0`; matching `(q − camPre)·zPre`
 * coefficient-wise gives z0 and the origin below. Zoom limits deliberately do
 * NOT apply here — flight paths transit far outside the user-gesture band
 * (design-006 §3.1); only the ARRIVAL camera is clamped by the caller.
 */
export function solveFlightStart(A: PortalAffine, camPre: CameraState): CameraState {
  return {
    x: A.ox + camPre.x * A.s,
    y: A.oy + camPre.y * A.s,
    zoom: camPre.zoom / A.s,
  };
}

/** Zoom distance in octaves — the flight-length measure (design-006 §4/§5). */
export function flightOctaves(from: CameraState, to: CameraState): number {
  return Math.abs(Math.log2(to.zoom / from.zoom));
}

/**
 * Depth-cap a flight start (design-006 §5): beyond `maxOctaves`, clamp the
 * start zoom to `capFactor ×` the arrival zoom (dive direction preserved),
 * keeping the exact start's view CENTER — the portal anchor — so the motion
 * still comes from/goes to the right place. `capped: true` means the caller
 * must present the flight as a crossfade (frozen departing cover + incoming
 * fade-in): geometric continuity is unpresentable at that raster-scale swing.
 */
export function capFlightStart(
  exact: CameraState,
  arrival: CameraState,
  vpW: number,
  vpH: number,
  maxOctaves: number,
  capFactor: number,
): { c0: CameraState; capped: boolean } {
  if (flightOctaves(exact, arrival) <= maxOctaves) return { c0: exact, capped: false };
  const zCap = exact.zoom > arrival.zoom ? arrival.zoom * capFactor : arrival.zoom / capFactor;
  return {
    c0: {
      x: exact.x + (vpW / 2) * (1 / exact.zoom - 1 / zCap),
      y: exact.y + (vpH / 2) * (1 / exact.zoom - 1 / zCap),
      zoom: zCap,
    },
    capped: true,
  };
}

/**
 * The flight path `c(p)`, p ∈ [0,1]: zoom log-lerped (constant perceived zoom
 * velocity); view CENTER linear in 1/zoom — exactly an anchored zoom whenever
 * a fixed screen point exists between the endpoints, a graceful blend
 * otherwise. Endpoints are exact: c(0) = c0, c(1) = c1.
 */
export function flightCamera(
  c0: CameraState,
  c1: CameraState,
  p: number,
  vpW: number,
  vpH: number,
): CameraState {
  const zoom = Math.exp(Math.log(c0.zoom) + (Math.log(c1.zoom) - Math.log(c0.zoom)) * p);
  const inv0 = 1 / c0.zoom;
  const inv1 = 1 / c1.zoom;
  const inv = 1 / zoom;
  const w = Math.abs(inv1 - inv0) < 1e-12 ? p : (inv - inv0) / (inv1 - inv0);
  const cx = c0.x + vpW * inv0 * 0.5 + (c1.x + vpW * inv1 * 0.5 - (c0.x + vpW * inv0 * 0.5)) * w;
  const cy = c0.y + vpH * inv0 * 0.5 + (c1.y + vpH * inv1 * 0.5 - (c0.y + vpH * inv0 * 0.5)) * w;
  return { x: cx - vpW * inv * 0.5, y: cy - vpH * inv * 0.5, zoom };
}

/**
 * One step of the critically-damped progress spring toward 1, in CLOSED FORM:
 * with u = 1 − p, the exact solution is `u(t) = (u₀ + Bt)·e^(−ωt)`,
 * `B = −v₀ + ω·u₀`. Unconditionally stable at ANY dt — the discretized form
 * (semi-implicit Euler) diverges once ω·dt approaches 1, which one dropped
 * frame at a fast response reaches easily (mock-measured, 2026-07-15).
 * From rest (v=0) the approach is monotonic: p never overshoots 1.
 */
export function springStep(
  p: number,
  v: number,
  omega: number,
  dtSec: number,
): { p: number; v: number } {
  const u = 1 - p;
  const B = -v + omega * u;
  const decay = Math.exp(-omega * dtSec);
  const u2 = (u + B * dtSec) * decay;
  const du2 = (B - omega * (u + B * dtSec)) * decay;
  return { p: 1 - u2, v: -du2 };
}
