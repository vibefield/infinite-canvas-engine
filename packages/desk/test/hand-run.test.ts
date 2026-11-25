// THE GLYPH RUN (petition I59 — the desk's pen): a sheet's writing as a few vec4s a glyph and a grid of cells about an em over the
// writing's box, read by `hand_ink` in a kind's shader (shaders/kit/hand.wgsl). Pinned here, on a face of the tests' own
// (./hand-fixture): every glyph is reachable from every cell its box touches and listed in no other; the same inputs give the same
// bytes; the moments are kept from the run's epoch (a glyph written before is the far past), the epoch split as `penNow` splits the
// clock; the place, turn and size are packed so the atlas rect's corners land on the glyph's box; a glyph the face lacks is named
// and left out; an empty sheet is a header that every point lies outside; the WGSL's constants are the run's; the atlas's mips
// halve exactly and are a rounded 2×2 box. And the cost of building a 2,000-glyph sheet, measured.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compose } from "../src/engine/shader";
import { handMetricsOf, readHandAtlas } from "../src/kit/hand-atlas";
import { HAND_RUN, type HandRun, handLevels, handMips, handRun, penNow } from "../src/kit/hand-run";
import { WRITTEN } from "../src/kit/pen-clock";
import { HAND, type HandLayout, layoutText } from "../src/kit/text";
import { kitWgsl } from "../src/kit/wgsl";
import { fixtureFace } from "./hand-fixture";

const face = fixtureFace();
const metrics = handMetricsOf(face.atlas);
const lay = (text: string, box = { w: 420, h: 320 }, seed = 7): HandLayout => layoutText(text, box, HAND, metrics, seed);

/** vec4 `i` of a run. */
const vec = (run: HandRun, i: number): number[] => Array.from(run.data.subarray(4 * i, 4 * i + 4));
/** The glyphs cell `c` lists. */
function listed(run: HandRun, c: number): number[] {
  const d = run.data;
  const listAt = d[8] as number;
  const off = d[4 * (HAND_RUN.header + (c >> 1)) + (c & 1) * 2] as number;
  const n = d[4 * (HAND_RUN.header + (c >> 1)) + (c & 1) * 2 + 1] as number;
  return Array.from({ length: n }, (_, k) => d[4 * listAt + off + k] as number);
}
/** Glyph `n`'s vec4s: its box, place and turned scale, origin texel with size and pressure, rect, moment with pen. */
const glyphAt = (run: HandRun, n: number): number[][] => Array.from({ length: HAND_RUN.glyph }, (_, k) => vec(run, (run.data[9] as number) + HAND_RUN.glyph * n + k));
/** The cell a point falls in, as `hand_ink` finds it (f32 arithmetic). */
function cellOf(run: HandRun, x: number, y: number): number {
  const f = Math.fround;
  const [x0, y0] = vec(run, 0) as [number, number];
  const [inv, cols, rows] = vec(run, 1) as [number, number, number];
  const cx = Math.min(Math.floor(f(f(f(x) - f(x0)) * f(inv))), cols - 1);
  const cy = Math.min(Math.floor(f(f(f(y) - f(y0)) * f(inv))), rows - 1);
  return cy * cols + cx;
}

