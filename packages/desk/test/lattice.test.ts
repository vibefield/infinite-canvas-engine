import { describe, expect, it } from "vitest";
import { boxOf, lod, smoothstep, wrap } from "../src/lattice/lod";

const view = (zoom: number, camX = 13.7, camY = -21.3) => ({ camX, camY, zoom, width: 1200, height: 800 });

describe("lod", () => {
  it("is the identity decade at zoom 1", () => {
    const l = lod(view(1));
    expect(l.k0).toBe(0);
    expect(l.fade).toBeCloseTo(0, 9);
    expect(l).toMatchObject({ fine: 2, mid: 20, coarse: 200, wrapPeriod: 200 });
  });

  it("promotes a decade at every ×10 and fades in between", () => {
    expect(lod(view(10)).k0).toBe(-1);
    expect(lod(view(0.1)).k0).toBe(1);
    expect(lod(view(10 ** 0.5)).fade).toBeCloseTo(0.5, 9);
  });

  it("keeps the fine/mid/coarse ratios exact across the decade", () => {
    for (const z of [0.316, 1, 1.259, 2.512, 6.31, 8.913, 1e-6, 1e6]) {
      const l = lod(view(z));
      expect(l.mid / l.fine).toBeCloseTo(10, 9);
      expect(l.coarse / l.mid).toBeCloseTo(10, 9);
    }
  });
});

// (The magnet atlas's geometry and the fine rung's schedule — atlasGeom, rungCounts, fineSchedule,
// fineAlpha — retired with the dot and the needle, 2026-09-25: the mat's lattice is analytic.)
describe("the lattice's helpers", () => {
  it("wrap keeps a phase in [0, p) either side of zero, so it never grows with the camera", () => {
    expect(wrap(205, 200)).toBeCloseTo(5, 12);
    expect(wrap(-5, 200)).toBeCloseTo(195, 12);
    expect(wrap(1e9 + 3, 200)).toBeCloseTo(3, 6);
  });
  it("smoothstep is 0 below, 1 above, ½ at the middle", () => {
    expect(smoothstep(10, 20, 5)).toBe(0);
    expect(smoothstep(10, 20, 25)).toBe(1);
    expect(smoothstep(10, 20, 15)).toBeCloseTo(0.5, 12);
  });
  it("a view's box is the whole viewport unless it names one (a nested slot's)", () => {
    expect(boxOf(view(1))).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(boxOf({ ...view(1), box: { x: 10, y: 20, w: 30, h: 40 } })).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});
