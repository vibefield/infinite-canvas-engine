/**
 * Nav-flight math (design-006 §2/§4). The load-bearing pins:
 *  - continuity: C(solveFlightStart(A, camPre)) ∘ A ≡ C(camPre) exactly —
 *    the cut frame moves nothing by even a pixel;
 *  - the closed-form spring is stable at ANY dt (the Euler form diverged);
 *  - path endpoints are exact; log-zoom keeps the midpoint geometric;
 *  - the depth cap preserves the exact start's view center.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../src/coords";
import { planeCssTransform, worldToScreen } from "../src/coords";
import {
  capFlightStart,
  composeAffine,
  flightCamera,
  flightOctaves,
  invertAffine,
  outgoingCamera,
  portalAffine,
  solveFlightStart,
  springStep,
  visibleRect,
  type PortalAffine,
} from "../src/nav-flight";

const VP = { w: 1440, h: 900 };

/** Screen position of a departed-frame point rendered through A under cam. */
function departedToScreen(q: { x: number; y: number }, A: PortalAffine, cam: CameraState) {
  return worldToScreen(A.ox + q.x * A.s, A.oy + q.y * A.s, cam);
}

describe("portalAffine", () => {
  it("maps the arrival rect onto the portal rect, aspect-fit, centers aligned", () => {
    const arrival = { x: -100, y: -50, width: 1440, height: 900 };
    const portal = { x: 90, y: -110, width: 270, height: 190 };
    const A = portalAffine(arrival, portal);
    // Uniform scale = the tighter axis.
    expect(A.s).toBeCloseTo(Math.min(270 / 1440, 190 / 900), 12);
    // Centers map exactly.
    const cx = A.ox + (arrival.x + arrival.width / 2) * A.s;
    const cy = A.oy + (arrival.y + arrival.height / 2) * A.s;
    expect(cx).toBeCloseTo(portal.x + portal.width / 2, 9);
    expect(cy).toBeCloseTo(portal.y + portal.height / 2, 9);
  });

  it("invert and compose are exact inverses / associative maps", () => {
    const A = { s: 0.25, ox: 12.5, oy: -33 };
    const inv = invertAffine(A);
    const q = { x: 123.4, y: -56.7 };
    const roundTrip = {
      x: inv.ox + (A.ox + q.x * A.s) * inv.s,
      y: inv.oy + (A.oy + q.y * A.s) * inv.s,
    };
    expect(roundTrip.x).toBeCloseTo(q.x, 9);
    expect(roundTrip.y).toBeCloseTo(q.y, 9);

    const B = { s: 0.34, ox: 200, oy: 80 };
    const AB = composeAffine(A, B);
    const viaCompose = { x: AB.ox + q.x * AB.s, y: AB.oy + q.y * AB.s };
    const viaSteps = { x: A.ox + (B.ox + q.x * B.s) * A.s, y: A.oy + (B.oy + q.y * B.s) * A.s };
    expect(viaCompose.x).toBeCloseTo(viaSteps.x, 9);
    expect(viaCompose.y).toBeCloseTo(viaSteps.y, 9);
  });
});