describe("the glyph run and its grid (petition I59)", () => {
  const text = "lol xo. lox\nool lx. xx lo\nlo. ox lol xol";
  const L = lay(text);
  const run = handRun(L, face.atlas);

  it("lists every glyph in every cell its box reaches — tried at points all over its exact turned rect — and in no cell its box misses", () => {
    expect(run.glyphs).toBe(L.glyphs.length);
    const { x0, y0, cell, cols, rows } = run.grid;
    let tried = 0;
    for (let n = 0; n < run.glyphs; n++) {
      const [, g1, , g3] = glyphAt(run, n) as [number[], number[], number[], number[]];
      const [ox, oy, a, b] = g1 as [number, number, number, number];
      const k2 = a * a + b * b;
      // points over the rect (texels from the pen's origin), mapped back into the sheet: d = R(rot) · τ / k
      for (let u = 0; u <= 8; u++) {
        for (let v = 0; v <= 8; v++) {
          const tx = (g3[0] as number) + ((g3[2] as number) - (g3[0] as number)) * (u / 8);
          const ty = (g3[1] as number) + ((g3[3] as number) - (g3[1] as number)) * (v / 8);
          const x = ox + (a * tx - b * ty) / k2;
          const y = oy + (b * tx + a * ty) / k2;
          expect(listed(run, cellOf(run, x, y)), `glyph ${n} at (${x.toFixed(3)}, ${y.toFixed(3)})`).toContain(n);
          tried += 1;
        }
      }
    }
    expect(tried).toBe(81 * run.glyphs);
    // …and a cell lists only glyphs whose box meets it (its closed square)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx0 = x0 + c * cell;
        const cy0 = y0 + r * cell;
        for (const n of listed(run, r * cols + c)) {
          const [box] = glyphAt(run, n) as [number[]];
          const meets = (box[0] as number) <= cx0 + cell && (box[2] as number) >= cx0 && (box[1] as number) <= cy0 + cell && (box[3] as number) >= cy0;
          expect(meets, `cell ${c},${r} lists glyph ${n}`).toBe(true);
        }
      }
    }
    // the cells are about an em, and a dense sheet's cell lists a handful
    expect(cell).toBe(L.em);
    expect(run.grid.entries / (cols * rows)).toBeLessThan(8);
  });

  it("is deterministic: the same layout, atlas and options give the same bytes", () => {
    const again = handRun(lay(text), face.atlas);
    expect(Buffer.from(again.data.buffer).equals(Buffer.from(run.data.buffer))).toBe(true);
  });

  it("packs place, turn, size and pressure: the atlas rect's corners, mapped into the sheet, are the glyph's box", () => {
    L.glyphs.forEach((g, n) => {
      const [box, g1, g2, g3] = glyphAt(run, n) as [number[], number[], number[], number[]];
      const size = L.em * g.scale;
      const k = face.atlas.em / size;
      expect(g1[0]).toBeCloseTo(g.x, 4);
      expect(g1[1]).toBeCloseTo(g.y, 4);
      expect(g1[2]).toBeCloseTo(Math.cos(g.rot) * k, 4);
      expect(g1[3]).toBeCloseTo(Math.sin(g.rot) * k, 4);
      expect(g2[2]).toBeCloseTo(size, 4);
      expect(g2[3]).toBeCloseTo(g.press, 5);
      const ga = face.atlas.glyphs[String(g.ch.codePointAt(0))];
      expect(g2[0]).toBeCloseTo((ga?.rect?.[0] ?? 0) + (ga?.origin?.[0] ?? 0), 4);
      expect(g3[2] as number - (g3[0] as number)).toBeCloseTo(ga?.rect?.[2] ?? 0, 4);
      const c = Math.cos(g.rot);
      const s = Math.sin(g.rot);
      const xs = [g3[0], g3[2]].flatMap((tx) => [g3[1], g3[3]].map((ty) => g.x + (c * (tx as number) - s * (ty as number)) / k));
      const ys = [g3[0], g3[2]].flatMap((tx) => [g3[1], g3[3]].map((ty) => g.y + (s * (tx as number) + c * (ty as number)) / k));
      expect(box[0]).toBeCloseTo(Math.min(...xs) - 1e-3, 3);
      expect(box[3]).toBeCloseTo(Math.max(...ys) + 1e-3, 3);
    });
  });

  it("keeps each moment from the run's epoch, a glyph written before as the far past, and the epoch as penNow splits the clock", () => {
    const moments = L.glyphs.map((_, j) => (j === 2 ? { start: 86_400_123.5, dur: 150 } : WRITTEN));
    const at = handRun(L, face.atlas, { moments, epoch: 86_400_100, pens: L.glyphs.map((_, j) => (j === 2 ? 3 : 0)) });
    expect(vec(at, 2).slice(2)).toEqual(penNow(86_400_100).map(Math.fround));
    expect(penNow(86_400_100)).toEqual([86_400, 100]);
    expect(glyphAt(at, 2)[4]?.slice(0, 2)).toEqual([Math.fround(23.5), 150]);
    expect(glyphAt(at, 2)[4]?.[3]).toBe(3);
    expect(glyphAt(at, 0)[4]?.[0]).toBe(Math.fround(HAND_RUN.before));
    expect(glyphAt(at, 0)[4]?.[3]).toBe(0);
    // the edge's range is the face's, the pen's spread and its alpha the options'
    expect(vec(handRun(L, face.atlas, { bleed: 0.3 }), 3)).toEqual([0.5, Math.fround(0.3), Math.fround(0.45), 0]);
  });

  it("names the glyphs the face lacks and leaves them out (the sheet keeps its raster road); the inkless space is neither", () => {
    const withQ = lay("lo q x");
    const r = handRun(withQ, face.atlas);
    const q = withQ.glyphs.findIndex((g) => g.ch === "q");
    expect(r.missing).toEqual([q]);
    expect(r.glyphs).toBe(withQ.glyphs.length - 1);
    expect(handRun(lay("lo x"), face.atlas).missing).toEqual([]);
  });

  it("an empty sheet is a header and an empty grid: every point lies outside its box", () => {
    const r = handRun(lay(""), face.atlas);
    expect(r.glyphs).toBe(0);
    expect(r.grid.x1).toBeLessThan(r.grid.x0);
    expect(r.length).toBe(HAND_RUN.header + 1);
  });

  it("measures: a 2,000-glyph sheet's run built (the layout already laid) — and its size", () => {
    const words = "lol xo. lox ool lx. xx lo";
    let long = "";
    while (long.length < 2800) long += `${words} `;
    const big = layoutText(long, { w: 1400, h: 2600 }, HAND, metrics, 9);
    const n = big.glyphs.length;
    expect(n).toBeGreaterThanOrEqual(2000);
    handRun(big, face.atlas);   // warm
    const times: number[] = [];
    let r: HandRun | undefined;
    for (let i = 0; i < 9; i++) { const t0 = performance.now(); r = handRun(big, face.atlas); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    const built = r as HandRun;
    console.log(`[hand-run] ${n} glyphs: built in ${times[4]?.toFixed(2)} ms (median of 9; fastest ${times[0]?.toFixed(2)}) — ${built.length} vec4s (${((built.length * 16) / 1024).toFixed(0)} KB), ${built.grid.cols}×${built.grid.rows} cells, ${built.grid.entries} entries (${(built.grid.entries / n).toFixed(2)} a glyph)`);
    expect(times[4]).toBeLessThan(250);
  });

  it("measures the same on the desk's own face, Caveat 500 as baked (apps/desk/assets/hand): a 2,000-glyph sheet's run, beside its layout", () => {
    const dir = resolve(import.meta.dirname, "../../../apps/desk/assets/hand");
    const read = readHandAtlas(JSON.parse(readFileSync(resolve(dir, "caveat-500.hand.json"), "utf8")), new Uint8Array(readFileSync(resolve(dir, "caveat-500.hand.bin"))));
    if ("error" in read) throw new Error(read.error);
    const m = handMetricsOf(read);
    const words = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! ";
    let long = "";
    while (long.length < 2600) long += words;
    const lay = (): HandLayout => layoutText(long, { w: 1400, h: 2600 }, HAND, m, 9);
    const big = lay();
    expect(big.glyphs.length).toBeGreaterThanOrEqual(2000);
    const median = (f: () => unknown): number => { f(); const t: number[] = []; for (let i = 0; i < 9; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); } return t.sort((a, b) => a - b)[4] as number; };
    const run = handRun(big, read);
    expect(run.missing).toEqual([]);
    const built = median(() => handRun(big, read));
    console.log(`[hand-run] Caveat 500, ${big.glyphs.length} glyphs: the run built in ${built.toFixed(2)} ms (median of 9), its layout in ${median(lay).toFixed(2)} ms — ${run.length} vec4s (${((run.length * 16) / 1024).toFixed(0)} KB), ${(run.grid.entries / big.glyphs.length).toFixed(2)} entries a glyph`);
    expect(built).toBeLessThan(250);
  });
});

