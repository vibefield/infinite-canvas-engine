// THE MARKS AS A HAND MAKES THEM (petition I60 — "Editing the Ink": a HIGHLIGHT is a marker's stroke under the ink, a STRIKE a pen
// line through the words on the x-height's middle, an UNDERLINE one under them, each pulled through left to right as a letter is
// written). The law of each mark — its width, how far the pen runs past the words, how it wobbles and tilts (the design page's first
// guesses: the spike's marksheet.mjs `shapeOf`, taken as they were) — and the MARKS SECTION of a glyph run (kit/hand-run.ts
// `handRun({ ink })`), which the kit's `marks` WGSL piece reads in a kind's own fragment shader (shaders/kit/marks.wgsl —
// `ink_marks`; kit/ink-marks.ts `inkMarksAt` is its CPU twin). Pure and deterministic: no GPU.
//
// THE SECTION lies after the run's glyphs and their re-inks; the header's `k0` says where (kit/hand-run.ts). Its vec4s, from its start:
//   m0  Y0 1/em rows washAt        the rows' top (units), one over their height (the layout's em), how many, where the wash begins
//   the ROWS, one vec4 a row:      `offset count la lb` — the strokes the row lists ([offset, offset + count) of the list) and the
//                                  laid lines whose caret band meets it ([la, lb)): a fragment reads only its own row's few
//   the STROKES, INK_MARKS.stroke vec4s each:
//     s0  x0 x1 y reach            its ends (the pen's run past the words included), its centre line at its middle, and how far its
//                                  ink lies from that line (half its width, its wobble, its tilt over half its run) — the reject
//     s1  hw slope amp press       half its width (units), its tilt (dy/dx), the wobble's height (units), its presence (0..1)
//     s2  p1 p2 lean code          the wobble's two phases (radians), a highlighter's chisel lean (dx per dy), and its CODE: its kind
//                                  (0 highlight, 1 strike, 2 underline) + 4 × its value + 32 × (the value under it + 1; 0 none)
//     s3  start dur h0 h1          its moment (ms from the run's epoch; HAND_RUN.before — on the paper before), how long, and the
//                                  stretch [h0, h1] of it (0..1 along it) on the paper already ([1, 0]: none)
//   the LIST: stroke indices, four a vec4
//   the WASH, one vec4 a laid line: `x0 y0 x1 y1` — the selection's rect on that line (x1 ≤ x0: none), rewritten ALONE with the
//                                  header's `k0` (kit/ink-marks.ts `inkWash`, kit/hand-gpu.ts `HandRuns.wash`): never the run rebuilt
// A value is a highlighter's number (n: `HIGHLIGHTERS[n − 1]`) or a line's PEN (0 the sheet's own, n `PENS[n − 1]`) — as a glyph's
// pen is numbered, so a kind's palette answers both.

import { highlightOf, type InkSpan, type InkValue, type MarkStroke, penOf, strikeOf, underlineOf } from "./ink";
import type { StrokeMoment } from "./pen-clock";
import { type HandLayout, hashHand } from "./text";

/**
 * How a hand makes each mark, em of the layout unless named (the design page's first guesses — the spike's `shapeOf` — taken as
 * they were): `hw` half its width; `before` and `after` how far the pen runs past the words' first and last carets; `amp` the
 * wobble's height; `tilt` the most it tilts either way (dy/dx) about `bias`; `press` its presence (a highlighter's translucent
 * stain, a pen line's pressure).
 */
export const INK_STROKES = {
  highlight: { hw: 0.35, before: 0.1, after: 0.13, amp: 0.012, tilt: 0.008, bias: 0, press: 0.62 },
  strike: { hw: 0.034, before: 0.07, after: 0.09, amp: 0.026, tilt: 0.016, bias: -0.014, press: 0.9 },
  underline: { hw: 0.03, before: 0.02, after: 0.05, amp: 0.02, tilt: 0.01, bias: -0.004, press: 0.9 },
} as const;

/** The marks' other numbers (the WGSL's `INK_*` constants are the same): em unless named. */
export const INK_MARKS = {
  /** The marks' head in a run's header: vec4 index 4 (`k0`: where the section begins, its strokes, the wash's extent in y). */
  head: 4,
  /** vec4s a stroke. */
  stroke: 4,
  /** The wobble's slow wavelength, and its quick one at half the height. */
  wave: [2.6, 0.9] as const,
  /** A highlighter's chisel: its ends cut on a lean of up to ± this, dx per dy. */
  chisel: 0.25,
  /** The widest edge ramp: a sheet whose device px is wider than this is its kind's to greek (the ink's own ramp is capped too). */
  ramp: 0.25,
} as const;

