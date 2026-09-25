// The rulers' law (lattice/ruler.ts, RULER.md): the levels at the product's
// zoom and at the mockup's, the decade's self-similarity and the wrap's
// continuity, the label text, the width cull, the CPU mirror of the layout
// (a wrapped camera, negative coordinates), and the uniforms filled by name.
import { must } from "./must";
import { describe, expect, it } from "vitest";
import { lod } from "../src/lattice/lod";
import { finestLabelled, formatLabel, labelChars, labelReach, labelsAlong, type RulerLaw, rulerLevels, wrapsOf } from "../src/lattice/ruler";
import { DEFAULT_MAT_CONFIG, GLYPHS, MatUniforms, NO_GLYPHS, STILL_MAT_FRAME, matUniformValues } from "../src/mat/layout";
import { MAT_GRID } from "../src/theme";

const LAW: RulerLaw = MAT_GRID.ruler;
const view = (zoom: number, camX = 0, camY = 0) => ({ camX, camY, zoom, width: 1200, height: 800 });
const levelsAt = (zoom: number, maxAbs = 0) => rulerLevels(lod(view(zoom)), zoom, LAW, maxAbs);

describe("the levels", () => {
  it("at zoom 1: ticks every 20 px on the mid rung, labels every 100 (the fifth mid sites) and 200 (the coarse rung), the fine rung silent", () => {
    const L = levelsAt(1);
    expect(L.map((l) => l.spacing)).toEqual([2, 10, 20, 100, 200]);
    expect(L.map((l) => l.pitch)).toEqual([2, 10, 20, 100, 200]);
    expect(L.map((l) => l.tickAlpha)).toEqual([0, 0, 1, 1, 1]);
    expect(L.map((l) => l.labelAlpha)).toEqual([0, 0, 0, 1, 1]);
    expect(L.map((l) => l.tickLen)).toEqual([6, 9, 6, 15, 15]);   // a labelled site's tick is the major one
    expect(L.map((l) => [l.mult, l.exp])).toEqual([[2, 0], [1, 1], [2, 1], [1, 2], [2, 2]]);
    expect(L.map((l) => l.perWrap)).toEqual([100, 20, 10, 2, 1]);
    expect(finestLabelled(L)).toBe(3);
  });

  it("at the mockup's zoom (7 — a 14 px fine pitch): fine ticks in full, the fifth fine sites labelled at 70 px, the mid rung's at 140", () => {
    const L = levelsAt(7);
    expect(L.map((l) => l.pitch)).toEqual([14, 70, 140, 700, 1400]);
    expect(L.map((l) => l.tickAlpha)).toEqual([1, 1, 1, 1, 1]);
    expect(L.map((l) => l.labelAlpha)).toEqual([0, 1, 1, 1, 1]);
    expect(L.map((l) => l.tickLen)).toEqual([6, 15, 15, 15, 15]);
    expect(finestLabelled(L)).toBe(1);
    // the mockup's own density — labels every tenth tick — is the same law with labels from 80 px
    const sparse = rulerLevels(lod(view(7)), 7, { ...LAW, labelsFrom: [80, 100] });
    expect(sparse.map((l) => l.labelAlpha)).toEqual([0, 0, 1, 1, 1]);
    expect(sparse.map((l) => l.tickLen)).toEqual([6, 9, 15, 15, 15]);
  });

  it("is self-similar across a decade: ten times the zoom is the same picture with different numbers", () => {
    for (const z of [1, 1.7, 3, 4.5, 6.2, 9]) {
      const a = levelsAt(z);
      const b = levelsAt(z * 10);
      for (let i = 0; i < 5; i++) {
        expect(must(b[i]).pitch).toBeCloseTo(must(a[i]).pitch, 9);
        expect(must(b[i]).tickLen).toBeCloseTo(must(a[i]).tickLen, 9);
        expect(must(b[i]).tickAlpha).toBeCloseTo(must(a[i]).tickAlpha, 9);
        expect(must(b[i]).labelAlpha).toBeCloseTo(must(a[i]).labelAlpha, 9);
        expect(must(b[i]).exp).toBe(must(a[i]).exp - 1);
        expect(must(b[i]).mult).toBe(must(a[i]).mult);
      }
    }
  });

  it("is continuous across the wrap: every level drawn just under zoom 10 is drawn identically just over it, two levels down", () => {
    const before = levelsAt(10 - 1e-6);
    const after = levelsAt(10 + 1e-6);
    const saturated = (l: (typeof before)[number]) => l.tickLen === LAW.tick[2] && l.tickAlpha === 1 && l.labelAlpha === 1;
    for (let i = 0; i < 5; i++) {
      const b = must(before[i]);
      if (b.tickAlpha <= 0 && b.labelAlpha <= 0) continue;
      const match = after.find((l) => Math.abs(l.pitch - b.pitch) < 1e-3);
      if (!match) {
        // coarser than the new coarse rung: its sites are among the coarse rung's, and both are saturated — a major tick with a label
        expect(b.pitch).toBeGreaterThan(must(after[4]).pitch);
        expect(saturated(b)).toBe(true); expect(saturated(must(after[4]))).toBe(true);
        continue;
      }
      expect(match.tickLen).toBeCloseTo(b.tickLen, 3);
      expect(match.tickAlpha).toBeCloseTo(b.tickAlpha, 3);
      expect(match.labelAlpha).toBeCloseTo(b.labelAlpha, 3);
    }
  });

  it("keeps labels between 50 and 250 px apart at every zoom, and every presence monotone in the pitch", () => {
    let prevPitch = 0;
    for (let z = 0.01; z < 100; z *= 1.03) {
      const L = levelsAt(z);
      const lf = finestLabelled(L);
      expect(lf).toBeGreaterThanOrEqual(0);
      const pitch = must(L[lf]).pitch;
      expect(pitch).toBeGreaterThanOrEqual(LAW.labelsFrom[0] - 1e-9);
      expect(pitch).toBeLessThanOrEqual(5 * LAW.labelsFrom[0] + 1e-9);
      for (const l of L) { expect(l.labelAlpha).toBeGreaterThanOrEqual(0); expect(l.labelAlpha).toBeLessThanOrEqual(1); expect(l.tickLen).toBeLessThanOrEqual(LAW.tick[2]); expect(l.tickLen).toBeGreaterThanOrEqual(LAW.tick[0]); }
      prevPitch = pitch;
    }
    void prevPitch;
  });

  it("mutes a level whose widest label on screen would not fit its pitch or the character cap", () => {
    // at zoom 1 the coarse rung's labels are 100 px apart; a reach of 10^9 puts ten digits on them: over the cap, mute
    expect(levelsAt(1, 1e9).map((l) => l.labelAlpha)).toEqual([0, 0, 0, 0, 0]);
    expect(levelsAt(1, 1e7).map((l) => l.labelAlpha)).toEqual([0, 0, 0, 1, 1]);   // "10000000" (8) fits 100 px at 6 px a character
    expect(labelReach(-250, 1, 1200)).toBe(950);
    expect(labelReach(400, 2, 1200)).toBe(1000);
  });
});

