// THE GLYPH RUN (petition I59 — the desk's pen, hand-draw A): a sheet's writing as a few numbers per glyph in one blob, read by
// the kit's `hand` WGSL piece in the kind's own fragment shader (shaders/kit/hand.wgsl — `hand_ink`), so no kind keeps a bitmap
// per object or a raster per zoom rung. Pure and deterministic: a function of the layout (kit/text.ts `layoutText`, unchanged),
// the face's atlas (kit/hand-atlas.ts, `ice-hand/1`) and the pen's moments (kit/pen-clock.ts) — no GPU. This module is also the
// read's CPU TWIN (`handInkAt` — the same arithmetic over the same blob and the same mip levels, for tests and hit tests) and the
// atlas's mip chain (`handMips`, made on the CPU so every host holds the same bytes and the twin samples what the GPU samples).
//
// A RUN is vec4s (`Float32Array`, four floats each) — the texels of a kind's run store (kit/hand-gpu.ts `HandRuns`), read at the
// same offsets by the WGSL. Units are the LAYOUT's (note units from the sheet's top-left, y down); times ms; atlas positions texels.
//   header (HAND_RUN.header vec4s at the run's base)
//     h0  x0 y0 x1 y1             the grid's box — no glyph's ink reaches outside it
//     h1  1/cell cols rows n      the grid: its cell's side (inverted), its columns and rows; the glyphs
//     h2  listAt glyphsAt s ms    where the list and the glyphs start (vec4s from the base); the run's EPOCH as `penNow` splits it
//     h3  range bleed alpha −     the em the edge byte spans (the atlas's `range`), the pen's spread (units) and its alpha
//   the grid's cells, two a vec4: `offset count` into the list (offset from the list's start)
//   the list: glyph indices (into the glyphs below), four a vec4
//   the glyphs, HAND_RUN.glyph vec4s each:
//     g0  x0 y0 x1 y1             its box: the atlas rect's four corners as laid (turned, scaled, jittered) — the one-load reject
//     g1  ox oy a b               the pen's origin (units) and the turned scale: texel = A + (a·dx + b·dy, a·dy − b·dx)
//     g2  ax ay size press        A — the origin's texel in the atlas; units per em; the pen's pressure
//     g3  x0 y0 x1 y1             the atlas rect, texels from the origin — the exact turned box a sample must lie in
//     g4  start dur length pen    its moment (ms from the epoch; HAND_RUN.before — written before), how long (ms), the pen's path
//                                 (units), and its pen: bits 0–3 (0 = the sheet's own); bits 4–23 kept for the marks and a re-ink

import { glyphOf, HAND_ATLAS_EDGE, type HandAtlas } from "./hand-atlas";
import type { PenMoment } from "./pen-clock";
import type { HandLayout } from "./text";

/** A run's shape — the counts `hand.wgsl` reads it by (its `HAND_*` constants are the same numbers). */
export const HAND_RUN = {
  /** vec4s of the header at a run's base. */
  header: 4,
  /** vec4s a glyph. */
  glyph: 5,
  /** Texels a row of a run store: a run's vec4 `i` lives at texel (i & 1023, i >> 10). */
  row: 1024,
  /** The start of a glyph written before (finite: WGSL may assume no infinities). */
  before: -1e30,
  /** The pen's bits of a glyph's last float (0 = the sheet's own); the bits above are kept for the marks and a re-ink. */
  penBits: 4,
  /** The wet ink's reach behind the nib, em of path (the spike's 26 px at 24). */
  wet: 1.1,
  /** The grid's most cells: a wider box takes wider cells. */
  maxCells: 1 << 16,
} as const;

/** The edge byte as unorm: `(R − EDGE) · range` em inside. */
const EDGE = HAND_ATLAS_EDGE / 255;

/** The desk's clock (ms) as a pair, `[whole seconds, ms]` — how `now` and a run's epoch reach the WGSL (f32 each, exact where it matters). */
export function penNow(ms: number): readonly [number, number] {
  const s = Math.floor(ms / 1000);
  return [s, ms - s * 1000];
}

/** The product's plain ease (cubic-bezier(.25, .1, .25, 1)) — the pen's progress through a glyph; `hand_ease` is the same five steps. */
export function handEase(x: number): number {
  const s = Math.min(1, Math.max(0, x));
  let t = s;
  for (let i = 0; i < 5; i++) {
    const f = ((t - 0.75) * t + 0.75) * t - s;
    const df = (3 * t - 1.5) * t + 0.75;
    t = Math.min(1, Math.max(0, t - f / df));
  }
  return ((-1.7 * t + 2.4) * t + 0.3) * t;
}

