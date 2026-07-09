import { describe, expect, it } from "vitest";
import { portAnchor, sideDirection } from "../src/anchors";
import { cubicAABB, cubicPoint, distanceToCubic, distanceToSegment, wireCubic } from "../src/bezier";
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