/** The selection's wash on each line: its rect grown by `pad` across and its corners rounded by `radius`, em (the spike's 1 and 2.2 at 24). */
export const INK_WASH = { pad: 0.04, radius: 0.09 } as const;

/** A stroke's kind as the section codes it. */
const KIND = { highlight: 0, strike: 1, underline: 2 } as const;
/** The hash's code for a stroke's own hand — past every code point, so it never meets a glyph's. */
const SALT = 0x110000;
/** A row's slack, units: a stroke or a band meets the rows within this of its edge, so f32's rounding never finds a row that lists it not. */
const SLACK = 1e-3;
const TURN = 2 * Math.PI;

/**
 * A glyph's value for a stroke of `kind`, off its mark — as kit/ink.ts `strokesOf` reads it: its highlighter; or its line, "in the
 * words' own pen" read as its own (1 the sheet's own, n ≥ 2 `PENS[n − 2]`). 0 — none.
 */
export function strokeValueOf(kind: MarkStroke["kind"], mark: number): number {
  if (kind === "highlight") return highlightOf(mark);
  const v = kind === "strike" ? strikeOf(mark) : underlineOf(mark);
  if (v !== 1) return v;
  const p = penOf(mark);
  return p === 0 ? 1 : p + 1;
}

/** A stroke as the pen draws it (`inkShape`): units of the layout, y down. */
export interface InkShape {
  readonly kind: MarkStroke["kind"];
  /** A highlighter's number (n `HIGHLIGHTERS[n − 1]`), or a line's PEN (0 the sheet's own, n `PENS[n − 1]`). */
  readonly value: number;
  /** Its ends: the words' carets, the pen's run past them added. */
  readonly x0: number;
  readonly x1: number;
  /** Its centre line at its middle (the stroke's line: kit/ink.ts `strokesOf`'s `y`). */
  readonly y: number;
  /** Half its width. */
  readonly hw: number;
  /** Its tilt, dy/dx about its middle. */
  readonly slope: number;
  /** The wobble's height, and its two phases (radians). */
  readonly amp: number;
  readonly p1: number;
  readonly p2: number;
  /** A highlighter's chisel: its ends lean by this, dx per dy off its centre line (0 for a line). */
  readonly lean: number;
  /** Its presence, 0..1. */
  readonly press: number;
  /** How far its ink lies from its centre line: half its width, the wobble, the tilt over half its run. */
  readonly reach: number;
}

/**
 * A stroke (kit/ink.ts `strokesOf`) as the pen draws it, in a layout's `em`, its hand from `seed` — the seed of its first glyph, so it
 * keeps its wobble through every edit that keeps that glyph. The centre line at x is `y + slope·(x − mid) + amp·(sin(2π(x − x0)/
 * (2.6 em) + p1) + ½ sin(2π(x − x0)/(0.9 em) + p2))` (`inkCentre`).
 */
export function inkShape(stroke: MarkStroke, em: number, seed: number): InkShape {
  const law = INK_STROKES[stroke.kind];
  const [r0, r1, r2, r3] = hashHand(seed, SALT + KIND[stroke.kind]);
  const x0 = stroke.x0 - law.before * em;
  const x1 = stroke.x1 + law.after * em;
  const slope = law.bias + (r0 * 2 - 1) * law.tilt;
  const amp = law.amp * em;
  const hw = law.hw * em;
  return {
    kind: stroke.kind,
    value: stroke.kind === "highlight" ? stroke.value : stroke.value - 1,
    x0, x1, y: stroke.y, hw, slope, amp,
    p1: r1 * TURN,
    p2: r2 * TURN,
    lean: stroke.kind === "highlight" ? (r3 - 0.5) * 2 * INK_MARKS.chisel : 0,
    press: law.press,
    reach: hw + 1.5 * amp + Math.abs(slope) * 0.5 * (x1 - x0),
  };
}