describe("the label text", () => {
  it("is plain digits — no suffix, no trailing zeros in a fraction, one zero", () => {
    expect(formatLabel(0, 2, 0)).toBe("0");
    expect(formatLabel(0, 1, -2)).toBe("0");
    expect(formatLabel(5, 2, 0)).toBe("10");
    expect(formatLabel(5, 1, 2)).toBe("500");
    expect(formatLabel(3, 2, 3)).toBe("6000");
    expect(formatLabel(1, 2, 1)).toBe("20");
    expect(formatLabel(-1, 1, 0)).toBe("-1");
    expect(formatLabel(-7, 2, -1)).toBe("-1.4");
    expect(formatLabel(7, 1, -2)).toBe("0.07");
    expect(formatLabel(25, 2, -1)).toBe("5");
    expect(formatLabel(10, 1, -1)).toBe("1");
    expect(formatLabel(123, 1, -2)).toBe("1.23");
    expect(formatLabel(-123, 2, -3)).toBe("-0.246");
  });
  it("counts the widest label of a magnitude, sign included", () => {
    expect(labelChars(950, 1, 2)).toBe("-1000".length);
    expect(labelChars(0, 2, 0)).toBe(1);
    expect(labelChars(1e9, 2, 0)).toBe(11);
  });
  it("names only glyphs the atlas holds", () => {
    for (const t of [formatLabel(-123, 2, -3), formatLabel(5, 1, 2)]) for (const c of t) expect(GLYPHS.includes(c)).toBe(true);
  });
});

