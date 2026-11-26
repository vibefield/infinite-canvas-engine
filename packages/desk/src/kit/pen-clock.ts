// THE PEN'S CLOCK (petition I59 — the desk's pen, hand-moves A): WHEN each glyph of a sheet was written, so the writing MOVES as
// it is typed and as writing arrives (a peer's words, an agent's comment, a paste) and never when a desk opens. Runtime only and
// one desk's: kept as the caret and the wipe are kept (a kind's `local`), so the document, sync and undo never see it.
//
// A glyph's moment is KEYED BY ITS SEED (kit/seeds.ts: `carrySeeds` keeps a glyph's seed through every edit around it), so an insert
// before a glyph, a reflow that carries a word to the next line or a re-layout at another size never writes it again: a seed seen
// before keeps its moment; a NEW seed is written from the look's `now` as the look says it came (`typed` — typed on this desk, one
// glyph a keystroke; `arrived` — every word its own pen, the letters of a word one after another); at an object's
// FIRST look every glyph is already there. A seed that left the text is forgotten (an undo that brings it back writes it again,
// as writing that arrives).
//
// The clock answers the desk's wake (K7a — nothing polled at rest): `due(now)` is now while a glyph is being written (or has just
// finished — one frame to draw it whole), the next start while one waits, ∞ at rest; `tick(now)` says whether the pen moved since
// the last tick, so a kind asks a redraw — the run holds the moments, so the writing moves with NO record remade.
//
// THE MARKS (petition I60 — the pen draws every mark the way it draws a letter, when the mark is made, never when a desk opens):
// `marks(key, …)` keeps, per object, each glyph's MARK as last seen, KEYED BY ITS SEED as the moments are — the pen that wrote it,
// the highlighter under it, the lines through it and under it (kit/ink.ts). A seed seen before whose PEN changed is RE-INKED: its
// new pen writes over the old along the glyph's own path, from the look's `now` at the hand's typing pace, the re-inks of one look
// following each other in reading order. A STROKE (kit/ink.ts `strokesOf`) is drawn from `now` where its glyphs did not carry its
// value at the last look — only the stretch that is new (the glyphs that did are already on paper), after any letters under it
// that are being written; a stroke whose glyphs all carried it keeps its moment. So an edit elsewhere (its glyphs' seeds carried,
// their marks unchanged) never draws a mark again, and an object's FIRST marks look draws nothing.

import { glyphOf, type HandAtlas } from "./hand-atlas";
import { type InkValue, type MarkStroke, penOf } from "./ink";
import { INK_STROKES, strokeValueOf } from "./ink-strokes";
import { type HandLayout, type HandLine, PENS } from "./text";

/** When a glyph was written: its pen set off at `start` and took `dur`, ms on the desk's clock; `start` −∞ — written before. */
export interface PenMoment {
  readonly start: number;
  readonly dur: number;
}

/** A glyph written before anything was seen of it — a desk opening, an object first drawn. */
export const WRITTEN: PenMoment = { start: Number.NEGATIVE_INFINITY, dur: 0 };

/**
 * How the glyphs new to a look were written: `typed` — typed on this desk, the kind's editor on it (each at the hand's typing pace
 * from `now`);
 * `arrived` — a write that came in (a peer, an agent, a paste: in reading order, every word its own pen); `shown` — already there
 * (no pen at all).
 */
export type PenHow = "typed" | "arrived" | "shown";