/** A stroke's centre line at `x` (clamped to its ends) and its slope there, in a layout's `em` — what `ink_marks` works out. */
export function inkCentre(s: Pick<InkShape, "x0" | "x1" | "y" | "slope" | "amp" | "p1" | "p2">, x: number, em: number): { readonly y: number; readonly dy: number } {
  const xc = Math.min(s.x1, Math.max(s.x0, x));
  const w1 = TURN / (INK_MARKS.wave[0] * em);
  const w2 = TURN / (INK_MARKS.wave[1] * em);
  const d = xc - s.x0;
  return {
    y: s.y + s.slope * (xc - 0.5 * (s.x0 + s.x1)) + s.amp * (Math.sin(w1 * d + s.p1) + 0.5 * Math.sin(w2 * d + s.p2)),
    dy: s.slope + s.amp * (w1 * Math.cos(w1 * d + s.p1) + 0.5 * w2 * Math.cos(w2 * d + s.p2)),
  };
}

/** A selection's wash for a layout's `lines`: one vec4 a laid line (`x0 y0 x1 y1`, `[0, 0, −1, −1]` where none) and its extent in y. */
export interface InkWashLines {
  readonly lines: Float32Array;
  /** `[wy0, wy1]`: the rows a fragment can find a wash in, its spans' tops and bottoms grown by half the widest ramp — `[0, 0]`: none. */
  readonly extent: readonly [number, number];
}

/** The wash's lines from `spans` (kit/ink.ts `spansOf` over the run's layout — a second span on one line widens it). */
export function washLines(lines: number, spans: readonly InkSpan[], em: number): InkWashLines {
  const out = new Float32Array(lines * 4);
  for (let k = 0; k < lines; k++) out.set([0, 0, -1, -1], 4 * k);
  let wy0 = Number.POSITIVE_INFINITY;
  let wy1 = Number.NEGATIVE_INFINITY;
  for (const s of spans) {
    if (!(s.line >= 0 && s.line < lines) || !(s.x1 > s.x0) || !(s.y1 > s.y0)) continue;
    const at = 4 * s.line;
    const had = (out[at + 2] as number) > (out[at] as number);
    out.set(had ? [Math.min(out[at] as number, s.x0), Math.min(out[at + 1] as number, s.y0), Math.max(out[at + 2] as number, s.x1), Math.max(out[at + 3] as number, s.y1)] : [s.x0, s.y0, s.x1, s.y1], at);
    wy0 = Math.min(wy0, s.y0);
    wy1 = Math.max(wy1, s.y1);
  }
  const half = 0.5 * INK_MARKS.ramp * em + SLACK;
  return { lines: out, extent: wy1 > wy0 ? [wy0 - half, wy1 + half] : [0, 0] };
}

/** What a run's marks section is built from (kit/hand-run.ts `handRun` hands it). */
export interface InkSectionInput {
  readonly layout: HandLayout;
  /** The ink the layout was laid from: its seeds give each stroke its hand. */
  readonly ink: InkValue;
  /** Its strokes, `strokesOf(layout, ink)`. */
  readonly strokes: readonly MarkStroke[];
  /** Each stroke's moment (the clock's `marks`), in `strokes`' order; absent — every stroke on the paper before. */
  readonly moments?: readonly StrokeMoment[];
  /** The selection's wash at build (`spansOf`); absent — none. */
  readonly wash?: readonly InkSpan[];
  /** The run's epoch, ms: the moments are kept from it. */
  readonly epoch: number;
  /** The start of a stroke on the paper before (`HAND_RUN.before`). */
  readonly before: number;
}

/** A run's marks section: its vec4s and what is in it. */
export interface InkSection {
  /** `length × 4` floats. */
  readonly data: Float32Array;
  /** vec4s. */
  readonly length: number;
  readonly rows: number;
  readonly strokes: number;
  /** The list's entries (a stroke is listed once a row it meets). */
  readonly entries: number;
  /** The laid lines: the wash has one vec4 each. */
  readonly lines: number;
  /** Where the wash begins, vec4s from the section's start. */
  readonly washAt: number;
  /** The wash's extent in y at build (`InkWashLines.extent`). */
  readonly wash: readonly [number, number];
  /** The strokes as drawn, in `strokes`' order. */
  readonly shapes: readonly InkShape[];
}

/**
 * A run's MARKS SECTION: the rows a stroke or a wash can lie in (one an em, from the top of the writing's first caret band), each
 * listing the strokes it meets and the laid lines whose caret band — where the wash lies — meets it; the strokes as the pen draws
 * them with their moments; and the wash's room, one vec4 a laid line. The same input gives the same bytes.
 */
