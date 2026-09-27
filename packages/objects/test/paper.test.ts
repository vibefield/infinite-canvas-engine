// The paper's law (paper/paper.ts, STICKY.md): the lamp on the desk, the tilt, the
// geometry a note resolves to, the CPU mirror (local frame · distance · height),
// the raster ladder; the hand's layout (paper/text.ts): the wrap, the jitter's
// determinism, the caret, the seeds carried through an edit; the ink shelves
// (paper/pages.ts): reuse, overflow, both hosts' agreement; and the records
// filled by name.
import { must } from "../../desk/test/must";
import { describe, expect, it } from "vitest";
import { BAND_MAX, BAND_MIN, boundsOf, DEFAULT_PAPER_LAW, heightAt, lampOf, localOf, PAPER_REST, pickPaper, rasterBand, resolvePaper, sdPaper, shadowReach, tiltOf, worldOf } from "../src/paper/paper";
import { caretAt, carrySeeds, glyphBox, hashHand, type HandMetrics, layoutText, HAND } from "@ice/desk/kit";
import { InkShelves } from "../src/paper/pages";
import { MAX_PAPERS, Paper, PaperUniforms, paperValues } from "../src/paper/layout";
import { MAT_GRID } from "@ice/desk";
import { PAPER } from "../src/paper/theme";

const LAMP = lampOf(MAT_GRID.plane);
const note = (over: Partial<{ cx: number; cy: number; w: number; h: number; angle: number }> = {}) => ({ cx: 600, cy: 400, w: 200, h: 200, angle: 0, ...over });

describe("the lamp", () => {
  it("is the gobo projector on the desk plane, in world units: off to the upper right, about a thousand px up", () => {
    expect(LAMP.x).toBeCloseTo(1929.5, 0);
    expect(LAMP.y).toBeCloseTo(-825.5, 0);
    expect(LAMP.h).toBeCloseTo(993.4, 0);
  });
  it("casts a note's shadow away from it — down and to the left at the mat's centre — with a slope under the cap", () => {
    const G = resolvePaper(note(), PAPER_REST, DEFAULT_PAPER_LAW, LAMP);
    expect(G.slope[0]).toBeLessThan(0);
    expect(G.slope[1]).toBeGreaterThan(0);
    expect(Math.hypot(G.slope[0], G.slope[1])).toBeLessThanOrEqual(PAPER.shadow.slopeMax);
    // a note straight under the lamp casts straight down: no offset
    const under = resolvePaper(note({ cx: LAMP.x, cy: LAMP.y }), PAPER_REST, DEFAULT_PAPER_LAW, LAMP);
    expect(Math.hypot(under.slope[0], under.slope[1])).toBeCloseTo(0, 9);
    expect(under.lamp[2]).toBeCloseTo(1, 9);
    // far from the lamp the slope is capped, the direction kept
    const far = resolvePaper(note({ cx: -40000, cy: 30000 }), PAPER_REST, DEFAULT_PAPER_LAW, LAMP);
    expect(Math.hypot(far.slope[0], far.slope[1])).toBeCloseTo(PAPER.shadow.slopeMax, 9);
    expect(far.slope[0]).toBeLessThan(0); expect(far.slope[1]).toBeGreaterThan(0);   // the lamp is to its right and above: the shadow goes left and down
  });
});

