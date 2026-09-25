// The portal flight — the maths of ICE design-006 T1, ported VERBATIM from
// `@ice/kernel` (nav-flight.ts, and coords.ts `fitCamera`), plus the opacity
// ramps of `@ice/core` presentation-transition.ts and the NAV_TRANSITION
// defaults. Pure: no GPU, no DOM, no ECS. test/nav.test.ts pins every function
// here to numbers ICE's own kernel produced for the same inputs, so a drift
// from the product's flight is a red test, not a feel.
//
// Conventions are coords.ts's (ICE Law 13), the same as lod.ts's `View`:
// camera {x, y} = the world point at the viewport's top-left, zoom = screen px
// per world unit, `screen = (world − cam)·zoom`.
//
// The portal embedding: a container's content coordinates are FRAME-LOCAL —
// the transition DEFINES the embedding by mapping the arrival camera's visible
// rect onto the container's body rect (`portalAffine`, aspect-fit, centres
// aligned). With that affine fixed, both frames ride ONE camera: the
// destination renders under `c(t)` directly; the departed frame renders under
// `outgoingCamera(A, c(t))`, A mapping departed coords into destination coords.
// Continuity at the cut is exact by construction (`solveFlightStart`), and no
// drift is possible mid-flight — there is no second clock.
//
// Numerics locked by ICE's field testing (2026-07-15, three rounds):
//  - the progress spring is the CLOSED-FORM critically-damped solution —
//    semi-implicit Euler diverges once ω·dt nears 1 (one dropped frame at a
//    fast exit response sent a camera to zoom 1501);
//  - the path interpolates zoom in LOG space (constant perceived zoom
//    velocity — van Wijk & Nuij) with the view centre linear in 1/zoom, which
//    is exactly an anchored zoom whenever a fixed screen point exists;
//  - flights beyond `freezeOctaves` are depth-capped (`capFlightStart`): a DOM
//    plane's raster scale swept ~30× in one flight outruns the tile
//    re-raster; the capped flight is presented as a crossfade-through-zoom.
//    (A GPU ground has no such limit — the cap is kept so the ground's motion
//    matches the planes above it.)

export interface CameraState { readonly x: number; readonly y: number; readonly zoom: number }
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Viewport { readonly width: number; readonly height: number }

/** Uniform scale + translate: `A(q) = o + q·s`. */
export interface PortalAffine { readonly s: number; readonly ox: number; readonly oy: number }

/** The world rect a camera shows through a viewport. */
export function visibleRect(cam: CameraState, vpW: number, vpH: number): Rect {
  return { x: cam.x, y: cam.y, width: vpW / cam.zoom, height: vpH / cam.zoom };
}

/**
 * The portal embedding: map `arrival` (the world rect the arrival camera will
 * show, in the CHILD frame's coords) onto `portal` (the container's body rect,
 * in the PARENT frame's coords). Aspect-FIT with centres aligned (design-006
 * §8.3 — the container's chrome absorbs the letterbox; a mini mat's face shows
 * the inside past the arrival on its longer side, MINIMAT.md §3).
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
 * before the cut. Zoom limits deliberately do NOT apply here — flight paths
 * transit far outside the user-gesture band; only the ARRIVAL camera is
 * clamped by the caller.
 */
export function solveFlightStart(A: PortalAffine, camPre: CameraState): CameraState {
  return { x: A.ox + camPre.x * A.s, y: A.oy + camPre.y * A.s, zoom: camPre.zoom / A.s };
}

/**
 * Destination camera expressed in departed-frame coordinates. Rendering the
 * outgoing ground with this camera is pixel-equivalent to first mapping its
 * points through A and then rendering under `destination`.
 */
export function outgoingCamera(A: PortalAffine, destination: CameraState): CameraState {
  return { x: (destination.x - A.ox) / A.s, y: (destination.y - A.oy) / A.s, zoom: A.s * destination.zoom };
}

/** Zoom distance in octaves — the flight-length measure (design-006 §4/§5). */
export function flightOctaves(from: CameraState, to: CameraState): number {
  return Math.abs(Math.log2(to.zoom / from.zoom));
}

/**
 * Depth-cap a flight start (design-006 §5): beyond `maxOctaves`, clamp the
 * start zoom to `capFactor ×` the arrival zoom (dive direction preserved),
 * keeping the exact start's view CENTRE — the portal anchor — so the motion
 * still comes from/goes to the right place. `capped: true` means the caller
 * presents the flight as a crossfade (`flightOpacity` with `frozen`).
 */
export function capFlightStart(exact: CameraState, arrival: CameraState, vpW: number, vpH: number, maxOctaves: number, capFactor: number): { c0: CameraState; capped: boolean } {
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
 * velocity); view CENTRE linear in 1/zoom — exactly an anchored zoom whenever
 * a fixed screen point exists between the endpoints, a graceful blend
 * otherwise. Endpoints are exact: c(0) = c0, c(1) = c1.
 */
