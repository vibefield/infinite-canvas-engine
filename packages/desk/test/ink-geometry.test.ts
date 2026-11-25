// THE INK'S GEOMETRY (petition I60; kit/ink.ts) over the kit's own layout (text.ts `layoutText`): the caret index nearest a point
// by the note's scoring, the word and the laid line around an index, a range's wash as one rect a line from the caret places,
// and every mark as the strokes a hand makes — one a line for each run of one value, its spaces trimmed. The hand here has no
// jitter, so every place is exact: a 24-unit em, a 16-unit margin, each glyph 12 wide and a space 7.2, the baselines 27.84 apart.
import { describe, expect, it } from "vitest";
import { indexIn, inkOf, type InkValue, lineAt, mark, spansOf, strokesOf, wordAt } from "../src/kit/ink";
import { caretAt, HAND, type HandMetrics, layoutText } from "../src/kit/text";

/** Every glyph half an em wide, a space 0.3 (the paper's test face). */
const MONO: HandMetrics = { ascent: 0.8, descent: 0.25, advance: (ch) => (ch === " " ? 0.3 : 0.5) };
/** The hand with no jitter and no wander: where a place must be exact. */
const FLAT = { ...HAND, jitter: { rot: 0, rise: 0, scale: 0, press: [1, 1] as readonly [number, number] }, wander: { amp: 0, period: 9 } };
const lay = (text: string) => layoutText(text, { w: 200, h: 200 }, FLAT, MONO, 3);
const plain = (text: string): InkValue => inkOf({ text }, 3);
/** A record's numbers to a thousandth: the layout keeps its places in f32. */
const near = <T extends object>(rows: readonly T[]): T[] => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 1000) / 1000 : v])) as T);

// "ab cd\nef": the caret's places 16 · 28 · 40 · 47.2 · 59.2 · 71.2 (before the newline) on the baseline 35.2, then 16 · 28 · 40
// on 63.04; a line's middle, where the scoring reads it, is 0.4 of the ascent (19.2) above its baseline: 27.52 and 55.36
const T = "ab cd\nef";

