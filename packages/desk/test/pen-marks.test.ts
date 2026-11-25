// THE PEN'S CLOCK DRAWS THE MARKS (petition I60 — the pen draws every mark the way it draws a letter, when the mark is made and
// never when a desk opens), on a face of the tests' own. Pinned: an object's first marks look draws nothing; a highlight made is
// drawn from that moment, once — the same look again answers the same object, an edit elsewhere (its glyphs' seeds carried) keeps
// its moment and, once drawn, never draws it again; a stroke grown at an end draws only its new stretch; a stroke over words still
// being written waits for their letters; a pen change RE-INKS its glyphs from now, one after another at the typed pace, squeezed,
// the pen they had kept; a recolour draws the new value over the old; a line in the words' own pen follows a re-ink of its words;
// `first: "arrived"` draws an object's strokes after their letters; and the desk's wake: `due` now while a mark is drawn, then ∞.
import { describe, expect, it } from "vitest";
import { handMetricsOf } from "../src/kit/hand-atlas";
import { carryInk, findQuote, type InkValue, inkOf, mark, strokesOf } from "../src/kit/ink";
import { createPenClock, PEN_PACE, type PenClock, type PenMarks, type PenMoment, SHOWN, WRITTEN } from "../src/kit/pen-clock";
import { HAND, type HandLayout, layoutText } from "../src/kit/text";
import { fixtureFace } from "./hand-fixture";

const face = fixtureFace();
const metrics = handMetricsOf(face.atlas);
const lay = (ink: InkValue): HandLayout => layoutText(ink.text, { w: 900, h: 600 }, HAND, metrics, 5, ink.seeds);
const counter = (from: number) => { let n = from; return () => n++; };
/** What a kind's tick does for one sheet: the writing's look, then the marks' — both at `now`. */
function looks(clock: PenClock, key: number, ink: InkValue, now: number, how: "typed" | "arrived" = "typed", first?: "shown" | "arrived"): PenMarks {
  const L = lay(ink);
  clock.look(key, { layout: L, seeds: ink.seeds, atlas: face.atlas, now, how, ...(first !== undefined ? { first } : {}) });
  return clock.marks(key, { layout: L, ink, strokes: strokesOf(L, ink), atlas: face.atlas, now, ...(first === "arrived" ? { first } : {}) });
}
function range(ink: InkValue, quote: string, occurrence?: number): readonly [number, number] {
  const r = findQuote(ink.text, quote, occurrence);
  if ("error" in r) throw new Error(`no "${quote}"`);
  return [r.from, r.to];
}
const TEXT = "lol xo lox\nool lx xo";
const plain = (): InkValue => inkOf({ text: TEXT }, 3);

