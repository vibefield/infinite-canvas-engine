import { describe, expect, it } from "vitest";
import { DEFAULT_MAT_CONFIG } from "../src/mat/layout";
import { rulerRegions } from "../src/mat/ruler-regions";

const BASE = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
const RULER = { ...DEFAULT_MAT_CONFIG.ruler, on: true, margin: 0 };

describe("foreground ruler regions", () => {
  it("partitions every pixel once, including fractional DPR, inset rulers and tiny viewports", () => {
    for (const [width, height] of [[1200, 800], [93.7, 61.3], [7, 11]]) {
      for (const dpr of [0.5, 1, 1.25, 2]) for (const margin of [0, 26]) {
        const view = { ...BASE, width: width as number, height: height as number, dpr };
        const regions = rulerRegions(view, { ...RULER, margin }, null);
        const all = [...regions.surface, ...regions.edges];
        const w = Math.round(view.width * dpr);
        const h = Math.round(view.height * dpr);
        expect(all.reduce((area, r) => area + r[2] * r[3], 0)).toBe(w * h);
        for (let i = 0; i < all.length; i++) {
          const a = all[i];
          if (!a) throw new Error("missing region");
          expect(a.every(Number.isInteger)).toBe(true);
          expect(a[0]).toBeGreaterThanOrEqual(0); expect(a[1]).toBeGreaterThanOrEqual(0);
          expect(a[2]).toBeGreaterThan(0); expect(a[3]).toBeGreaterThan(0);
          expect(a[0] + a[2]).toBeLessThanOrEqual(w); expect(a[1] + a[3]).toBeLessThanOrEqual(h);
          for (const b of all.slice(i + 1)) {
            const overlapW = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
            const overlapH = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
            expect(overlapW * overlapH).toBe(0);
          }
        }
      }
    }
  });

  it("reuses its geometry while panning and zooming; the product needs one surface and four narrow edges", () => {
    const regions = rulerRegions(BASE, RULER, null);
    expect(rulerRegions({ ...BASE, camX: -1234, camY: 5678, zoom: 0.25 }, RULER, regions)).toBe(regions);
    expect(regions.surface).toHaveLength(1);
    expect(regions.edges).toHaveLength(4);
    expect(regions.edges.reduce((area, r) => area + r[2] * r[3], 0)).toBeLessThan(BASE.width * BASE.height * BASE.dpr ** 2 * 0.06);
    for (const change of [{ width: 700 }, { height: 500 }, { dpr: 1 }]) expect(rulerRegions({ ...BASE, ...change }, RULER, regions)).not.toBe(regions);
    for (const change of [{ margin: 26 }, { band: 40 }, { line: 2 }]) expect(rulerRegions(BASE, { ...RULER, ...change }, regions)).not.toBe(regions);
  });
});
