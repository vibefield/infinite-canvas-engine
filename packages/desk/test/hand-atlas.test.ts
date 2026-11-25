// THE HAND'S ATLAS, READ (petition I59 — kit/hand-atlas.ts): `readHandAtlas` takes an `ice-hand/1` json and its bin and answers
// the atlas or an error that names the field — a short bin, a wrong format, a glyph whose rect leaves the atlas are refused, a
// field it does not know is ignored — and the layout's metrics come off the atlas, so `layoutText` places glyphs by the very
// advances and kerning their ink was baked at. A baked atlas reads back whole.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeHand } from "../src/bake/bake";
import { glyphOf, HAND_ATLAS_FORMAT, type HandAtlas, handMetricsOf, readHandAtlas } from "../src/kit/hand-atlas";
import { HAND, layoutText } from "../src/kit/text";

/** A 16 × 8 atlas with a space and one inked glyph ("i", 4 × 6 texels at 2, 1). */
function tiny(): { json: Record<string, unknown>; bin: Uint8Array } {
  return {
    json: {
      format: "ice-hand/1", family: "Test", weight: 400, em: 64, range: 0.1875, ascent: 0.9, descent: 0.3, width: 16, height: 8,
      glyphs: {
        32: { advance: 0.25, length: 0, strokes: [] },
        105: { advance: 0.3, rect: [2, 1, 4, 6], origin: [1, 5], length: 0.6, strokes: [[0.05, -0.4, 0.05, 0], [0.05, -0.6]] },
      },
      kerning: { "105,105": -0.02 },
      source: { file: "Test.ttf", sha256: "00" },
      corrections: [],
    },
    bin: new Uint8Array(16 * 8 * 2),
  };
}
const read = (json: unknown, bin: Uint8Array): HandAtlas => {
  const a = readHandAtlas(json, bin);
  if ("error" in a) throw new Error(a.error);
  return a;
};
const refusal = (json: unknown, bin: Uint8Array): string => {
  const a = readHandAtlas(json, bin);
  return "error" in a ? a.error : "(read)";
};

describe("readHandAtlas (kit/hand-atlas.ts)", () => {
  it("reads an ice-hand/1 atlas: the face's fields, each glyph, the kerning, the bin beside them", () => {
    const { json, bin } = tiny();
    const a = read(json, bin);
    expect(HAND_ATLAS_FORMAT).toBe("ice-hand/1");
    expect(a.format).toBe("ice-hand/1");
    expect([a.family, a.weight, a.em, a.range, a.ascent, a.descent, a.width, a.height]).toEqual(["Test", 400, 64, 0.1875, 0.9, 0.3, 16, 8]);
    expect(a.bin).toBe(bin);
    expect(glyphOf(a, 105)).toEqual({ advance: 0.3, rect: [2, 1, 4, 6], origin: [1, 5], length: 0.6, strokes: [[0.05, -0.4, 0.05, 0], [0.05, -0.6]] });
    expect(glyphOf(a, 32)).toEqual({ advance: 0.25, length: 0, strokes: [] });
    expect(glyphOf(a, 65)).toBeUndefined();
    expect(a.kerning).toEqual({ "105,105": -0.02 });
    expect(a.source).toEqual({ file: "Test.ttf", sha256: "00" });
  });

  it("refuses a short bin (and a long one): the bin is exactly width × height × 2 bytes", () => {
    const { json } = tiny();
    expect(refusal(json, new Uint8Array(16 * 8 * 2 - 1))).toMatch(/bin is 255 bytes.*256/);
    expect(refusal(json, new Uint8Array(16 * 8 * 2 + 2))).toMatch(/bin is 258 bytes/);
  });

  it("refuses a wrong format", () => {
    const { json, bin } = tiny();
    expect(refusal({ ...json, format: "ice-hand/2" }, bin)).toMatch(/not an ice-hand\/1 atlas.*"ice-hand\/2"/);
    expect(refusal({ ...json, format: undefined }, bin)).toMatch(/not an ice-hand\/1 atlas.*absent/);
    expect(refusal("ice-hand/1", bin)).toMatch(/not an object/);
    expect(refusal(null, bin)).toMatch(/not an object/);
  });

  it("refuses a glyph whose rect leaves the atlas — past either edge, or before the first texel", () => {
    const { json, bin } = tiny();
    const withRect = (rect: unknown): unknown => ({ ...json, glyphs: { 105: { advance: 0.3, rect, origin: [1, 5], length: 0.6, strokes: [[0, 0]] } } });
    expect(refusal(withRect([13, 1, 4, 6]), bin)).toMatch(/glyph 105: rect \[13, 1, 4, 6\] leaves the 16 × 8 atlas/);
    expect(refusal(withRect([2, 3, 4, 6]), bin)).toMatch(/leaves the 16 × 8 atlas/);
    expect(refusal(withRect([-1, 1, 4, 6]), bin)).toMatch(/leaves the 16 × 8 atlas/);
    expect(refusal(withRect([2, 1, 0, 6]), bin)).toMatch(/leaves the 16 × 8 atlas/);
    expect(refusal(withRect([2, 1, 4.5, 6]), bin)).toMatch(/whole texels/);
    expect(refusal(withRect([12, 2, 4, 6]), bin)).toBe("(read)");   // flush with the corner is inside
  });

  it("refuses what it cannot draw: a missing advance, a stroke that is not x, y pairs, strokes with no rect, a bad key", () => {
    const { json, bin } = tiny();
    const glyphs = json.glyphs as Record<string, Record<string, unknown>>;
    const g105 = glyphs[105] as Record<string, unknown>;
    expect(refusal({ ...json, glyphs: { ...glyphs, 105: { ...g105, advance: "0.3" } } }, bin)).toMatch(/glyph 105: advance/);
    expect(refusal({ ...json, glyphs: { ...glyphs, 105: { ...g105, strokes: [[0.1, 0.2, 0.3]] } } }, bin)).toMatch(/glyph 105: stroke 0/);
    expect(refusal({ ...json, glyphs: { ...glyphs, 105: { ...g105, origin: undefined } } }, bin)).toMatch(/glyph 105: origin/);
    expect(refusal({ ...json, glyphs: { ...glyphs, 32: { advance: 0.25, length: 0, strokes: [[0, 0]] } } }, bin)).toMatch(/glyph 32: strokes without a rect/);
    expect(refusal({ ...json, glyphs: { ...glyphs, x: { advance: 0.1, length: 0, strokes: [] } } }, bin)).toMatch(/glyph key "x"/);
    expect(refusal({ ...json, kerning: { "105-105": -0.02 } }, bin)).toMatch(/kerning key "105-105"/);
    expect(refusal({ ...json, em: 0 }, bin)).toMatch(/em is not a positive number/);
    expect(refusal({ ...json, width: 16.5 }, bin)).toMatch(/width and height/);
    expect(refusal({ ...json, source: undefined }, bin)).toMatch(/source/);
    expect(refusal({ ...json, corrections: [1] }, bin)).toMatch(/corrections/);
  });

  it("is tolerant of what it does not know, and an inkless glyph's absent length is 0; the atlas holds copies, not the json", () => {
    const { json, bin } = tiny();
    const glyphs = json.glyphs as Record<string, Record<string, unknown>>;
    const a = read({ ...json, futureField: { any: 1 }, glyphs: { ...glyphs, 32: { advance: 0.25, strokes: [], hint: "x" } } }, bin);
    expect(glyphOf(a, 32)).toEqual({ advance: 0.25, length: 0, strokes: [] });
    expect(Object.hasOwn(a, "futureField")).toBe(false);
    const parsed = tiny().json;
    const b = read(parsed, bin);
    ((parsed.glyphs as Record<string, { strokes: number[][] }>)[105] as { strokes: number[][] }).strokes[0]?.push(9, 9);
    (parsed.kerning as Record<string, number>)["105,105"] = 5;
    expect(glyphOf(b, 105)?.strokes[0]).toEqual([0.05, -0.4, 0.05, 0]);
    expect(b.kerning["105,105"]).toBe(-0.02);
  });
});