export interface HandRunOptions {
  /** Each glyph's moment, by its index in `layout.glyphs` (the clock's `look`); absent — every glyph written before. */
  readonly moments?: readonly PenMoment[];
  /** The run's epoch, ms on the desk's clock: the moments are kept from it (default 0). Build at the look's `now`. */
  readonly epoch?: number;
  /** Each glyph's pen, by its index in `layout.glyphs`: 0 = the sheet's own (the default), 1–15 the kind's. */
  readonly pens?: ArrayLike<number>;
  /** The pen's spread, units: the edge widened by half of it at `bleedAlpha` (default 0 — none; the note's raster lays 0.3). */
  readonly bleed?: number;
  /** The spread's presence, 0..1 (default 0.45 — the note's raster's). */
  readonly bleedAlpha?: number;
  /** The grid's cell, units (default: the layout's em). */
  readonly cell?: number;
}

/** A run: its vec4s and what it was built from. */
export interface HandRun {
  /** `length × 4` floats — what a run store writes and `hand_ink` reads. */
  readonly data: Float32Array;
  /** vec4s. */
  readonly length: number;
  /** The glyphs in the run: the layout's glyphs with ink the atlas holds. */
  readonly glyphs: number;
  /** The layout's glyphs the atlas does NOT hold (indices into `layout.glyphs`): not empty — the sheet keeps its raster road. */
  readonly missing: readonly number[];
  /** The grid: its box (units — `x1 < x0` when the run lays no ink), its cell's side, columns and rows, and the list's entries. */
  readonly grid: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly cell: number; readonly cols: number; readonly rows: number; readonly entries: number };
  /** The epoch it was built at, ms. */
  readonly epoch: number;
}

interface Item {
  readonly box: readonly [number, number, number, number];
  readonly g1: readonly [number, number, number, number];
  readonly g2: readonly [number, number, number, number];
  readonly g3: readonly [number, number, number, number];
  readonly g4: readonly [number, number, number, number];
}

/** A cell's slack: a box meets the cells within this of its edge, so f32's rounding of a point never finds a cell that lists it not. */
const SLACK = 1e-3;

/**
 * A sheet's GLYPH RUN: per glyph its place, turn, size and pressure, its rect in the atlas, the pen's moment and its pen, and a
 * grid of cells about an em over the writing's box listing the glyphs each cell can meet. The same layout, atlas and options give
 * the same bytes.
 */
