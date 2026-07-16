import { describe, expect, it } from "vitest";
import { portAnchor, sideDirection } from "../src/anchors";
import {
  cubicAABB,
  cubicPoint,
  distanceToCubic,
  distanceToSegment,
  tessellateCubic,
  wireCubic,
} from "../src/bezier";
import { pointInAABB } from "../src/shapes";
import { inRange, makePrng } from "./prng";

const widget = { x: 100, y: 200, width: 80, height: 60 };

describe("portAnchor", () => {
  it("places single ports at side midpoints", () => {
    const slot = { index: 0, count: 1 };
    expect(portAnchor(widget, { ...slot, side: "n" })).toEqual({ x: 140, y: 200 });
    expect(portAnchor(widget, { ...slot, side: "s" })).toEqual({ x: 140, y: 260 });
    expect(portAnchor(widget, { ...slot, side: "w" })).toEqual({ x: 100, y: 230 });
    expect(portAnchor(widget, { ...slot, side: "e" })).toEqual({ x: 180, y: 230 });
  });

  it("distributes multiple ports evenly along the side", () => {
    const a = portAnchor(widget, { side: "e", index: 0, count: 3 });
    const b = portAnchor(widget, { side: "e", index: 1, count: 3 });
    const d = portAnchor(widget, { side: "e", index: 2, count: 3 });
    expect(a.y).toBeCloseTo(215);
    expect(b.y).toBeCloseTo(230);
    expect(d.y).toBeCloseTo(245);
    expect(a.x).toBe(180);
  });

  it("side directions are outward unit vectors (Y-down world)", () => {
    expect(sideDirection("n")).toEqual({ x: 0, y: -1 });
    expect(sideDirection("s")).toEqual({ x: 0, y: 1 });
  });
});

describe("wire cubic", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 200, y: 100 };
  const curve = wireCubic(from, "e", to, "w");

  it("interpolates endpoints at t=0 and t=1", () => {
    expect(cubicPoint(curve, 0)).toEqual(from);
    expect(cubicPoint(curve, 1)).toEqual(to);
  });

  it("control-hull AABB contains sampled curve points (property)", () => {
    const rand = makePrng(2024);
    for (let i = 0; i < 100; i++) {
      const c = wireCubic(
        { x: inRange(rand, -500, 500), y: inRange(rand, -500, 500) },
        "e",
        { x: inRange(rand, -500, 500), y: inRange(rand, -500, 500) },
        "w",
      );
      const aabb = cubicAABB(c);
      for (let s = 0; s <= 16; s++) {
        const p = cubicPoint(c, s / 16);
        expect(pointInAABB(p.x, p.y, aabb)).toBe(true);
      }
    }
  });

  it("distanceToCubic ≈ 0 on the curve, grows off it", () => {
    const on = cubicPoint(curve, 0.5);
    expect(distanceToCubic(on.x, on.y, curve)).toBeLessThan(1.5);
    expect(distanceToCubic(on.x, on.y - 40, curve)).toBeGreaterThan(20);
  });

  it("distanceToSegment handles degenerate and clamped cases", () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5); // zero-length segment
    expect(distanceToSegment(-10, 0, 0, 0, 10, 0)).toBe(10); // clamps to endpoint a
    expect(distanceToSegment(5, 7, 0, 0, 10, 0)).toBe(7); // interior projection
  });
});

describe("tessellateCubic (the @ice/ground wires pass)", () => {
  it("a degenerate straight cubic emits one segment with arc length == chord", () => {
    const line = { x0: 0, y0: 0, x1: 10, y1: 0, x2: 20, y2: 0, x3: 30, y3: 0 };
    const t = tessellateCubic(line);
    expect(t.points.length).toBe(4); // two points: p0 and p3
    expect(t.points[0]).toBe(0);
    expect(t.points[2]).toBe(30);
    expect(t.arcLength[1]).toBeCloseTo(30, 5);
  });

  it("endpoints are exact; every polyline point lies within tolerance of the curve", () => {
    const c = wireCubic({ x: 0, y: 0 }, "e", { x: 200, y: 120 }, "w");
    const t = tessellateCubic(c, 0.25);
    const n = t.points.length / 2;
    expect(t.points[0]).toBe(c.x0);
    expect(t.points[1]).toBe(c.y0);
    expect(t.points[(n - 1) * 2]).toBeCloseTo(c.x3, 4);
    expect(t.points[(n - 1) * 2 + 1]).toBeCloseTo(c.y3, 4);
    for (let i = 0; i < n; i++) {
      const d = distanceToCubic(t.points[i * 2] as number, t.points[i * 2 + 1] as number, c, 128);
      expect(d).toBeLessThan(0.5); // sampled-distance slack over the 0.25 tolerance
    }
  });

  it("arc length is monotonic and ≥ the chord; tighter tolerance emits more points", () => {
    const c = wireCubic({ x: 0, y: 0 }, "e", { x: 100, y: 200 }, "n");
    const coarse = tessellateCubic(c, 2);
    const fine = tessellateCubic(c, 0.05);
    expect(fine.points.length).toBeGreaterThan(coarse.points.length);
    const n = fine.arcLength.length;
    for (let i = 1; i < n; i++) {
      expect(fine.arcLength[i] as number).toBeGreaterThanOrEqual(fine.arcLength[i - 1] as number);
    }
    expect(fine.arcLength[n - 1] as number).toBeGreaterThanOrEqual(Math.hypot(100, 200) - 1e-3);
  });

  it("maxDepth bounds emission on pathological curves", () => {
    const spike = { x0: 0, y0: 0, x1: 1e6, y1: -1e6, x2: -1e6, y2: 1e6, x3: 1, y3: 1 };
    const t = tessellateCubic(spike, 1e-6, 8);
    expect(t.points.length / 2).toBeLessThanOrEqual(2 ** 8 + 1);
  });
});