describe("solveFlightStart (continuity at the cut)", () => {
  it("expresses the destination camera in departed coordinates", () => {
    const A = { s: 0.25, ox: 120, oy: 80 };
    const destination = { x: 180, y: 140, zoom: 2 };
    const departed = outgoingCamera(A, destination);
    expect(departed).toEqual({ x: 240, y: 240, zoom: 0.5 });
    const q = { x: 300, y: 400 };
    expect((A.ox + q.x * A.s - destination.x) * destination.zoom).toBeCloseTo(
      (q.x - departed.x) * departed.zoom,
    );
    expect((A.oy + q.y * A.s - destination.y) * destination.zoom).toBeCloseTo(
      (q.y - departed.y) * departed.zoom,
    );
  });

  it("departed content through A under c0 renders exactly as under camPre", () => {
    // Enter shape: A = M⁻¹ maps parent coords into the child frame.
    const arrivalCam: CameraState = { x: -420, y: -260, zoom: 1.48 };
    const R1 = visibleRect(arrivalCam, VP.w, VP.h);
    const K = { x: 90, y: -110, width: 270, height: 190 };
    const A = invertAffine(portalAffine(R1, K));
    const camPre: CameraState = { x: -650, y: -400, zoom: 0.55 };
    const c0 = solveFlightStart(A, camPre);

    for (const q of [{ x: 0, y: 0 }, { x: -560, y: -300 }, { x: 230, y: 170 }]) {
      const before = worldToScreen(q.x, q.y, camPre);
      const after = departedToScreen(q, A, c0);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
    // Same statement at the plane-transform level: C(c0)∘A = C(camPre).
    const dep = planeCssTransform(c0);
    expect(A.s * c0.zoom).toBeCloseTo(camPre.zoom, 9); // scale channel
    expect((A.ox - c0.x) * c0.zoom).toBeCloseTo(planeCssTransform(camPre).tx, 6);
    expect(dep.scale).toBeGreaterThan(0);
  });

  it("enter starts zoomed OUT of the arrival (a dive-in); exit starts zoomed IN", () => {
    const arrivalCam: CameraState = { x: 0, y: 0, zoom: 1.5 };
    const K = { x: 100, y: 100, width: 250, height: 180 };
    const M = portalAffine(visibleRect(arrivalCam, VP.w, VP.h), K);
    const parentCam: CameraState = { x: -200, y: -150, zoom: 0.6 };

    const enterStart = solveFlightStart(invertAffine(M), parentCam);
    expect(enterStart.zoom).toBeLessThan(arrivalCam.zoom);

    const childCam: CameraState = { x: 10, y: 20, zoom: 1.2 };
    const exitStart = solveFlightStart(M, childCam);
    expect(exitStart.zoom).toBeGreaterThan(parentCam.zoom * 2); // deep inside the card
  });
});

describe("flightCamera", () => {
  const c0: CameraState = { x: 480, y: 300, zoom: 0.14 };
  const c1: CameraState = { x: -420, y: -260, zoom: 1.48 };

  it("endpoints are exact", () => {
    const at0 = flightCamera(c0, c1, 0, VP.w, VP.h);
    const at1 = flightCamera(c0, c1, 1, VP.w, VP.h);
    expect(at0).toEqual(c0);
    expect(at1.x).toBeCloseTo(c1.x, 9);
    expect(at1.y).toBeCloseTo(c1.y, 9);
    expect(at1.zoom).toBeCloseTo(c1.zoom, 9);
  });

  it("zoom interpolates in LOG space (midpoint = geometric mean)", () => {
    const mid = flightCamera(c0, c1, 0.5, VP.w, VP.h);
    expect(mid.zoom).toBeCloseTo(Math.sqrt(c0.zoom * c1.zoom), 9);
  });

  it("a pure zoom keeps its anchor fixed on screen (anchored-zoom property)", () => {
    // Construct c1 as a zoom of c0 about a fixed screen point.
    const anchor = { sx: 500, sy: 320 };
    const worldAnchor = { x: anchor.sx / c0.zoom + c0.x, y: anchor.sy / c0.zoom + c0.y };
    const z1 = c0.zoom * 6;
    const cz: CameraState = { x: worldAnchor.x - anchor.sx / z1, y: worldAnchor.y - anchor.sy / z1, zoom: z1 };
    for (const p of [0.25, 0.5, 0.75]) {
      const cam = flightCamera(c0, cz, p, VP.w, VP.h);
      const s = worldToScreen(worldAnchor.x, worldAnchor.y, cam);
      expect(s.x).toBeCloseTo(anchor.sx, 6);
      expect(s.y).toBeCloseTo(anchor.sy, 6);
    }
  });
});

describe("capFlightStart", () => {
  const arrival: CameraState = { x: -600, y: -400, zoom: 0.36 };

  it("within maxOctaves: exact start, uncapped", () => {
    const exact: CameraState = { x: 100, y: 80, zoom: 0.36 * 9 }; // ~3.17 octaves
    const r = capFlightStart(exact, arrival, VP.w, VP.h, 4.2, 10);
    expect(r.capped).toBe(false);
    expect(r.c0).toEqual(exact);
  });

  it("beyond maxOctaves: zoom capped to capFactor × arrival, view CENTER preserved", () => {
    const exact: CameraState = { x: 100, y: 80, zoom: 0.36 * 60 }; // ~5.9 octaves
    const r = capFlightStart(exact, arrival, VP.w, VP.h, 4.2, 10);
    expect(r.capped).toBe(true);
    expect(r.c0.zoom).toBeCloseTo(arrival.zoom * 10, 9);
    const exactCenter = { x: exact.x + VP.w / (2 * exact.zoom), y: exact.y + VP.h / (2 * exact.zoom) };
    const cappedCenter = { x: r.c0.x + VP.w / (2 * r.c0.zoom), y: r.c0.y + VP.h / (2 * r.c0.zoom) };
    expect(cappedCenter.x).toBeCloseTo(exactCenter.x, 9);
    expect(cappedCenter.y).toBeCloseTo(exactCenter.y, 9);
    expect(flightOctaves(r.c0, arrival)).toBeCloseTo(Math.log2(10), 9);
  });
});

describe("springStep (closed form)", () => {
  const omega = (2 * Math.PI) / 0.336; // the fast exit response that broke Euler

  it("converges monotonically from rest — no overshoot past 1", () => {
    let p = 0;
    let v = 0;
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      ({ p, v } = springStep(p, v, omega, 0.016));
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(p).toBeLessThanOrEqual(1 + 1e-9);
      prev = p;
    }
    expect(p).toBeGreaterThan(0.999);
    expect(Math.abs(v)).toBeLessThan(1e-3);
  });

  it("is stable at ANY dt — the exact case that diverged under Euler (ω·dt ≈ 0.94)", () => {
    let p = 0;
    let v = 0;
    for (let i = 0; i < 60; i++) {
      ({ p, v } = springStep(p, v, omega, 0.05)); // clamped worst-case frame
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(p).toBeGreaterThan(0.999);
    // One giant 500 ms step lands essentially at rest, still in range.
    const jump = springStep(0, 0, omega, 0.5);
    expect(jump.p).toBeGreaterThan(0.99);
    expect(jump.p).toBeLessThanOrEqual(1);
  });

  it("matches the exact analytic solution over an arbitrary step split", () => {
    // Stepping 0.3 s in one go ≡ stepping 0.1 s three times (exact form).
    const one = springStep(0.2, 0.8, omega, 0.3);
    let acc = { p: 0.2, v: 0.8 };
    for (let i = 0; i < 3; i++) acc = springStep(acc.p, acc.v, omega, 0.1);
    expect(acc.p).toBeCloseTo(one.p, 9);
    expect(acc.v).toBeCloseTo(one.v, 9);
  });
});
