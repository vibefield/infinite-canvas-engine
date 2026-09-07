// @vitest-environment node
import { must } from "./must.ts";
import { describe, expect, it } from "vitest";
import { atlasGeom, fineSchedule, lod, rungCounts, fineAlpha } from "../../src/lattice/lod";

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

describe("atlasGeom", () => {
  it("steps at mid when the fine rung is off, and at fine once it is live", () => {
    const FADE_IN = [10, 20] as const;
    const live = (z: number) => fineAlpha(lod(view(z)), z, FADE_IN);
    expect(live(1)).toBe(0);                    // fine cell 2 px: under the window
    expect(live(6.31)).toBeGreaterThan(0.1);    // fine cell 12.6 px: a quarter into the window (0.17)
    const off = atlasGeom(view(1), lod(view(1)), 5.25, live(1));
    const on = atlasGeom(view(6.31), lod(view(6.31)), 5.25, live(6.31));
    expect(off.step).toBe(20);
    expect(on.step).toBe(2);
    // The ~100× step discontinuity the study priced, now bounded: the fine rung
    // only comes alive at a 10 px cell, so the fine atlas is ~10 k texels at
    // this viewport, never the six figures a 2.5 px fine cell demanded.
    expect(off.w * off.h).toBeLessThan(5_000);
    expect(on.w * on.h).toBeGreaterThan(5_000);
    expect(on.w * on.h).toBeLessThan(20_000);
  });

  // The invariant the atlas margin exists for: every site of every rung that
  // can PAINT into the viewport (its glyph extent overlaps it) has its texel
  // inside the atlas. Sites beyond that are culled before they fetch, so the
  // atlas owes them nothing. This is the CPU form of the 67-million-site sweep.
  it("holds a texel for every site that can paint into the viewport", () => {
    const halfLen = 5.5;
    const FADE_IN = [10, 20] as const;
    let checked = 0;
    for (const z of [1, 1.259, 1.585, 2.512, 3.981, 6.31, 8.913, 0.316]) {
      for (const [cx, cy] of [[0, 0], [123.4, -56.7], [-999.9, 77.7], [1e6 + 13, -1e6 + 7]]) {
        const v = view(z, cx, cy);
        const l = lod(v);
        const fineLive = fineAlpha(l, z, FADE_IN);
        const g = atlasGeom(v, l, halfLen * 1.05, fineLive);
        const counts = rungCounts(v, l);
        const spacings = [l.fine, l.mid, l.coarse];
        for (let rung = fineLive > 0.01 ? 0 : 1; rung < 3; rung++) {
          const spacing = spacings[rung] as number;
          const cell = spacing * z;
          const extent = Math.min(halfLen, cell * 0.42) * 1.05 + 1.2 * 2;
          const ratio = Math.round(spacing / g.step);
          const ox = Math.floor(g.phaseX / spacing) - 1;
          const oy = Math.floor(g.phaseY / spacing) - 1;
          const rc = must(counts[rung]);
          for (let j = 0; j < rc.rows; j++) for (let i = 0; i < rc.cols; i++) {
            const sx = ((ox + i) * spacing - g.phaseX) * z;
            const sy = ((oy + j) * spacing - g.phaseY) * z;
            if (sx < -extent || sy < -extent || sx > v.width + extent || sy > v.height + extent) continue;
            const ti = (ox + i) * ratio - g.originI;
            const tj = (oy + j) * ratio - g.originJ;
            if (ti < 0 || tj < 0 || ti >= g.w || tj >= g.h) {
              throw new Error(`zoom ${z} cam ${cx},${cy} rung ${rung} site (${ox + i},${oy + j}) → texel (${ti},${tj}) outside ${g.w}×${g.h}`);
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50_000);   // the fine rung is live only at the two zooms past 5
  });

  it("wraps the phase so it never grows with the camera", () => {
    const a = atlasGeom(view(1, 5, 5), lod(view(1)), 5.5, 0);
    const b = atlasGeom(view(1, 5 + 200 * 1e6, 5), lod(view(1)), 5.5, 0);
    expect(b.phaseX).toBeCloseTo(a.phaseX, 6);
  });
});

describe("rungCounts + schedule", () => {
  it("adds three cells of slack per axis", () => {
    const [fine] = rungCounts(view(1), lod(view(1)));
    expect(fine.cols).toBe(Math.ceil(1200 / 2) + 3);
    expect(fine.rows).toBe(Math.ceil(800 / 2) + 3);
  });

  it("switches the fine rung to fullscreen only when dense", () => {
    // The fine rung is live from a 10 px cell, so at 1200×800 it never exceeds
    // ~10 k sites: dense means a big viewport (a 4K field at the window's foot).
    const FADE_IN = [10, 20] as const;
    const live = (v: ReturnType<typeof view>) => fineAlpha(lod(v), v.zoom, FADE_IN);
    const dense = { ...view(6.31), width: 4000, height: 2400 };
    const sparse = view(6.31);
    const off = view(1);
    expect(rungCounts(dense, lod(dense))[0].count).toBeGreaterThan(40_000);
    expect(fineSchedule(lod(dense), rungCounts(dense, lod(dense)), "auto", live(dense))).toBe("fullscreen");
    expect(fineSchedule(lod(sparse), rungCounts(sparse, lod(sparse)), "auto", live(sparse))).toBe("instanced");
    expect(fineSchedule(lod(off), rungCounts(off, lod(off)), "auto", live(off))).toBe("off");
    expect(fineSchedule(lod(dense), rungCounts(dense, lod(dense)), "instanced", live(dense))).toBe("instanced");
  });
});
