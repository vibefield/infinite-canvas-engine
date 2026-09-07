// @vitest-environment node
// The portal flight's pure parts, pinned to numbers ICE's OWN kernel produced
// for the same inputs (packages/kernel/src/nav-flight.ts and coords.ts, loaded
// as-is in Node, 2026-09-05): the affine, the continuity solve, the outgoing
// camera, the depth cap, the log-zoom path, the closed-form spring, the fit
// band — and the opacity ramps of core's presentation coordinator. Then the
// two nav ops as geometry, the flight a host drives, and the portal records.
import { must } from "./must";
import { describe, expect, it } from "vitest";
import { frameUniformStruct } from "../../src/card/layout";
import { Uniforms } from "../../src/field/layout";
import { MatUniforms } from "../../src/packs/mat/layout";
import { VF_UNIFORMS } from "../../src/packs/vf-frame";
import {
  FIT, NAV, arrivalCamera, boundsOf, capFlightStart, composeAffine, enterFlight, exitFlight, fitCamera, flightAt, flightCamera, flightOctaves, flightOpacity,
  departedCamera, invertAffine, outgoingCamera, portalAffine, solveFlightStart, springStep, startFlight, stepFlight, visibleRect,
} from "../../src/nav/flight";
import { clipOf, PORTAL_CHAIN, portalValues, scissorOf } from "../../src/nav/portal";
import { lod } from "../../src/lattice/lod";

const VP = { width: 1200, height: 800 };
const CAM_PRE = { x: 13.7, y: -21.3, zoom: 1.37 };
const CARD = { x: 412.5, y: 233.25, width: 329, height: 155 };
const CONTENT = { x: -40, y: -20, width: 700, height: 300 };

// ICE's numbers (10 significant digits)
const ICE = {
  c1: { x: -290, y: -270, zoom: 1 },
  M: { s: 0.19375, ox: 516.9375, oy: 285.5625 },
  A: { s: 5.161290323, ox: -2668.064516, oy: -1473.870968 },
  c0: { x: -2597.354839, y: -1583.806452, zoom: 0.2654375 },
  composed: { s: 0.0484375, ox: 518.875, oy: 284.59375 },
  octaves: 1.913555891,
  cap2: { x: 139000, y: 93000, zoom: 0.1 },
  cap2octaves: 7.965784285,
  path: [
    { x: -2597.354839, y: -1583.806452, zoom: 0.2654375 },
    { x: -1710.861626, y: -1079.037752, zoom: 0.3698040888 },
    { x: -1074.555676, y: -716.7255279, zoom: 0.5152062694 },
    { x: -617.8288148, y: -456.6655292, zoom: 0.717778705 },
    { x: -290, y: -270, zoom: 1 },
  ],
  spring: [
    { p: 0.02636923761, v: 2.906873066 }, { p: 0.08979957342, v: 4.530772188 }, { p: 0.1726496006, v: 5.296386226 }, { p: 0.263259249, v: 5.503443933 },
    { p: 0.3541689958, v: 5.361184112 }, { p: 0.4408337549, v: 5.013697533 }, { p: 0.5206998396, v: 4.558490797 }, { p: 0.5925473833, v: 4.060029524 },
    { p: 0.6560260096, v: 3.559572775 }, { p: 0.711330482, v: 3.082276034 }, { p: 0.7589771645, v: 2.642289367 }, { p: 0.7996525957, v: 2.246389706 },
  ],
  big: { p: 0.9963977255, v: 0.04758817856 },
};
const near = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
const camNear = (a: { x: number; y: number; zoom: number }, b: { x: number; y: number; zoom: number }, rel = 1e-9) => { near(a.x, b.x, rel); near(a.y, b.y, rel); near(a.zoom, b.zoom, rel); };

