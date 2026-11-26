// THE ATLAS'S BYTES (petition I59 — bake/derive.ts's field, bake/bake.ts): two bakes are byte-equal; the grids the bake searches
// answer exactly what the plain loops over every edge and every sample answer; the ink a shader would read off R covers what a
// direct raster of the outline covers — under 1% mean at 24 px over "pageS8k" (the spike's truth method: 16 samples a pixel
// against the atlas's edge, bilinear, a 1-px ramp); G is the moment the pen reaches a texel, 0 where it starts, 255 where it
// ends; and the texels outside every glyph's rect are 0, 0. The json's text parses back to the json.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeHand } from "../src/bake/bake";
import { deriveGlyph, glyphField } from "../src/bake/derive";
import { contourSegments, type FontContour, readFont } from "../src/bake/ttf";
import { HAND_PEN_DOT, HAND_PEN_LIFT, type HandAtlasGlyph, type HandAtlasJson } from "../src/kit/hand-atlas";

/** The outline's edges, each quadratic as 24 lines — finer than the bake's own 10, as the spike's truth was. */
function fineEdges(contours: readonly FontContour[]): [number, number, number, number][] {
  const edges: [number, number, number, number][] = [];
  for (const contour of contours) {
    const poly: [number, number][] = [];
    for (const seg of contourSegments(contour)) {
      if (seg.length === 2) { poly.push([seg[0].x, seg[0].y]); continue; }
      const [p0, c, p1] = seg;
      for (let k = 0; k < 24; k++) {
        const t = k / 24;
        const u = 1 - t;
        poly.push([u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, u * u * p0.y + 2 * u * t * c.y + t * t * p1.y]);
      }
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as [number, number];
      const b = poly[(i + 1) % poly.length] as [number, number];
      edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return edges;
}

const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/desk/assets/fonts", name)));
const CAVEAT = bytes("Caveat-500.ttf");
const codes = (s: string): number[] => [...s].map((c) => c.codePointAt(0) as number);
const WORD = "pageS8k";
const baked = bakeHand(CAVEAT, { file: "Caveat-500.ttf", codes: codes(`${WORD}Ñé %i`) });

/** The atlas's R and G at a texel point (texel centres at +0.5), bilinear — the sampler a shader's would be. */
function sampler(json: HandAtlasJson, bin: Uint8Array): (u: number, v: number) => [number, number] {
  const W = json.width;
  const H = json.height;
  return (u, v) => {
    const x = Math.max(0, Math.min(W - 1.001, u - 0.5));
    const y = Math.max(0, Math.min(H - 1.001, v - 0.5));
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const at = (ii: number, jj: number, c: number): number => bin[2 * (jj * W + ii) + c] as number;
    const mix = (c: number): number => (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy;
    return [mix(0), mix(1)];
  };
}
const glyph = (json: HandAtlasJson, ch: string): HandAtlasGlyph => {
  const g = json.glyphs[ch.codePointAt(0) as number];
  if (g === undefined) throw new Error(`no glyph ${ch}`);
  return g;
};

describe("the bake's bytes", () => {
  it("two bakes are byte-equal — the text and the bin", () => {
    const again = bakeHand(CAVEAT, { file: "Caveat-500.ttf", codes: codes(`${WORD}Ñé %i`) });
    expect(again.text).toBe(baked.text);
    expect(Buffer.from(again.bin).equals(Buffer.from(baked.bin))).toBe(true);
    expect(JSON.parse(baked.text)).toEqual(baked.json);
  });

  it("the grids answer what the plain loops over every edge and sample answer, byte for byte", () => {
    const face = readFont(CAVEAT);
    const kalam = readFont(bytes("Kalam-400.ttf"));
    for (const [f, ch] of [[face, "g"], [face, "8"], [face, "Ñ"], [face, "%"], [face, "i"], [kalam, "é"], [kalam, "W"]] as const) {
      const d = deriveGlyph(f, ch.codePointAt(0) as number, []);
      if (d === null || d.pen === null) throw new Error(`no pen for ${ch}`);
      const fast = glyphField(d.pen, f.unitsPerEm, 64);
      const plain = glyphField(d.pen, f.unitsPerEm, 64, true);
      expect([fast.w, fast.h, ...fast.origin], ch).toEqual([plain.w, plain.h, ...plain.origin]);
      expect(Buffer.from(fast.bytes).equals(Buffer.from(plain.bytes)), ch).toBe(true);
    }
  }, 30_000);

  it("is laid out as ice-hand/1 says: whole-texel rects inside the atlas, sides a multiple of 4, 0, 0 outside every rect", () => {
    const { json, bin } = baked;
    expect(json.width % 4).toBe(0);
    expect(json.height % 4).toBe(0);
    expect(bin.length).toBe(json.width * json.height * 2);
    expect(json.range).toBe(12 / 64);
    const inside = new Uint8Array(json.width * json.height);
    for (const g of Object.values(json.glyphs)) {
      if (g.rect === undefined) continue;
      const [x, y, w, h] = g.rect;
      expect(x + w).toBeLessThanOrEqual(json.width);
      expect(y + h).toBeLessThanOrEqual(json.height);
      expect(g.origin?.every(Number.isInteger)).toBe(true);
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) inside[j * json.width + i] = 1;
    }
    let stray = 0;
    for (let t = 0; t < inside.length; t++) if (!inside[t] && (bin[2 * t] !== 0 || bin[2 * t + 1] !== 0)) stray++;
    expect(stray).toBe(0);
  });
});

describe("R: the ink's edge", () => {
  it("covers what a direct raster of the outline covers: under 1% mean at 24 px over pageS8k", () => {
    const face = readFont(CAVEAT);
    const upm = face.unitsPerEm;
    const { json, bin } = baked;
    const sample = sampler(json, bin);
    const px = 24;
    let sum = 0;
    let n = 0;
    for (const ch of WORD) {
      const g = glyph(json, ch);
      const [rx, ry, rw, rh] = g.rect as readonly [number, number, number, number];
      const [ox, oy] = g.origin as readonly [number, number];
      const edges = face.parts(face.glyphId(ch.codePointAt(0) as number)).flatMap((part) => fineEdges(part.contours));
      const inside = (x: number, y: number): boolean => {
        let wn = 0;
        for (const [ax, ay, bx, by] of edges) {
          if (ay <= y && by > y) { if (ax + ((y - ay) / (by - ay)) * (bx - ax) < x) wn++; }
          else if (by <= y && ay > y) { if (ax + ((y - ay) / (by - ay)) * (bx - ax) < x) wn--; }
        }
        return wn !== 0;
      };
      // the glyph's rect in em (y up): left, top
      const l = -ox / json.em;
      const t = oy / json.em;
      const w = Math.ceil((rw / json.em) * px);
      const h = Math.ceil((rh / json.em) * px);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let c = 0;
          for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside((l + (i + (sx + 0.5) / 4) / px) * upm, (t - (j + (sy + 0.5) / 4) / px) * upm)) c++;
          const ex = l + (i + 0.5) / px;
          const ey = t - (j + 0.5) / px;
          const [r] = sample(rx + ox + ex * json.em, ry + oy - ey * json.em);
          const d = ((r - 128) / 255) * json.range;   // em, + inside
          const a = Math.max(0, Math.min(1, 0.5 + d * px));
          sum += Math.abs(c / 16 - a);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(sum / n).toBeLessThan(0.01);
  }, 30_000);

  it("reads inside along the pen's path (its tips aside) and 0 at the rect's rim", () => {
    const { json, bin } = baked;
    const sample = sampler(json, bin);
    for (const ch of WORD) {
      const g = glyph(json, ch);
      const [rx, ry, rw, rh] = g.rect as readonly [number, number, number, number];
      const [ox, oy] = g.origin as readonly [number, number];
      for (const st of g.strokes) {
        const tip = st.length > 2 ? 2 : 0;   // an open stroke's two ends run on to the ink's tip; a dot is its centre
        for (let k = tip; k + 1 < st.length - tip; k += 2) {
          expect(sample(rx + ox + (st[k] as number) * json.em, ry + oy + (st[k + 1] as number) * json.em)[0], ch).toBeGreaterThan(128);
        }
      }
      for (let i = rx; i < rx + rw; i++) expect(bin[2 * (ry * json.width + i)], ch).toBe(0);
      for (let i = rx; i < rx + rw; i++) expect(bin[2 * ((ry + rh - 1) * json.width + i)], ch).toBe(0);
    }
  });
});

describe("G: the moment the pen reaches a texel", () => {
  it("is 0 where the pen starts, runs late into the writing, and is never later than the pen passing a point of its path", () => {
    const { json, bin } = baked;
    const sample = sampler(json, bin);
    for (const ch of WORD) {
      const g = glyph(json, ch);
      const [rx, ry, rw, rh] = g.rect as readonly [number, number, number, number];
      const [ox, oy] = g.origin as readonly [number, number];
      const G = (x: number, y: number): number => sample(rx + ox + x * json.em, ry + oy + y * json.em)[1];
      const first = g.strokes[0] as readonly number[];
      expect(G(first[0] as number, first[1] as number), ch).toBeLessThan(8);
      // the latest a texel is first reached: late in the writing, though under 255 when the writing ends on ink already
      // written (Caveat's g ends with a five-point dab over its first stroke's start, which G reads as 0: its latest is 223)
      let most = 0;
      for (let j = ry; j < ry + rh; j++) for (let i = rx; i < rx + rw; i++) most = Math.max(most, bin[2 * (j * json.width + i) + 1] as number);
      expect(most, ch).toBeGreaterThan(200);
      // the pen covers its own path no later than it passes: where it is after `along` em of its path, G ≤ along / length
      let along = 0;
      g.strokes.forEach((st, k) => {
        if (k > 0) along += HAND_PEN_LIFT;
        if (st.length === 2) { along += HAND_PEN_DOT; return; }
        for (let i = 0; i + 1 < st.length; i += 2) {
          if (i > 0) along += Math.sqrt(((st[i] as number) - (st[i - 2] as number)) ** 2 + ((st[i + 1] as number) - (st[i - 1] as number)) ** 2);
          // (+8: the listed path is up to 3% shorter than the pen's — the bound below — and G is a byte, bilinear)
          expect(G(st[i] as number, st[i + 1] as number), `${ch} stroke ${k}`).toBeLessThanOrEqual((along / g.length) * 255 + 8);
        }
      });
      expect(along / g.length, ch).toBeGreaterThan(0.97);   // the listed path is the pen's (the lists keep every fourth sample)
      expect(along / g.length, ch).toBeLessThan(1.0001);
    }
  });

  it("a later stroke arrives after an earlier one: k's arm is written after its stem", () => {
    const { json, bin } = baked;
    const sample = sampler(json, bin);
    const g = glyph(json, "k");
    expect(g.strokes.length).toBeGreaterThanOrEqual(2);
    const [rx, ry] = g.rect as readonly [number, number, number, number];
    const [ox, oy] = g.origin as readonly [number, number];
    const G = (x: number, y: number): number => sample(rx + ox + x * json.em, ry + oy + y * json.em)[1];
    const stem = g.strokes[0] as readonly number[];
    const arm = g.strokes[1] as readonly number[];
    const mid = (st: readonly number[]): [number, number] => { const k = 2 * Math.floor(st.length / 4); return [st[k] as number, st[k + 1] as number]; };
    expect(G(...mid(arm))).toBeGreaterThan(G(...mid(stem)));
  });
});
