// THE FACE'S FILE, READ (petition I59 — bake/ttf.ts): the TrueType reader's facts on the desk's own faces (apps/desk/assets/fonts),
// as their tables hold them — Caveat 500's em, its box (hhea, which its typo numbers equal under USE_TYPO_METRICS; never the win
// numbers), its advances, a pair its GPOS kerns, a composite kept as its letter and its accent; Kalam's format-12 character map
// and a face that kerns nothing — and a file that is not a TrueType font refused by name. The SHA-256 the atlas records is
// node:crypto's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/bake/sha256";
import { contourSegments, readFont } from "../src/bake/ttf";

const font = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/fonts", name)));
const caveat = readFont(font("Caveat-500.ttf"));
const id = (c: string): number => caveat.glyphId(c.codePointAt(0) as number);

describe("readFont on Caveat 500", () => {
  it("its em, family and weight, and the box the browser lays it by (hhea = typo under USE_TYPO_METRICS; not win)", () => {
    expect(caveat.unitsPerEm).toBe(1000);
    expect(caveat.family).toBe("Caveat");   // name ID 16 (ID 1 is "Caveat Medium")
    expect(caveat.weight).toBe(500);
    expect(caveat.metrics.hhea).toEqual({ ascender: 960, descender: -300, lineGap: 0 });
    expect(caveat.metrics.typo).toEqual({ ascender: 960, descender: -300, lineGap: 0 });
    expect(caveat.metrics.win).toEqual({ ascent: 974, descent: 315 });
    expect(caveat.metrics.useTypoMetrics).toBe(true);
    expect([caveat.ascent, caveat.descent]).toEqual([960, 300]);
  });

  it("maps code points through its format-4 cmap, and advances by hmtx", () => {
    expect(caveat.glyphId(0x4e00)).toBe(0);   // no CJK: .notdef
    expect(caveat.glyphId(0x1f600)).toBe(0);  // past the BMP, which a format-4 map cannot name
    for (const [ch, advance] of [["A", 505], ["a", 440], [" ", 242], ["N", 606], ["8", 450]] as const) {
      expect(id(ch), ch).toBeGreaterThan(0);
      expect(caveat.advance(id(ch)), ch).toBe(advance);
    }
  });

  it("kerns the pairs its GPOS kerns (PairPos formats 1 and 2 under latn's kern) and nothing else", () => {
    expect(caveat.kerning(id("T"), id("o"))).toBe(-90);
    expect(caveat.kerning(id("A"), id("V"))).toBe(-40);
    expect(caveat.kerning(id("V"), id("A"))).toBe(-55);
    expect(caveat.kerning(id("Q"), id("j"))).toBe(90);
    expect(caveat.kerning(id("H"), id("H"))).toBe(0);
    expect(caveat.kerning(id(" "), id(" "))).toBe(0);
  });

  it("keeps a composite's components apart: Ñ is N's outline, moved, then the tilde", () => {
    const enye = id("Ñ");
    expect(caveat.composite(enye)).toBe(true);
    expect(caveat.composite(id("N"))).toBe(false);
    const parts = caveat.parts(enye);
    expect(parts.map((p) => p.id)).toEqual([id("N"), parts[1]?.id]);
    expect(parts).toHaveLength(2);
    const n = caveat.parts(id("N"));
    expect(n).toHaveLength(1);
    // the composite places N one unit left (its component record: 78 @ −1, 0)
    expect(parts[0]?.contours.map((c) => c.map((p) => [p.x + 1, p.y, p.on]))).toEqual(n[0]?.contours.map((c) => c.map((p) => [p.x, p.y, p.on])));
    // the tilde sits above the cap height
    const tildeYs = parts[1]?.contours.flat().map((p) => p.y) ?? [];
    expect(Math.min(...tildeYs)).toBeGreaterThan(610);
  });

  it("an outline's segments are lines and quadratics, closed: each starts where the last ended", () => {
    const [o] = caveat.parts(id("o"));
    for (const contour of o?.contours ?? []) {
      const segs = contourSegments(contour);
      expect(segs.length).toBeGreaterThan(2);
      for (let k = 0; k < segs.length; k++) {
        const end = segs[k]?.[segs[k]?.length === 2 ? 1 : 2];
        const next = segs[(k + 1) % segs.length]?.[0];
        expect(end).toEqual(next);
      }
    }
  });
});

describe("readFont on Kalam 400, and on what is not a TrueType font", () => {
  it("Kalam: its format-12 cmap (3/10) maps as its format 4 would, its box is hhea's, and it kerns nothing", () => {
    const kalam = readFont(font("Kalam-400.ttf"));
    expect([kalam.family, kalam.weight, kalam.unitsPerEm]).toEqual(["Kalam", 400, 1000]);
    expect([kalam.ascent, kalam.descent]).toEqual([1063, 531]);
    expect(kalam.metrics.useTypoMetrics).toBe(false);
    const k = (c: string): number => kalam.glyphId(c.codePointAt(0) as number);
    for (const c of "AaNé€™") expect(k(c), c).toBeGreaterThan(0);
    expect(new Set([..."AaNé€™"].map(k)).size).toBe(6);
    expect(kalam.composite(k("é"))).toBe(false);   // Kalam draws its accented letters whole
    expect(kalam.kerning(k("T"), k("o"))).toBe(0);
    expect(kalam.kerning(k("A"), k("V"))).toBe(0);
  });

  it("refuses a CFF face, and bytes that are no font, by name", () => {
    const otto = new Uint8Array(64);
    otto.set([0x4f, 0x54, 0x54, 0x4f]);   // "OTTO"
    expect(() => readFont(otto)).toThrow(/ice\/bake: not a TrueType-outline font \(its sfnt version is "OTTO"\)/);
    expect(() => readFont(new Uint8Array(4))).toThrow(/ice\/bake: the file is too short/);
    const noHead = new Uint8Array(12);
    noHead.set([0, 1, 0, 0]);
    expect(() => readFont(noHead)).toThrow(/ice\/bake: the font has no head table/);
  });
});

describe("the source's SHA-256 (bake/sha256.ts)", () => {
  it("is node:crypto's, for the empty message, a block boundary and a font", () => {
    const hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
    expect(sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    for (const n of [1, 55, 56, 63, 64, 65, 1000]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      expect(sha256Hex(b), `${n} bytes`).toBe(hex(b));
    }
    const ttf = font("Caveat-500.ttf");
    expect(sha256Hex(ttf)).toBe(hex(ttf));
  });
});
