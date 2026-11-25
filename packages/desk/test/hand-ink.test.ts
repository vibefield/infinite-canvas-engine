// THE PEN'S READ on the CPU (petition I59 — kit/hand-run.ts `handInkAt`, `hand_ink`'s twin: the same arithmetic over the same run
// and the same mip levels), held to a face whose geometry is known exactly (./hand-fixture: round-nibbed straight strokes). The
// edge: a stroke's centre line is inked at the glyph's pressure, a nib's width off it half, past it nothing. Blank paper reads no
// atlas texel. THE REVEAL (the brief's law): nothing before the pen sets off; while it writes, a texel shows once the pen's progress
// has reached its arrival — behind the nib written, ahead of it bare, the front round as the nib — and where a later stroke crosses
// an earlier one the earlier ink is already there; after its time the glyph is whole. The pen and the pressure; a minified read at
// a coarser level; the run's weight (the outline moved outward); the pen's spread; how the ink lies, as the raster lays it (the
// bleed's stroke, the fill over it, every glyph over the ones before: source-over, never only the larger); a glyph whose pen origin
// lies outside its rect (as the bake lays one above the baseline).
// And on the desk's own faces as baked: the coarse levels keep to their glyph — up to 4 texels a px a glyph reads the same to the
// bit with every other glyph of its atlas erased, past that under 2% of coverage, never a neighbour's ink.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type HandAtlas, type HandAtlasGlyph, readHandAtlas } from "../src/kit/hand-atlas";
import { HAND_RUN, handEase, handInkAt, handRun } from "../src/kit/hand-run";
import type { PenMoment } from "../src/kit/pen-clock";
import type { HandLayout } from "../src/kit/text";
import { type FixtureGlyph, fixtureFace, nibAt, pathLength } from "./hand-fixture";

const face = fixtureFace();
const EM = 48;   // units an em: a glyph 48 units tall at zoom 1

/** One upright glyph alone, its pen's origin at (x, y), `EM` units an em. */
function lone(ch: string, x: number, y: number, extra: { readonly press?: number; readonly rot?: number; readonly scale?: number } = {}): HandLayout {
  const g = face.glyphs.get(ch) as FixtureGlyph;
  return {
    glyphs: [{ ch, index: 0, x, y, advance: g.advance * EM, rot: extra.rot ?? 0, scale: extra.scale ?? 1, press: extra.press ?? 1, line: 0 }],
    lines: [{ start: 0, end: 1, y, width: g.advance * EM }], positions: new Float32Array([x, y, x + g.advance * EM, y]),
    overflow: false, em: EM, ascent: 0.8 * EM, descent: 0.3 * EM,
  };
}
/** A point of the glyph's own (em, y down from its origin) in the sheet, for a glyph laid upright at (ox, oy). */
const at = (ox: number, oy: number, ex: number, ey: number): readonly [number, number] => [ox + ex * EM, oy + ey * EM];

const O = [30, 60] as const;
const L = face.glyphs.get("l") as FixtureGlyph;   // the bar: (0.18, −0.72) down to (0.18, 0), nib 0.07 em