describe("handMetricsOf: the layout's metrics are the atlas's", () => {
  it("advances and kerning by code point, the face's box; a glyph the atlas lacks advances 0", () => {
    const { json, bin } = tiny();
    const m = handMetricsOf(read(json, bin));
    expect([m.ascent, m.descent]).toEqual([0.9, 0.3]);
    expect(m.advance("i")).toBe(0.3);
    expect(m.advance(" ")).toBe(0.25);
    expect(m.advance("Z")).toBe(0);
    expect(m.kern?.("i", "i")).toBe(-0.02);
    expect(m.kern?.("i", " ")).toBe(0);
  });

  it("layoutText lays a word by the atlas's own numbers (each glyph's x is the advances and kerning before it)", () => {
    const { json, bin } = tiny();
    const L = layoutText("ii i", { w: 400, h: 200 }, HAND, handMetricsOf(read(json, bin)), 3);
    const xs = L.glyphs.map((g) => g.x);
    expect(L.glyphs.map((g) => g.ch).join("")).toBe("iii");
    expect(L.ascent).toBeCloseTo(0.9 * HAND.size, 9);
    const first = L.glyphs[0];
    const second = L.glyphs[1];
    if (first === undefined || second === undefined) throw new Error("no glyphs laid");
    expect(xs[0]).toBe(HAND.pad);
    expect(second.x).toBeCloseTo(first.x + first.advance - 0.02 * HAND.size, 9);   // its advance (its own size's) and the pair's kerning
  });
});

describe("a baked atlas reads back whole", () => {
  it("bakeHand's text and bin are an atlas readHandAtlas takes, field for field", () => {
    const ttf = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/fonts/Caveat-500.ttf")));
    const baked = bakeHand(ttf, { file: "Caveat-500.ttf", codes: [0x20, 0x54, 0x6f] });   // " To": a space, a kerned pair
    const a = read(JSON.parse(baked.text), baked.bin);
    expect(JSON.parse(baked.text)).toEqual(baked.json);
    const { bin: _bin, ...fields } = a;
    expect(fields).toEqual(baked.json);
    const m = handMetricsOf(a);
    expect(m.advance("T")).toBe(baked.json.glyphs[0x54]?.advance);
    expect(m.kern?.("T", "o")).toBe(-0.09);
  });
});
