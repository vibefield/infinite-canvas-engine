// THE PEN'S CLOCK (petition I59 — hand-moves A: the writing moves as you type and when writing arrives, never when a desk opens),
// on a face of the tests' own. Pinned: an object's first look writes nothing; typed glyphs are written from the look's `now` at
// the hand's typing pace; a glyph's moment is KEYED BY ITS SEED, so an insert before it (seeds carried by `carrySeeds`) never
// writes it again; arrived writing is written word by word, the letters of a word one after another, all within the pace's most;
// a kind that knows an object is new has its first look written; a forgotten object is first seen again; a seed that left the
// text is written again when it comes back; and the desk's wake: `due` now while the pen writes, one tick to draw it whole, then
// ∞ — nothing polled at rest.
import { describe, expect, it } from "vitest";
import { handMetricsOf } from "../src/kit/hand-atlas";
import { createPenClock, PEN_PACE, type PenMoment, WRITTEN } from "../src/kit/pen-clock";
import { carrySeeds, HAND, type HandLayout, layoutText } from "../src/kit/text";
import { fixtureFace } from "./hand-fixture";

const face = fixtureFace();
const metrics = handMetricsOf(face.atlas);
const lay = (text: string, seeds: readonly number[]): HandLayout => layoutText(text, { w: 900, h: 600 }, HAND, metrics, 5, seeds);
const look = (clock: ReturnType<typeof createPenClock>, key: number, text: string, seeds: readonly number[], now: number, how: "typed" | "arrived" | "shown", first?: "typed" | "arrived" | "shown") =>
  clock.look(key, { layout: lay(text, seeds), seeds, atlas: face.atlas, now, how, ...(first !== undefined ? { first } : {}) });
const counter = (from: number) => { let n = from; return () => n++; };