describe("the ink's geometry (kit/ink.ts)", () => {
  it("indexIn: the caret index nearest a point, by the note's scoring — lines weigh three times the columns, from each line's middle", () => {
    const L = lay(T);
    expect(indexIn(L, 30, 27.52, T.length)).toBe(1);
    expect(indexIn(L, 17, 26, T.length)).toBe(0);    // the prototype's: just inside the top left
    expect(indexIn(L, 150, 27.52, T.length)).toBe(5);   // past a line's end: the caret before its newline
    expect(indexIn(L, 29, 56, T.length)).toBe(7);
    expect(indexIn(L, 22, 27.52, T.length)).toBe(0);    // halfway between two places: the first of equals
    // the weight: a column weighed once against a line would take index 4 here — three times, the nearer line wins
    expect(indexIn(L, 60, 50, T.length)).toBe(8);
    // the middle: from the baselines this point is nearer the first line (index 2); from the middles, the second
    expect(indexIn(L, 40, 45, T.length)).toBe(8);
    // `length` bounds the places scored
    expect(indexIn(L, 150, 27.52, 2)).toBe(2);
    expect(indexIn(L, 150, 27.52, 99)).toBe(5);
  });

  it("wordAt: letters, digits, their marks and apostrophes are a word's; on a space, the run of spaces; else one character", () => {
    expect(wordAt("ship the pen", 6)).toEqual({ from: 5, to: 8 });     // the prototype's
    expect(wordAt("ship the pen", 4)).toEqual({ from: 0, to: 4 });     // the caret just after a word takes that word
    expect(wordAt("ship the pen", 5)).toEqual({ from: 5, to: 8 });
    expect(wordAt("ship the pen", 12)).toEqual({ from: 9, to: 12 });
    expect(wordAt("a   b", 2)).toEqual({ from: 1, to: 4 });
    expect(wordAt("a   b", 1)).toEqual({ from: 0, to: 1 });
    expect(wordAt("a   b", 4)).toEqual({ from: 4, to: 5 });
    expect(wordAt("don't stop", 2)).toEqual({ from: 0, to: 5 });
    expect(wordAt(`it${String.fromCharCode(0x2019)}s here`, 1)).toEqual({ from: 0, to: 4 });
    expect(wordAt("at 64 now", 4)).toEqual({ from: 3, to: 5 });
    expect(wordAt("café crème", 2)).toEqual({ from: 0, to: 4 });
    expect(wordAt(`cafe${String.fromCharCode(0x301)} ok`, 1)).toEqual({ from: 0, to: 5 });   // a combining accent is its letter's
    expect(wordAt("a , b", 2)).toEqual({ from: 2, to: 3 });
    expect(wordAt(`a ${String.fromCodePoint(0x1f600)} b`, 2)).toEqual({ from: 2, to: 4 });   // a pair is one character
    expect(wordAt("", 0)).toEqual({ from: 0, to: 0 });
    expect(wordAt("ab\n\ncd", 3)).toEqual({ from: 3, to: 3 });   // an empty line: nothing
    expect(wordAt("ab \ncd", 3)).toEqual({ from: 2, to: 3 });    // a line's end after a space: the space
    expect(wordAt("abc", 99)).toEqual({ from: 0, to: 3 });
    expect(wordAt("abc", -1)).toEqual({ from: 0, to: 3 });
  });

  it("lineAt: the layout's own line around an index — a broken line with its newline, a wrapped one with its trailing space", () => {
    const L = lay(T);
    expect(lineAt(L, 0)).toEqual({ from: 0, to: 6 });
    expect(lineAt(L, 5)).toEqual({ from: 0, to: 6 });
    expect(lineAt(L, 6)).toEqual({ from: 6, to: 8 });
    expect(lineAt(L, 8)).toEqual({ from: 6, to: 8 });
    expect(lineAt(L, 99)).toEqual({ from: 6, to: 8 });
    expect(lineAt(L, -4)).toEqual({ from: 0, to: 6 });
    // "aaaa " fills 55.2 of the line's 168; the twelve b's (144) wrap whole
    const W = lay("aaaa bbbbbbbbbbbb");
    expect(lineAt(W, 4)).toEqual({ from: 0, to: 5 });
    expect(lineAt(W, 5)).toEqual({ from: 5, to: 17 });
    expect(lineAt(lay("ab\n"), 3)).toEqual({ from: 3, to: 3 });   // the empty line after a closing newline
  });

  it("spansOf: one rect a line the range touches, from the caret's places and its height — a line it runs to the end of shows a sliver", () => {
    const L = lay(T);
    expect(near(spansOf(L, 1, 4))).toEqual([{ line: 0, x0: 28, x1: 59.2, y0: 16, y1: 41.2 }]);
    // across the break: the first line to its end and a fifth of an em past it (the newline, seen), then the next
    expect(near(spansOf(L, 3, 7))).toEqual([{ line: 0, x0: 47.2, x1: 76, y0: 16, y1: 41.2 }, { line: 1, x0: 16, x1: 28, y0: 43.84, y1: 69.04 }]);
    expect(near(spansOf(L, 1, 6))).toEqual([{ line: 0, x0: 28, x1: 76, y0: 16, y1: 41.2 }]);   // the newline itself selected
    expect(near(spansOf(L, 1, 5))).toEqual([{ line: 0, x0: 28, x1: 71.2, y0: 16, y1: 41.2 }]);   // up to it, not past
    expect(near(spansOf(L, 6, 8))).toEqual([{ line: 1, x0: 16, x1: 40, y0: 43.84, y1: 69.04 }]);   // the last line has nothing past it
    // the caret's own places: x0 where the caret before `from` stands, y0 its top
    const [first] = spansOf(L, 1, 4);
    const c = caretAt(L, 1);
    expect([first?.x0, first?.y0, first?.y1]).toEqual([c.x, c.y - c.above, c.y + c.below]);
    // an empty line in the range is a sliver, not lost
    expect(near(spansOf(lay("ab\n\ncd"), 0, 6))).toEqual([
      { line: 0, x0: 16, x1: 44.8, y0: 16, y1: 41.2 },
      { line: 1, x0: 16, x1: 20.8, y0: 43.84, y1: 69.04 },
      { line: 2, x0: 16, x1: 40, y0: 71.68, y1: 96.88 },
    ]);
    // a wrapped line runs to its trailing space, then the sliver
    expect(near(spansOf(lay("aaaa bbbbbbbbbbbb"), 2, 7))).toEqual([{ line: 0, x0: 40, x1: 76, y0: 16, y1: 41.2 }, { line: 1, x0: 16, x1: 40, y0: 43.84, y1: 69.04 }]);
    expect(spansOf(L, 3, 3)).toEqual([]);
    expect(spansOf(L, 7, 3)).toEqual(spansOf(L, 3, 7));
    expect(spansOf(L, -5, 99)).toEqual(spansOf(L, 0, 8));
  });

  it("strokesOf: one stroke a line for each run of one value, its spaces trimmed — a strike 0.2 em above the baseline, an underline 0.15 under", () => {
    const L = lay(T);
    expect(near(strokesOf(L, mark(plain(T), 1, 5, { highlight: "yellow" })))).toEqual([{ line: 0, kind: "highlight", value: 1, from: 1, to: 5, x0: 28, x1: 71.2, y: 30.4 }]);
    expect(near(strokesOf(L, mark(plain(T), 2, 6, { highlight: "yellow" })))).toEqual([{ line: 0, kind: "highlight", value: 1, from: 3, to: 5, x0: 47.2, x1: 71.2, y: 30.4 }]);
    expect(near(strokesOf(L, mark(plain(T), 0, 2, { strike: true })))).toEqual([{ line: 0, kind: "strike", value: 1, from: 0, to: 2, x0: 16, x1: 40, y: 30.4 }]);
    expect(near(strokesOf(L, mark(plain(T), 0, 2, { underline: true })))).toEqual([{ line: 0, kind: "underline", value: 1, from: 0, to: 2, x0: 16, x1: 40, y: 38.8 }]);
    // never across a newline, and one a line across a wrap
    expect(near(strokesOf(L, mark(plain(T), 3, 8, { highlight: "pink" })))).toEqual([
      { line: 0, kind: "highlight", value: 2, from: 3, to: 5, x0: 47.2, x1: 71.2, y: 30.4 },
      { line: 1, kind: "highlight", value: 2, from: 6, to: 8, x0: 16, x1: 40, y: 58.24 },
    ]);
    const W = "aaaa bbbbbbbbbbbb";
    expect(near(strokesOf(lay(W), mark(plain(W), 0, W.length, { highlight: "green" })))).toEqual([
      { line: 0, kind: "highlight", value: 3, from: 0, to: 4, x0: 16, x1: 64, y: 30.4 },
      { line: 1, kind: "highlight", value: 3, from: 5, to: 17, x0: 16, x1: 160, y: 58.24 },
    ]);
    expect(strokesOf(L, plain(T))).toEqual([]);
  });

  it("strokesOf runs by the FIELD's value: two highlighters are two strokes, a pen change under one highlight is one; each line its kinds in order", () => {
    const A = lay("abcd");
    expect(near(strokesOf(A, mark(mark(plain("abcd"), 0, 2, { highlight: "yellow" }), 2, 4, { highlight: "pink" })))).toEqual([
      { line: 0, kind: "highlight", value: 1, from: 0, to: 2, x0: 16, x1: 40, y: 30.4 },
      { line: 0, kind: "highlight", value: 2, from: 2, to: 4, x0: 40, x1: 64, y: 30.4 },
    ]);
    expect(strokesOf(A, mark(mark(plain("abcd"), 0, 4, { highlight: "yellow" }), 0, 2, { pen: "red" })).length).toBe(1);
    const all = mark(mark(mark(plain("abcd"), 0, 4, { underline: true }), 0, 4, { strike: true }), 0, 4, { highlight: "yellow" });
    expect(strokesOf(A, all).map((s) => s.kind)).toEqual(["highlight", "strike", "underline"]);
  });

  it("strokesOf draws a line in the words' own pen in each one's pen — split where the words' pen changes, never at a space between", () => {
    const S = "red ink here";   // 16 · 28 · 40 · 52 · 59.2 … 95.2 (the second space) · 102.4 … 150.4
    const penned = mark(mark(plain(S), 0, 7, { pen: "red" }), 0, S.length, { strike: true });
    // 1 is the sheet's own pen; n ≥ 2 is PENS[n − 2]: red is 5
    expect(near(strokesOf(lay(S), penned))).toEqual([
      { line: 0, kind: "strike", value: 5, from: 0, to: 7, x0: 16, x1: 95.2, y: 30.4 },
      { line: 0, kind: "strike", value: 1, from: 8, to: 12, x0: 102.4, x1: 150.4, y: 30.4 },
    ]);
    // a line in a named pen is that pen over every word, whatever pens they are in
    expect(near(strokesOf(lay(S), mark(penned, 0, S.length, { strike: "ball" })))).toEqual([{ line: 0, kind: "strike", value: 3, from: 0, to: 12, x0: 16, x1: 150.4, y: 30.4 }]);
    // two red words penned apart, the space between them in the sheet's pen: the line through them is one
    const R = "red red";
    const apart = mark(mark(mark(plain(R), 0, 3, { pen: "red" }), 4, 7, { pen: "red" }), 0, R.length, { underline: true });
    expect(near(strokesOf(lay(R), apart))).toEqual([{ line: 0, kind: "underline", value: 5, from: 0, to: 7, x0: 16, x1: 95.2, y: 38.8 }]);
  });
});
