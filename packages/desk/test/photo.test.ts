// The photo's law (PHOTO.md): the pose → geometry mirror, the local eye, and
// the body's physics — held, released, landed — as numbers, no GPU.
import { must } from "./must";
import { describe, expect, it } from "vitest";
import {
  bendAt, clearMat, grab, hitPhoto, LAMP, lightAt, moveHold, newBody, PHOTO, type PhotoBody, pointAt, printSize, project,
  release, resolvePhoto, restless, shadowSlope, stepPhoto, twist, unproject,
} from "../src/photo/photo";

const law = structuredClone(PHOTO);
const run = (b: PhotoBody, seconds: number, each?: (t: number) => void, t0 = 0) => {
  const dt = 1 / 120;
  let t = t0;
  for (let i = 0; i < Math.round(seconds / dt); i++) { t += dt; each?.(t); stepPhoto(b, dt, law); }
  return t;
};
const settled = (b: PhotoBody) => run(b, 3);

describe("the print's size and the light", () => {
  it("keeps the picture's aspect with the long side at the law's", () => {
    const s = printSize(3000, 2000);
    expect(s.w).toBe(400); expect(s.h).toBeCloseTo(400 * (2000 / 3000), 9);
    expect(printSize(900, 1200).h).toBe(400);
  });
  it("the light is the one lamp: up and to the right; shadows fall lower-left, capped", () => {
    const L = lightAt(0, 0);
    expect(Math.hypot(...L)).toBeCloseTo(1, 12);
    expect(L[0]).toBeGreaterThan(0); expect(L[1]).toBeLessThan(0); expect(L[2]).toBeGreaterThan(0);
    const s = shadowSlope(0, 0);
    expect(s[0]).toBeLessThan(0); expect(s[1]).toBeGreaterThan(0);
    // far from the lamp the slope is capped at the note's
    expect(Math.hypot(...shadowSlope(LAMP.x - 50000, LAMP.y))).toBeCloseTo(PHOTO.shadow.penumbra.slopeMax, 9);
  });
});

describe("the geometry mirror", () => {
  it("a flat print at rest is its rect: the eye sees it at its own size", () => {
    const b = newBody(100, 50, 400, 300, 0.3);
    b.bend = 0;
    const G = resolvePhoto(b);
    for (const [u, v] of [[-200, -150], [200, 150], [37, -80]] as const) {
      const P = pointAt(G, u, v);
      expect(P[2]).toBeCloseTo(0, 12);
      const [sx, sy] = project(G.eye, P);
      expect(sx).toBeCloseTo(P[0], 9); expect(sy).toBeCloseTo(P[1], 9);
      const [qu, qv] = unproject(G, sx, sy);
      expect(qu).toBeCloseTo(u, 6); expect(qv).toBeCloseTo(v, 6);
    }
    expect(hitPhoto(G, 100, 50)).toBe(true);
    expect(hitPhoto(G, 100 + 260, 50)).toBe(false);
  });

  it("a lifted print reads larger by eye/(eye − h), about its anchor", () => {
    const b = newBody(0, 0, 400, 300);
    b.h = 20; b.bend = 0;
    const G = resolvePhoto(b);
    const [sx] = project(G.eye, pointAt(G, 200, 0));
    expect(sx / 200).toBeCloseTo(law.eye / (law.eye - 20), 9);
  });

  it("unproject inverts project on a tilted, bent sheet (the pass and the pick agree)", () => {
    const b = newBody(10, -20, 400, 280, 0.4, 16);
    b.sx = 0.08; b.sy = -0.05; b.ax = 120; b.ay = 60; b.bend = 5;
    b.hold = { gx: 120, gy: 60, px: 0, py: 0, vx: 0, vy: 0, ax: 0, ay: 0, trail: [] };
    const G = resolvePhoto(b);
    for (const [u, v] of [[0, 0], [150, 100], [-180, -120], [60, -130]] as const) {
      const w = bendAt(G, u, v);
      const P = pointAt(G, u, v);
      const Pb: [number, number, number] = [P[0] + G.n[0] * w, P[1] + G.n[1] * w, P[2] + G.n[2] * w];
      const [sx, sy] = project(G.eye, Pb);
      const [qu, qv] = unproject(G, sx, sy);
      // one bend correction: exact to well under a device pixel at this bend
      expect(Math.hypot(qu - u, qv - v)).toBeLessThan(0.1);
    }
  });

  it("the bounds hold every corner as seen and as cast", () => {
    const b = newBody(0, 0, 400, 300, 0.2, 18);
    b.sx = 0.1;
    const G = resolvePhoto(b);
    const s = G.slope;
    for (const [u, v] of [[-200, -150], [200, -150], [200, 150], [-200, 150]] as const) {
      const P = pointAt(G, u, v);
      for (const [x, y] of [project(G.eye, P), [P[0] + s[0] * P[2], P[1] + s[1] * P[2]]]) {
        expect(x).toBeGreaterThan(G.bounds.x0); expect(x).toBeLessThan(G.bounds.x1);
        expect(y).toBeGreaterThan(G.bounds.y0); expect(y).toBeLessThan(G.bounds.y1);
      }
    }
  });
});