/** The pen's timing (the design page's first guesses — the spike's sheet.mjs and hand-core.mjs — taken as they were). */
export interface PenPace {
  /** A typed glyph takes `base + perEm × its path (em)` ms, within [`min`, `max`]. */
  readonly typed: { readonly base: number; readonly perEm: number; readonly min: number; readonly max: number };
  /**
   * An arrived glyph takes `base + perRootEm × √(its path, em)` ms; the next letter of its word sets off at `overlap` of it; the
   * next WORD's pen sets off `lead + stagger × the word's own length` ms after this word's (at most `staggerMax`); and the whole
   * arrival is squeezed into `most` ms, no glyph under `least`.
   */
  readonly arrived: {
    readonly base: number;
    readonly perRootEm: number;
    readonly overlap: number;
    readonly lead: number;
    readonly stagger: number;
    readonly staggerMax: number;
    readonly most: number;
    readonly least: number;
  };
  /** Several new glyphs in ONE typed look (an input method's commit) follow one another at `overlap` of each. */
  readonly overlap: number;
  /**
   * A RE-INK (petition I60): each glyph whose pen changed takes the typed pace's time; the next sets off at `overlap` of it; the
   * whole look's re-inks are squeezed into `most`, no glyph under `least` (absent: `PEN_PACE.reink`).
   */
  readonly reink?: { readonly overlap: number; readonly most: number; readonly least: number };
  /**
   * A STROKE drawn (petition I60): `base + perEm × the em it draws` ms, at most `most` — a highlighter's band, and a line through
   * or under the words (absent: `PEN_PACE.strokes`).
   */
  readonly strokes?: {
    readonly highlight: { readonly base: number; readonly perEm: number; readonly most: number };
    readonly line: { readonly base: number; readonly perEm: number; readonly most: number };
  };
}

/** The pen's pace on the desk (`createPenClock`'s unless a kind says): ms. */
export const PEN_PACE: PenPace = {
  typed: { base: 90, perEm: 45, min: 100, max: 190 },
  arrived: { base: 40, perRootEm: 23.077, overlap: 0.82, lead: 70, stagger: 0.35, staggerMax: 220, most: 1400, least: 45 },
  overlap: 0.82,
  // the design page's first guesses (the spike's marksheet.mjs `set`), taken as they were
  reink: { overlap: 0.6, most: 1100, least: 60 },
  strokes: { highlight: { base: 170, perEm: 46, most: 520 }, line: { base: 130, perEm: 40, most: 420 } },
};

/** What a look is handed: the sheet's glyphs as laid, their seeds, the face (each glyph's path), the clock, and how new glyphs came. */
export interface PenLook {
  /** The layout as laid (`layoutText`): its glyphs in reading order. */
  readonly layout: HandLayout;
  /** Each glyph's seed by its TEXT index (`seeds[g.index]`) — the very seeds `layoutText` was handed (`seedsFor(text, stored, seed)`). */
  readonly seeds: ArrayLike<number>;
  /** The face's atlas: how long each glyph's path is (`HandAtlasGlyph.length`, em). */
  readonly atlas: HandAtlas;
  /** The desk's clock, ms — the kind's tick's `now`. */
  readonly now: number;
  /** How the glyphs new to this look were written. */
  readonly how: PenHow;
  /** How an object's FIRST look writes its glyphs — `shown` (the default: a desk opening, an object first drawn); `arrived` for an object a kind knows is new. */
  readonly first?: PenHow;
}

/** An object's key on the clock (a kind's: its entity, or a key of its own). */
export type PenKey = number | string;

/**
 * When a STROKE of a sheet's marks is drawn (petition I60): its pen sets off at `start` and takes `dur` (ms on the desk's clock;
 * `start` −∞ — on the paper before), pulled through left to right over the part of it not in `have`.
 */
export interface StrokeMoment {
  readonly start: number;
  readonly dur: number;
  /**
   * The stretch of it already on the paper, 0..1 from the caret before its first glyph to the caret after its last (the stroke as
   * kit/ink.ts `strokesOf` gives it): `[0, 1]` — all of it; `[1, 0]` — none.
   */
  readonly have: readonly [number, number];
  /**
   * The value it showed before its value changed — its glyphs all carried that one at the last look (a recoloured highlight, a line
   * in the words' own pen whose pen changed): shown where the new has not reached yet; −1 — none. As `MarkStroke.value`.
   */
  readonly was: number;
}

