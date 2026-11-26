// A FACE OF THE TESTS' OWN in `ice-hand/1` (petition I59): a few glyphs drawn by a ROUND NIB along straight strokes, so every
// texel's distance to the ink and the moment the nib first covers it are known exactly — what the run, the read and its CPU twin
// are held to without the baker. The format is the kit's (kit/hand-atlas.ts): R the signed distance (128 = the edge, `range` em
// across 0..255), G the arrival (0..1 along the glyph's whole path — its strokes, a lift between each two, a dot's tap — the FIRST
// moment the nib covers the texel; a texel the nib never covers takes the arrival of the nearest point of the path). Read back
// through the kit's own reader, so a fixture the reader would refuse fails here first.

import type { CardMaterial, KindProgram } from "../src/kind";
import { HAND_ATLAS_FORMAT, HAND_PEN_DOT, HAND_PEN_LIFT, type HandAtlas, readHandAtlas } from "../src/kit/hand-atlas";
import { handBindings } from "../src/kit/hand-gpu";
import { kitWgsl } from "../src/kit/wgsl";

/**
 * A kind's card material that writes with the pen (the note in P3, a plugin's pad alike): the kit's view and hand pieces, its three
 * pen bindings under its OWN prefix (`handBindings`) beside a uniform of its own, and a fragment that makes the one call over them.
 */
export function penMaterial(name: string): CardMaterial {
  return {
    shaders: () => kitWgsl(["view", "hand"], {
      entry: {
        label: `${name}/card.wgsl`,
        text: `fn ${name}_quad(slot: u32, vid: u32) -> vec4f { return vec4f(2.0, 2.0, 2.0, 1.0); }\nfn ${name}_frag(slot: u32, clip: vec4f) -> vec4f {\n  let ink = hand_ink(${name}_hand_runs, ${name}_hand_atlas, ${name}_hand_samp, slot, clip.xy, ${name}_k.xy, ${name}_k.z);\n  return vec4f(ink.cover) * u.view.w;\n}`,
      },
    }),
    bindings: [{ wgsl: `var<uniform> ${name}_k: vec4f`, entry: { stages: ["fragment"], buffer: "uniform" } }, ...handBindings(name)],
    quad: `${name}_quad`,
    frag: `${name}_frag`,
  };
}
/** A kind's program carrying `penMaterial(name)` (its pass is never made). */
export const penProgram = (name: string): KindProgram => ({ name, stratum: "things", card: penMaterial(name), create: async () => { throw new Error("not made"); } });

export interface FixtureGlyph {
  readonly ch: string;
  /** em */
  readonly advance: number;
  /** The nib's radius, em. */
  readonly nib: number;
  /** The pen's path, em from the origin, y down: each stroke `[x0, y0, x1, y1, …]`; one point is a dot. */
  readonly strokes: readonly (readonly number[])[];
}

/** A ring of `n` segments around (cx, cy), radius r, from its top, counterclockwise as the eye sees it (y down), closed. */
function ring(cx: number, cy: number, r: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 - (2 * Math.PI * i) / n; out.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return out;
}

/** The fixture's glyphs: a bar, a ring, a cross (two strokes that cross), a dot; the space is inkless. */
export const FIXTURE_GLYPHS: readonly FixtureGlyph[] = [
  { ch: "l", advance: 0.36, nib: 0.07, strokes: [[0.18, -0.72, 0.18, 0]] },
  { ch: "o", advance: 0.56, nib: 0.06, strokes: [ring(0.28, -0.24, 0.2, 24)] },
  { ch: "x", advance: 0.5, nib: 0.06, strokes: [[0.06, -0.46, 0.44, 0], [0.44, -0.46, 0.06, 0]] },
  { ch: ".", advance: 0.22, nib: 0.07, strokes: [[0.11, -0.07]] },
];

/** A stroke's segments' lengths (em); a dot's path is `HAND_PEN_DOT`. */
const strokeLength = (st: readonly number[]): number => {
  if (st.length === 2) return HAND_PEN_DOT;
  let L = 0;
  for (let i = 2; i < st.length; i += 2) L += Math.hypot((st[i] as number) - (st[i - 2] as number), (st[i + 1] as number) - (st[i - 1] as number));
  return L;
};

/** The pen's whole path through a glyph, em: its strokes, and a lift between each two. */
export const pathLength = (g: FixtureGlyph): number => g.strokes.reduce((s, st) => s + strokeLength(st), 0) + HAND_PEN_LIFT * Math.max(0, g.strokes.length - 1);