describe("the edge (petition I59)", () => {
  const run = handRun(lone("l", O[0], O[1]), face.atlas);
  const ink = (ex: number, ey: number, aa = 1) => handInkAt(run, face.atlas, ...at(O[0], O[1], ex, ey), 0, aa);

  it("a stroke's centre line is inked whole, a nib's width off it half, a device px past that nothing", () => {
    for (const ey of [-0.6, -0.36, -0.1]) {
      expect(ink(0.18, ey).cover).toBeCloseTo(1, 2);
      expect(ink(0.18 + L.nib, ey).cover).toBeGreaterThan(0.4);
      expect(ink(0.18 + L.nib, ey).cover).toBeLessThan(0.6);
      expect(ink(0.18 - L.nib - 1.2 / EM, ey).cover).toBe(0);
      expect(ink(0.18, ey).samples).toBe(1);
    }
  });

  it("blank paper reads no atlas texel: outside the grid's box one load; in a cell that lists nothing, three", () => {
    const far = handInkAt(run, face.atlas, O[0] - 200, O[1], 0, 1);
    expect([far.cover, far.samples, far.loads]).toEqual([0, 0, 1]);
    // two bars far apart: the cells between them list nothing
    const two: HandLayout = { ...lone("l", O[0], O[1]), glyphs: [lone("l", O[0], O[1]).glyphs[0] as HandLayout["glyphs"][number], { ...(lone("l", O[0] + 400, O[1]).glyphs[0] as HandLayout["glyphs"][number]), index: 1 }] };
    const wide = handRun(two, face.atlas);
    const gap = handInkAt(wide, face.atlas, O[0] + 200, O[1] - 10, 0, 1);
    expect([gap.cover, gap.samples, gap.loads]).toEqual([0, 0, 3]);
    // …and inside the box, near ink but outside every glyph's box, no sample either
    const beside = handInkAt(wide, face.atlas, O[0] + 0.18 * EM + 40, O[1] - 10, 0, 1);
    expect(beside.samples).toBe(0);
  });

  it("carries the pressure into the coverage and names the glyph's pen", () => {
    const pressed = handRun(lone("l", O[0], O[1], { press: 0.8 }), face.atlas, { pens: [5] });
    const p = handInkAt(pressed, face.atlas, ...at(O[0], O[1], 0.18, -0.36), 0, 1);
    expect(p.cover).toBeCloseTo(0.8, 2);
    expect(p.pen).toBe(5);
  });

  it("turned and scaled, the glyph's own frame goes with it", () => {
    const rot = 0.3;
    const turned = handRun(lone("l", O[0], O[1], { rot, scale: 1.25 }), face.atlas);
    // the bar's middle in the glyph's frame (em), turned by `rot` and scaled about the origin, as canvas's rotate lays it
    const [ex, ey] = [0.18 * 1.25 * EM, -0.36 * 1.25 * EM];
    const x = O[0] + Math.cos(rot) * ex - Math.sin(rot) * ey;
    const y = O[1] + Math.sin(rot) * ex + Math.cos(rot) * ey;
    expect(handInkAt(turned, face.atlas, x, y, 0, 1).cover).toBeCloseTo(1, 2);
    expect(handInkAt(turned, face.atlas, O[0] + 0.18 * EM, O[1] - 0.36 * EM, 0, 1).cover).toBe(0);   // where the upright bar would be
  });

  it("minified, reads a coarser level at the LOD its texels per device px ask — the stroke still there, softened", () => {
    const small = ink(0.18, -0.36, 8);   // 8 units a device px: 32/48 × 8 ≈ 5.3 texels a px — level ≈ 2.4
    expect(small.samples).toBe(1);
    expect(small.cover).toBeGreaterThan(0.2);
    expect(small.cover).toBeLessThanOrEqual(1);
  });

  it("far out, the edge's ramp stops at the field's reach: no haze over the glyph's rect where the field has no more to say", () => {
    // 40 units a device px against a field that reaches 0.25 em (12 units) past the ink: the rect's corner, far from the bar
    const corner = ink(0.18 + L.nib + 0.24, -0.72 - L.nib - 0.24, 40);
    expect(corner.samples).toBe(1);
    expect(corner.cover).toBe(0);   // without the cap: 0.5 − 12/40 = 0.2 of ink over the whole rect
    // …while the stroke is still there, faded: at the coarsest level it is under a texel wide
    expect(ink(0.18, -0.36, 40).cover).toBeGreaterThan(0.2);
  });

  it("the run's weight moves the outline outward by its em: the stroke that much wider on each side, its centre as it was", () => {
    const w = 0.02;   // em: about a device px at this size (48 units an em, a unit a px)
    const heavy = handRun(lone("l", O[0], O[1]), face.atlas, { weight: w });
    for (const ey of [-0.6, -0.36, -0.1]) {
      // where the bare bar's edge is half inked, w em further out the weighted bar's is — on either side of the bar
      const bare = handInkAt(run, face.atlas, ...at(O[0], O[1], 0.18 + L.nib, ey), 0, 1).cover;
      expect(handInkAt(heavy, face.atlas, ...at(O[0], O[1], 0.18 + L.nib + w, ey), 0, 1).cover).toBeCloseTo(bare, 1);
      expect(handInkAt(heavy, face.atlas, ...at(O[0], O[1], 0.18 - L.nib - w, ey), 0, 1).cover).toBeCloseTo(handInkAt(run, face.atlas, ...at(O[0], O[1], 0.18 - L.nib, ey), 0, 1).cover, 1);
      // a device px past the moved edge, nothing; the centre line inked whole, as it was
      expect(handInkAt(heavy, face.atlas, ...at(O[0], O[1], 0.18 + L.nib + w + 1.2 / EM, ey), 0, 1).cover).toBe(0);
      expect(handInkAt(heavy, face.atlas, ...at(O[0], O[1], 0.18, ey), 0, 1).cover).toBeCloseTo(1, 2);
    }
  });

  it("the pen's spread widens the edge by half its width at its alpha", () => {
    const spread = handRun(lone("l", O[0], O[1]), face.atlas, { bleed: 2, bleedAlpha: 0.45 });
    const out = handInkAt(spread, face.atlas, ...at(O[0], O[1], 0.18 + L.nib + 0.75 / EM, -0.36), 0, 0.25);
    expect(out.cover).toBeCloseTo(0.45, 1);
    expect(handInkAt(run, face.atlas, ...at(O[0], O[1], 0.18 + L.nib + 0.75 / EM, -0.36), 0, 0.25).cover).toBe(0);
  });
});