export function handRun(layout: HandLayout, atlas: HandAtlas, opts: HandRunOptions = {}): HandRun {
  const epoch = opts.epoch ?? 0;
  const items: Item[] = [];
  const missing: number[] = [];
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  layout.glyphs.forEach((g, j) => {
    const a = glyphOf(atlas, g.ch.codePointAt(0) ?? 0);
    if (a === undefined) { missing.push(j); return; }
    if (a.rect === undefined || a.origin === undefined) return;   // inkless: an advance, nothing to draw
    const size = layout.em * g.scale;
    const k = atlas.em / size;
    const c = Math.cos(g.rot);
    const s = Math.sin(g.rot);
    const [rx, ry, rw, rh] = a.rect;
    const [ox, oy] = a.origin;
    const lx0 = -ox;
    const ly0 = -oy;
    const lx1 = rw - ox;
    const ly1 = rh - oy;
    // the rect's corners as laid: d = R(rot) · τ / k (canvas's rotate: x' = c·x − s·y, y' = s·x + c·y)
    let bx0 = Number.POSITIVE_INFINITY;
    let by0 = Number.POSITIVE_INFINITY;
    let bx1 = Number.NEGATIVE_INFINITY;
    let by1 = Number.NEGATIVE_INFINITY;
    for (const [tx, ty] of [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]] as const) {
      const px = g.x + (c * tx - s * ty) / k;
      const py = g.y + (s * tx + c * ty) / k;
      bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py);
    }
    x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
    const m = opts.moments?.[j];
    const start = m === undefined || !(m.start > Number.NEGATIVE_INFINITY) ? HAND_RUN.before : m.start - epoch;
    const pen = Math.max(0, Math.min(15, Math.trunc(opts.pens?.[j] ?? 0)));
    items.push({
      box: [bx0, by0, bx1, by1],
      g1: [g.x, g.y, c * k, s * k],
      g2: [rx + ox, ry + oy, size, g.press],
      g3: [lx0, ly0, lx1, ly1],
      g4: [start, m === undefined ? 0 : Math.max(0, m.dur), a.length * size, pen],
    });
  });
  const empty = items.length === 0;
  if (empty) { x0 = 0; y0 = 0; x1 = -1; y1 = -1; }
  // the grid: cells about an em, widened when the box would hold more than the most
  let cell = Math.max(opts.cell ?? layout.em, 1e-3);
  const span = (side: number): number => (empty ? 1 : Math.max(1, Math.ceil((side + SLACK) / cell)));
  while (span(x1 - x0) * span(y1 - y0) > HAND_RUN.maxCells) cell *= 2;
  const cols = span(x1 - x0);
  const rows = span(y1 - y0);
  const cells = cols * rows;
  const inv = Math.fround(1 / cell);
  const fx0 = Math.fround(x0);
  const fy0 = Math.fround(y0);
  const cellOf = (v: number, o: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor((v - o) * inv)));
  const count = new Uint32Array(cells);
  const reach = items.map((it) => {
    const c0 = cellOf(it.box[0] - SLACK, fx0, cols);
    const c1 = cellOf(it.box[2] + SLACK, fx0, cols);
    const r0 = cellOf(it.box[1] - SLACK, fy0, rows);
    const r1 = cellOf(it.box[3] + SLACK, fy0, rows);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * cols + c] = (count[r * cols + c] as number) + 1;
    return [c0, c1, r0, r1] as const;
  });
  const offset = new Uint32Array(cells);
  let entries = 0;
  for (let i = 0; i < cells; i++) { offset[i] = entries; entries += count[i] as number; }
  const list = new Uint32Array(entries);
  const fill = offset.slice();
  reach.forEach(([c0, c1, r0, r1], n) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const i = r * cols + c; list[fill[i] as number] = n; fill[i] = (fill[i] as number) + 1; }
  });
  const listAt = HAND_RUN.header + Math.ceil(cells / 2);
  const glyphsAt = listAt + Math.ceil(entries / 4);
  const length = glyphsAt + HAND_RUN.glyph * items.length;
  const data = new Float32Array(length * 4);
  const [es, ems] = penNow(epoch);
  data.set([x0, y0, x1, y1, inv, cols, rows, items.length, listAt, glyphsAt, es, ems, atlas.range, Math.max(0, opts.bleed ?? 0), opts.bleedAlpha ?? 0.45, 0], 0);
  for (let i = 0; i < cells; i++) { data[4 * HAND_RUN.header + 2 * i] = offset[i] as number; data[4 * HAND_RUN.header + 2 * i + 1] = count[i] as number; }
  for (let i = 0; i < entries; i++) data[4 * listAt + i] = list[i] as number;
  items.forEach((it, n) => {
    const at = 4 * (glyphsAt + HAND_RUN.glyph * n);
    data.set([it.box[0] - SLACK, it.box[1] - SLACK, it.box[2] + SLACK, it.box[3] + SLACK], at);
    data.set(it.g1, at + 4);
    data.set(it.g2, at + 8);
    data.set(it.g3, at + 12);
    data.set(it.g4, at + 16);
  });
  return { data, length, glyphs: items.length, missing, grid: { x0, y0, x1, y1, cell, cols, rows, entries }, epoch };
}

// ---------------------------------------------------------------- the atlas's mips (the GPU's levels and the twin's)

/** One level of an atlas's chain: RG8 rows, `w × h × 2` bytes. */
export interface HandMip {
  readonly w: number;
  readonly h: number;
  readonly bytes: Uint8Array;
}

/**
 * The coarsest level's texel, atlas texels (whatever the em): the pad the bake keeps round each ink (bake/derive.ts `PAD_TEXELS`,
 * which test/hand-run.test.ts holds it to). `hand_ink` keeps each sample half a texel of the coarser level it reads inside its own
 * glyph's rect, so no read reaches more than one such texel past the rect — short of a neighbour's ink, which the bake keeps a pad
 * and its one-texel gutter away. A coarser level would reach into it. And its half (4) is within the ±6 texels the edge byte spans
 * before it saturates: a block across an edge averages true distances, so the edge stays where it is.
 */
const COARSEST_TEXEL = 8;

/** How many levels an atlas's chain has: down to a texel `COARSEST_TEXEL` atlas texels wide — four — or the atlas's own size. */
export const handLevels = (atlas: Pick<HandAtlas, "width" | "height">): number => {
  const bySize = Math.floor(Math.log2(Math.max(atlas.width, atlas.height, 1))) + 1;
  return Math.max(1, Math.min(Math.log2(COARSEST_TEXEL) + 1, bySize));
};

const chains = new WeakMap<HandAtlas, readonly HandMip[]>();