describe("the kernel's maths, verbatim", () => {
  const c1 = fitCamera(CONTENT, VP.width, VP.height, FIT);
  const M = portalAffine(visibleRect(c1, VP.width, VP.height), CARD);
  const A = invertAffine(M);
  const c0 = solveFlightStart(A, CAM_PRE);

  it("fitCamera frames content into the natural band, centred", () => { camNear(c1, ICE.c1); expect(c1.zoom).toBe(1); });
  it("portalAffine is aspect-fit with centres aligned; invert and compose are ICE's", () => {
    near(M.s, ICE.M.s); near(M.ox, ICE.M.ox); near(M.oy, ICE.M.oy);
    near(A.s, ICE.A.s); near(A.ox, ICE.A.ox); near(A.oy, ICE.A.oy);
    const c = composeAffine(M, { s: 0.25, ox: 10, oy: -5 });
    near(c.s, ICE.composed.s); near(c.ox, ICE.composed.ox); near(c.oy, ICE.composed.oy);
  });
  it("the continuity solve, and the outgoing camera is its exact inverse", () => {
    camNear(c0, ICE.c0);
    camNear(outgoingCamera(A, c0), CAM_PRE);
    near(flightOctaves(c0, c1), ICE.octaves);
  });
  it("capFlightStart leaves a short flight alone and caps a long one at capFactor × arrival, keeping the view centre", () => {
    expect(capFlightStart(c0, c1, VP.width, VP.height, NAV.freezeOctaves, NAV.capFactor)).toEqual({ c0, capped: false });
    const far = { x: -5000, y: -3000, zoom: 0.004 };
    near(flightOctaves(far, c1), ICE.cap2octaves);
    const cap = capFlightStart(far, c1, VP.width, VP.height, NAV.freezeOctaves, NAV.capFactor);
    expect(cap.capped).toBe(true); camNear(cap.c0, ICE.cap2);
    // the same screen centre before and after the cap
    near(cap.c0.x + VP.width / (2 * cap.c0.zoom), far.x + VP.width / (2 * far.zoom));
  });
  it("flightCamera log-lerps zoom with exact endpoints", () => {
    [0, 0.25, 0.5, 0.75, 1].forEach((p, i) => camNear(flightCamera(c0, c1, p, VP.width, VP.height), must(ICE.path[i])));
    camNear(flightCamera(c0, c1, 0, VP.width, VP.height), c0, 1e-14);   // exact in the maths; an ulp through exp∘log
    camNear(flightCamera(c0, c1, 1, VP.width, VP.height), c1, 1e-14);
  });
  it("springStep is the closed form: ICE's sequence at 60 Hz, stable at a half-second step, never overshooting from rest", () => {
    const omega = (2 * Math.PI) / 0.42;
    let s = { p: 0, v: 0 };
    for (const g of ICE.spring) { s = springStep(s.p, s.v, omega, 1 / 60); near(s.p, g.p, 1e-8); near(s.v, g.v, 1e-8); }
    const big = springStep(0.2, 0.8, omega, 0.5); near(big.p, ICE.big.p, 1e-8); near(big.v, ICE.big.v, 1e-8);
    let q = { p: 0, v: 0 };
    let prev = 0;
    for (let i = 0; i < 400; i++) { q = springStep(q.p, q.v, omega, 1 / 60); expect(q.p).toBeGreaterThanOrEqual(prev); expect(q.p).toBeLessThanOrEqual(1); prev = q.p; }
    expect(q.p).toBeGreaterThan(0.999);
  });
});

describe("the opacity story (core presentation-transition, verbatim)", () => {
  it("enter holds the parent to 0.3 and drops it by 0.75; exit holds the inside to 0.85", () => {
    expect(flightOpacity("enter", 0, false)).toEqual({ outgoing: 1, incoming: 1 });
    expect(flightOpacity("enter", 0.3, false).outgoing).toBe(1);
    expect(flightOpacity("enter", 0.525, false).outgoing).toBeCloseTo(0.5, 9);
    expect(flightOpacity("enter", 0.75, false).outgoing).toBe(0);
    expect(flightOpacity("exit", 0.85, false).outgoing).toBe(1);
    expect(flightOpacity("exit", 0.925, false).outgoing).toBeCloseTo(0.5, 9);
    expect(flightOpacity("exit", 1, false).outgoing).toBe(0);
  });
  it("a frozen flight is a crossfade: out 0.05→0.45, in 0.3→0.7", () => {
    expect(flightOpacity("enter", 0, true)).toEqual({ outgoing: 1, incoming: 0 });
    expect(flightOpacity("exit", 0.25, true).outgoing).toBeCloseTo(0.5, 9);
    expect(flightOpacity("exit", 0.5, true).incoming).toBeCloseTo(0.5, 9);
    expect(flightOpacity("enter", 0.7, true)).toEqual({ outgoing: 0, incoming: 1 });
  });
});