describe("the pen lays its ink as the raster does (petition I59 — desk/host/ink.ts's model: stroke the bleed, fill, source-over)", () => {
  // The raster draws each glyph twice, source-over: its outline stroked `bleed` wide at α × its pressure, then the glyph filled at its
  // pressure — and every glyph over the ones before. So on a glyph's edge, where the fill lays part of a px and the stroke all of
  // it, the two ADD as paint does — F + S·(1 − F) — and where two glyphs meet (a kerned or a cursive overlap) their inks add the same
  // way, 1 − (1 − a)(1 − b): never only the larger. The pen and the wet ink are still the glyph's that laid the most.
  const press = 0.8;

  it("within a glyph the fill lies over its bleed's stroke — a band about the outline, as `strokeText` lays it: on the edge F + S·(1 − F), deep inside the fill alone", () => {
    const plain = handRun(lone("l", O[0], O[1]), face.atlas);
    const spread = handRun(lone("l", O[0], O[1], { press }), face.atlas, { bleed: 2, bleedAlpha: 0.45 });
    for (const ey of [-0.6, -0.36, -0.1]) {
      const edge = at(O[0], O[1], 0.18 + L.nib, ey);
      const f = handInkAt(plain, face.atlas, ...edge, 0, 1).cover;   // the fill alone there, at full pressure: part of the px
      expect(f).toBeGreaterThan(0.3);
      expect(f).toBeLessThan(0.7);
      const F = press * f;
      const S = 0.45 * press;   // the stroke lays its whole there: the bleed's half-width (a unit) is past the edge's one-px ramp
      expect(handInkAt(spread, face.atlas, ...edge, 0, 1).cover).toBeCloseTo(F + S * (1 - F), 3);
    }
    // deep inside the glyph, past the stroke's inner half (the bar's centre line, 3.4 units in), the fill alone: its pressure — the
    // raster strokes a band about the outline, not the glyph grown, so nothing lies under the fill there
    expect(handInkAt(spread, face.atlas, ...at(O[0], O[1], 0.18, -0.36), 0, 1).cover).toBeCloseTo(press, 3);
  });

  it("glyphs lie over one another: where two lay ink, 1 − (1 − a)(1 − b); the pen and the wet ink the glyph's that laid the most", () => {
    // two bars laid on one another — an overlap at its extreme — at two pressures, two pens
    const two = (pa: number, pb: number): HandLayout => {
      const base = lone("l", O[0], O[1]);
      const a = lone("l", O[0], O[1], { press: pa }).glyphs[0] as HandLayout["glyphs"][number];
      const b = { ...(lone("l", O[0], O[1], { press: pb }).glyphs[0] as HandLayout["glyphs"][number]), index: 1 };
      return { ...base, glyphs: [a, b] };
    };
    const centre = at(O[0], O[1], 0.18, -0.36);
    const both = handInkAt(handRun(two(0.5, 0.6), face.atlas, { pens: [3, 5] }), face.atlas, ...centre, 0, 1);
    expect(both.cover).toBeCloseTo(1 - 0.5 * 0.4, 2);   // 0.8 — the larger alone would be 0.6
    expect(both.pen).toBe(5);   // the glyph that laid the most names the pen
    expect(handInkAt(handRun(two(0.6, 0.5), face.atlas, { pens: [3, 5] }), face.atlas, ...centre, 0, 1).pen).toBe(3);
    // the wet ink is that glyph's too: one bar long dry, the other being written over it now
    const T0 = 5000;
    const DUR = 200;
    const moments: PenMoment[] = [{ start: T0 - 10_000, dur: DUR }, { start: T0, dur: DUR }];
    const now = T0 + DUR / 2;
    const nib = -0.72 + handEase(0.5) * pathLength(L);
    const behind = at(O[0], O[1], 0.18, nib - 0.05);   // just behind the second bar's nib: its ink fresh there
    const wetter = handInkAt(handRun(two(0.5, 0.9), face.atlas, { moments, epoch: T0 - 40 }), face.atlas, ...behind, now, 1);
    expect(wetter.wet).toBeGreaterThan(0.5);   // the bar being written laid the most (0.9): its fresh ink
    expect(wetter.cover).toBeGreaterThan(0.9);   // the two together: more than either
    const drier = handInkAt(handRun(two(0.5, 0.4), face.atlas, { moments, epoch: T0 - 40 }), face.atlas, ...behind, now, 1);
    expect(drier.wet).toBe(0);   // the dry bar laid the most (0.5): its ink, dry
  });
});

