// THE BAKE'S CORRECTIONS (petition I59 — bake/corrections.ts): Caveat's N derives as one stroke started at its last stem's top (the
// habit "top first"); its correction reverses it, so the pen starts at the foot of the first stem, and the atlas records the
// correction's id — on both weights, and in Ñ, whose N is a part. Kalam's N needs none; its Ç and ç, drawn whole with a cedilla
// that touches the letter, are re-ordered letter first. A correction that no longer fits what the derivation finds is refused
// whole and reported; an order must be a permutation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeHand } from "../src/bake/bake";
import { HAND_CORRECTIONS, type HandCorrection } from "../src/bake/corrections";

const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/fonts", name)));
/** A glyph's first stroke's first and last points (em, y down). */
function ends(atlas: ReturnType<typeof bakeHand>, ch: string): { first: [number, number]; last: [number, number]; strokes: number } {
  const g = atlas.json.glyphs[ch.codePointAt(0) as number];
  const st = g?.strokes[0];
  if (st === undefined) throw new Error(`no stroke for ${ch}`);
  return { first: [st[0] as number, st[1] as number], last: [st[st.length - 2] as number, st[st.length - 1] as number], strokes: g?.strokes.length ?? 0 };
}

describe("Caveat's N: the pen starts at the foot of its first stem", () => {
  for (const [file, id] of [["Caveat-500.ttf", "caveat-500-N-flip-0"], ["Caveat-600.ttf", "caveat-600-N-flip-0"]] as const) {
    it(`${file}: ${id} applied and recorded; without it the one stroke runs top right to foot`, () => {
      const ttf = bytes(file);
      const fixed = bakeHand(ttf, { file, codes: [0x4e] });
      expect(fixed.json.corrections).toEqual([id]);
      expect(fixed.refused).toEqual([]);
      const n = ends(fixed, "N");
      expect(n.strokes).toBe(1);
      expect(n.first[0]).toBeLessThan(0.25);    // the first stem's foot: left…
      expect(n.first[1]).toBeGreaterThan(-0.15);   // …on the baseline (y down)
      expect(n.last[0]).toBeGreaterThan(0.5);   // the last stem's top: right…
      expect(n.last[1]).toBeLessThan(-0.6);     // …high
      const raw = bakeHand(ttf, { file, codes: [0x4e], corrections: [] });
      expect(raw.json.corrections).toEqual([]);
      expect(ends(raw, "N")).toEqual({ first: n.last, last: n.first, strokes: 1 });
      expect(raw.json.glyphs[0x4e]?.length).toBeCloseTo(fixed.json.glyphs[0x4e]?.length ?? Number.NaN, 3);   // the same path, the other way
    });
  }

  it("Ñ writes its N as N is written (the part's correction), then the tilde; the id is recorded once", () => {
    const baked = bakeHand(bytes("Caveat-500.ttf"), { file: "Caveat-500.ttf", codes: [0x4e, 0xd1] });
    expect(baked.json.corrections).toEqual(["caveat-500-N-flip-0"]);
    const n = ends(baked, "N");
    const enye = ends(baked, "Ñ");
    expect(enye.strokes).toBe(2);
    expect(enye.first[0]).toBeCloseTo(n.first[0] - 0.001, 3);   // Ñ's N sits one unit left
    expect(enye.first[1]).toBeCloseTo(n.first[1], 3);
    const tilde = baked.json.glyphs[0xd1]?.strokes[1] ?? [];
    for (let k = 1; k < tilde.length; k += 2) expect(tilde[k]).toBeLessThan(-0.62);   // above the cap height
  });

  it("Kalam's N needs none; its Ç and ç write the letter, then the cedilla that touches it", () => {
    const kalam = bytes("Kalam-400.ttf");
    expect(bakeHand(kalam, { file: "Kalam-400.ttf", codes: [0x4e, 0x6b] }).json.corrections).toEqual([]);
    expect(HAND_CORRECTIONS.filter((c) => c.family === "Kalam").map((c) => c.id)).toEqual(["kalam-400-Ccedilla-order-1-0", "kalam-400-ccedilla-order-1-0"]);
    const raw = bakeHand(kalam, { file: "Kalam-400.ttf", codes: [0xc7, 0xe7], corrections: [] });
    const fixed = bakeHand(kalam, { file: "Kalam-400.ttf", codes: [0xc7, 0xe7] });
    expect(fixed.json.corrections).toEqual(["kalam-400-Ccedilla-order-1-0", "kalam-400-ccedilla-order-1-0"]);
    for (const code of [0xc7, 0xe7]) {
      const before = raw.json.glyphs[code]?.strokes ?? [];
      const after = fixed.json.glyphs[code]?.strokes ?? [];
      expect(after).toEqual([before[1], before[0]]);
      const ys = (st: readonly number[] | undefined): number[] => (st ?? []).filter((_, i) => i % 2 === 1);
      expect(Math.max(...ys(after[1]))).toBeGreaterThan(0.1);   // the cedilla: below the baseline (y down)…
      expect(Math.min(...ys(after[0]))).toBeLessThan(-0.4);     // …after the letter above it
    }
  });
});

describe("a correction that no longer fits is refused whole", () => {
  const ttf = bytes("Caveat-500.ttf");
  const fix = (over: Partial<HandCorrection>): HandCorrection => ({ id: "test", family: "Caveat", weight: 500, code: 0x69, why: "a test", ...over });

  it("a flip past the strokes, a flip of a dot (ä's), an order that is not a permutation: refused, reported, the derived pen kept", () => {
    const plain = bakeHand(ttf, { file: "f.ttf", codes: [0x69, 0xe4], corrections: [] });
    const bad = [fix({ id: "past", flip: [5] }), fix({ id: "dot", code: 0xe4, flip: [1] }), fix({ id: "twice", order: [0, 0] }), fix({ id: "short", order: [1] })];
    for (const one of bad) {
      const baked = bakeHand(ttf, { file: "f.ttf", codes: [0x69, 0xe4], corrections: [one] });
      expect(baked.refused, one.id).toEqual([one.id]);
      expect(baked.json.corrections, one.id).toEqual([]);
      expect(baked.json.glyphs[one.code], one.id).toEqual(plain.json.glyphs[one.code]);
    }
  });

  it("an order that is a permutation is applied: i's dot first, then its stem; another face's correction is not this face's", () => {
    const plain = bakeHand(ttf, { file: "f.ttf", codes: [0x69], corrections: [] });
    const baked = bakeHand(ttf, { file: "f.ttf", codes: [0x69], corrections: [fix({ id: "dot-first", order: [1, 0] }), fix({ id: "bold-only", weight: 600, flip: [0] })] });
    expect(baked.json.corrections).toEqual(["dot-first"]);
    expect(baked.refused).toEqual([]);
    const [stem, dot] = plain.json.glyphs[0x69]?.strokes ?? [];
    expect(baked.json.glyphs[0x69]?.strokes).toEqual([dot, stem]);
  });
});