export function inkSection(input: InkSectionInput): InkSection {
  const { layout: L, ink, strokes } = input;
  const em = L.em;
  const half = 0.5 * INK_MARKS.ramp * em + SLACK;
  const shapes = strokes.map((s) => inkShape(s, em, (ink.seeds[s.from] ?? 0) | 0));
  const nl = L.lines.length;
  // the rows' extent: every laid line's caret band (where a wash can lie) and every stroke's reach, grown by half the widest ramp
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const ln of L.lines) { y0 = Math.min(y0, ln.y - L.ascent - half); y1 = Math.max(y1, ln.y + L.descent + half); }
  for (const s of shapes) { y0 = Math.min(y0, s.y - s.reach - half); y1 = Math.max(y1, s.y + s.reach + half); }
  if (!(y1 > y0)) { y0 = 0; y1 = em; }
  const inv = Math.fround(1 / em);
  const fy0 = Math.fround(y0);
  const rows = Math.max(1, Math.ceil((y1 - fy0) * inv));
  const rowOf = (v: number): number => Math.min(rows - 1, Math.max(0, Math.floor((v - fy0) * inv)));
  const count = new Uint32Array(rows);
  const reach = shapes.map((s) => {
    const r0 = rowOf(s.y - s.reach - half);
    const r1 = rowOf(s.y + s.reach + half);
    for (let r = r0; r <= r1; r++) count[r] = (count[r] as number) + 1;
    return [r0, r1] as const;
  });
  const offset = new Uint32Array(rows);
  let entries = 0;
  for (let r = 0; r < rows; r++) { offset[r] = entries; entries += count[r] as number; }
  const list = new Uint32Array(entries);
  const fill = offset.slice();
  reach.forEach(([r0, r1], n) => { for (let r = r0; r <= r1; r++) { list[fill[r] as number] = n; fill[r] = (fill[r] as number) + 1; } });
  // the laid lines whose caret band meets each row
  const la = new Array<number>(rows).fill(nl);
  const lb = new Array<number>(rows).fill(0);
  L.lines.forEach((ln, k) => {
    for (let r = rowOf(ln.y - L.ascent - half); r <= rowOf(ln.y + L.descent + half); r++) { la[r] = Math.min(la[r] as number, k); lb[r] = Math.max(lb[r] as number, k + 1); }
  });
  const strokesAt = 1 + rows;
  const listAt = strokesAt + INK_MARKS.stroke * shapes.length;
  const washAt = listAt + Math.ceil(entries / 4);
  const length = washAt + nl;
  const data = new Float32Array(length * 4);
  data.set([fy0, inv, rows, washAt], 0);
  for (let r = 0; r < rows; r++) data.set([offset[r] as number, count[r] as number, (lb[r] as number) > (la[r] as number) ? (la[r] as number) : 0, (lb[r] as number) > (la[r] as number) ? (lb[r] as number) : 0], 4 * (1 + r));
  shapes.forEach((s, n) => {
    const m = input.moments?.[n];
    const stroke = strokes[n] as MarkStroke;
    // the stretch on the paper, from the words' carets (the clock's) to the drawn stroke's ends: a start or an end it holds, it holds
    // with the pen's run past it
    const span = s.x1 - s.x0;
    const ext = (h: number): number => (h <= 0 ? 0 : h >= 1 ? 1 : span > 0 ? (stroke.x0 + h * (stroke.x1 - stroke.x0) - s.x0) / span : 0);
    const none = m === undefined || m.have[0] > m.have[1];
    const shown = m === undefined || !(m.start > Number.NEGATIVE_INFINITY);
    const was = m === undefined || m.was < 0 ? 0 : (stroke.kind === "highlight" ? m.was : m.was - 1) + 1;
    const at = 4 * (strokesAt + INK_MARKS.stroke * n);
    data.set([s.x0, s.x1, s.y, s.reach], at);
    data.set([s.hw, s.slope, s.amp, s.press], at + 4);
    data.set([s.p1, s.p2, s.lean, KIND[s.kind] + 4 * s.value + 32 * was], at + 8);
    data.set([shown ? input.before : (m as StrokeMoment).start - input.epoch, m === undefined ? 0 : Math.max(0, m.dur), none ? 1 : ext((m as StrokeMoment).have[0]), none ? 0 : ext((m as StrokeMoment).have[1])], at + 12);
  });
  for (let e = 0; e < entries; e++) data[4 * listAt + e] = list[e] as number;
  const wash = washLines(nl, input.wash ?? [], em);
  data.set(wash.lines, 4 * washAt);
  return { data, length, rows, strokes: shapes.length, entries, lines: nl, washAt, wash: wash.extent, shapes };
}