describe("the sheet", () => {
  it("takes a tilt within ± the law's degrees from its seed, never the same for two seeds", () => {
    const max = (PAPER.tilt * Math.PI) / 180;
    const seen = new Set<number>();
    for (let s = 1; s <= 50; s++) { const a = tiltOf(s, PAPER.tilt); expect(Math.abs(a)).toBeLessThanOrEqual(max); seen.add(a); }
    expect(seen.size).toBe(50);
    expect(tiltOf(7, PAPER.tilt)).toBe(tiltOf(7, PAPER.tilt));
  });
  it("resolves at rest to its own rect, and held to the lift's scale and height with the darker shadow", () => {
    const rest = resolvePaper(note(), PAPER_REST, DEFAULT_PAPER_LAW, LAMP);
    expect(rest.half).toEqual([100, 100]);
    expect(rest.lift).toBe(0);
    expect(rest.shadow.alpha).toBeCloseTo(PAPER.shadow.alpha, 9);
    const held = resolvePaper(note(), { held: 1, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, LAMP);
    expect(held.half[0]).toBeCloseTo(100 * PAPER.lift.scale, 9);
    expect(held.lift).toBe(PAPER.lift.height);
    expect(held.shadow.alpha).toBeCloseTo(PAPER.shadow.alphaHeld, 9);
    expect(shadowReach(held)).toBeGreaterThan(shadowReach(rest));
  });
  it("the local frame turns with the tilt and comes back: a corner of a note turned 30° is where the rotation puts it", () => {
    const G = resolvePaper(note({ angle: Math.PI / 6 }), PAPER_REST, DEFAULT_PAPER_LAW, LAMP);
    const [wx, wy] = worldOf(G, 90, -90);
    const [qx, qy] = localOf(G, wx, wy);
    expect(qx).toBeCloseTo(90, 9); expect(qy).toBeCloseTo(-90, 9);
    // the rotation is clockwise on screen for a positive angle: the right edge's midpoint goes DOWN
    const [rx, ry] = worldOf(G, 100, 0);
    expect(rx).toBeGreaterThan(600); expect(ry).toBeGreaterThan(400);
    expect(pickPaper(G, wx, wy)).toBe("paper");
    const [ox, oy] = worldOf(G, 101, -101);
    expect(pickPaper(G, ox, oy)).toBe("outside");
    expect(sdPaper(G, 600, 400)).toBeCloseTo(-100 + 0, 6);
    const b = boundsOf(G);
    expect(b.w).toBeCloseTo(200 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6)), 6);
  });
  it("lies flat under the strip and rises as t² to the free edge, the corners most; a held note is the lift higher everywhere", () => {
    const G = resolvePaper(note(), PAPER_REST, DEFAULT_PAPER_LAW, LAMP);
    expect(heightAt(G, 0, -100)).toBe(0);
    expect(heightAt(G, 0, -100 + PAPER.glue * 200)).toBe(0);
    const mid = heightAt(G, 0, 100);
    const corner = heightAt(G, 100, 100);
    expect(mid).toBeCloseTo(PAPER.curl, 9);
    expect(corner).toBeCloseTo(PAPER.curl * (1 + PAPER.cornerCurl), 9);
    const half = heightAt(G, 0, -100 + PAPER.glue * 200 + (1 - PAPER.glue) * 100);
    expect(half).toBeCloseTo(PAPER.curl * 0.25, 9);
    const H = resolvePaper(note(), { held: 1, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, LAMP);
    expect(heightAt(H, 0, -100)).toBe(PAPER.lift.height);
  });
});