describe("held", () => {
  it("the grab point stays under the finger, lifted and all", () => {
    const b = newBody(0, 0, 400, 300);
    grab(b, 150, 100, 0);
    let t = 0;
    t = run(b, 0.6, (tt) => moveHold(b, 150 + tt * 300, 100 + tt * 120, tt), t);
    const H = must(b.hold);
    const G = resolvePhoto(b);
    // the grab point, in 3D with the sheet's bend, projects onto the finger (the eye is over it)
    const P = pointAt(G, H.gx, H.gy);
    const w = bendAt(G, H.gx, H.gy);
    const [sx, sy] = project(G.eye, [P[0] + G.n[0] * w, P[1] + G.n[1] * w, P[2] + G.n[2] * w]);
    expect(Math.hypot(sx - H.px, sy - H.py)).toBeLessThan(0.3);
    expect(b.h).toBeGreaterThan(law.lift * 0.9);
  });

  it("grabbed at a corner and pulled about, it keeps its turn (no swing), and leaves the hand without spin", () => {
    const b = newBody(0, 0, 400, 300, 0.1);
    grab(b, 180, -130, 0);   // near the top-right corner
    const t = run(b, 1.5, (tt) => moveHold(b, 180 + tt * 500, -130 + Math.sin(tt * 7) * 90, tt));
    expect(b.angle).toBeCloseTo(0.1, 9);
    release(b, t);
    expect(b.spin).toBe(0);
    settled(b);
    expect(b.angle).toBeCloseTo(0.1, 9);
  });

  it("grabbed at the centre, it does not turn", () => {
    const b = newBody(0, 0, 400, 300, 0.2);
    grab(b, 0, 0, 0);
    run(b, 1.5, (t) => moveHold(b, t * 700, Math.sin(t * 6) * 80, t));
    expect(b.angle).toBeCloseTo(0.2, 6);
  });

  it("tips away from the fingers, and no corner goes through the mat", () => {
    const b = newBody(0, 0, 400, 300);
    grab(b, 190, 0, 0);
    let lowest = Number.POSITIVE_INFINITY;
    run(b, 1, (t) => {
      moveHold(b, 190, 0, t);
      const G = resolvePhoto(b);
      for (const [u, v] of [[-200, -150], [200, -150], [200, 150], [-200, 150]] as const) lowest = Math.min(lowest, pointAt(G, u, v)[2] + bendAt(G, u, v));
    });
    expect(b.sx).toBeGreaterThan(0);   // higher toward +x, where the fingers are
    expect(lowest).toBeGreaterThan(-0.5);
  });

  it("the wheel turns it about the finger", () => {
    const b = newBody(0, 0, 400, 300);
    grab(b, 100, 50, 0);
    twist(b, Math.PI / 2);
    const [gx, gy] = [must(b.hold).gx, must(b.hold).gy];
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    expect(b.x + c * gx - s * gy).toBeCloseTo(100, 9);
    expect(b.y + s * gx + c * gy).toBeCloseTo(50, 9);
  });
});

describe("released", () => {
  it("dropped still, it falls, lands and rests: flat, on the mat, quiet", () => {
    const b = newBody(0, 0, 400, 300);
    grab(b, 0, 0, 0);
    let t = run(b, 0.8, (tt) => moveHold(b, 0, 0, tt));
    release(b, t);
    t = settled(b);
    expect(b.h).toBeLessThan(0.02);
    expect(Math.hypot(b.sx, b.sy)).toBeLessThan(1e-3);
    expect(Math.hypot(b.vx, b.vy)).toBe(0);
    expect(restless(b)).toBe(false);
    expect(Math.hypot(b.x, b.y)).toBeLessThan(1);
  });

  it("flicked, it glides, then the mat's grip stops it — farther for a faster flick", () => {
    const travel = (speed: number) => {
      const b = newBody(0, 0, 400, 300);
      grab(b, 0, 0, 0);
      let t = run(b, 0.5, (tt) => moveHold(b, 0, 0, tt));
      const t0 = t;
      t = run(b, 0.15, (tt) => moveHold(b, (tt - t0) * speed, 0, tt), t);
      const x0 = b.x;
      release(b, t);
      expect(b.vx).toBeGreaterThan(speed * 0.8);
      settled(b);
      expect(restless(b)).toBe(false);
      return b.x - x0;
    };
    const slow = travel(800);
    const fast = travel(2400);
    expect(slow).toBeGreaterThan(20);
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  it("a finger that stopped before letting go throws nothing", () => {
    const b = newBody(0, 0, 400, 300);
    grab(b, 0, 0, 0);
    let t = run(b, 0.3, (tt) => moveHold(b, tt * 2000, 0, tt));
    const x = must(b.hold).px;
    t = run(b, 0.2, (tt) => moveHold(b, x, 0, tt), t);
    release(b, t);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(40);
  });

  it("a pasted print falls from its arrival height and lands with the shadow's contact", () => {
    const b = newBody(0, 0, 400, 300, 0, law.arrive);
    let peakDown = 0;
    run(b, 2, () => { peakDown = Math.min(peakDown, b.vh); });
    expect(peakDown).toBeLessThan(-50);
    expect(b.h).toBeLessThan(0.05);
  });

  it("clearMat scales the slope down to the room under the far corner", () => {
    const b = newBody(0, 0, 400, 300);
    b.h = 4; b.sx = 0.2;
    clearMat(b);
    expect(Math.abs(b.sx) * 200).toBeLessThanOrEqual(4 + 1e-9);
  });
});
