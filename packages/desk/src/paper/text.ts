// The handwriting's LAYOUT — pure: no canvas, no font file. A host supplies
// the face's metrics (advances and kerning in em, the ascent and descent) and
// this lays a note's text into its writable box — wrapped at words, broken at
// newlines — and gives every glyph its own hand: a small rotation, a rise off
// the baseline, a size, a pressure, and the line's slow wander, all from a hash
// of the glyph's own seed. So a note re-rastered at another zoom is the same
// handwriting to the pixel, and a glyph typed before the next keeps its hand
// when the host carries the seeds through an edit (lab/main.ts does). The
// raster (lab/ink.ts) draws exactly these boxes; the caret sits at
// `positions`; the tests pin the wrap and the determinism.

export interface HandMetrics {
  /** em above the baseline, em below — the face's own box. */
  readonly ascent: number;
  readonly descent: number;
  /** A glyph's advance, em. */
  advance(ch: string): number;
  /** Optional pair kerning, em (negative tightens). */
  kern?(a: string, b: string): number;
}

/** The hand's law (theme.ts `HAND`): the size in world units, and how far each glyph may stray. */
export interface HandLaw {
  /** The pen's size, world units (CSS px at zoom 1). */
  readonly size: number;
  /** Line pitch, × size. */
  readonly lineHeight: number;
  /** The margin the writing keeps from the paper's edge, world units. */
  readonly pad: number;
  readonly jitter: {
    /** Each glyph's tilt, ± radians. */
    readonly rot: number;
    /** Each glyph's rise off the baseline, ± em. */
    readonly rise: number;
    /** Each glyph's size, ± fraction. */
    readonly scale: number;
    /** The pen's pressure — the ink's presence — between these. */
    readonly press: readonly [number, number];
  };
  readonly wander: {
    /** The line's slow drift, ± em. */
    readonly amp: number;
    /** …over this many em along the line. */
    readonly period: number;
  };
}

export interface HandGlyph {
  readonly ch: string;
  /** Its index in the text. */
  readonly index: number;
  /** The glyph's origin on its baseline, note units from the paper's top-left. */
  readonly x: number;
  readonly y: number;
  /** The advance it takes, note units. */
  readonly advance: number;
  readonly rot: number;
  readonly scale: number;
  readonly press: number;
  readonly line: number;
}

export interface HandLine {
  /** Text indices [start, end). */
  readonly start: number;
  readonly end: number;
  /** The baseline, note units. */
  readonly y: number;
  readonly width: number;
}

export interface HandLayout {
  readonly glyphs: readonly HandGlyph[];
  readonly lines: readonly HandLine[];
  /** The caret's place BEFORE each index (and after the last): x, baseline y — `2 × (text.length + 1)`. */
  readonly positions: Float32Array;
  /** The writing ran past the bottom margin. */
  readonly overflow: boolean;
  /** The em, and the caret's height above and below the baseline. */
  readonly em: number;
  readonly ascent: number;
  readonly descent: number;
}

/**
 * Four floats in [0, 1) from a glyph's seed and its character — a 32-bit mix
 * (Wang's hash twice, xorshift between) that changes wholly for a change of
 * one bit in either. Deterministic across hosts: only integer arithmetic.
 */
export function hashHand(seed: number, code: number): readonly [number, number, number, number] {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(code | 0, 0x85ebca77)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x7feb352d) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 0x846ca68b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    out.push(h / 4294967296);
    h = (h + 0x6d2b79f5) >>> 0;
  }
  return out as unknown as readonly [number, number, number, number];
}

/** A glyph's seed when the host carries none: the note's seed and the glyph's place. */
export const glyphSeed = (noteSeed: number, index: number): number => (Math.imul(noteSeed | 0, 0x27d4eb2f) + Math.imul(index + 1, 0x165667b1)) | 0;

/**
 * Lay `text` into a `box` (note units) under `law` with the face's `metrics`.
 * `seeds[i]` is glyph i's own seed (the host's, carried through edits) — absent,
 * it is derived from `noteSeed` and the index.
 */