describe("the pen's clock (petition I59)", () => {
  it("an object's first look writes nothing — every glyph already there, as a desk opening finds it — and asks no frame", () => {
    const clock = createPenClock();
    const m = look(clock, 1, "lox lo", [11, 12, 13, 14, 15, 16], 5000, "arrived");
    expect(m.length).toBe(5);
    expect(m.every((x) => x === WRITTEN)).toBe(true);
    expect(clock.due(5000)).toBe(Number.POSITIVE_INFINITY);
    expect(clock.tick(5016)).toBe(false);
  });

  it("typed: each new glyph from now at the hand's typing pace; the glyphs already there keep theirs", () => {
    const clock = createPenClock();
    look(clock, 1, "lo", [1, 2], 1000, "typed");
    const m = look(clock, 1, "lox", [1, 2, 3], 1300, "typed");
    expect(m.slice(0, 2)).toEqual([WRITTEN, WRITTEN]);
    const x = m[2] as PenMoment;
    expect(x.start).toBe(1300);
    expect(x.dur).toBeGreaterThanOrEqual(PEN_PACE.typed.min);
    expect(x.dur).toBeLessThanOrEqual(PEN_PACE.typed.max);
    // two new glyphs in one look (an input method's commit) follow one another
    const two = look(clock, 1, "loxlo", [1, 2, 3, 4, 5], 1310, "typed");
    expect(two[2]).toEqual(x);   // still being written: its moment kept
    expect((two[4] as PenMoment).start).toBeCloseTo(1310 + (two[3] as PenMoment).dur * PEN_PACE.overlap, 6);
  });

  it("is keyed by the SEED: a glyph inserted before others never writes them again, even mid-stroke", () => {
    const clock = createPenClock();
    const fresh = counter(100);
    look(clock, 7, "lo", [1, 2], 0, "typed");
    const typed = carrySeeds("lo", [1, 2], "lox", fresh);   // "x" typed at the end
    const m1 = look(clock, 7, "lox", typed.seeds, 2000, "typed");
    const x = m1[2] as PenMoment;
    expect(x.start).toBe(2000);
    // 40 ms later, a glyph typed at the START: the carry keeps every seed after it, so "x" keeps the moment it is being written at
    const inserted = carrySeeds("lox", typed.seeds, "xlox", fresh);
    expect(inserted.from).toBe(0);
    expect(inserted.seeds.slice(1)).toEqual(typed.seeds);
    const m2 = look(clock, 7, "xlox", inserted.seeds, 2040, "typed");
    expect(m2[3]).toEqual(x);
    expect((m2[0] as PenMoment).start).toBe(2040);
    expect(m2.slice(1, 3)).toEqual([WRITTEN, WRITTEN]);
    expect(clock.momentOf(7, typed.seeds[2] as number)).toEqual(x);
    // a reflow (the same seeds, another box) writes nothing again either: the last look's very answer, so the kind keeps its run
    const narrow = clock.look(7, { layout: layoutText("xlox", { w: 60, h: 600 }, HAND, metrics, 5, inserted.seeds), seeds: inserted.seeds, atlas: face.atlas, now: 2050, how: "typed" });
    expect(narrow).toBe(m2);
  });

  it("arrived: every word its own pen, each setting off after the one before, its letters one after another — the whole within the pace's most", () => {
    const clock = createPenClock();
    look(clock, 3, "", [], 0, "arrived");   // the object seen, empty
    const text = "lol xo lox ool";
    const seeds = Array.from({ length: text.length }, (_, i) => 1000 + i);
    const m = look(clock, 3, text, seeds, 10_000, "arrived");
    const L = lay(text, seeds);
    expect(m.length).toBe(L.glyphs.length);
    const words: PenMoment[][] = [];
    let prev = -2;
    L.glyphs.forEach((g, j) => { if (g.index !== prev + 1) words.push([]); (words[words.length - 1] as PenMoment[]).push(m[j] as PenMoment); prev = g.index; });
    expect(words.length).toBe(4);
    expect((words[0]?.[0] as PenMoment).start).toBe(10_000);
    for (let w = 1; w < words.length; w++) expect((words[w]?.[0] as PenMoment).start).toBeGreaterThan((words[w - 1]?.[0] as PenMoment).start);
    for (const word of words) for (let k = 1; k < word.length; k++) {
      const a = word[k - 1] as PenMoment;
      expect((word[k] as PenMoment).start).toBeCloseTo(a.start + a.dur * PEN_PACE.arrived.overlap, 6);
    }
    const end = Math.max(...m.map((x) => x.start + x.dur));
    expect(end - 10_000).toBeLessThanOrEqual(PEN_PACE.arrived.most + 1e-6);
    // a long arrival is squeezed into the most, no glyph under the least
    const long = "lol xo lox ool ".repeat(30);
    const ls = Array.from({ length: long.length }, (_, i) => 5000 + i);
    const lm = look(clock, 3, long, ls, 20_000, "arrived");
    expect(Math.max(...lm.map((x) => x.start + x.dur)) - 20_000).toBeLessThanOrEqual(PEN_PACE.arrived.most + 1e-6);
    expect(Math.min(...lm.filter((x) => x !== WRITTEN).map((x) => x.dur))).toBeGreaterThanOrEqual(PEN_PACE.arrived.least);
  });

  it("a kind that knows an object is new has its first look written (`first`); a forgotten object is first seen again", () => {
    const clock = createPenClock();
    const born = look(clock, 9, "lox", [1, 2, 3], 100, "arrived", "arrived");
    expect(born.every((x) => x.start >= 100 && x.dur > 0)).toBe(true);
    clock.forget(9);
    expect(clock.momentOf(9, 1)).toBeUndefined();
    expect(look(clock, 9, "lox", [1, 2, 3], 5000, "arrived").every((x) => x === WRITTEN)).toBe(true);
  });

  it("a seed that left the text is forgotten: brought back (an undo), it is written again", () => {
    const clock = createPenClock();
    look(clock, 4, "lox", [1, 2, 3], 0, "typed");
    look(clock, 4, "lo", [1, 2], 500, "typed");
    expect(clock.momentOf(4, 3)).toBeUndefined();
    const back = look(clock, 4, "lox", [1, 2, 3], 900, "arrived");
    expect((back[2] as PenMoment).start).toBe(900);
  });

  it("wakes the desk while the pen writes and once more to draw it whole — then sleeps: nothing polled at rest (K7a)", () => {
    const clock = createPenClock();
    look(clock, 1, "lo", [1, 2], 0, "typed");
    expect(clock.due(0)).toBe(Number.POSITIVE_INFINITY);
    const m = look(clock, 1, "lox", [1, 2, 3], 1000, "typed");
    const end = (m[2] as PenMoment).start + (m[2] as PenMoment).dur;
    expect(clock.due(1000)).toBe(1000);
    expect(clock.writing(1000)).toBe(1);
    let t = 1000;
    const moved: boolean[] = [];
    while (t < end + 40) { t += 16; moved.push(clock.tick(t)); if (t < end) expect(clock.due(t)).toBe(t); }
    // every tick through the writing moved, and the first tick past its end (it draws the glyph whole); then none
    const past = moved.findIndex((_, i) => 1000 + 16 * (i + 1) >= end);
    expect(moved.slice(0, past + 1).every(Boolean)).toBe(true);
    expect(moved.slice(past + 1).some(Boolean)).toBe(false);
    expect(clock.due(t)).toBe(Number.POSITIVE_INFINITY);
    expect(clock.writing(t)).toBe(0);
    // a writing set to begin later (an arrival scheduled ahead of the clock): due at its start, not before
    const ahead = createPenClock();
    look(ahead, 2, "", [], 0, "arrived");
    look(ahead, 2, "lo", [5, 6], 3000, "arrived");
    expect(ahead.due(2000)).toBe(3000);
  });
});