/** A stroke on the paper before anything was seen of it — a desk opening, an object first drawn — or all of whose glyphs carried it. */
export const SHOWN: StrokeMoment = { start: Number.NEGATIVE_INFINITY, dur: 0, have: [0, 1], was: -1 };

/** What a marks look is handed (`PenClock.marks`): the sheet's ink as laid, its strokes, the face and the clock. */
export interface PenMarksLook {
  /** The layout as laid (`layoutText`) from the ink's text and seeds. */
  readonly layout: HandLayout;
  /** The ink it was laid from (kit/ink.ts): its text, its seeds — the ones `layoutText` was handed — and its marks. */
  readonly ink: InkValue;
  /** Its strokes, `strokesOf(layout, ink)` (kit/ink.ts), in that order. */
  readonly strokes: readonly MarkStroke[];
  /** The face's atlas: how long each glyph's path is (a re-ink takes the typed pace's time for it). */
  readonly atlas: HandAtlas;
  /** The desk's clock, ms — the kind's tick's `now`. */
  readonly now: number;
  /** How an object's FIRST marks look draws its strokes: `shown` (the default — a desk opening) or `arrived` (an object a kind knows is new: each drawn after its letters). */
  readonly first?: "shown" | "arrived";
}

/** The marks' moments (`PenClock.marks`), each list in its own order — the layout's glyphs, the look's strokes. */
export interface PenMarks {
  /** Each laid glyph's pen BEFORE its re-ink (0 the sheet's own, n `PENS[n − 1]`) — its own pen where it has none. */
  readonly was: readonly number[];
  /** Each laid glyph's RE-INK: its new pen written over `was` from `start` for `dur` — `WRITTEN` where none is drawn. */
  readonly reinks: readonly PenMoment[];
  /** Each stroke's moment, in the look's `strokes` order. */
  readonly strokes: readonly StrokeMoment[];
}

export interface PenClock {
  /**
   * The moments of a sheet's glyphs as of `look.now`, one per `look.layout.glyphs` entry in its order: a seed seen before keeps
   * its moment (a glyph long written comes back `WRITTEN`); a new one is written as `look.how` says — or, at the object's first
   * look, as `look.first` says (`shown`). Every seed not in this look is forgotten. A look whose glyphs carry the same seeds in the
   * same order as the last (a reflow, a redraw) answers the LAST look's very array: a kind keeps the run it built by identity.
   */
  look(key: PenKey, look: PenLook): readonly PenMoment[];
  /**
   * The moments of a sheet's MARKS as of `look.now` (petition I60), after the same object's `look` of the same frame: each glyph's
   * re-ink — a seed seen before whose pen changed is written over in its new pen from `now`, the look's re-inks one after another
   * at the hand's typing pace — and each stroke's — drawn from `now` (after any letters under it still being written) over the
   * stretch whose glyphs did not carry its value at the last marks look, kept while all of them did. An object's first marks look
   * draws nothing (`look.first` — `arrived`: every stroke drawn after its letters). A look that brings the same seeds, marks and
   * strokes as the last answers the LAST look's very object: a kind keeps the run it built by identity.
   */
  marks(key: PenKey, look: PenMarksLook): PenMarks;
  /** When the pen is next live (K7a — `KindLocal.due`): `now` while a glyph is being written or has finished since the last tick; the next start while one waits; ∞ at rest. */
  due(now: number): number;
  /** Once a tick: did the pen move since the last tick (a glyph being written, or one that finished between the two)? Then a kind asks a redraw. */
  tick(now: number): boolean;
  /** The object left the desk for good: its moments forgotten. */
  forget(key: PenKey): void;
  /** Every object forgotten (a scene reload). */
  clear(): void;
  /** Glyph `seed` of object `key` as last looked at — undefined unseen, `WRITTEN` long written (a witness). */
  momentOf(key: PenKey, seed: number): PenMoment | undefined;
  /** How many objects have a glyph not yet whole at `now`, or a mark still being drawn (a witness). */
  writing(now: number): number;
}

interface Flight {
  readonly start: number;
  readonly end: number;
}

