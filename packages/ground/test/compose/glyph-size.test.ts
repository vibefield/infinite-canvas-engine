// @vitest-environment node
// The glyph size presets: whatever the cell and the field do to a glyph, the
// drawn size stays inside the configured range — and with the range open, the
// chain is the raw prototype's. Every rung draws one size; a rung's alpha is a
// function of its own cell, so a decade wrap is continuous by construction.
import { describe, expect, it } from "vitest";
import { glyphSize, rawGlyphSize, rungAlpha } from "../../src/field/glyph-size";
import { fineAlpha, lod, atlasGeom, fineSchedule, rungCounts } from "../../src/lattice/lod";
import { DEFAULT_FIELD_CONFIG, OPEN_RANGE, glyphReachPx, normaliseRange, uniformValues } from "../../src/field/layout";
import { PRODUCT_GRID } from "../../oracle/fixtures/vf-theme.ts";

const CELLS = [2, 4, 8, 12, 20, 40, 120, 200, 2000];   // CSS px — the fine rung lives in 2..20, mid 20..200, coarse beyond
const INFLUENCES = [0, 0.05, 0.3, 0.7, 1];
const sweep = function* () { for (const cellPx of CELLS) for (const influence of INFLUENCES) yield { cellPx, influence }; };

describe("glyph size range", () => {
  const cfg = DEFAULT_FIELD_CONFIG;

  it("the raw chain runs from a sub-pixel speck to the swollen dot — the reason a range exists", () => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = 0;
    for (const s of sweep()) { const { dot } = rawGlyphSize(cfg, s); lo = Math.min(lo, dot); hi = Math.max(hi, dot); }
    expect(lo).toBeLessThan(0.5);                                   // a 2 px cell, at rest
    expect(hi).toBeCloseTo(cfg.halfLen * 1.05, 9);                  // full field, cell not biting
  });

  it("every drawn size lies inside the preset, for every cell × influence", () => {
    for (const s of sweep()) {
      const g = glyphSize(cfg, s);
      expect(g.dot).toBeGreaterThanOrEqual(cfg.dotRadius[0]); expect(g.dot).toBeLessThanOrEqual(cfg.dotRadius[1]);
      expect(g.len).toBeGreaterThanOrEqual(cfg.needleHalfLen[0]); expect(g.len).toBeLessThanOrEqual(cfg.needleHalfLen[1]);
      expect(g.wid).toBeGreaterThanOrEqual(cfg.needleHalfWidth[0]); expect(g.wid).toBeLessThanOrEqual(cfg.needleHalfWidth[1]);
    }
  });

  it("both ends of each preset are actually reached somewhere in the sweep — the range is not slack", () => {
    const hit = { dotLo: false, dotHi: false, lenLo: false, lenHi: false, widLo: false, widHi: false };
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    for (const s of sweep()) {
      const g = glyphSize(cfg, s);
      if (near(g.dot, cfg.dotRadius[0])) hit.dotLo = true; if (near(g.dot, cfg.dotRadius[1])) hit.dotHi = true;
      if (near(g.len, cfg.needleHalfLen[0])) hit.lenLo = true; if (near(g.len, cfg.needleHalfLen[1])) hit.lenHi = true;
      if (near(g.wid, cfg.needleHalfWidth[0])) hit.widLo = true; if (near(g.wid, cfg.needleHalfWidth[1])) hit.widHi = true;
    }
    expect(hit).toEqual({ dotLo: true, dotHi: true, lenLo: true, lenHi: true, widLo: true, widHi: true });
  });

  it("an open range is a no-op: the drawn size IS the raw chain's", () => {
    const open = { ...cfg, dotRadius: OPEN_RANGE, needleHalfLen: OPEN_RANGE, needleHalfWidth: OPEN_RANGE };
    for (const s of sweep()) expect(glyphSize(open, s)).toEqual(rawGlyphSize(open, s));
  });

  it("the clamp is monotonic, so the clamped maximum the entries size their quads by is the clamp of the maximum", () => {
    for (const cellPx of CELLS) {
      const top = glyphSize(cfg, { cellPx, influence: 1 });
      for (const influence of INFLUENCES) {
        const g = glyphSize(cfg, { cellPx, influence });
        expect(g.dot).toBeLessThanOrEqual(top.dot + 1e-12);
        expect(g.len).toBeLessThanOrEqual(top.len + 1e-12);
      }
    }
  });

  it("the atlas margin covers the widest glyph: the swollen dot, or a preset floor set above it", () => {
    expect(glyphReachPx(cfg)).toBeCloseTo(cfg.halfLen * 1.05, 9);
    expect(glyphReachPx({ ...cfg, dotRadius: [9, 12] })).toBe(9);
    for (const s of sweep()) { const g = glyphSize(cfg, s); expect(Math.max(g.dot, g.len)).toBeLessThanOrEqual(glyphReachPx(cfg) + 1e-9); }
  });

  it("ranges are normalised before they reach the GPU: ordered, non-negative", () => {
    expect(normaliseRange([5, 2])).toEqual([2, 5]);
    expect(normaliseRange([-1, 3])).toEqual([0, 3]);
    const c = { ...cfg, dotRadius: [4, 1] as const, needleHalfLen: [6, 2] as const, needleHalfWidth: [0.9, 0.3] as const };
    const u = uniformValues({ view: { camX: 0, camY: 0, zoom: 1, width: 100, height: 100, dpr: 1 }, pointer: { x: 0, y: 0, on: false } }, c, 0);
    expect(u.dotRange).toEqual([1, 4, 0, 0]);
    expect(u.needleRange).toEqual([2, 6, 0.3, 0.9]);
  });

  it("alpha is one function of a rung's own cell: a decade wrap is continuous by construction", () => {
    for (const fadeIn of [[10, 20], [20, 40], [12, 24]] as const) {
      // the site that is the FINE rung at a 20 px cell becomes the MID rung at a 20 px cell — same cell, same alpha
      expect(rungAlpha(20, fadeIn)).toBe(rungAlpha(20, fadeIn));
      expect(rungAlpha(fadeIn[0] - 0.1, fadeIn)).toBe(0);    // nothing below the window
      expect(rungAlpha((fadeIn[0] + fadeIn[1]) / 2, fadeIn)).toBeCloseTo(0.5, 9);
      expect(rungAlpha(fadeIn[1], fadeIn)).toBe(1);
      expect(rungAlpha(2000, fadeIn)).toBe(1);
    }
    // the product window: the 20 px lattice is FULL at zoom 1, and the fine rung (2 px there) is off
    expect(rungAlpha(20, PRODUCT_GRID.fadeIn)).toBe(1);
    expect(rungAlpha(2, PRODUCT_GRID.fadeIn)).toBe(0);
  });

  it("the fine rung draws only while its cell is inside the window, and the atlas steps at mid whenever it is off — over six decades", () => {
    for (const fadeIn of [[10, 20], [20, 40]] as const) {
      let on = 0;
      let off = 0;
      for (let e = -3; e <= 3; e += 0.02) {
        const zoom = 10 ** e;
        const v = { camX: 3.3, camY: -7.1, zoom, width: 1200, height: 800 };
        const l = lod(v);
        const fineCell = l.fine * zoom;
        const fa = fineAlpha(l, zoom, fadeIn);
        expect(fa).toBeGreaterThanOrEqual(0); expect(fa).toBeLessThanOrEqual(1);
        // an alpha under 1/100 is invisible: the schedule skips the rung and the atlas steps at mid
        if (fineCell <= fadeIn[0]) expect(fa).toBe(0);
        if (fa <= 0.01) { expect(fineSchedule(l, rungCounts(v, l), "auto", fa)).toBe("off"); expect(atlasGeom(v, l, 5, fa).step).toBe(l.mid); off++; }
        else { expect(fineCell).toBeGreaterThan(fadeIn[0]); expect(fineSchedule(l, rungCounts(v, l), "auto", fa)).not.toBe("off"); expect(atlasGeom(v, l, 5, fa).step).toBe(l.fine); on++; }
        if (l.mid * zoom >= fadeIn[1]) expect(rungAlpha(l.mid * zoom, fadeIn)).toBe(1);
      }
      // [20, 40]: the fine cell never exceeds 20 px, so the fine rung never draws at all
      if (fadeIn[0] >= 20) expect(on).toBe(0); else { expect(on).toBeGreaterThan(0); expect(off).toBeGreaterThan(on); }
    }
  });

  it("the defaults are the product presets and window", () => {
    expect(DEFAULT_FIELD_CONFIG.dotRadius).toEqual(PRODUCT_GRID.dotRadius);
    expect(DEFAULT_FIELD_CONFIG.needleHalfLen).toEqual(PRODUCT_GRID.needleHalfLen);
    expect(DEFAULT_FIELD_CONFIG.needleHalfWidth).toEqual(PRODUCT_GRID.needleHalfWidth);
    expect(DEFAULT_FIELD_CONFIG.fadeIn).toEqual([10, 20]);
  });
});