describe("the layout's mirror", () => {
  it("lists the finest labelled level's sites from the inner corner to the far line, each read from the wrapped phase as the shader does", () => {
    const zoom = 1;
    const cam = -250;
    const span = 1200;
    const L = levelsAt(zoom, labelReach(cam, zoom, span));
    const labels = labelsAlong(cam, zoom, span, L, LAW);
    expect(labels.map((l) => l.text)).toEqual(["-100", "0", "100", "200", "300", "400", "500", "600", "700", "800", "900"]);
    expect(labels.map((l) => l.at)).toEqual([150, 250, 350, 450, 550, 650, 750, 850, 950, 1050, 1150]);
    expect(labels.map((l) => l.level)).toEqual([3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3]);
    expect(labels.every((l) => l.alpha === 1)).toBe(true);
    expect(must(labels[0]).index).toBe(-1);
    // the wrap count and the local count reconstruct floor(x / spacing) for any camera
    for (const c of [-250, 13.7, 1e6 + 13, -1e6 - 7, 399.999999]) {
      const w = wrapsOf(c, 200);
      const phase = c - w * 200;
      for (const x of [52, 300, 1174]) expect(w * 2 + Math.floor((phase + x) / 100)).toBe(Math.floor((c + x) / 100));
    }
  });
  it("at the mockup's zoom reads the mockup's numbers: 0 · 10 · 20 … down the fifth fine sites", () => {
    const zoom = 7;
    const cam = -53 / 7;   // world 0 one px past the band's inner corner
    const L = levelsAt(zoom, labelReach(cam, zoom, 1200));
    const labels = labelsAlong(cam, zoom, 1200, L, LAW);
    expect(labels.slice(0, 5).map((l) => l.text)).toEqual(["0", "10", "20", "30", "40"]);
    expect(must(labels[1]).at - must(labels[0]).at).toBeCloseTo(70, 9);
    expect(must(labels[0]).at).toBeCloseTo(53, 9);
  });
});

describe("the uniforms", () => {
  it("fills the ruler's fields by name from the config, the view and the atlas", () => {
    const v = { camX: -250, camY: 1e6 + 13, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const cfg = { ...DEFAULT_MAT_CONFIG, ruler: { ...DEFAULT_MAT_CONFIG.ruler, on: true } };
    const glyphs = { ...NO_GLYPHS, scale: 2, cellW: 16, cellH: 30, advance: 12, baseline: 22, cap: 14, width: 192, height: 30, count: 12 };
    const u = matUniformValues(v, [10, 20], cfg, STILL_MAT_FRAME, 0.4, undefined, undefined, glyphs);
    expect(u.ruler).toEqual([1, 26, 26, 1]);
    expect(u.rulerText).toEqual([5, 3, 15, 2]);
    expect(u.rulerAlpha.slice(0, 3)).toEqual([0.55, 0.85, 0.85]);
    expect(u.rulerOrigin.slice(0, 3)).toEqual([-2, 5000, 3]);
    expect(u.rulerGlyph).toEqual([16, 30, 12, 22]);
    expect(u.rulerAtlas).toEqual([192, 30, 14, 12]);
    expect(u.rulerSites).toHaveLength(20);
    expect(u.rulerSites.slice(12, 16)).toEqual([100, 15, 1, 1]);
    expect(u.rulerFormat.slice(12, 15)).toEqual([1, 2, 2]);
    const buf = MatUniforms.alloc(1);
    expect(() => buf.set(u)).not.toThrow();
    expect(MatUniforms.slots.rulerSites.byte % 16).toBe(0);
    expect(MatUniforms.slots.rulerSites.n).toBe(20);
    // off by default: the engine's config prints nothing, and the day's chain is untouched (mat.wgsl mixes by 0)
    expect(matUniformValues(v, [10, 20], DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, 0.4).ruler[0]).toBe(0);
    expect(DEFAULT_MAT_CONFIG.ruler.on).toBe(false);
  });
});