interface Sheet {
  moments: Map<number, PenMoment>;
  flights: Flight[];
  /** The last look's seeds in glyph order, and what it answered — handed back as it was when a look brings nothing new. */
  seeds: number[];
  out: readonly PenMoment[];
}

/** A sheet's marks as the last marks look left them (`PenClock.marks`). */
interface InkSheet {
  /** The last look's seeds and marks in glyph order, its strokes' keys, and what it answered — handed back when nothing changed. */
  seeds: number[];
  marks: number[];
  keys: string[];
  out: PenMarks;
  /** Each glyph's mark at the last look, by its seed. */
  bySeed: Map<number, number>;
  /** The re-inks still being drawn, by seed: when, and the pen under them. */
  reinks: Map<number, { readonly start: number; readonly dur: number; readonly was: number }>;
  /** The strokes still being drawn, by key. */
  strokes: Map<string, StrokeMoment>;
  flights: Flight[];
}

/** A glyph's pen off its mark, as the kit names pens (one this build has no name for is the sheet's own). */
const penNumber = (mark: number): number => { const p = penOf(mark); return p <= PENS.length ? p : 0; };

/** A stroke's key on the clock: its kind, its value, and the seeds of its first and last glyphs. */
const strokeKey = (s: MarkStroke, seedAt: (i: number) => number): string => `${s.kind}:${s.value}:${seedAt(s.from)}:${seedAt(s.to - 1)}`;

