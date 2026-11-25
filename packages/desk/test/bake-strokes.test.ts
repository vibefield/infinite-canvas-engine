// THE PEN'S PATH (petition I59 — bake/derive.ts): every printable ASCII glyph of each of the desk's three faces gets a pen — 94 of
// 94, each stroke x, y pairs inside the glyph's own box — and the desk's faces map every code point of the glyph set (none is
// missing; one a face lacks is reported, never baked). The hand's habits hold: a line starts at its top, a flat one at its left,
// a ring at its top and turns counterclockwise; a composite writes its letter, then its accent, as its own short stroke.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeHand, HAND_GLYPH_SET } from "../src/bake/bake";
import { deriveGlyph, type GlyphPen, strokeLists } from "../src/bake/derive";
import { readFont } from "../src/bake/ttf";

const FACES = ["Caveat-500.ttf", "Caveat-600.ttf", "Kalam-400.ttf"] as const;
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/fonts", name)));
const caveat = readFont(bytes("Caveat-500.ttf"));
const pen = (ch: string, face = caveat): GlyphPen => {
  const d = deriveGlyph(face, ch.codePointAt(0) as number, []);
  if (d === null || d.pen === null) throw new Error(`no pen for ${ch}`);
  return d.pen;
};
const pts = (list: readonly number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i] as number, list[i + 1] as number]);
  return out;
};

describe("every printable ASCII glyph gets a pen", () => {
  for (const name of FACES) {
    it(`${name}: 94 of 94, each stroke x, y pairs inside the glyph's box`, () => {
      const face = readFont(bytes(name));
      const without: string[] = [];
      for (let c = 33; c <= 126; c++) {
        const d = deriveGlyph(face, c, []);
        if (d === null || d.pen === null || d.pen.strokes.length === 0) { without.push(String.fromCharCode(c)); continue; }
        const box = d.pen.polys.flat();
        const [x0, x1] = [Math.min(...box.map((p) => p[0])), Math.max(...box.map((p) => p[0]))].map((v) => v / face.unitsPerEm) as [number, number];
        const [y0, y1] = [Math.min(...box.map((p) => -p[1])), Math.max(...box.map((p) => -p[1]))].map((v) => v / face.unitsPerEm) as [number, number];
        for (const list of strokeLists(d.pen)) {
          expect(list.length % 2, String.fromCharCode(c)).toBe(0);
          expect(list.length, String.fromCharCode(c)).toBeGreaterThanOrEqual(2);
          for (const [x, y] of pts(list)) {
            expect(x, String.fromCharCode(c)).toBeGreaterThanOrEqual(x0 - 0.02);
            expect(x, String.fromCharCode(c)).toBeLessThanOrEqual(x1 + 0.02);
            expect(y, String.fromCharCode(c)).toBeGreaterThanOrEqual(y0 - 0.02);
            expect(y, String.fromCharCode(c)).toBeLessThanOrEqual(y1 + 0.02);
          }
        }
      }
      expect(without).toEqual([]);
    });
  }

  it("the desk's faces map every code point of the glyph set (none missing); a code point a face lacks is reported, not baked", () => {
    expect(HAND_GLYPH_SET).toHaveLength(95 + 96 + 12);
    for (const name of FACES) {
      const face = readFont(bytes(name));
      expect(HAND_GLYPH_SET.filter((c) => face.glyphId(c) === 0), name).toEqual([]);
    }
    const baked = bakeHand(bytes("Caveat-500.ttf"), { file: "Caveat-500.ttf", codes: [0x41, 0x4e00, 0x20] });
    expect(baked.missing).toEqual([0x4e00]);
    expect(Object.keys(baked.json.glyphs)).toEqual(["32", "65"]);
    expect(baked.json.glyphs[32]).toEqual({ advance: 0.242, length: 0, strokes: [] });   // the space: an advance, nothing to draw
  });
});

