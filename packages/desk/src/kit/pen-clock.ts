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

import { glyphOf, type HandAtlas } from "./hand-atlas";
import type { HandLayout } from "./text";

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
}

/** The pen's pace on the desk (`createPenClock`'s unless a kind says): ms. */
export const PEN_PACE: PenPace = {
  typed: { base: 90, perEm: 45, min: 100, max: 190 },
  arrived: { base: 40, perRootEm: 23.077, overlap: 0.82, lead: 70, stagger: 0.35, staggerMax: 220, most: 1400, least: 45 },
  overlap: 0.82,
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

export interface PenClock {
  /**
   * The moments of a sheet's glyphs as of `look.now`, one per `look.layout.glyphs` entry in its order: a seed seen before keeps
   * its moment (a glyph long written comes back `WRITTEN`); a new one is written as `look.how` says — or, at the object's first
   * look, as `look.first` says (`shown`). Every seed not in this look is forgotten. A look whose glyphs carry the same seeds in the
   * same order as the last (a reflow, a redraw) answers the LAST look's very array: a kind keeps the run it built by identity.
   */
  look(key: PenKey, look: PenLook): readonly PenMoment[];
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
  /** How many objects have a glyph not yet whole at `now` (a witness). */
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
  let lastTick = Number.NEGATIVE_INFINITY;

  /** A moment as of `now`: a glyph whole by then is simply WRITTEN (its moment is no longer needed). */
  const settle = (m: PenMoment, now: number): PenMoment => (m.start + m.dur <= now ? WRITTEN : m);

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

    due(now) {
      let next = Number.POSITIVE_INFINITY;
      for (const s of sheets.values()) {
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
      for (const s of sheets.values()) {
        if (s.flights.length === 0) continue;
        for (const f of s.flights) if (f.start <= now && f.end > lastTick) moved = true;
        s.flights = s.flights.filter((f) => f.end > now);
      }
      lastTick = now;
      return moved;
    },

    forget(key) { sheets.delete(key); },
    clear() { sheets.clear(); },
    momentOf: (key, seed) => sheets.get(key)?.moments.get(seed | 0),

    writing(now) {
      let n = 0;
      for (const s of sheets.values()) if (s.flights.some((f) => f.end > now)) n += 1;
      return n;
    },
  };
}