describe("the reveal (petition I59 — the pen's law)", () => {
  const T0 = 5000;
  const DUR = 200;
  const moment: PenMoment = { start: T0, dur: DUR };
  const run = handRun(lone("l", O[0], O[1]), face.atlas, { moments: [moment], epoch: T0 - 40 });
  const ink = (ey: number, now: number, ex = 0.18) => handInkAt(run, face.atlas, ...at(O[0], O[1], ex, ey), now, 1);
  const total = pathLength(L);

  it("lays nothing before its pen sets off, and the whole glyph once its time is out", () => {
    for (const ey of [-0.7, -0.36, -0.02]) {
      expect(ink(ey, T0 - 100).cover).toBe(0);
      expect(ink(ey, T0).cover).toBe(0);
      expect(ink(ey, T0 + DUR).cover).toBeCloseTo(1, 2);
      expect(ink(ey, T0 + DUR).wet).toBe(0);
    }
  });

  it("while it writes: behind the nib written, ahead of it bare, the front where the eased progress meets the arrival", () => {
    const now = T0 + DUR / 2;
    const p = handEase(0.5);
    // the nib's centre after p of the path (the bar runs from the top): y = −0.72 + p · 0.72 em
    const nib = -0.72 + p * total;
    expect(ink(nib - 2 * L.nib, now).cover).toBeCloseTo(1, 1);   // behind it: written
    expect(ink(nib + 2 * L.nib, now).cover).toBe(0);              // ahead of it, past the nib's reach: bare
    // just behind the nib the ink is wet; far behind it, dry
    expect(ink(nib - 0.05, now).wet).toBeGreaterThan(0.5);
    expect(ink(-0.7, now).wet).toBeLessThan(ink(nib - 0.05, now).wet);
    // the front is the nib's own round edge: on the centre line it is a nib ahead of the centre, off the line less far ahead
    const front = (ex: number): number => {
      let lo = nib - 3 * L.nib;
      let hi = nib + 3 * L.nib;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (ink(mid, now, ex).cover > 0.25) lo = mid; else hi = mid; }
      return lo;
    };
    const centre = front(0.18);
    const side = front(0.18 + 0.6 * L.nib);
    expect(centre - nib).toBeGreaterThan(0.6 * L.nib);
    expect(centre - nib).toBeLessThan(1.3 * L.nib);
    expect(side).toBeLessThan(centre);   // round: the front draws back toward its sides
    expect(nibAt(L, 0.18, centre).first / total).toBeCloseTo(p, 1);
  });

  it("where a later stroke crosses an earlier one, the earlier ink is already there", () => {
    const X = face.glyphs.get("x") as FixtureGlyph;   // (0.06, −0.46) → (0.44, 0), lift, then (0.44, −0.46) → (0.06, 0)
    const xr = handRun(lone("x", O[0], O[1]), face.atlas, { moments: [moment], epoch: T0 });
    const xTotal = pathLength(X);
    // the moment the second stroke sets off, and a moment it is half way: the crossing is at its middle
    const first = Math.hypot(0.38, 0.46);
    const progress = (first + 0.1 + 0.25 * first) / xTotal;   // a quarter into the second stroke: not at the crossing yet
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (handEase(mid) < progress) lo = mid; else hi = mid; }
    const now = T0 + lo * DUR;
    const cross = at(O[0], O[1], 0.25, -0.23);
    expect(handInkAt(xr, face.atlas, ...cross, now, 1).cover).toBeCloseTo(1, 1);   // the first stroke's ink, there already
    // on the second stroke past the crossing (where only it runs): not yet written
    const later = at(O[0], O[1], 0.44 - 0.75 * 0.38, -0.46 + 0.75 * 0.46);
    expect(handInkAt(xr, face.atlas, ...later, now, 1).cover).toBe(0);
    expect(handInkAt(xr, face.atlas, ...later, T0 + DUR, 1).cover).toBeCloseTo(1, 1);
  });

  it("keeps time from the run's own epoch: the same moment built at another epoch reads the same", () => {
    const other = handRun(lone("l", O[0], O[1]), face.atlas, { moments: [moment], epoch: T0 - 90_000 });
    for (const now of [T0 + 20, T0 + 100, T0 + 180]) {
      expect(handInkAt(other, face.atlas, ...at(O[0], O[1], 0.18, -0.4), now, 1).cover).toBeCloseTo(ink(-0.4, now).cover, 4);
    }
  });

  it("a glyph written before is whole at any time", () => {
    const before = handRun(lone("l", O[0], O[1]), face.atlas, { epoch: 1e9 });
    expect(handInkAt(before, face.atlas, ...at(O[0], O[1], 0.18, -0.36), 0, 1).cover).toBeCloseTo(1, 2);
    expect(handInkAt(before, face.atlas, ...at(O[0], O[1], 0.18, -0.36), 2e9, 1).cover).toBeCloseTo(1, 2);
    expect(HAND_RUN.before).toBeLessThan(-1e29);
  });
});