describe("the pen's clock draws the marks (petition I60)", () => {
  it("an object's first marks look draws nothing — every mark already on the paper, as a desk opening finds it — and asks no frame", () => {
    const clock = createPenClock();
    let ink = plain();
    ink = mark(ink, ...range(ink, "xo lox"), { highlight: "yellow" });
    ink = mark(ink, ...range(ink, "ool"), { strike: true });
    ink = mark(ink, ...range(ink, "lx xo"), { pen: "red" });
    const m = looks(clock, 1, ink, 5000);
    expect(m.strokes.length).toBe(2);
    expect(m.strokes.every((s) => s === SHOWN)).toBe(true);
    expect(m.reinks.every((r) => r === WRITTEN)).toBe(true);
    const L = lay(ink);
    expect(m.was).toEqual(L.glyphs.map((g) => ((ink.marks[g.index] ?? 0) & 7)));
    expect(clock.due(5000)).toBe(Number.POSITIVE_INFINITY);
    expect(clock.tick(5016)).toBe(false);
  });

  it("a highlight made is drawn from that moment, once: the same look answers the same object, an edit elsewhere keeps its moment, and once drawn it stays", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 1000);
    const hl = mark(ink, ...range(ink, "xo lox"), { highlight: "yellow" });
    const m = looks(clock, 1, hl, 2000);
    const s = m.strokes[0] as (typeof m.strokes)[number];
    expect(s).toMatchObject({ start: 2000, have: [1, 0], was: -1 });
    expect(s.dur).toBeGreaterThanOrEqual(PEN_PACE.strokes?.highlight.base as number);
    expect(s.dur).toBeLessThanOrEqual(PEN_PACE.strokes?.highlight.most as number);
    expect(m.reinks.every((r) => r === WRITTEN)).toBe(true);
    expect(clock.due(2000)).toBe(2000);
    expect(clock.tick(2016)).toBe(true);
    expect(looks(clock, 1, hl, 2030)).toBe(m);
    // a letter typed before it, 50 ms in: the seeds carried, its glyphs' marks unchanged — the stroke keeps its moment
    const typed = carryInk(hl, `l${hl.text}`, counter(500)).ink;
    const m2 = looks(clock, 1, typed, 2050);
    expect(m2.strokes[0]).toBe(s);
    // drawn: another edit, long after, finds it on the paper
    const later = carryInk(typed, `o${typed.text}`, counter(600)).ink;
    expect(looks(clock, 1, later, 9000).strokes[0]).toBe(SHOWN);
    // and the desk sleeps once it is drawn
    clock.tick(2000 + s.dur + 1);
    clock.tick(9500);
    expect(clock.due(9600)).toBe(Number.POSITIVE_INFINITY);
  });

  it("a stroke grown at its end draws only the new stretch, and one grown at its start only the new start", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 0);
    const short = mark(ink, ...range(ink, "xo", 1), { highlight: "green" });
    looks(clock, 1, short, 1000);
    const long = mark(short, ...range(short, "xo lox"), { highlight: "green" });
    const end = looks(clock, 1, long, 5000).strokes[0] as (typeof SHOWN);
    expect(end.start).toBe(5000);
    expect(end.have[0]).toBe(0);
    expect(end.have[1]).toBeGreaterThan(0.1);
    expect(end.have[1]).toBeLessThan(0.6);
    // the other way: "lox" first, then "xo lox" — what was on the paper is its end
    const clock2 = createPenClock();
    looks(clock2, 2, ink, 0);
    const tail = mark(ink, ...range(ink, "lox"), { highlight: "green" });
    looks(clock2, 2, tail, 1000);
    const grown = looks(clock2, 2, mark(tail, ...range(tail, "xo lox"), { highlight: "green" }), 5000).strokes[0] as (typeof SHOWN);
    expect(grown.have[1]).toBe(1);
    expect(grown.have[0]).toBeGreaterThan(0.3);
    expect(grown.have[0]).toBeLessThan(0.9);
    // the pen takes less time over the shorter stretch it draws than over the whole stroke made at once
    const clock3 = createPenClock();
    looks(clock3, 3, ink, 0);
    const whole = looks(clock3, 3, long, 5000).strokes[0] as (typeof SHOWN);
    expect(whole.have).toEqual([1, 0]);
    expect(end.dur).toBeLessThan(whole.dur);
  });

  it("a stroke over words still being written waits for their letters", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 0);
    // "ll" typed at the end, already highlighted (written inside a highlight, it would join one): the highlight waits for them
    const typed = carryInk(ink, `${ink.text} ll`, counter(800)).ink;
    const hl = mark(typed, typed.text.length - 2, typed.text.length, { highlight: "yellow" });
    const L = lay(hl);
    const moments = clock.look(1, { layout: L, seeds: hl.seeds, atlas: face.atlas, now: 3000, how: "typed" });
    const m = clock.marks(1, { layout: L, ink: hl, strokes: strokesOf(L, hl), atlas: face.atlas, now: 3000 });
    const last = moments[moments.length - 1] as PenMoment;
    expect(last.start).toBeGreaterThan(3000);
    expect((m.strokes[0] as (typeof SHOWN)).start).toBeCloseTo(last.start + last.dur, 9);
  });

  it("a pen change re-inks its glyphs from now, one after another at the typed pace, squeezed — the pen they had kept — and the rest keep theirs", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 0);
    const [a, b] = range(ink, "lol xo lox");
    const red = mark(ink, a, b, { pen: "red" });
    const m = looks(clock, 1, red, 2000);
    const L = lay(red);
    const inside = L.glyphs.map((g) => g.index >= a && g.index < b);
    let prev = Number.NEGATIVE_INFINITY;
    let end = 0;
    L.glyphs.forEach((_, j) => {
      const r = m.reinks[j] as PenMoment;
      if (!inside[j]) { expect(r).toBe(WRITTEN); expect(m.was[j]).toBe(0); return; }
      expect(m.was[j]).toBe(0);
      expect(r.start).toBeGreaterThanOrEqual(2000);
      expect(r.start).toBeGreaterThan(prev);
      expect(r.dur).toBeGreaterThanOrEqual(PEN_PACE.reink?.least as number);
      expect(r.dur).toBeLessThanOrEqual(PEN_PACE.typed.max);
      prev = r.start;
      end = Math.max(end, r.start + r.dur);
    });
    expect((m.reinks[inside.indexOf(true)] as PenMoment).start).toBe(2000);
    expect(end - 2000).toBeLessThanOrEqual((PEN_PACE.reink?.most as number) + PEN_PACE.typed.max);
    // the same look again: the same object; long after, they are simply in their new pen
    expect(looks(clock, 1, red, 2040)).toBe(m);
    const later = mark(red, ...range(red, "ool"), { highlight: "pink" });
    const m2 = looks(clock, 1, later, 9000);
    expect(m2.reinks.every((r) => r === WRITTEN)).toBe(true);
    expect(m2.was.filter((_, j) => inside[j]).every((p) => p === 4)).toBe(true);
  });

  it("a recolour draws the new value over the old: the highlighter changed is drawn with the one it had under it", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 0);
    const yellow = mark(ink, ...range(ink, "xo lox"), { highlight: "yellow" });
    looks(clock, 1, yellow, 1000);
    const pink = mark(yellow, ...range(yellow, "xo lox"), { highlight: "pink" });
    const s = looks(clock, 1, pink, 6000).strokes[0] as (typeof SHOWN);
    expect(s).toMatchObject({ start: 6000, have: [1, 0], was: 1 });
  });

  it("a line in the words' own pen follows a re-ink of its words: drawn in the new pen over the old, once the letters are", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 0);
    const struck = mark(ink, ...range(ink, "ool"), { strike: true });
    looks(clock, 1, struck, 1000);
    const red = mark(struck, ...range(struck, "ool"), { pen: "red" });
    const m = looks(clock, 1, red, 6000);
    const s = m.strokes[0] as (typeof SHOWN);
    // its value was the sheet's own pen (1); now it is red's (PENS[3]: 5); it sets off when the last re-inked letter is whole
    expect(s.was).toBe(1);
    const end = Math.max(...m.reinks.filter((r) => r !== WRITTEN).map((r) => r.start + r.dur));
    expect(s.start).toBeCloseTo(end, 9);
  });

  it("`first: \"arrived\"` draws an object's strokes after their letters — a kind that knows it is new", () => {
    const clock = createPenClock();
    let ink = plain();
    ink = mark(ink, ...range(ink, "lox"), { underline: "fountain" });
    const L = lay(ink);
    const moments = clock.look(4, { layout: L, seeds: ink.seeds, atlas: face.atlas, now: 100, how: "arrived", first: "arrived" });
    const m = clock.marks(4, { layout: L, ink, strokes: strokesOf(L, ink), atlas: face.atlas, now: 100, first: "arrived" });
    const [a, b] = range(ink, "lox");
    const ends = L.glyphs.flatMap((g, j) => (g.index >= a && g.index < b ? [(moments[j] as PenMoment).start + (moments[j] as PenMoment).dur] : []));
    expect((m.strokes[0] as (typeof SHOWN)).start).toBeCloseTo(Math.max(...ends), 9);
    expect(clock.writing(150)).toBe(1);
  });

  it("wakes the desk while a mark is drawn and not after; a forgotten object is first seen again", () => {
    const clock = createPenClock();
    const ink = plain();
    looks(clock, 1, ink, 0);
    clock.tick(16);
    const hl = mark(ink, ...range(ink, "lol"), { highlight: "yellow" });
    const s = looks(clock, 1, hl, 1000).strokes[0] as (typeof SHOWN);
    expect(clock.due(1000)).toBe(1000);
    expect(clock.writing(1000)).toBe(1);
    expect(clock.tick(1016)).toBe(true);
    // its last frame: one tick after it ends draws it whole, then nothing
    expect(clock.tick(1000 + s.dur + 5)).toBe(true);
    expect(clock.due(1000 + s.dur + 20)).toBe(Number.POSITIVE_INFINITY);
    expect(clock.tick(1000 + s.dur + 40)).toBe(false);
    clock.forget(1);
    const again = looks(clock, 1, mark(hl, ...range(hl, "lox"), { strike: "ball" }), 5000);
    expect(again.strokes.every((x) => x === SHOWN)).toBe(true);
  });
});