export function layoutText(text: string, box: { readonly w: number; readonly h: number }, law: HandLaw, metrics: HandMetrics, noteSeed = 1, seeds?: ArrayLike<number>): HandLayout {
  const em = law.size;
  const lineH = law.lineHeight * em;
  const x0 = law.pad;
  const xMax = Math.max(box.w - law.pad, x0 + 1);
  const yMax = box.h - law.pad;
  const glyphs: HandGlyph[] = [];
  const lines: { start: number; end: number; y: number; width: number }[] = [];
  const positions = new Float32Array(2 * (text.length + 1));
  const phase = hashHand(noteSeed, 7)[0] * Math.PI * 2;
  let x = x0;
  let y = law.pad + metrics.ascent * em;
  let line = 0;
  let lineStart = 0;
  let prev = "";
  let overflow = false;
  const adv = (ch: string) => metrics.advance(ch) * em;
  const newline = (i: number) => {
    lines.push({ start: lineStart, end: i, y, width: x - x0 });
    lineStart = i; line += 1; x = x0; y += lineH; prev = "";
  };
  // the width a word (to the next space or newline) takes, with its kerning
  const wordWidth = (i: number): number => {
    let w = 0;
    let p = "";
    for (let j = i; j < text.length; j++) {
      const c = text[j] as string;
      if (c === " " || c === "\n") break;
      if (p && metrics.kern) w += metrics.kern(p, c) * em;
      w += adv(c); p = c;
    }
    return w;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === "\n") { positions[2 * i] = x; positions[2 * i + 1] = y; newline(i + 1); continue; }
    const wordStart = i === 0 || text[i - 1] === " " || text[i - 1] === "\n";
    // a word that does not fit the rest of the line wraps before it — unless it starts the line, when it breaks by glyph below
    if (ch !== " " && wordStart && x > x0 && x + wordWidth(i) > xMax) newline(i);
    if (ch !== " " && !wordStart && prev && metrics.kern) x += metrics.kern(prev, ch) * em;
    // a glyph that runs past the edge mid-word (a word longer than the line) wraps by itself
    if (ch !== " " && x > x0 && x + adv(ch) > xMax) newline(i);
    positions[2 * i] = x; positions[2 * i + 1] = y;
    if (ch === " ") { x += adv(ch); prev = ch; continue; }
    const seed = seeds && i < seeds.length ? (seeds[i] as number) : glyphSeed(noteSeed, i);
    const [r0, r1, r2, r3] = hashHand(seed, ch.codePointAt(0) ?? 0);
    const scale = 1 + (r2 - 0.5) * 2 * law.jitter.scale;
    const a = adv(ch) * scale;
    const wander = law.wander.amp * em * Math.sin((2 * Math.PI * (x - x0)) / Math.max(law.wander.period * em, 1e-6) + phase);
    glyphs.push({
      ch, index: i, x, y: y + wander + (r1 - 0.5) * 2 * law.jitter.rise * em, advance: a,
      rot: (r0 - 0.5) * 2 * law.jitter.rot, scale, press: law.jitter.press[0] + (law.jitter.press[1] - law.jitter.press[0]) * r3, line,
    });
    if (y + metrics.descent * em > yMax) overflow = true;
    x += a; prev = ch;
  }
  positions[2 * text.length] = x; positions[2 * text.length + 1] = y;
  lines.push({ start: lineStart, end: text.length, y, width: x - x0 });
  if (y + metrics.descent * em > yMax && text.length > 0) overflow = true;
  return { glyphs, lines, positions, overflow, em, ascent: metrics.ascent * em, descent: metrics.descent * em };
}

/** The caret before `index`: its left edge on the baseline, and its extent above and below. */
export function caretAt(L: HandLayout, index: number): { readonly x: number; readonly y: number; readonly above: number; readonly below: number } {
  const i = Math.min(Math.max(index, 0), L.positions.length / 2 - 1);
  return { x: L.positions[2 * i] as number, y: L.positions[2 * i + 1] as number, above: L.ascent, below: L.descent };
}

/** The box a glyph's ink can reach (its advance wide, the face's box tall, grown by the hand's jitter), note units — what the wipe reveals. */
export function glyphBox(L: HandLayout, g: HandGlyph): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } {
  const grow = L.em * 0.12;
  return { x0: g.x - grow, y0: g.y - L.ascent * g.scale - grow, x1: g.x + g.advance + grow, y1: g.y + L.descent * g.scale + grow };
}

/**
 * The hand's seeds carried through an edit: the common prefix and suffix of
 * the old and new text keep their seeds, the inserted run gets fresh ones from
 * `fresh()`. Returns the new seeds and the inserted range [from, to).
 */
export function carrySeeds(oldText: string, oldSeeds: ArrayLike<number>, newText: string, fresh: () => number): { seeds: number[]; from: number; to: number } {
  let pre = 0;
  const maxPre = Math.min(oldText.length, newText.length);
  while (pre < maxPre && oldText[pre] === newText[pre]) pre += 1;
  let suf = 0;
  const maxSuf = Math.min(oldText.length, newText.length) - pre;
  while (suf < maxSuf && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf += 1;
  const seeds: number[] = [];
  for (let i = 0; i < pre; i++) seeds.push(i < oldSeeds.length ? (oldSeeds[i] as number) : fresh());
  const inserted = newText.length - pre - suf;
  for (let i = 0; i < inserted; i++) seeds.push(fresh());
  for (let i = 0; i < suf; i++) { const j = oldText.length - suf + i; seeds.push(j < oldSeeds.length ? (oldSeeds[j] as number) : fresh()); }
  return { seeds, from: pre, to: pre + inserted };
}