/** Where along its path (em) the nib first covers (x, y) em — or, never covering it, the nearest point of the path; and the distance to the ink (em, inside positive). */
export function nibAt(g: FixtureGlyph, x: number, y: number): { readonly first: number; readonly inside: number } {
  let from = 0;
  let first = Number.POSITIVE_INFINITY;
  let near = Number.POSITIVE_INFINITY;
  let nearAt = 0;
  let dist = Number.POSITIVE_INFINITY;
  g.strokes.forEach((st, k) => {
    if (k > 0) from += HAND_PEN_LIFT;
    if (st.length === 2) {
      const d = Math.hypot(x - (st[0] as number), y - (st[1] as number));
      dist = Math.min(dist, d);
      if (d <= g.nib && first === Number.POSITIVE_INFINITY) first = from + HAND_PEN_DOT * Math.min(1, d / g.nib);
      if (d < near) { near = d; nearAt = from; }
      from += HAND_PEN_DOT;
      return;
    }
    for (let i = 2; i < st.length; i += 2) {
      const ax = st[i - 2] as number;
      const ay = st[i - 1] as number;
      const bx = st[i] as number;
      const by = st[i + 1] as number;
      const L = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / L;
      const uy = (by - ay) / L;
      const proj = (x - ax) * ux + (y - ay) * uy;
      const perp2 = (x - ax) ** 2 + (y - ay) ** 2 - proj * proj;
      const c = Math.min(L, Math.max(0, proj));
      const d = Math.hypot(x - (ax + ux * c), y - (ay + uy * c));
      dist = Math.min(dist, d);
      if (d < near) { near = d; nearAt = from + c; }
      if (first === Number.POSITIVE_INFINITY && perp2 <= g.nib * g.nib) {
        const h = Math.sqrt(Math.max(0, g.nib * g.nib - perp2));
        const s0 = Math.max(0, proj - h);
        if (s0 <= Math.min(L, proj + h)) first = from + s0;
      }
      from += L;
    }
  });
  return { first: first === Number.POSITIVE_INFINITY ? nearAt : first, inside: g.nib - dist };
}

export interface Fixture {
  readonly json: Record<string, unknown>;
  readonly bin: Uint8Array;
  readonly atlas: HandAtlas;
  /** The fixture's glyphs by character. */
  readonly glyphs: ReadonlyMap<string, FixtureGlyph>;
}

/**
 * The fixture face: `em` texels an em (32), `range` em across the edge byte (0.5), each glyph its ink's box and half the range
 * around it; `glyphs` its glyphs (FIXTURE_GLYPHS); `whole` — each rect laid as the bake lays one (bake/derive.ts `glyphField`): the
 * ink's box in whole texels and the margin round it, so the pen's origin is whole texels, and outside the rect for a glyph whose
 * ink does not reach its origin.
 */
export function fixtureFace(opts: { readonly em?: number; readonly range?: number; readonly glyphs?: readonly FixtureGlyph[]; readonly whole?: boolean } = {}): Fixture {
  const em = opts.em ?? 32;
  const range = opts.range ?? 0.5;
  const margin = range / 2;
  const set = opts.glyphs ?? FIXTURE_GLYPHS;
  const placed: { g: FixtureGlyph; rect: [number, number, number, number]; origin: [number, number] }[] = [];
  let x = 1;
  let tall = 0;
  for (const g of set) {
    const xs = g.strokes.flatMap((st) => st.filter((_, i) => i % 2 === 0));
    const ys = g.strokes.flatMap((st) => st.filter((_, i) => i % 2 === 1));
    if (opts.whole === true) {
      const pad = Math.round(margin * em);
      const left = Math.floor((Math.min(...xs) - g.nib) * em) - pad;
      const top = Math.floor((Math.min(...ys) - g.nib) * em) - pad;
      const w = Math.ceil((Math.max(...xs) + g.nib) * em) + pad - left;
      const h = Math.ceil((Math.max(...ys) + g.nib) * em) + pad - top;
      placed.push({ g, rect: [x, 1, w, h], origin: [-left, -top] });
      x += w + 2;
      tall = Math.max(tall, h);
      continue;
    }
    const bx0 = Math.min(...xs) - g.nib - margin;
    const by0 = Math.min(...ys) - g.nib - margin;
    const w = Math.ceil((Math.max(...xs) + g.nib + margin - bx0) * em);
    const h = Math.ceil((Math.max(...ys) + g.nib + margin - by0) * em);
    placed.push({ g, rect: [x, 1, w, h], origin: [-bx0 * em, -by0 * em] });
    x += w + 2;
    tall = Math.max(tall, h);
  }
  const width = x + 1;
  const height = tall + 2;
  const bin = new Uint8Array(width * height * 2);
  const glyphs: Record<string, unknown> = { "32": { advance: 0.25, length: 0, strokes: [] } };
  for (const { g, rect, origin } of placed) {
    const total = pathLength(g);
    for (let j = 0; j < rect[3]; j++) {
      for (let i = 0; i < rect[2]; i++) {
        const ex = (i + 0.5 - origin[0]) / em;
        const ey = (j + 0.5 - origin[1]) / em;
        const n = nibAt(g, ex, ey);
        const o = ((rect[1] + j) * width + rect[0] + i) * 2;
        bin[o] = Math.min(255, Math.max(0, Math.round(128 + (n.inside / range) * 255)));
        bin[o + 1] = Math.min(255, Math.max(0, Math.round((n.first / total) * 255)));
      }
    }
    glyphs[String(g.ch.codePointAt(0))] = { advance: g.advance, rect, origin, length: total, strokes: g.strokes.map((s) => [...s]) };
  }
  const json = {
    format: HAND_ATLAS_FORMAT, family: "Fixture", weight: 400, em, range, ascent: 0.8, descent: 0.3, width, height, glyphs,
    kerning: {}, source: { file: "fixture", sha256: "0" }, corrections: [],
  };
  const read = readHandAtlas(json, bin);
  if ("error" in read) throw new Error(`the fixture face is refused: ${read.error}`);
  return { json, bin, atlas: read, glyphs: new Map(set.map((g) => [g.ch, g])) };
}