describe("the hand piece's WGSL keeps the run's numbers (petition I59)", () => {
  const wgsl = readFileSync(resolve(import.meta.dirname, "../shaders/kit/hand.wgsl"), "utf8");
  const constOf = (name: string): string => /^const (\w+): \w+ = ([^;]+);/m.exec(wgsl.split("\n").find((l) => l.startsWith(`const ${name}:`)) ?? "")?.[2] ?? "";

  it("its row, header, glyph, edge and wet constants are HAND_RUN's", () => {
    expect(constOf("HAND_ROW")).toBe(`${HAND_RUN.row}u`);
    expect(constOf("HAND_HEADER")).toBe(`${HAND_RUN.header}u`);
    expect(constOf("HAND_GLYPH")).toBe(`${HAND_RUN.glyph}u`);
    expect(constOf("HAND_EDGE")).toBe("128.0 / 255.0");
    expect(Number(constOf("HAND_WET"))).toBe(HAND_RUN.wet);
    // the pen's bits: what `hand_ink` masks is HAND_RUN's
    expect(wgsl).toContain(`u32(g4.w) & ${(1 << HAND_RUN.penBits) - 1}u`);
  });

  it("is a kit piece by name: pure (no binding), labelled by its file, after the kind's structs", () => {
    const c = kitWgsl(["hand"], { entry: { label: "own.wgsl", text: "@fragment fn fs() {}" } });
    expect((c.modules ?? []).map((m) => m.label)).toEqual(["kit/hand.wgsl"]);
    expect(c.modules?.[0]?.text).toBe(wgsl);
    expect(() => compose(c)).not.toThrow();
  });
});