export function flightCamera(c0: CameraState, c1: CameraState, p: number, vpW: number, vpH: number): CameraState {
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
 * `B = −v₀ + ω·u₀`. Unconditionally stable at ANY dt. From rest (v = 0) the
 * approach is monotonic: p never overshoots 1.
 */
export function springStep(p: number, v: number, omega: number, dtSec: number): { p: number; v: number } {
  const u = 1 - p;
  const B = -v + omega * u;
  const decay = Math.exp(-omega * dtSec);
  const u2 = (u + B * dtSec) * decay;
  const du2 = (B - omega * (u + B * dtSec)) * decay;
  return { p: 1 - u2, v: -du2 };
}

/** Zoom-to-fit `content` with `pad` (world units), the zoom clamped into a band (kernel coords.ts). */
export function fitCamera(content: Rect, vpW: number, vpH: number, opts: { pad: number; minZoom: number; maxZoom: number }): CameraState {
  const fit = Math.min(vpW / (content.width + opts.pad * 2), vpH / (content.height + opts.pad * 2));
  const zoom = Math.min(opts.maxZoom, Math.max(opts.minZoom, fit));
  return { x: content.x + content.width / 2 - vpW / (2 * zoom), y: content.y + content.height / 2 - vpH / (2 * zoom), zoom };
}

// ---------------------------------------------------------------- the product's numbers

/** `@ice/core` NAV_TRANSITION_DEFAULTS — the response the product flies at. */
export const NAV = {
  responseMs: 420,
  exitResponseFactor: 0.8,
  durationPerOctave: 0.12,
  baseOctaves: 3.5,
  freezeOctaves: 4.2,
  capFactor: 10,
  settleP: 0.999,
  settleV: 0.02,
} as const;
export type FlightTuning = { readonly [K in keyof typeof NAV]: number };

/** `@ice/core` FIT_DEFAULTS — the NATURAL band an arrival is framed into (design-006, amended 2026-07-18). */
export const FIT = { pad: 80, minZoom: 0.5, maxZoom: 1 } as const;
export type FitBand = { readonly [K in keyof typeof FIT]: number };

// ---------------------------------------------------------------- the opacity story

export type NavKind = "enter" | "exit";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const ramp = (v: number, from: number, to: number): number => (to <= from ? (v >= to ? 1 : 0) : smooth((v - from) / (to - from)));

/**
 * The departing and arriving presentations' opacity at progress `p` — ICE
 * core `opacityAt`, verbatim. Enter: the parent holds until p ≈ 0.3 and is
 * gone by 0.75 (most of it has physically left the viewport by then). Exit:
 * the inner frame holds to 0.85 and fades as it lands on the card face. A
 * FROZEN (depth-capped) flight is a crossfade: out 0.05→0.45, in 0.3→0.7.
 */
export function flightOpacity(kind: NavKind, p: number, frozen: boolean): { readonly outgoing: number; readonly incoming: number } {
  if (frozen) return { outgoing: 1 - ramp(p, 0.05, 0.45), incoming: ramp(p, 0.3, 0.7) };
  return { outgoing: kind === "enter" ? 1 - ramp(p, 0.3, 0.75) : 1 - ramp(p, 0.85, 1), incoming: 1 };
}

// ---------------------------------------------------------------- a flight, as a host drives it

/**
 * One in-flight transition — what ICE keeps in its `NavTransition` resource,
 * minus the ECS. The host owns the clock: `stepFlight` each frame until
 * `active` clears, `flightAt` for a pinned still.
 */
export interface Flight {
  readonly kind: NavKind;
  /** A: departed-frame coords → destination-frame coords. */
  readonly affine: PortalAffine;
  /** The departed frame's camera at the cut — what it renders under at p = 0, and throughout a frozen flight. */
  readonly camPre: CameraState;
  readonly c0: CameraState;
  readonly c1: CameraState;
  /** Depth-capped: present as a crossfade (`flightOpacity`). */
  readonly frozen: boolean;
  /** Response multiplier from octave distance, locked at start (§4). */
  readonly durMul: number;
  p: number;
  v: number;
  active: boolean;
}

/**
 * Arm a flight from the already-cut world: `camPre` the departed frame's
 * camera at the cut (the continuity solve gives c0 in destination coords),
 * `c1` the clamped arrival. Applies the depth cap and the octave response.
 * The host snaps its camera to `flight.c0`.
 */
export function startFlight(kind: NavKind, A: PortalAffine, camPre: CameraState, c1: CameraState, vp: Viewport, tune: FlightTuning = NAV, exact: CameraState = solveFlightStart(A, camPre)): Flight {
  // `exact`: the start the continuity solve gives — or, from a LIVE PORTAL (PORTAL.md §2.4), the camera the
  // inside was already rendering under (`outgoingCamera(M, camPre)`, the same number to within an ulp), so
  // the arriving slot's first frame is the portal's last frame bit for bit.
  const { c0, capped } = capFlightStart(exact, c1, vp.width, vp.height, tune.freezeOctaves, tune.capFactor);
  const octaves = flightOctaves(c0, c1);
  return { kind, affine: A, camPre, c0, c1, frozen: capped, durMul: 1 + tune.durationPerOctave * Math.max(0, octaves - tune.baseOctaves), p: 0, v: 0, active: true };
}

/**
 * The camera the DEPARTED frame renders under this frame. Riding the flight
 * through the affine (`outgoingCamera`) — except at the cut itself, where it
 * is the pre-cut camera bit for bit (the affine and its inverse round-trip to
 * within an ulp, and at zoom 1 an ulp is the other side of a decade), and
 * throughout a FROZEN flight, where the departed frame stays at its pre-cut
 * appearance and fades (design-006 §5: the cap broke the geometry, so the
 * story is a dissolve, not a portal).
 */
export function departedCamera(f: Flight, cam: CameraState): CameraState {
  if (f.frozen || (cam.x === f.c0.x && cam.y === f.c0.y && cam.zoom === f.c0.zoom)) return f.camPre;
  return outgoingCamera(f.affine, cam);
}

/** Advance the spring by `dtSec`; returns the camera for this frame. Lands EXACTLY on c1 and clears `active` at settle. */
export function stepFlight(f: Flight, dtSec: number, vp: Viewport, tune: FlightTuning = NAV): CameraState {
  if (!f.active) return f.c1;
  const responseMs = tune.responseMs * (f.kind === "exit" ? tune.exitResponseFactor : 1) * f.durMul;
  const omega = (2 * Math.PI) / (responseMs / 1000);
  const { p, v } = springStep(f.p, f.v, omega, dtSec);
  if (p > tune.settleP && Math.abs(v) < tune.settleV) { f.p = 1; f.v = 0; f.active = false; return f.c1; }
  f.p = p; f.v = v;
  return flightCamera(f.c0, f.c1, clamp01(p), vp.width, vp.height);
}

/** The camera at progress `p` — a pinned still (the oracle's scenes, the harness's shots). The endpoints are c0 and c1 themselves, bit for bit. */
export function flightAt(f: Flight, p: number, vp: Viewport): CameraState {
  if (p <= 0) return f.c0;
  if (p >= 1) return f.c1;
  return flightCamera(f.c0, f.c1, p, vp.width, vp.height);
}

// ---------------------------------------------------------------- the two nav ops, as geometry

/** The bounds of some rects, or null when there are none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height); }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The DEFAULT framing for a frame (design-006 as amended): zoom-to-fit its
 * content capped into the natural band; an empty frame arrives centred on
 * its origin at zoom 1.
 */
export function arrivalCamera(content: Rect | null, vp: Viewport, fit: FitBand = FIT): CameraState {
  if (content === null) return { x: -vp.width / 2, y: -vp.height / 2, zoom: 1 };
  return fitCamera(content, vp.width, vp.height, fit);
}

/** A flight that is already over — what a degenerate portal (no area) gets: the host snaps to the arrival, as ICE's rect-less link "degrades the whole jump to a snap — never half-fly". */
export function cutFlight(kind: NavKind, camPre: CameraState, c1: CameraState): Flight {
  return { kind, affine: { s: 1, ox: 0, oy: 0 }, camPre, c0: c1, c1, frozen: false, durMul: 1, p: 1, v: 0, active: false };
}
const hasArea = (K: Rect): boolean => K.width > 0 && K.height > 0;

/**
 * ENTER a container whose body rect is `K` (parent coords) holding `content`
 * (child coords): the arrival is the child's default framing, the portal maps
 * that arrival onto K, and the flight starts where the parent was. The host
 * switches frames, snaps its camera to `flight.c0`, then steps.
 */
export function enterFlight(K: Rect, content: Rect | null, camPre: CameraState, vp: Viewport, tune: FlightTuning = NAV, fit: FitBand = FIT, exact?: CameraState): Flight {
  const c1 = arrivalCamera(content, vp, fit);
  if (!hasArea(K)) return cutFlight("enter", camPre, c1);
  const A = invertAffine(portalAffine(visibleRect(c1, vp.width, vp.height), K));
  return startFlight("enter", A, camPre, c1, vp, tune, exact ?? solveFlightStart(A, camPre));
}

/**
 * EXIT to the parent: the portal is rebuilt from the container's CURRENT rect
 * `K` and the inner frame's default framing (so arrival and preview agree),
 * and the landing is the camera saved at entry. `camPre` is the inner camera
 * at the cut.
 */
export function exitFlight(K: Rect, inner: Rect | null, camPre: CameraState, saved: CameraState, vp: Viewport, tune: FlightTuning = NAV, fit: FitBand = FIT): Flight {
  if (!hasArea(K)) return cutFlight("exit", camPre, saved);
  const M = portalAffine(visibleRect(arrivalCamera(inner, vp, fit), vp.width, vp.height), K);
  return startFlight("exit", M, camPre, saved, vp, tune);
}