describe("the raster ladder", () => {
  it("is the √2 rung at or above the screen's density, within the band's floor and ceiling", () => {
    expect(rasterBand(1, 2)).toBe(2);
    expect(rasterBand(1, 1)).toBe(1);
    expect(rasterBand(1.3, 2)).toBeCloseTo(Math.SQRT2 * 2, 12);
    expect(rasterBand(1.5, 2)).toBe(4);
    expect(rasterBand(0.3, 2)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(rasterBand(0.05, 1)).toBe(BAND_MIN);
    expect(rasterBand(40, 2)).toBe(BAND_MAX);
    expect(rasterBand(3, 2, 0, 4)).toBe(4);   // a cap: the page's side over the note's
  });
  it("keeps the band in use while the screen stays at or under it and over 2.3× under it — no band crossing on a wobble", () => {
    expect(rasterBand(1.9, 2, 4)).toBe(4);
    expect(rasterBand(2.001, 2, 4)).toBeCloseTo(Math.SQRT2 * 4, 12);
    expect(rasterBand(0.9, 2, 4)).toBe(4);
    expect(rasterBand(0.8, 2, 4)).toBe(2);
    expect(rasterBand(0.99, 2, 2)).toBe(2);
    expect(rasterBand(1.01, 2, 2)).toBeCloseTo(Math.SQRT2 * 2, 12);
  });
});

/** A fixed-width face for the tests: every glyph 0.5 em, `W` 0.9, a space 0.3; the box 0.8 over, 0.25 under. */
const MONO: HandMetrics = { ascent: 0.8, descent: 0.25, advance: (ch) => (ch === " " ? 0.3 : ch === "W" ? 0.9 : 0.5) };
const law = { ...HAND, jitter: { ...HAND.jitter, press: [HAND.jitter.press[0], HAND.jitter.press[1]] as readonly [number, number] } };
/** The same hand with no jitter at all — where a wrap count must be exact. */
const flat = { ...law, jitter: { rot: 0, rise: 0, scale: 0, press: [1, 1] as readonly [number, number] }, wander: { amp: 0, period: 9 } };
const BOX = { w: 200, h: 200 };

describe("the hand's layout", () => {
  it("wraps at words inside the margins, breaks at newlines, and breaks a word longer than the line by glyph", () => {
    const L = layoutText("buy milk and\neggs", BOX, flat, MONO, 3);
    // 24 px em, 0.5 em glyphs = 12 px; the line is 200 − 32 = 168 px wide: "buy milk and" is 3+1+4+1+3 glyphs = 12·(0.5·11 + 0.3·… ) — fits; then a newline
    expect(L.lines.length).toBe(2);
    expect(must(L.lines[0]).start).toBe(0); expect(must(L.lines[0]).end).toBe(13);
    expect(must(L.lines[1]).start).toBe(13);
    expect(L.glyphs.filter((g) => g.line === 1).map((g) => g.ch).join("")).toBe("eggs");
    const W = layoutText("aaaa bbbbbbbbbbbb", BOX, flat, MONO, 3);   // 12 glyphs of 12 px = 144 < 168 fits on its own line, not after "aaaa "
    expect(W.lines.length).toBe(2);
    expect(must(W.glyphs.find((g) => g.ch === "b")).line).toBe(1);
    const long = layoutText("abcdefghijklmnopqrstuvwxyz", BOX, flat, MONO, 3);   // 26 × 12 = 312 > 168: breaks by glyph after 14
    expect(long.lines.length).toBe(2);
    expect(must(long.lines[0]).end).toBe(14);
    expect(L.overflow).toBe(false);
    const tall = layoutText(Array(12).fill("x").join("\n"), BOX, flat, MONO, 3);
    expect(tall.overflow).toBe(true);
  });
  it("gives every glyph its own hand within the law, the same on every call — and a different one for a different seed", () => {
    const A = layoutText("hello", BOX, law, MONO, 5);
    const B = layoutText("hello", BOX, law, MONO, 5);
    const C = layoutText("hello", BOX, law, MONO, 6);
    expect(A.glyphs).toEqual(B.glyphs);
    expect(A.glyphs.map((g) => g.rot)).not.toEqual(C.glyphs.map((g) => g.rot));
    for (const g of A.glyphs) {
      expect(Math.abs(g.rot)).toBeLessThanOrEqual(law.jitter.rot);
      expect(Math.abs(g.scale - 1)).toBeLessThanOrEqual(law.jitter.scale + 1e-12);
      expect(g.press).toBeGreaterThanOrEqual(law.jitter.press[0]); expect(g.press).toBeLessThanOrEqual(law.jitter.press[1]);
      expect(Math.abs(g.y - must(A.lines[0]).y)).toBeLessThanOrEqual((law.jitter.rise + law.wander.amp) * law.size + 1e-9);
    }
    const seeds = A.glyphs.map((g) => g.rot);
    expect(new Set(seeds).size).toBe(seeds.length);
    // the hash: four floats in [0, 1), a different set for a different seed or character
    const h = hashHand(1, 97);
    expect(h.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(hashHand(1, 97)).toEqual(h);
    expect(hashHand(2, 97)).not.toEqual(h);
    expect(hashHand(1, 98)).not.toEqual(h);
  });
  it("puts the caret before each index and after the last, on the line's baseline; a wipe box holds the glyph", () => {
    const L = layoutText("ab\ncd", BOX, law, MONO, 1);
    const c0 = caretAt(L, 0);
    const c2 = caretAt(L, 2);
    const c3 = caretAt(L, 3);
    const c5 = caretAt(L, 5);
    expect(c0.x).toBe(law.pad); expect(c0.y).toBeCloseTo(law.pad + MONO.ascent * law.size, 5);
    expect(c2.x).toBeGreaterThan(c0.x); expect(c2.y).toBe(c0.y);
    expect(c3.x).toBe(law.pad); expect(c3.y).toBeCloseTo(c0.y + law.lineHeight * law.size, 5);
    expect(c5.x).toBeGreaterThan(c3.x);
    expect(c0.above).toBeCloseTo(MONO.ascent * law.size, 9);
    const g = must(L.glyphs[0]);
    const b = glyphBox(L, g);
    expect(b.x0).toBeLessThan(g.x); expect(b.x1).toBeGreaterThan(g.x + g.advance);
    expect(b.y0).toBeLessThan(g.y - L.ascent); expect(b.y1).toBeGreaterThan(g.y);
  });
  it("carries the seeds through an edit: an insertion keeps every other glyph's hand, a deletion too", () => {
    let k = 100;
    const fresh = () => k++;
    const a = carrySeeds("", [], "hel", fresh);
    expect(a.seeds).toEqual([100, 101, 102]); expect([a.from, a.to]).toEqual([0, 3]);
    const b = carrySeeds("hel", a.seeds, "hello", fresh);
    expect(b.seeds).toEqual([100, 101, 102, 103, 104]); expect([b.from, b.to]).toEqual([3, 5]);
    const c = carrySeeds("hello", b.seeds, "heXllo", fresh);
    expect(c.seeds).toEqual([100, 101, 105, 102, 103, 104]); expect([c.from, c.to]).toEqual([2, 3]);
    // two letters gone: the suffix match keeps the LATER of the two l's (either is a fair reading of the edit)
    const d = carrySeeds("heXllo", c.seeds, "helo", fresh);
    expect(d.seeds).toEqual([100, 101, 103, 104]); expect([d.from, d.to]).toEqual([2, 2]);
    // a layout with carried seeds keeps a glyph's hand across the insertion
    const before = layoutText("hello", BOX, law, MONO, 1, b.seeds);
    const after = layoutText("heXllo", BOX, law, MONO, 1, c.seeds);
    expect(must(after.glyphs[3]).rot).toBe(must(before.glyphs[2]).rot);
    expect(must(after.glyphs[5]).press).toBe(must(before.glyphs[4]).press);
  });
});

describe("the ink shelves", () => {
  it("lays rasters along rows of one height, reuses a freed span, and opens the next layer when a page is full", () => {
    const S = new InkShelves(1024, 2);
    const a = S.alloc(400, 400);
    const b = S.alloc(400, 400);
    const c = S.alloc(400, 400);
    expect(a).toEqual({ layer: 0, x: 0, y: 0, w: 400, h: 400 });
    expect(b).toEqual({ layer: 0, x: 400, y: 0, w: 400, h: 400 });
    expect(c).toEqual({ layer: 0, x: 0, y: 400, w: 400, h: 400 });   // the row had 224 left: a new row
    S.free(must(b));
    expect(S.alloc(300, 380)).toEqual({ layer: 0, x: 400, y: 0, w: 300, h: 380 });   // a slightly shorter raster takes the freed span
    expect(S.alloc(1024, 224)).toEqual({ layer: 0, x: 0, y: 800, w: 1024, h: 224 });
    expect(S.alloc(10, 10)).toEqual({ layer: 1, x: 0, y: 0, w: 10, h: 10 });   // page 0 has no row height left
    expect(S.alloc(2000, 10)).toBeNull();
    expect(S.stats.layersUsed).toBe(2);
    S.reset();
    expect(S.stats).toEqual({ used: 0, rows: 0, layersUsed: 0 });
    expect(S.alloc(400, 400)).toEqual(a);
  });
  it("merges freed neighbours back into one span", () => {
    const S = new InkShelves(1000, 1);
    const a = must(S.alloc(300, 100));
    const b = must(S.alloc(300, 100));
    const c = must(S.alloc(300, 100));
    S.free(b); S.free(a); S.free(c);
    expect(S.alloc(1000, 100)).toEqual({ layer: 0, x: 0, y: 0, w: 1000, h: 100 });
  });
});

describe("the records", () => {
  it("fill by name: a note with ink, a wipe and a caret; a blank one with none", () => {
    const G = resolvePaper(note({ angle: 0.1 }), { held: 0.5, ring: 1, fade: 0.9 }, DEFAULT_PAPER_LAW, LAMP);
    const buf = Paper.alloc(2);
    buf.set(paperValues({ geometry: G, paper: [1, 0.9, 0.6], ink: [0.1, 0.1, 0.2], raster: { layer: 1, uv: { u0: 0, v0: 0, u1: 0.2, v1: 0.2 } }, wipe: { x0: 10, y0: 20, x1: 30, y1: 40, t: 0.5 }, caret: { x: 5, y: 30, above: 19, below: 6, on: true } }, PAPER.grain), 0);
    buf.set(paperValues({ geometry: G, paper: [1, 0.9, 0.6], ink: [0.1, 0.1, 0.2] }, PAPER.grain), 1);
    const f = new Float32Array(buf.bytes);
    const i = new Int32Array(buf.bytes);
    const at = (field: keyof typeof Paper.slots, el = 0) => (Paper.slots[field].byte + el * Paper.size) / 4;
    expect(f[at("half")]).toBeCloseTo(100 * (1 + (PAPER.lift.scale - 1) * 0.5), 6);
    expect(f[at("rot")]).toBeCloseTo(Math.cos(0.1), 6);
    expect(i[at("layer")]).toBe(1);
    expect(i[at("layer", 1)]).toBe(-1);
    expect(f[at("marks")]).toBeCloseTo(0.5, 9); expect(f[at("marks") + 1]).toBe(1);
    expect(f[at("marks", 1)]).toBe(1); expect(f[at("marks", 1) + 1]).toBe(0);
    expect(f[at("wipe", 1) + 2]).toBe(-1);
    expect(f[at("alpha")]).toBeCloseTo(0.9, 6);
    expect(Paper.size % 16).toBe(0);
    expect(PaperUniforms.size % 16).toBe(0);
    expect(MAX_PAPERS).toBe(1024);
  });
});