describe("the atlas's mips (petition I59): made on the CPU, every level exactly half the one above", () => {
  it("pads level 0 to a multiple of 2^(levels − 1), the atlas at its top-left, and boxes each level from the one above, rounded", () => {
    const chain = handMips(face.atlas);
    expect(chain.length).toBe(handLevels(face.atlas));
    expect(handLevels({ em: 64, width: 520, height: 512 })).toBe(5);
    expect(handLevels(face.atlas)).toBe(4);   // 32 texels an em: 32, 16, 8, 4
    const top = chain[0] as (typeof chain)[number];
    const pad = 2 ** (chain.length - 1);
    expect(top.w % pad).toBe(0);
    expect(top.h % pad).toBe(0);
    for (let y = 0; y < face.atlas.height; y++) {
      expect(Buffer.from(top.bytes.subarray(y * top.w * 2, y * top.w * 2 + face.atlas.width * 2)).equals(Buffer.from(face.atlas.bin.subarray(y * face.atlas.width * 2, (y + 1) * face.atlas.width * 2)))).toBe(true);
    }
    for (let l = 1; l < chain.length; l++) {
      const up = chain[l - 1] as (typeof chain)[number];
      const m = chain[l] as (typeof chain)[number];
      expect([m.w * 2, m.h * 2]).toEqual([up.w, up.h]);
      for (const [x, y] of [[0, 0], [m.w >> 1, m.h >> 1], [m.w - 1, m.h - 1]] as const) {
        for (let ch = 0; ch < 2; ch++) {
          const at = (xx: number, yy: number): number => up.bytes[(yy * up.w + xx) * 2 + ch] as number;
          const want = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1) + 2) >> 2;
          expect(m.bytes[(y * m.w + x) * 2 + ch]).toBe(want);
        }
      }
    }
    expect(handMips(face.atlas)).toBe(chain);   // made once per atlas
  });
});
