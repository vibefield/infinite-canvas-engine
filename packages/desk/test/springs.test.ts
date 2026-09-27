// The desk's shared physics and distance (src/springs.ts, src/sdf.ts) — kept from the
// card's tests when the cards retired (2026-09-25): every object lifts on these springs
// and hit-tests with this distance.
import { describe, expect, it } from "vitest";
import { sdRoundBox } from "../src/kit/sdf";
import { settled, spring, SPRINGS } from "../src/kit/springs";

describe("sdRoundBox", () => {
  // The metric property itself: |d(p) − d(q)| ≤ |p − q| for any two points.
  // (Not hypot-of-secants — across a crease those legitimately exceed 1 even
  // for a true SDF, because two axis secants straddling a kink are not a gradient.)
  it("is 1-Lipschitz: |Δd| never exceeds |Δp|", () => {
    let worst = 0;
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 6000; i++) {
      const x = (rnd() - 0.5) * 900;
      const y = (rnd() - 0.5) * 700;
      const a = rnd() * Math.PI * 2;
      const len = 0.5 + rnd() * 60;
      const qx = x + Math.cos(a) * len;
      const qy = y + Math.sin(a) * len;
      worst = Math.max(worst, Math.abs(sdRoundBox(x, y, 280, 210, 18) - sdRoundBox(qx, qy, 280, 210, 18)) / len);
    }
    expect(worst).toBeLessThanOrEqual(1.0005);
  });

  it("is exact on the edges and the corner arc, and clamps its radius to the box", () => {
    expect(sdRoundBox(0, 0, 100, 50, 10)).toBeCloseTo(-50, 12);
    expect(sdRoundBox(110, 0, 100, 50, 10)).toBeCloseTo(10, 12);
    // the corner arc's centre is (90, 40); a point on its diagonal 5 units out
    const k = Math.SQRT1_2 * 15;
    expect(sdRoundBox(90 + k, 40 + k, 100, 50, 10)).toBeCloseTo(5, 12);
    // a radius past the short side is the short side: a stadium
    expect(sdRoundBox(0, 60, 100, 50, 999)).toBeCloseTo(sdRoundBox(0, 60, 100, 50, 50), 12);
  });
});

describe("spring", () => {
  it("is critically damped: reaches the target with no overshoot and settles", () => {
    let x = 0;
    let v = 0;
    let peak = 0;
    for (let t = 0; t < 1.5; t += 1 / 120) { [x, v] = spring(x, v, 1, 2.4, 1, 1 / 120); peak = Math.max(peak, x); }
    expect(peak).toBeLessThanOrEqual(1 + 1e-6);
    expect(settled(x, v, 1)).toBe(true);
  });

  it("reverses from mid-flight without a snap", () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 20; i++) [x, v] = spring(x, v, 1, 2.4, 1, 1 / 120);
    const before = x;
    [x, v] = spring(x, v, 0, 2.4, 1, 1 / 120);
    expect(Math.abs(x - before)).toBeLessThan(0.05);
  });

  it("underdamped overshoots and settles — the lift's slight overshoot", () => {
    let x = 0;
    let v = 0;
    let peak = 0;
    for (let t = 0; t < 1.2; t += 1 / 120) { [x, v] = spring(x, v, 1, SPRINGS.liftHz, SPRINGS.liftDamp, 1 / 120); peak = Math.max(peak, x); }
    expect(peak).toBeGreaterThan(1.001);
    expect(settled(x, v, 1, 5e-3)).toBe(true);
  });
});
