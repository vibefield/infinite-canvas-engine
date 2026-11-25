// THE PEN'S READ on the CPU (petition I59 — kit/hand-run.ts `handInkAt`, `hand_ink`'s twin: the same arithmetic over the same run
// and the same mip levels), held to a face whose geometry is known exactly (./hand-fixture: round-nibbed straight strokes). The
// edge: a stroke's centre line is inked at the glyph's pressure, a nib's width off it half, past it nothing. Blank paper reads no
// atlas texel. THE REVEAL (the brief's law): nothing before the pen sets off; while it writes, a texel shows once the pen's progress
// has reached its arrival — behind the nib written, ahead of it bare, the front round as the nib — and where a later stroke crosses
// an earlier one the earlier ink is already there; after its time the glyph is whole. The pen and the pressure; a minified read at
// a coarser level; the pen's spread.
import { describe, expect, it } from "vitest";
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

  it("the pen's spread widens the edge by half its width at its alpha", () => {
    const spread = handRun(lone("l", O[0], O[1]), face.atlas, { bleed: 2, bleedAlpha: 0.45 });
    const out = handInkAt(spread, face.atlas, ...at(O[0], O[1], 0.18 + L.nib + 0.75 / EM, -0.36), 0, 0.25);
    expect(out.cover).toBeCloseTo(0.45, 1);
    expect(handInkAt(run, face.atlas, ...at(O[0], O[1], 0.18 + L.nib + 0.75 / EM, -0.36), 0, 0.25).cover).toBe(0);
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