describe("a glyph whose pen origin lies outside its rect (petition I59 — the bake's origins are whole texels, and may)", () => {
  // a tick wholly above the baseline (its origin under the rect) and a grave far right of its origin (its origin left of the rect
  // and under it), laid as the bake lays a rect: the ink's box in whole texels and the margin round it
  const TICK: FixtureGlyph = { ch: "'", advance: 0.24, nib: 0.05, strokes: [[0.12, -0.72, 0.1, -0.5]] };
  const GRAVE: FixtureGlyph = { ch: "`", advance: 0.6, nib: 0.04, strokes: [[0.35, -0.7, 0.45, -0.6]] };
  const marks = fixtureFace({ glyphs: [TICK, GRAVE], whole: true });
  const one = (g: FixtureGlyph, x: number, y: number, rot = 0, scale = 1): HandLayout => ({
    glyphs: [{ ch: g.ch, index: 0, x, y, advance: g.advance * EM, rot, scale, press: 1, line: 0 }],
    lines: [{ start: 0, end: 1, y, width: g.advance * EM }], positions: new Float32Array([x, y, x + g.advance * EM, y]),
    overflow: false, em: EM, ascent: 0.8 * EM, descent: 0.3 * EM,
  });

  it("is laid as baked: whole-texel origins, outside the rect", () => {
    for (const g of [TICK, GRAVE]) {
      const baked = marks.atlas.glyphs[String(g.ch.codePointAt(0))];
      const [, , , h] = baked?.rect as readonly [number, number, number, number];
      const [ox, oy] = baked?.origin as readonly [number, number];
      expect(Number.isInteger(ox) && Number.isInteger(oy)).toBe(true);
      expect(oy).toBeGreaterThan(h);
    }
    expect((marks.atlas.glyphs[String("`".codePointAt(0))]?.origin as readonly [number, number])[0]).toBeLessThan(0);
  });

  it("is inked where its strokes are — upright, and turned and scaled about its origin — and nowhere else", () => {
    for (const g of [TICK, GRAVE]) {
      const st = g.strokes[0] as readonly number[];
      const mid = [((st[0] as number) + (st[2] as number)) / 2, ((st[1] as number) + (st[3] as number)) / 2] as const;
      // upright: the stroke's middle inked whole; two nibs and a device px beside it (across the stroke) nothing
      const run = handRun(one(g, O[0], O[1]), marks.atlas);
      expect(handInkAt(run, marks.atlas, ...at(O[0], O[1], mid[0], mid[1]), 0, 1).cover).toBeCloseTo(1, 2);
      const across = [(st[3] as number) - (st[1] as number), (st[0] as number) - (st[2] as number)];
      const n = Math.hypot(across[0] as number, across[1] as number);
      const off = 2 * g.nib + 1 / EM;
      const beside = at(O[0], O[1], mid[0] + ((across[0] as number) / n) * off, mid[1] + ((across[1] as number) / n) * off);
      expect(handInkAt(run, marks.atlas, ...beside, 0, 1).cover).toBe(0);
      // turned and scaled: the middle goes with the glyph's frame, as canvas's rotate lays it
      const rot = -0.4;
      const turned = handRun(one(g, O[0], O[1], rot, 1.5), marks.atlas);
      const [ex, ey] = [mid[0] * 1.5 * EM, mid[1] * 1.5 * EM];
      expect(handInkAt(turned, marks.atlas, O[0] + Math.cos(rot) * ex - Math.sin(rot) * ey, O[1] + Math.sin(rot) * ex + Math.cos(rot) * ey, 0, 1).cover).toBeCloseTo(1, 2);
    }
  });
});