const same = (a: readonly (number | string)[], b: readonly (number | string)[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Each glyph's path, em, from the face (a glyph the face lacks counts one em: it is the raster's, never the pen's). */
function pathOf(atlas: HandAtlas, ch: string): number {
  const g = glyphOf(atlas, ch.codePointAt(0) ?? 0);
  return g === undefined ? 1 : Math.max(g.length, 0);
}

/**
 * The moments of `fresh` (indices into `glyphs`, in reading order) written from `now` as `how` says. Arrived: grouped into words —
 * a glyph whose text index does not follow the one before it (a space, a line between) starts a new word.
 */
function schedule(glyphs: HandLayout["glyphs"], fresh: readonly number[], atlas: HandAtlas, now: number, how: "typed" | "arrived", pace: PenPace): Map<number, PenMoment> {
  const out = new Map<number, PenMoment>();
  if (how === "typed") {
    const T = pace.typed;
    let t = now;
    for (const j of fresh) {
      const g = glyphs[j] as HandLayout["glyphs"][number];
      const dur = Math.min(T.max, Math.max(T.min, T.base + T.perEm * pathOf(atlas, g.ch)));
      out.set(j, { start: t, dur });
      t += dur * pace.overlap;
    }
    return out;
  }
  const A = pace.arrived;
  const words: number[][] = [];
  let prev = Number.NaN;
  for (const j of fresh) {
    const g = glyphs[j] as HandLayout["glyphs"][number];
    if (words.length === 0 || g.index !== prev + 1) words.push([]);
    (words[words.length - 1] as number[]).push(j);
    prev = g.index;
  }
  const items: { j: number; start: number; dur: number }[] = [];
  let wordStart = 0;
  let end = 0;
  for (const word of words) {
    let t = 0;
    for (const j of word) {
      const g = glyphs[j] as HandLayout["glyphs"][number];
      const dur = A.base + A.perRootEm * Math.sqrt(pathOf(atlas, g.ch));
      items.push({ j, start: wordStart + t, dur });
      end = Math.max(end, wordStart + t + dur);
      t += dur * A.overlap;
    }
    wordStart += Math.min(A.lead + t * A.stagger, A.staggerMax);
  }
  if (end <= A.most) {
    for (const it of items) out.set(it.j, { start: now + it.start, dur: it.dur });
    return out;
  }
  // squeezed into the most: every start by one factor — so the last can still take the least before the most — and every glyph at
  // least the least, ending by the most (the spike's squeeze overshot it by up to the least)
  const last = items.reduce((m, it) => Math.max(m, it.start), 0);
  const f = Math.min(A.most / end, last > 0 ? (A.most - A.least) / last : 1);
  for (const it of items) {
    const start = it.start * f;
    out.set(it.j, { start: now + start, dur: Math.min(Math.max(A.least, it.dur * f), A.most - start) });
  }
  return out;
}

/** The desk's pen clock: one per desk (a kind's `local`), keyed by object, each glyph's moment by its seed. */
export function createPenClock(opts: { readonly pace?: PenPace } = {}): PenClock {
  const pace = opts.pace ?? PEN_PACE;
  const sheets = new Map<PenKey, Sheet>();
  /** The marks' memory, by object (petition I60) — beside the writing's, so a first `look` is never mistaken for a later one. */
  const inks = new Map<PenKey, InkSheet>();
  let lastTick = Number.NEGATIVE_INFINITY;

  /** A moment as of `now`: a glyph whole by then is simply WRITTEN (its moment is no longer needed). */
  const settle = (m: PenMoment, now: number): PenMoment => (m.start + m.dur <= now ? WRITTEN : m);

  /** Every object's flights: the writing's and the marks'. */
  function* holders(): Iterable<{ flights: Flight[] }> { yield* sheets.values(); yield* inks.values(); }

  /** The re-inks of one look, in reading order: each at the typed pace for its path, the next at `overlap` of it, squeezed into `most`. */
  const reinkAt = (glyphs: HandLayout["glyphs"], fresh: readonly number[], atlas: HandAtlas, now: number): PenMoment[] => {
    const T = pace.typed;
    const R = pace.reink ?? (PEN_PACE.reink as NonNullable<PenPace["reink"]>);
    const durs = fresh.map((j) => Math.min(T.max, Math.max(T.min, T.base + T.perEm * pathOf(atlas, (glyphs[j] as HandLayout["glyphs"][number]).ch))));
    const whole = durs.reduce((a, d) => a + d * R.overlap, 0);
    const squeeze = Math.min(1, R.most / (whole || 1));
    let t = now;
    return durs.map((d) => {
      const m = { start: t, dur: Math.max(R.least, d * squeeze) };
      t += d * R.overlap * squeeze;
      return m;
    });
  };

  return {
    look(key, L) {
      const had = sheets.get(key);
      const glyphs = L.layout.glyphs;
      const order = glyphs.map((g) => (L.seeds[g.index] ?? 0) | 0);
      // the same glyphs as the last look (a reflow, a redraw, a zoom): its answer, the very array — a kind keeps its run by identity
      if (had !== undefined && order.length === had.seeds.length && order.every((s, i) => s === had.seeds[i])) return had.out;
      const how = had === undefined ? (L.first ?? "shown") : L.how;
      const prev = had?.moments;
      const out = new Array<PenMoment>(glyphs.length);
      const next = new Map<number, PenMoment>();
      const fresh: number[] = [];
      /** A seed new to this look, by the first glyph that carries it (a second glyph of the same seed shares its moment). */
      const firstOf = new Map<number, number>();
      const twins: [number, number][] = [];
      for (let j = 0; j < glyphs.length; j++) {
        const g = glyphs[j] as HandLayout["glyphs"][number];
        const seed = (L.seeds[g.index] ?? 0) | 0;
        const old = prev?.get(seed);
        if (old !== undefined) {
          const m = settle(old, L.now);
          out[j] = m;
          next.set(seed, m);
          continue;
        }
        const first = firstOf.get(seed);
        if (first !== undefined) { twins.push([j, first]); continue; }
        firstOf.set(seed, j);
        fresh.push(j);
      }
      const flights: Flight[] = (had?.flights ?? []).filter((f) => f.end > L.now || f.end > lastTick);
      if (how === "shown" || fresh.length === 0) {
        for (const j of fresh) { out[j] = WRITTEN; next.set((L.seeds[(glyphs[j] as HandLayout["glyphs"][number]).index] ?? 0) | 0, WRITTEN); }
      } else {
        const made = schedule(glyphs, fresh, L.atlas, L.now, how, pace);
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        for (const j of fresh) {
          const m = made.get(j) as PenMoment;
          out[j] = m;
          next.set((L.seeds[(glyphs[j] as HandLayout["glyphs"][number]).index] ?? 0) | 0, m);
          lo = Math.min(lo, m.start);
          hi = Math.max(hi, m.start + m.dur);
        }
        flights.push({ start: lo, end: hi });
      }
      for (const [j, first] of twins) out[j] = out[first] as PenMoment;
      sheets.set(key, { moments: next, flights, seeds: order, out });
      return out;
    },

    marks(key, L) {
      const had = inks.get(key);
      const { layout, ink, now } = L;
      const glyphs = layout.glyphs;
      const seedAt = (i: number): number => (ink.seeds[i] ?? 0) | 0;
      const seeds = glyphs.map((g) => seedAt(g.index));
      const marks = glyphs.map((g) => (ink.marks[g.index] ?? 0) | 0);
      const keys = L.strokes.map((s) => strokeKey(s, seedAt));
      // the same glyphs, marks and strokes as the last look (a reflow, a redraw): its answer, the very object
      if (had !== undefined && same(seeds, had.seeds) && same(marks, had.marks) && same(keys, had.keys)) return had.out;
      const flights: Flight[] = (had?.flights ?? []).filter((f) => f.end > now || f.end > lastTick);
      const bySeed = new Map<number, number>();
      const reinks = new Map<number, { readonly start: number; readonly dur: number; readonly was: number }>();
      const was = new Array<number>(glyphs.length);
      const out = new Array<PenMoment>(glyphs.length);
      // THE RE-INKS: a seed seen before whose pen changed; a glyph new to the marks is `look`'s to write, in the pen it has
      const fresh: number[] = [];
      for (let j = 0; j < glyphs.length; j++) {
        const seed = seeds[j] as number;
        const pen = penNumber(marks[j] as number);
        bySeed.set(seed, marks[j] as number);
        was[j] = pen;
        out[j] = WRITTEN;
        const old = had?.bySeed.get(seed);
        if (old === undefined) continue;
        if (penNumber(old) !== pen) {
          // (a re-ink still being drawn when the pen changes again: its new pen is taken as written, and the next goes over it)
          was[j] = penNumber(old);
          fresh.push(j);
          continue;
        }
        const going = had?.reinks.get(seed);
        if (going !== undefined && going.start + going.dur > now) { was[j] = going.was; out[j] = { start: going.start, dur: going.dur }; reinks.set(seed, going); }
      }
      if (fresh.length > 0) {
        const made = reinkAt(glyphs, fresh, L.atlas, now);
        let end = now;
        fresh.forEach((j, n) => {
          const m = made[n] as PenMoment;
          out[j] = m;
          reinks.set(seeds[j] as number, { start: m.start, dur: m.dur, was: was[j] as number });
          end = Math.max(end, m.start + m.dur);
        });
        flights.push({ start: now, end });
      }
      // THE STROKES: each drawn over the stretch whose glyphs did not carry its value, after the letters under it being written
      const written = sheets.get(key)?.moments;
      const reinkOf = new Map<number, PenMoment>();
      for (const j of fresh) reinkOf.set((glyphs[j] as HandLayout["glyphs"][number]).index, out[j] as PenMoment);
      const S = pace.strokes ?? (PEN_PACE.strokes as NonNullable<PenPace["strokes"]>);
      const P = layout.positions;
      const blank = (i: number): boolean => { const c = ink.text.charCodeAt(i); return c === 32 || c === 10; };
      const strokes = new Map<string, StrokeMoment>();
      const drawn = L.strokes.map((s, q): StrokeMoment => {
        const k = keys[q] as string;
        /** When the stroke may set off: once every letter under it being written, or re-inked, is whole. */
        const after = (): number => {
          let t = now;
          for (let i = s.from; i < s.to; i++) {
            const w = written?.get(seedAt(i));
            if (w !== undefined && w.start + w.dur > t) t = w.start + w.dur;
            const r = reinkOf.get(i);
            if (r !== undefined && r.start + r.dur > t) t = r.start + r.dur;
          }
          return t;
        };
        let have: readonly [number, number] = [1, 0];
        let prior = -1;
        if (had === undefined) {
          if ((L.first ?? "shown") === "shown") return SHOWN;
        } else {
          // which of its glyphs carried this value at the last look (the first and the last of them), and what the others carried
          let a = -1;
          let b = -1;
          let all = true;
          let others: number | undefined;
          for (let i = s.from; i < s.to; i++) {
            if (blank(i)) continue;
            const old = had.bySeed.get(seedAt(i));
            const v = old === undefined ? 0 : strokeValueOf(s.kind, old);
            if (old !== undefined && v === s.value) { if (a < 0) a = i; b = i; continue; }
            all = false;
            others = others === undefined || others === v ? v : -1;
          }
          if (all) {
            const going = had.strokes.get(k);
            if (going !== undefined && going.start + going.dur > now) { strokes.set(k, going); return going; }
            return SHOWN;
          }
          if (a >= 0) {
            const ln = layout.lines[s.line] as HandLine;
            const right = (i: number): number => (i + 1 < ln.end ? (P[2 * (i + 1)] as number) : (P[2 * ln.start] as number) + ln.width);
            const span = s.x1 - s.x0;
            const frac = (x: number): number => (span > 0 ? Math.min(1, Math.max(0, (x - s.x0) / span)) : 0);
            have = [a === s.from ? 0 : frac(P[2 * a] as number), b === s.to - 1 ? 1 : frac(right(b))];
          } else if (others !== undefined && others > 0) prior = others;   // every glyph carried one other value: a recolour
        }
        // the pen pulls through what is new — after what was there when that is its start, up to it when that is its end
        const from = have[0] <= 0.004 ? have[1] : 0;
        const to = have[1] >= 0.996 ? have[0] : 1;
        const law = INK_STROKES[s.kind];
        const pacing = s.kind === "highlight" ? S.highlight : S.line;
        const width = s.x1 - s.x0 + (law.before + law.after) * layout.em;
        const dur = Math.min(pacing.most, pacing.base + (pacing.perEm * Math.max(0, to - from) * width) / layout.em);
        const m: StrokeMoment = { start: after(), dur, have, was: prior };
        strokes.set(k, m);
        flights.push({ start: m.start, end: m.start + m.dur });
        return m;
      });
      const answer: PenMarks = { was, reinks: out, strokes: drawn };
      inks.set(key, { seeds, marks, keys, out: answer, bySeed, reinks, strokes, flights });
      return answer;
    },

    due(now) {
      let next = Number.POSITIVE_INFINITY;
      for (const s of holders()) {
        for (const f of s.flights) {
          // being written now, or finished since the last tick (one frame owed to draw it whole)
          if (f.start <= now && (now < f.end || f.end > lastTick)) return now;
          if (f.start > now && f.start < next) next = f.start;
        }
      }
      return next;
    },

    tick(now) {
      let moved = false;
      for (const s of holders()) {
        if (s.flights.length === 0) continue;
        for (const f of s.flights) if (f.start <= now && f.end > lastTick) moved = true;
        s.flights = s.flights.filter((f) => f.end > now);
      }
      lastTick = now;
      return moved;
    },

    forget(key) { sheets.delete(key); inks.delete(key); },
    clear() { sheets.clear(); inks.clear(); },
    momentOf: (key, seed) => sheets.get(key)?.moments.get(seed | 0),

    writing(now) {
      const keys = new Set<PenKey>();
      for (const [k, s] of sheets) if (s.flights.some((f) => f.end > now)) keys.add(k);
      for (const [k, s] of inks) if (s.flights.some((f) => f.end > now)) keys.add(k);
      return keys.size;
    },
  };
}