describe("the hand's habits", () => {
  it("a line starts at its top; a flat line at its left", () => {
    const l = strokeLists(pen("l"));
    expect(l).toHaveLength(1);
    const lp = pts(l[0] as number[]);
    expect((lp[0] as [number, number])[1]).toBeLessThan((lp[lp.length - 1] as [number, number])[1]);   // y down: the top first
    const dash = pts((strokeLists(pen("-"))[0] as number[]));
    expect((dash[0] as [number, number])[0]).toBeLessThan((dash[dash.length - 1] as [number, number])[0]);
  });

  it("a ring starts at its top and turns counterclockwise as the page shows it", () => {
    const o = pen("o");
    expect(o.strokes).toHaveLength(1);
    expect(o.strokes[0]?.closed).toBe(true);
    const ring = pts(strokeLists(o)[0] as number[]);
    const ys = ring.map((p) => p[1]);
    expect((ring[0] as [number, number])[1]).toBeLessThan(Math.min(...ys) + 0.05);
    let area = 0;   // y down: a negative shoelace sum is counterclockwise on the page
    for (let k = 1; k < ring.length; k++) area += (ring[k - 1] as [number, number])[0] * (ring[k] as [number, number])[1] - (ring[k] as [number, number])[0] * (ring[k - 1] as [number, number])[1];
    expect(area).toBeLessThan(0);
    expect((ring[1] as [number, number])[0]).toBeLessThan((ring[0] as [number, number])[0]);   // from the top, leftward
  });

  it("an i's dot comes after its stem (Caveat's is a short stroke); a point-dot is one point, after the body: ä", () => {
    const i = strokeLists(pen("i"));
    expect(i).toHaveLength(2);
    expect(Math.max(...pts(i[1] as number[]).map((p) => p[1]))).toBeLessThan(Math.min(...pts(i[0] as number[]).map((p) => p[1])));
    const a = pen("ä");
    expect(a.strokes.map((s) => s.dot)).toEqual([false, true, true]);
    expect(strokeLists(a).slice(1).map((s) => s.length)).toEqual([2, 2]);
  });

  it("a composite writes its letter, then its accent: Caveat's é is its e's stroke, moved, then the acute above the x-height", () => {
    const e = strokeLists(pen("e"));
    const eAcute = strokeLists(pen("é"));
    expect(eAcute).toHaveLength(e.length + 1);
    // the composite places e one unit left (its component record: 244 @ −1, 0) — the same pen, 0.001 em over
    for (let k = 0; k < e.length; k++) {
      const mine = pts(eAcute[k] as number[]);
      const theirs = pts(e[k] as number[]);
      expect(mine).toHaveLength(theirs.length);
      mine.forEach((p, n) => {
        expect(p[0]).toBeCloseTo((theirs[n] as [number, number])[0] - 0.001, 3);
        expect(p[1]).toBeCloseTo((theirs[n] as [number, number])[1], 3);
      });
    }
    const accent = pts(eAcute[e.length] as number[]);
    for (const [, y] of accent) expect(y).toBeLessThan(-0.45);   // above Caveat's x-height (0.4 em), y down
  });

  it("a face that draws its accented letters whole writes the accent last too: Kalam's À and ù, and the points of its ! and ?", () => {
    const kalam = readFont(bytes("Kalam-400.ttf"));
    for (const ch of "Àù") {
      const st = strokeLists(pen(ch, kalam));
      expect(st.length, ch).toBeGreaterThanOrEqual(3);
      const last = pts(st[st.length - 1] as number[]);
      expect(Math.max(...last.map((p) => p[1])), ch).toBeLessThan(-0.55);   // the grave: above the letter (y down)
      for (const other of st.slice(0, -1)) expect(Math.max(...pts(other).map((p) => p[1])), ch).toBeGreaterThan(-0.55);
    }
    for (const ch of "!?") {
      const st = strokeLists(pen(ch, kalam));
      expect(st, ch).toHaveLength(2);
      expect(Math.min(...pts(st[1] as number[]).map((p) => p[1])), ch).toBeGreaterThan(-0.2);   // the point, at the foot, last
      expect(Math.min(...pts(st[0] as number[]).map((p) => p[1])), ch).toBeLessThan(-0.6);
    }
  });
});