/**
 * The atlas's mip chain, made once per atlas: level 0 the atlas's texels at the top-left of a size padded to a multiple of
 * 2^(levels − 1) (so every level is exactly half the one above and a uv is the same place at every level), each further level a
 * 2×2 box of the one above, rounded — the same bytes on every host. Both channels box-filter. The distance stays a distance: the
 * edge byte is linear in it within ±6 texels of the edge, a block no coarser than 8 texels across an edge lies within that, and
 * where the edge is straight across a block the average IS the distance at its centre — a stroke thinner than a block fades, as a
 * stroke thinner than a device px should. The arrival stays a timing field: the bake fills it over the whole rect (no texel 0 next
 * to the ink), so a block's average is the nearby moments blurred. A block that straddles two rects mixes them; `hand_ink`'s
 * sample, kept inside its own rect, reads none of a neighbour up to level 2, and at level 3 never its ink — at most the outer edge
 * of its field (on the desk's three faces, a glyph's coverage moves by under 0.011 with every other glyph erased).
 */
export function handMips(atlas: HandAtlas): readonly HandMip[] {
  const had = chains.get(atlas);
  if (had !== undefined) return had;
  const levels = handLevels(atlas);
  const pad = 2 ** (levels - 1);
  const W = Math.ceil(atlas.width / pad) * pad;
  const H = Math.ceil(atlas.height / pad) * pad;
  const top = new Uint8Array(W * H * 2);
  for (let y = 0; y < atlas.height; y++) top.set(atlas.bin.subarray(y * atlas.width * 2, (y + 1) * atlas.width * 2), y * W * 2);
  const out: HandMip[] = [{ w: W, h: H, bytes: top }];
  for (let l = 1; l < levels; l++) {
    const up = out[l - 1] as HandMip;
    const w = up.w >> 1;
    const h = up.h >> 1;
    const b = new Uint8Array(w * h * 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = ((2 * y) * up.w + 2 * x) * 2;
        const c = a + up.w * 2;
        for (let ch = 0; ch < 2; ch++) b[(y * w + x) * 2 + ch] = ((up.bytes[a + ch] as number) + (up.bytes[a + 2 + ch] as number) + (up.bytes[c + ch] as number) + (up.bytes[c + 2 + ch] as number) + 2) >> 2;
      }
    }
    out.push({ w, h, bytes: b });
  }
  chains.set(atlas, out);
  return out;
}

/** Bilinear at a uv on one level, clamped to its edge, texel centres at +½ — both channels, 0..1. */
function bilinear(m: HandMip, u: number, v: number): readonly [number, number] {
  const x = u * m.w - 0.5;
  const y = v * m.h - 0.5;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const cx = (n: number): number => Math.min(m.w - 1, Math.max(0, n));
  const cy = (n: number): number => Math.min(m.h - 1, Math.max(0, n));
  const at = (xx: number, yy: number, ch: number): number => (m.bytes[(cy(yy) * m.w + cx(xx)) * 2 + ch] as number) / 255;
  const ch = (k: number): number => (at(i, j, k) * (1 - fx) + at(i + 1, j, k) * fx) * (1 - fy) + (at(i, j + 1, k) * (1 - fx) + at(i + 1, j + 1, k) * fx) * fy;
  return [ch(0), ch(1)];
}