describe("the coarse levels keep to their glyph: the desk's own faces as baked (apps/desk/assets/hand)", () => {
  // The chain is made over the whole atlas, so a coarse texel can straddle two rects. Each glyph is read through the twin over its own
  // corner of its atlas — its rect and 16 texels round it, in whole level-3 texels, cut at the atlas's own edges, the same bytes the
  // whole atlas gives every read a sample there makes — with its neighbours' texels kept, and with them erased: at a point every two
  // texels of its rect, at rest and mid-writing, plain and spread by half the field's reach (bleed 6 units at 64 an em: 3 texels).
  const dir = resolve(import.meta.dirname, "../../../apps/desk/assets/hand");
  const bakedFace = (name: string): HandAtlas => {
    const read = readHandAtlas(JSON.parse(readFileSync(resolve(dir, `${name}.hand.json`), "utf8")), new Uint8Array(readFileSync(resolve(dir, `${name}.hand.bin`))));
    if ("error" in read) throw new Error(read.error);
    return read;
  };
  /** Glyph `cp`'s corner of `atlas` as an atlas of its own, its neighbours' texels kept or erased. */
  const cornerOf = (atlas: HandAtlas, cp: string, keep: boolean): HandAtlas => {
    const g = atlas.glyphs[cp] as HandAtlasGlyph;
    const [rx, ry, rw, rh] = g.rect as readonly [number, number, number, number];
    const x0 = Math.max(0, Math.floor((rx - 16) / 8) * 8);
    const y0 = Math.max(0, Math.floor((ry - 16) / 8) * 8);
    const x1 = Math.min(atlas.width, Math.ceil((rx + rw + 16) / 8) * 8);
    const y1 = Math.min(atlas.height, Math.ceil((ry + rh + 16) / 8) * 8);
    const w = x1 - x0;
    const bin = new Uint8Array(w * (y1 - y0) * 2);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!keep && (x < rx || y < ry || x >= rx + rw || y >= ry + rh)) continue;
        bin[((y - y0) * w + x - x0) * 2] = atlas.bin[(y * atlas.width + x) * 2] as number;
        bin[((y - y0) * w + x - x0) * 2 + 1] = atlas.bin[(y * atlas.width + x) * 2 + 1] as number;
      }
    }
    return { ...atlas, width: w, height: y1 - y0, bin, glyphs: { [cp]: { ...g, rect: [rx - x0, ry - y0, rw, rh] } }, kerning: {} };
  };

  for (const name of ["caveat-500", "caveat-600", "kalam-400"]) {
    it(`${name}: up to 4 texels a px every glyph reads the same to the bit with its neighbours erased; past that under 2% of coverage, no ghost`, () => {
      const atlas = bakedFace(name);
      const em = atlas.em;   // units an em = texels an em: a texel a unit at zoom 1
      const T0 = 5000;
      let glyphs = 0;
      let points = 0;
      let unequal = 0;
      let most = 0;
      let ghost = 0;
      for (const [cp, g] of Object.entries(atlas.glyphs)) {
        if (g.rect === undefined || g.origin === undefined) continue;
        glyphs += 1;
        const ch = String.fromCodePoint(Number(cp));
        const [, , rw, rh] = g.rect;
        const [ox, oy] = g.origin;
        const layout: HandLayout = {
          glyphs: [{ ch, index: 0, x: 0, y: 0, advance: g.advance * em, rot: 0, scale: 1, press: 1, line: 0 }],
          lines: [{ start: 0, end: 1, y: 0, width: g.advance * em }], positions: new Float32Array([0, 0, g.advance * em, 0]),
          overflow: false, em, ascent: atlas.ascent * em, descent: atlas.descent * em,
        };
        const kept = cornerOf(atlas, cp, true);
        const erased = cornerOf(atlas, cp, false);
        const runs = (a: HandAtlas) => ({
          rest: handRun(layout, a), spread: handRun(layout, a, { bleed: 6 }),
          writing: handRun(layout, a, { moments: [{ start: T0, dur: 200 }], epoch: T0 }),
        });
        const k = runs(kept);
        const e = runs(erased);
        for (let v = 0.25; v < rh; v += 2) {
          for (let u = 0.25; u < rw; u += 2) {
            points += 1;
            const [x, y] = [u - ox, v - oy];
            // up to 4 texels a px (levels 0–2): to the bit, at rest spread and mid-writing
            for (const [run, now] of [["spread", 0], ["writing", T0 + 100]] as const) {
              if (handInkAt(k[run], kept, x, y, now, 4).cover !== handInkAt(e[run], erased, x, y, now, 4).cover) unequal += 1;
            }
            // 8 and 16 texels a px (level 3, the coarsest): the coverage within 2%, and no ink where the glyph alone lays none
            for (const aa of [8, 16]) {
              for (const run of ["rest", "spread"] as const) {
                const a = handInkAt(k[run], kept, x, y, 0, aa).cover;
                const b = handInkAt(e[run], erased, x, y, 0, aa).cover;
                most = Math.max(most, Math.abs(a - b));
                if (b === 0) ghost = Math.max(ghost, a);
              }
            }
          }
        }
      }
      console.log(`[hand-ink] ${name}: ${glyphs} glyphs, ${points} points — unequal up to 4 texels a px: ${unequal}; at 8–16: coverage moved at most ${most.toFixed(4)}, ghost ink at most ${ghost.toFixed(4)}`);
      expect(glyphs).toBeGreaterThan(190);
      expect(unequal).toBe(0);
      expect(most).toBeLessThan(0.02);
      expect(ghost).toBeLessThan(0.012);
    });
  }
});
