/**
 * cubicBezierEase — the CSS timing-function twin (easing.ts). The GL lift
 * runs the DOM card-lift spring through this; the properties that matter:
 * exact endpoints, the linear identity, curve fidelity (f(x(u)) = y(u)), and
 * overshoot for y-control-points beyond 1.
 */
import { describe, expect, it } from "vitest";
import { cubicBezierEase } from "../src";

/** Bernstein sample with P0=0, P3=1 (the reference the solver must invert). */
const sample = (u: number, p1: number, p2: number): number => {
  const v = 1 - u;
  return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
};

describe("cubicBezierEase", () => {
  it("clamps endpoints exactly: f(≤0) = 0, f(≥1) = 1", () => {
    const f = cubicBezierEase(0.2, 0.9, 0.3, 1.2);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(-0.5)).toBe(0);
    expect(f(1.5)).toBe(1);
  });

  it("cubic-bezier(0,0,1,1) is the identity", () => {
    const f = cubicBezierEase(0, 0, 1, 1);
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(f(t)).toBeCloseTo(t, 5);
    }
  });

  it("inverts x faithfully: f(x(u)) = y(u) across the curve (the lift spring)", () => {
    const [x1, y1, x2, y2] = [0.2, 0.9, 0.3, 1.2];
    const f = cubicBezierEase(x1, y1, x2, y2);
    for (let u = 0.05; u < 1; u += 0.05) {
      expect(f(sample(u, x1, x2))).toBeCloseTo(sample(u, y1, y2), 4);
    }
  });

  it("overshoots past 1 when a y control point exceeds 1 (spring pop), then settles", () => {
    const f = cubicBezierEase(0.2, 0.9, 0.3, 1.2);
    let max = 0;
    for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, f(t));
    expect(max).toBeGreaterThan(1.05); // the spring's peak (~1.06)
    expect(f(1)).toBe(1); // and it lands exactly
  });
});