describe("the nav ops as geometry, and a flight a host drives", () => {
  it("enterFlight starts where the parent was: the parent through A renders as before; exitFlight lands on the saved camera", () => {
    const f = enterFlight(CARD, CONTENT, CAM_PRE, VP);
    expect(f.kind).toBe("enter"); expect(f.frozen).toBe(false); expect(f.active).toBe(true); expect(f.p).toBe(0);
    camNear(f.c1, ICE.c1); camNear(f.c0, ICE.c0);
    camNear(outgoingCamera(f.affine, f.c0), CAM_PRE);
    const saved = { x: 100, y: 50, zoom: 0.8 };
    const innerCam = { x: -100, y: -200, zoom: 1.6 };
    const g = exitFlight(CARD, CONTENT, innerCam, saved, VP);
    expect(g.kind).toBe("exit"); expect(g.c1).toEqual(saved);
    camNear(outgoingCamera(g.affine, g.c0), innerCam);   // the inside, through M, renders as before the cut
    // and the same M as the enter used (the arrival framing is recomputed, not remembered)
    near(g.affine.s, ICE.M.s); near(g.affine.ox, ICE.M.ox);
  });
  it("a tiny container is a long flight: capped, frozen, and the response stretches with the octaves", () => {
    const tiny = { x: 100, y: 100, width: 24, height: 12 };
    const f = enterFlight(tiny, CONTENT, CAM_PRE, VP);
    expect(f.frozen).toBe(true);
    expect(f.c0.zoom).toBeCloseTo(f.c1.zoom / NAV.capFactor, 12);
    const octaves = flightOctaves(f.c0, f.c1);
    expect(f.durMul).toBeCloseTo(1 + NAV.durationPerOctave * Math.max(0, octaves - NAV.baseOctaves), 12);
    const short = enterFlight(CARD, CONTENT, CAM_PRE, VP);
    expect(short.durMul).toBe(1);
  });
  it("stepFlight flies the spring to rest, lands EXACTLY on c1, and clears active; flightAt pins a still", () => {
    const f = enterFlight(CARD, CONTENT, CAM_PRE, VP);
    let frames = 0;
    let cam = f.c0;
    let lastZoom = f.c0.zoom;
    while (f.active && frames < 600) { cam = stepFlight(f, 1 / 60, VP); expect(cam.zoom).toBeGreaterThanOrEqual(lastZoom - 1e-12); lastZoom = cam.zoom; frames += 1; }
    expect(f.active).toBe(false);
    expect(cam).toEqual(f.c1);
    expect(frames).toBeGreaterThan(20); expect(frames).toBeLessThan(120);   // ≈ 420 ms at 60 Hz, plus the settle
    expect(flightAt(f, 0, VP)).toBe(f.c0); expect(flightAt(f, 1, VP)).toBe(f.c1);   // a pinned still's endpoints are the flight's own, bit for bit
    camNear(flightAt(f, 0.5, VP), must(ICE.path[2]));
    expect(stepFlight(f, 1, VP)).toEqual(f.c1);   // at rest it stays put
  });
  it("departedCamera is the pre-cut camera at the cut and through a frozen flight, the ride through the affine otherwise", () => {
    const f = enterFlight(CARD, CONTENT, CAM_PRE, VP);
    expect(departedCamera(f, { ...f.c0 })).toBe(CAM_PRE);                 // by value, not identity — a host copies its camera
    const mid = flightAt(f, 0.5, VP);
    camNear(departedCamera(f, mid), outgoingCamera(f.affine, mid));
    // the round trip through A lands within an ulp of camPre — and at zoom 1 an ulp below is the other side of a decade
    const z1 = enterFlight(CARD, CONTENT, { x: 13.7, y: -21.3, zoom: 1 }, VP);
    camNear(outgoingCamera(z1.affine, z1.c0), z1.camPre, 1e-14);
    expect(departedCamera(z1, z1.c0).zoom).toBe(1);
    expect(lod({ camX: 0, camY: 0, zoom: 1, width: 1200, height: 800 }).k0).toBe(0);
    expect(lod({ camX: 0, camY: 0, zoom: 0.9999999999999999, width: 1200, height: 800 }).k0).toBe(1);
    const frozen = enterFlight({ x: 100, y: 100, width: 24, height: 12 }, CONTENT, CAM_PRE, VP);
    expect(departedCamera(frozen, flightAt(frozen, 0.7, VP))).toBe(CAM_PRE);
  });
  it("a portal with no area is a cut, never a NaN: the flight is over before it starts", () => {
    const f = enterFlight({ x: 100, y: 100, width: 0, height: 40 }, CONTENT, CAM_PRE, VP);
    expect(f.active).toBe(false); expect(f.p).toBe(1); expect(f.c0).toEqual(f.c1);
    expect(Number.isFinite(f.c1.zoom) && Number.isFinite(f.c1.x)).toBe(true);
    const g = exitFlight({ x: 0, y: 0, width: 10, height: 0 }, CONTENT, CAM_PRE, { x: 1, y: 2, zoom: 3 }, VP);
    expect(g.active).toBe(false); expect(g.c1).toEqual({ x: 1, y: 2, zoom: 3 });
    expect(stepFlight(g, 1 / 60, VP)).toEqual(g.c1);
  });
  it("exit is lighter (0.8× the response) — it lands sooner", () => {
    const a = enterFlight(CARD, CONTENT, CAM_PRE, VP);
    const b = exitFlight(CARD, CONTENT, CAM_PRE, { x: 0, y: 0, zoom: 1 }, VP);
    const count = (f: typeof a) => { let n = 0; while (f.active && n < 600) { stepFlight(f, 1 / 60, VP); n += 1; } return n; };
    expect(count(b)).toBeLessThan(count(a));
  });
  it("startFlight takes a tuning; boundsOf and arrivalCamera handle the empty frame", () => {
    const f = startFlight("enter", ICE.A, CAM_PRE, ICE.c1, VP, { ...NAV, freezeOctaves: 1 });
    expect(f.frozen).toBe(true); expect(f.camPre).toBe(CAM_PRE);
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: 0, y: 0, width: 10, height: 10 }, { x: -5, y: 20, width: 2, height: 2 }])).toEqual({ x: -5, y: 0, width: 15, height: 22 });
    expect(arrivalCamera(null, VP)).toEqual({ x: -600, y: -400, zoom: 1 });
  });
});