/** Trilinear at a uv and a LOD — what a linear-mip sampler's `textureSampleLevel` answers. */
function trilinear(chain: readonly HandMip[], u: number, v: number, lod: number): readonly [number, number] {
  const l0 = Math.floor(lod);
  const l1 = Math.min(l0 + 1, chain.length - 1);
  const f = lod - l0;
  const a = bilinear(chain[l0] as HandMip, u, v);
  if (f <= 0 || l1 === l0) return a;
  const b = bilinear(chain[l1] as HandMip, u, v);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// ---------------------------------------------------------------- the CPU twin of `hand_ink`

/** What the pen laid at a point (`hand_ink`'s `HandInk`): coverage, the fresh ink, the pen, and what the read took. */
export interface HandInkAt {
  /** The ink's coverage, 0..1 — its pressure in it. */
  readonly cover: number;
  /** How fresh that ink is: 1 just behind the nib, 0 dry — the freshness of the glyph that laid the most (a kind weighs it by `cover`). */
  readonly wet: number;
  /** The pen of the glyph that laid the most (0 = the sheet's own). */
  readonly pen: number;
  /** Atlas samples the read took (none on blank paper). */
  readonly samples: number;
  /** Run texels the read loaded. */
  readonly loads: number;
}

/**
 * `hand_ink` on the CPU — the same arithmetic over the same vec4s and the same mip levels (`handMips`): what the pen laid at
 * `(x, y)` (the run's units) at `now` (ms on the desk's clock), `aa` units a device pixel. For tests and hit tests.
 */
export function handInkAt(run: HandRun | Float32Array, atlas: HandAtlas, x: number, y: number, now: number, aa: number): HandInkAt {
  const d = run instanceof Float32Array ? run : run.data;
  const v = (i: number, c: number): number => d[4 * i + c] as number;
  let loads = 1;
  const none = { cover: 0, wet: 0, pen: 0, samples: 0, loads };
  if (x < v(0, 0) || y < v(0, 1) || x >= v(0, 2) || y >= v(0, 3)) return none;
  const inv = v(1, 0);
  const cols = v(1, 1);
  const rows = v(1, 2);
  const cx = Math.min(Math.floor((x - v(0, 0)) * inv), cols - 1);
  const cy = Math.min(Math.floor((y - v(0, 1)) * inv), rows - 1);
  const c = cy * cols + cx;
  const first = v(HAND_RUN.header + (c >> 1), (c & 1) * 2);
  const n = v(HAND_RUN.header + (c >> 1), (c & 1) * 2 + 1);
  loads = 3;
  if (n === 0) return { ...none, loads };
  loads += 2;
  const listAt = v(2, 0);
  const glyphsAt = v(2, 1);
  const t = now - (v(2, 2) * 1000 + v(2, 3));
  const range = v(3, 0);
  const bleed = v(3, 1);
  const bleedA = v(3, 2);
  const chain = handMips(atlas);
  const top = chain[0] as HandMip;
  const levels = chain.length - 1;
  let cover = 0;
  let wet = 0;
  let pen = 0;
  let samples = 0;
  for (let k = 0; k < n; k++) {
    const e = first + k;
    if (k === 0 || (e & 3) === 0) loads += 1;
    const g = glyphsAt + (d[4 * (listAt + (e >> 2)) + (e & 3)] as number) * HAND_RUN.glyph;
    loads += 1;
    if (x < v(g, 0) || y < v(g, 1) || x > v(g, 2) || y > v(g, 3)) continue;
    loads += 2;
    const dx = x - v(g + 1, 0);
    const dy = y - v(g + 1, 1);
    const a = v(g + 1, 2);
    const b = v(g + 1, 3);
    const tx = a * dx + b * dy;
    const ty = a * dy - b * dx;
    if (tx < v(g + 3, 0) || ty < v(g + 3, 1) || tx > v(g + 3, 2) || ty > v(g + 3, 3)) continue;
    loads += 2;
    const since = t - v(g + 4, 0);
    if (since <= 0) continue;
    const lod = Math.min(levels, Math.max(0, Math.log2(Math.max(aa * Math.hypot(a, b), 1e-6))));
    // kept half a texel of the coarser level it reads inside the glyph's own rect (`handMips`): no read reaches a neighbour's ink
    const inset = 0.5 * 2 ** Math.ceil(lod);
    const ix = Math.min(inset, 0.5 * (v(g + 3, 2) - v(g + 3, 0)));
    const iy = Math.min(inset, 0.5 * (v(g + 3, 3) - v(g + 3, 1)));
    const qx = Math.min(Math.max(tx, v(g + 3, 0) + ix), v(g + 3, 2) - ix);
    const qy = Math.min(Math.max(ty, v(g + 3, 1) + iy), v(g + 3, 3) - iy);
    const [r, arrival] = trilinear(chain, (v(g + 2, 0) + qx) / top.w, (v(g + 2, 1) + qy) / top.h, lod);
    samples += 1;
    const size = v(g + 2, 2);
    const dist = (r - EDGE) * range * size;
    // the ramp never wider than the field's reach (half its range): past it a haze would lie over the glyph's whole rect
    const ramp = Math.min(aa, 0.5 * range * size);
    let fill = Math.min(1, Math.max(0, 0.5 + dist / ramp));
    if (bleed > 0) fill = Math.max(fill, bleedA * Math.min(1, Math.max(0, 0.5 + (dist + 0.5 * bleed) / ramp)));
    let written = 1;
    let fresh = 0;
    const dur = v(g + 4, 1);
    if (since < dur) {
      const ahead = (handEase(since / dur) - arrival) * v(g + 4, 2);
      written = Math.min(1, Math.max(0, 0.5 + ahead / aa));
      fresh = written * Math.min(1, Math.max(0, 1 - ahead / (HAND_RUN.wet * size)));
    }
    const laid = fill * written * v(g + 2, 3);
    if (laid > cover) { cover = laid; pen = Math.trunc(v(g + 4, 3)) & ((1 << HAND_RUN.penBits) - 1); wet = fresh; }
  }
  return { cover, wet, pen, samples, loads };
}