describe("the portal records", () => {
  it("clipOf projects a world rect to screen CSS px; portalValues and scissorOf read it", () => {
    const clip = clipOf(CARD, 22, { x: 100, y: 50, zoom: 2 });
    expect(clip).toEqual({ cx: (412.5 + 164.5 - 100) * 2, cy: (233.25 + 77.5 - 50) * 2, hx: 329, hy: 155, r: 44 });
    const v = portalValues({ opacity: 1, portal: clip });
    expect(v.portals.slice(0, 4)).toEqual([clip.cx, clip.cy, clip.hx, clip.hy]); expect(v.clips.slice(0, 4)).toEqual([44, 1, 0, 0]);
    expect(v.portals.length).toBe(4 * PORTAL_CHAIN); expect(v.clips[5]).toBe(0);   // one face, then the chain ends
    expect(portalValues({ opacity: 0.5 }).clips.every((x) => x === 0)).toBe(true);
    expect(portalValues(undefined).clips[1]).toBe(0);
    // the scissor is the bbox in device px, one px of ramp either side, inside the attachment
    // x0 = ⌊(954−329)·2⌋−1, y0 = ⌊(521.5−155)·2⌋−1; the right edge (2567) clamps to the attachment's 2400
    expect(scissorOf({ opacity: 1, portal: clip }, 2, { w: 2400, h: 1600 })).toEqual([1249, 732, 2400 - 1249, 1354 - 732]);
    expect(scissorOf(undefined, 2, { w: 2400, h: 1600 })).toEqual([0, 0, 2400, 1600]);
    expect(scissorOf({ opacity: 1, portal: { cx: -500, cy: 10, hx: 20, hy: 20, r: 0 } }, 2, { w: 2400, h: 1600 })[2]).toBe(0);   // off screen: zero width
    expect(scissorOf({ opacity: 1, portal: { cx: 1190, cy: 790, hx: 100, hy: 100, r: 0 } }, 2, { w: 2400, h: 1600 })).toEqual([2179, 1379, 221, 221]);
  });
  it("every uniform block carries the portal chain — portals and clips — by name", () => {
    // the frame's block is BUILT per card program (design-014): the chain is in the HEAD,
    // so a program's own slots (the vf-frame pack's twelve) cannot displace it
    for (const s of [Uniforms, MatUniforms, frameUniformStruct(0), frameUniformStruct(VF_UNIFORMS)]) {
      const names = (s.fields as ReadonlyArray<readonly [string, string]>).map(([name]) => name);
      expect(names).toContain("portals"); expect(names).toContain("clips");
      expect(s.size % 16).toBe(0);
    }
  });
});
