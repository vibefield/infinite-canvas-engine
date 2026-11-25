// THE INK VALUE (petition I60; kit/ink.ts): the three rows a written object edits as one — the text, each glyph's seed, each
// glyph's mark — the cell's runs exact and pinned, their reader tolerant, and the verbs pure: an edit keeps every untouched
// glyph's hand and marks, letters arriving inside a mark join it (at its edge they do not), a paste carries the words and their
// marks and writes them again in a fresh hand, and an agent quotes the words it means and reads the marks by name. The rows port
// the prototype's own checks (the design's spike, ink-edit/check.mjs) where they apply.
import { describe, expect, it } from "vitest";
import { carryInk, cleanPiece, decodeMarks, encodeMarks, findQuote, highlightOf, type InkChange, inkCells, inkOf, type InkPiece, type InkValue, lift, mark, paste, penOf, readWriting, replace, splice, strikeOf, underlineOf } from "../src/kit/ink";
import { encodeSeeds, seedsFor } from "../src/kit/seeds";
import { carrySeeds, glyphSeed, HIGHLIGHTERS, type HighlighterName, PENS, type PenName } from "../src/kit/text";

// a mark's numbers spelled out once: 3 bits a field, low bits first — pen · highlighter · strike · underline
const BALL = 2;            // pen 2: PENS[1]
const RED = 4;             // pen 4: PENS[3]
const YELLOW = 1 << 3;     // highlighter 1: HIGHLIGHTERS[0]
const PINK = 2 << 3;
const GREEN = 3 << 3;
const STRUCK = 1 << 6;     // a line through, in the words' own pen
const STRUCK_RED = 5 << 6; // …in PENS[3]
const UNDER = 1 << 9;      // a line under, in the words' own pen

/** The prototype's sheet. */
const TEXT = "ship the pen on Friday\nbake the atlas at 64\ndraft the intro\ncheck the kerning\nthe note goes after the pad";

/** Where `quote` is in `text`, once — or a thrown name. */
function where(text: string, quote: string): [number, number] {
  const r = findQuote(text, quote);
  if (!("from" in r)) throw new Error(`"${quote}" is not on the sheet once: ${JSON.stringify(r)}`);
  return [r.from, r.to];
}

/** The prototype's sheet in its own hand (seed 11), four of its five lines marked. */
function sheet(): InkValue {
  let ink = inkOf({ text: TEXT, seeds: "", marks: "" }, 11);
  ink = mark(ink, ...where(TEXT, "on Friday"), { highlight: "yellow" });
  ink = mark(ink, ...where(TEXT, "draft the intro"), { strike: "red" });
  ink = mark(ink, ...where(TEXT, "kerning"), { underline: true });
  ink = mark(ink, ...where(TEXT, "bake the atlas"), { pen: "red" });
  return ink;
}

/** A fresh seed from `from` up, one a call. */
const counter = (from: number): (() => number) => {
  let k = from;
  return () => k++;
};

describe("the ink's marks (kit/ink.ts)", () => {
  it("a mark is four fields of 3 bits, low bits first — pen, highlighter, strike, underline — over the kit's names, whose order is stored", () => {
    expect(PENS).toEqual(["felt", "ball", "fountain", "red"]);
    expect(HIGHLIGHTERS).toEqual(["yellow", "pink", "green"]);
    const m = RED | PINK | STRUCK | (3 << 9);
    expect([penOf(m), highlightOf(m), strikeOf(m), underlineOf(m)]).toEqual([4, 2, 1, 3]);
    expect([penOf(0), highlightOf(0), strikeOf(0), underlineOf(0)]).toEqual([0, 0, 0, 0]);
  });

  it("stores runs of count:mark in base 36, the unmarked tail dropped — an unmarked sheet stores \"\" — in a pinned format", () => {
    expect(encodeMarks([])).toBe("");
    expect(encodeMarks([0, 0, 0])).toBe("");
    expect(encodeMarks([0, 0, YELLOW, YELLOW, 0, 0])).toBe("2:0,2:8");
    expect(encodeMarks(new Array(40).fill(PINK))).toBe("14:g");
    expect(encodeMarks([STRUCK_RED])).toBe("1:8w");
    // the prototype's sheet, pinned: the cell's format may never drift
    expect(encodeMarks(sheet().marks)).toBe("d:0,9:8,1:0,e:4,7:0,f:8w,b:0,7:e8");
    // the encoder writes only what the reader keeps: a pen out of range is 0, a bit past the four fields is gone
    expect(encodeMarks([7, YELLOW | (1 << 12)])).toBe("1:0,1:8");
  });

  it("reads tolerantly: a malformed run ends the read, a short row pads with 0, a long one is cut, a field out of range and a newline read 0", () => {
    expect(decodeMarks("", "abc")).toEqual([0, 0, 0]);
    expect(decodeMarks("2:8", "abcd")).toEqual([YELLOW, YELLOW, 0, 0]);
    expect(decodeMarks("9:8", "abc")).toEqual([YELLOW, YELLOW, YELLOW]);
    expect(decodeMarks("1:8,x,1:8", "abc")).toEqual([YELLOW, 0, 0]);
    expect(decodeMarks("1:8,-1:8,1:8", "abc")).toEqual([YELLOW, 0, 0]);
    expect(decodeMarks("1:8,", "abc")).toEqual([YELLOW, 0, 0]);
    expect(decodeMarks("not runs at all ✗", "ab")).toEqual([0, 0]);
    expect(decodeMarks("3:8", "a\nb")).toEqual([YELLOW, 0, YELLOW]);   // a newline carries 0, whatever the cell says
    expect(decodeMarks("2:G", "ab")).toEqual([PINK, PINK]);             // base 36 in either case
    // a field out of range reads 0 and the fields in range stay: a stranger's pen 7 and highlighter 5 on a strike
    expect(decodeMarks(`1:${(7 | (5 << 3) | STRUCK).toString(36)}`, "a")).toEqual([STRUCK]);
    // …and no bit past the four fields survives the read
    expect(decodeMarks(`1:${((1 << 12) | YELLOW).toString(36)}`, "a")).toEqual([YELLOW]);
    // the prototype's: the marks survive their own encoding
    const m = sheet().marks;
    expect(decodeMarks(encodeMarks(m), TEXT)).toEqual([...m]);
  });

  it("reads a kind's three cells as one ink — the seeds through seedsFor, a cell with no marks unmarked — and writes them back", () => {
    const plain = inkOf({ text: "abc", seeds: "", marks: "" }, 7);
    expect(plain).toEqual({ text: "abc", seeds: seedsFor("abc", "", 7), marks: [0, 0, 0] });
    expect(plain.seeds).toEqual([glyphSeed(7, 0), glyphSeed(7, 1), glyphSeed(7, 2)]);   // a new sheet's own hand
    expect(inkOf({ text: "abc" }, 7)).toEqual(plain);   // a cell written before the marks (or the seeds) existed
    expect(inkOf({ text: "ab", seeds: encodeSeeds([5, 6]), marks: "1:8" }, 7)).toEqual({ text: "ab", seeds: [5, 6], marks: [YELLOW, 0] });
    const ink = sheet();
    const cells = inkCells(ink);
    expect(cells).toEqual({ text: TEXT, seeds: encodeSeeds(ink.seeds), marks: "d:0,9:8,1:0,e:4,7:0,f:8w,b:0,7:e8" });
    expect(inkOf(cells, 11)).toEqual(ink);
    expect(inkCells(plain).marks).toBe("");
  });
});

describe("the ink's verbs (kit/ink.ts)", () => {
  it("splice: the letters around keep their hand and marks; the arrivals are fresh and join a mark inside it, never at its edge", () => {
    const v: InkValue = { text: "abcdef", seeds: [1, 2, 3, 4, 5, 6], marks: [0, YELLOW, YELLOW, YELLOW, YELLOW, 0] };
    expect(splice(v, 2, 2, "XY", counter(100))).toEqual({ text: "abXYcdef", seeds: [1, 2, 100, 101, 3, 4, 5, 6], marks: [0, YELLOW, YELLOW, YELLOW, YELLOW, YELLOW, YELLOW, 0] });
    expect(splice(v, 5, 5, "Z", counter(100)).marks).toEqual([0, YELLOW, YELLOW, YELLOW, YELLOW, 0, 0]);   // at its end
    expect(splice(v, 1, 1, "Z", counter(100)).marks).toEqual([0, 0, YELLOW, YELLOW, YELLOW, YELLOW, 0]);   // at its start
    expect(splice(v, 1, 3, "", counter(100))).toEqual({ text: "adef", seeds: [1, 4, 5, 6], marks: [0, YELLOW, YELLOW, 0] });
    // a newline arrives unmarked, even inside
    expect(splice(v, 2, 2, "X\nY", counter(100)).marks).toEqual([0, YELLOW, YELLOW, 0, YELLOW, YELLOW, YELLOW, YELLOW, 0]);
  });

  it("splice joins field by field: a highlight both sides share joins, a pen or a line only one side carries does not", () => {
    const v: InkValue = { text: "abcd", seeds: [1, 2, 3, 4], marks: [0, YELLOW | RED, YELLOW | STRUCK, 0] };
    expect(splice(v, 2, 2, "X", counter(9)).marks[2]).toBe(YELLOW);
    const pens: InkValue = { text: "ab", seeds: [1, 2], marks: [RED | STRUCK, RED | UNDER] };
    expect(splice(pens, 1, 1, "X", counter(9)).marks[1]).toBe(RED);
  });

  it("splice clamps its range to the text, in either order, and asks fresh once a unit, in order", () => {
    const v: InkValue = { text: "abcdef", seeds: [1, 2, 3, 4, 5, 6], marks: [0, 0, 0, 0, 0, 0] };
    expect(splice(v, 3, 1, "", counter(0))).toEqual(splice(v, 1, 3, "", counter(0)));
    expect(splice(v, -5, 99, "q", counter(7))).toEqual({ text: "q", seeds: [7], marks: [0] });
    const asked: number[] = [];
    const next = counter(50);
    splice(v, 6, 6, "xyz", () => { const s = next(); asked.push(s); return s; });
    expect(asked).toEqual([50, 51, 52]);
  });

  it("carryInk is carrySeeds generalised: seed for seed and range for range the same, through every kind of edit", () => {
    const edits: readonly (readonly [string, string])[] = [["", "abc"], ["abc", ""], ["abc", "abc"], ["hello", "heXllo"], ["heXllo", "helo"], ["buy milk", "buy oat milk"], ["aaa", "aa"], ["abc", "xyz"], ["ab\ncd", "ab\n\ncd"], ["on Friday", "on Saturday"]];
    for (const [was, now] of edits) {
      const ink = inkOf({ text: was, seeds: "", marks: "" }, 3);
      const a = carryInk(ink, now, counter(1000));
      const b = carrySeeds(was, ink.seeds, now, counter(1000));
      expect(a.ink.seeds, `${was} → ${now}`).toEqual(b.seeds);
      expect([a.from, a.to], `${was} → ${now}`).toEqual([b.from, b.to]);
      expect(a.ink.text).toBe(now);
      expect(a.ink.marks.length).toBe(now.length);
    }
    // a row of seeds shorter than its text (a value made by hand): both write the missing ones fresh, in the same order
    const short: InkValue = { text: "abcd", seeds: [1, 2], marks: [] };
    expect(carryInk(short, "abXcd", counter(70)).ink.seeds).toEqual(carrySeeds("abcd", [1, 2], "abXcd", counter(70)).seeds);
  });

  it("carryInk carries the marks: a letter typed inside a highlight joins it, at its edge it does not (the prototype's rows)", () => {
    const ink = sheet();
    const typed = carryInk(ink, TEXT.replace("Friday", "FriXXday"), counter(5));
    expect(readWriting(typed.ink).runs[0]?.text).toBe("on FriXXday");
    expect([typed.from, typed.to]).toEqual([19, 21]);
    const after = carryInk(ink, TEXT.replace("on Friday", "on Friday noon"), counter(5));
    expect(readWriting(after.ink).runs[0]?.text).toBe("on Friday");
    // every mark rides its words through an edit before them
    const before = carryInk(ink, `Do: ${TEXT}`, counter(5));
    expect(readWriting(before.ink).runs.map((r) => r.text)).toEqual(readWriting(ink).runs.map((r) => r.text));
  });

  it("mark sets one field over a range — a pen by name, a highlighter, a line in the words' own pen or a named one — and lifts it", () => {
    const v = inkOf({ text: "ab cd", seeds: "", marks: "" }, 1);
    expect(mark(v, 0, 2, { pen: "red" }).marks).toEqual([RED, RED, 0, 0, 0]);
    expect(mark(v, 0, 5, { highlight: "pink" }).marks).toEqual([PINK, PINK, PINK, PINK, PINK]);
    expect(mark(v, 3, 5, { strike: true }).marks).toEqual([0, 0, 0, STRUCK, STRUCK]);
    expect(mark(v, 3, 5, { strike: "red" }).marks).toEqual([0, 0, 0, STRUCK_RED, STRUCK_RED]);
    expect(mark(v, 0, 1, { underline: "ball" }).marks).toEqual([3 << 9, 0, 0, 0, 0]);
    const all = mark(mark(mark(mark(v, 0, 5, { pen: "ball" }), 0, 5, { highlight: "green" }), 0, 5, { strike: true }), 0, 5, { underline: "red" });
    expect(all.marks[0]).toBe(BALL | GREEN | STRUCK | (5 << 9));
    // each lifted alone, the others kept
    expect(mark(all, 0, 5, { pen: null }).marks[0]).toBe(GREEN | STRUCK | (5 << 9));
    expect(mark(all, 0, 5, { highlight: null }).marks[0]).toBe(BALL | STRUCK | (5 << 9));
    expect(mark(all, 0, 5, { strike: false }).marks[0]).toBe(BALL | GREEN | (5 << 9));
    expect(mark(all, 0, 5, { underline: false }).marks[0]).toBe(BALL | GREEN | STRUCK);
    expect(mark(all, 1, 4, { clear: true }).marks).toEqual([all.marks[0], 0, 0, 0, all.marks[4]]);
    // a change naming two fields sets both, `clear` first
    expect(mark(all, 0, 1, { clear: true, highlight: "pink" } as InkChange).marks[0]).toBe(PINK);
    expect(mark(v, 0, 1, { strike: true, highlight: "yellow" } as InkChange).marks[0]).toBe(STRUCK | YELLOW);
    // the words and their hand are untouched, the range clamped and in either order
    const m = mark(v, 5, -2, { highlight: "yellow" });
    expect(m.text).toBe(v.text);
    expect(m.seeds).toEqual(v.seeds);
    expect(m.marks).toEqual([YELLOW, YELLOW, YELLOW, YELLOW, YELLOW]);
  });

  it("mark never marks a newline, and a name the kit does not have throws, naming the kit's — even over no glyph", () => {
    const v = inkOf({ text: "ab\ncd", seeds: "", marks: "" }, 1);
    expect(mark(v, 0, 5, { highlight: "yellow" }).marks).toEqual([YELLOW, YELLOW, 0, YELLOW, YELLOW]);
    expect(mark(v, 0, 5, { strike: true }).marks[2]).toBe(0);
    expect(() => mark(v, 0, 1, { pen: "purple" as PenName })).toThrow(`mark: no pen "purple" (the kit's: felt, ball, fountain, red)`);
    expect(() => mark(v, 0, 1, { strike: "teal" as PenName })).toThrow(`mark: no pen "teal"`);
    expect(() => mark(v, 2, 2, { highlight: "blue" as HighlighterName })).toThrow(`mark: no highlighter "blue" (the kit's: yellow, pink, green)`);
  });

  it("replace is splice by its name", () => {
    const ink = sheet();
    const edits: readonly (readonly [number, number, string])[] = [[0, 4, "send"], [16, 22, "Monday"], [5, 5, "XX"], [0, TEXT.length, ""], [30, 20, "?"]];
    for (const [from, to, words] of edits) expect(replace(ink, from, to, words, counter(1))).toEqual(splice(ink, from, to, words, counter(1)));
    // the prototype's: the marks ride their words through an edit before them
    expect(readWriting(replace(ink, 0, 4, "send", counter(99))).runs).toEqual(readWriting(ink).runs);
  });

  it("lift takes the words and their marks as the cell stores them — never the hand", () => {
    const ink = sheet();
    const [a, b] = where(TEXT, "pen on Friday");
    const piece = lift(ink, a, b);
    expect(piece).toEqual({ text: "pen on Friday", marks: "4:0,9:8" });
    expect(Object.keys(piece)).toEqual(["text", "marks"]);
    expect(lift(ink, b, a)).toEqual(piece);
    expect(lift(ink, -10, 4)).toEqual({ text: "ship", marks: "" });
  });

  it("paste carries the words and their marks and writes them again in a fresh hand (the prototype's rows)", () => {
    const ink = sheet();
    const piece = lift(ink, ...where(TEXT, "pen on Friday"));
    const landed = paste(ink, TEXT.length, TEXT.length, { text: `\n${piece.text}`, marks: `1:0,${piece.marks}` }, () => 77);
    expect(readWriting(landed).runs.at(-1)).toEqual({ from: TEXT.length + 5, to: TEXT.length + 14, text: "on Friday", highlight: "yellow" });
    expect(landed.seeds.slice(TEXT.length)).toEqual(new Array(14).fill(77));
    expect(landed.marks.length).toBe(landed.text.length);
    expect(landed.seeds.length).toBe(landed.text.length);
    const draft = where(TEXT, "draft")[0] + 2;
    expect(readWriting(paste(ink, draft, draft, { text: "XY", marks: "" }, counter(1))).runs.find((r) => r.strike !== undefined)?.text).toBe("drXYaft the intro");
    expect(paste(ink, 0, 0, { text: "ab", marks: "2:7" }, counter(1)).marks[0]).toBe(0);   // a pen this build does not have: dropped
    expect(paste(ink, ...where(TEXT, "on Friday"), { text: "", marks: "" }, counter(1)).text.split("\n")[0]).toBe("ship the pen ");
  });

  it("paste lays a piece's fields over what the splice joined — but words in the sheet's own pen land in the LANDING sheet's", () => {
    const ink = sheet();
    const atlas = where(TEXT, "the atlas")[0];   // inside "bake the atlas", in the red pen
    expect(splice(ink, atlas, atlas, "XY", counter(1)).marks.slice(atlas, atlas + 2)).toEqual([RED, RED]);   // typed there: red
    expect(paste(ink, atlas, atlas, { text: "XY", marks: "" }, counter(1)).marks.slice(atlas, atlas + 2)).toEqual([0, 0]);   // pasted plain: the sheet's own pen
    expect(paste(ink, atlas, atlas, { text: "XY", marks: "2:2" }, counter(1)).marks.slice(atlas, atlas + 2)).toEqual([BALL, BALL]);   // a pen the piece names wins
    const friday = where(TEXT, "Friday")[0] + 2;   // inside the yellow highlight
    expect(paste(ink, friday, friday, { text: "XY", marks: "2:4" }, counter(1)).marks.slice(friday, friday + 2)).toEqual([YELLOW | RED, YELLOW | RED]);
    expect(paste(ink, friday, friday, { text: "XY", marks: "2:g" }, counter(1)).marks.slice(friday, friday + 2)).toEqual([PINK, PINK]);   // its own highlighter wins
  });

  it("paste reads a piece as a stranger's: what is not a string reads empty, a newline stays unmarked, a seed on it is never taken", () => {
    const ink = sheet();
    expect(paste(ink, 0, 0, { text: 5, marks: null } as unknown as InkPiece, counter(1))).toEqual(ink);
    expect(paste(ink, 0, 0, { text: "a\nb", marks: "3:8" }, counter(1)).marks.slice(0, 3)).toEqual([YELLOW, 0, YELLOW]);
    const handed = { text: "ab", marks: "", seeds: [1, 2] } as InkPiece;
    expect(paste(ink, 0, 0, handed, counter(500)).seeds.slice(0, 2)).toEqual([500, 501]);
  });

  it("cleanPiece filters the text and its marks together: line ends and tabs read as the sheet writes them, a refused character leaves with its mark, the cut at max", () => {
    const all = (): boolean => true;
    const piece = (text: string, marks: readonly number[]): InkPiece => ({ text, marks: encodeMarks(marks) });
    expect(cleanPiece({ text: "a\r\nb\rc\td", marks: "" }, all).text).toBe("a\nb\nc d");
    const kept = cleanPiece(piece("aXb", [YELLOW, PINK, GREEN]), (ch) => ch !== "X");
    expect(kept).toEqual({ text: "ab", marks: "1:8,1:o" });
    expect(decodeMarks(kept.marks, kept.text)).toEqual([YELLOW, GREEN]);   // the b keeps its green: nothing shifted onto it
    expect(decodeMarks(cleanPiece(piece("a\r\nb", [YELLOW, YELLOW, YELLOW, YELLOW]), all).marks, "a\nb")).toEqual([YELLOW, 0, YELLOW]);
    expect(cleanPiece(piece("a\tb", [YELLOW, PINK, YELLOW]), all)).toEqual(piece("a b", [YELLOW, PINK, YELLOW]));   // a tab is a space, its mark kept
    expect(cleanPiece({ text: "abcdef", marks: "" }, all, 3).text).toBe("abc");
    expect(cleanPiece({ text: "x".repeat(5000), marks: "" }, all).text.length).toBe(4000);
    // asked of each character as it lands: a one-line field refuses the newline a \r\n became
    expect(cleanPiece({ text: "a\r\nb", marks: "" }, (ch) => ch !== "\n").text).toBe("ab");
    // a pair is one character: asked whole, kept whole, never split by the cut
    const face = String.fromCodePoint(0x1f600);
    const asked: string[] = [];
    expect(cleanPiece({ text: `a${face}b`, marks: "" }, (ch) => { asked.push(ch); return true; }).text).toBe(`a${face}b`);
    expect(asked).toEqual(["a", face, "b"]);
    expect(cleanPiece({ text: `a${face}b`, marks: "" }, all, 2).text).toBe("a");
    expect(cleanPiece({ text: `a${face}b`, marks: "" }, all, 3).text).toBe(`a${face}`);
  });

  it("findQuote finds quoted words exactly — once, or the n-th — or says why not (the prototype's rows)", () => {
    expect(findQuote(TEXT, "the")).toEqual({ error: "ambiguous", count: 6 });
    expect(findQuote(TEXT, "the", 2)).toEqual({ from: TEXT.indexOf("the atlas"), to: TEXT.indexOf("the atlas") + 3 });
    expect(findQuote(TEXT, "atlas")).toEqual({ from: 32, to: 37 });
    expect(findQuote(TEXT, "atlas", 1)).toEqual({ from: 32, to: 37 });
    expect(findQuote(TEXT, "Saturday")).toEqual({ error: "missing" });
    expect(findQuote(TEXT, "friday")).toEqual({ error: "missing" });   // exact: the case counts
    expect(findQuote(TEXT, "")).toEqual({ error: "missing" });
    expect(findQuote(TEXT, "the", 7)).toEqual({ error: "missing" });
    expect(findQuote(TEXT, "the", 0)).toEqual({ error: "missing" });
    expect(findQuote(TEXT, "the", 1.5)).toEqual({ error: "missing" });
    expect(findQuote("aaa", "aa")).toEqual({ error: "ambiguous", count: 2 });   // every start counts, overlapping too
    expect(findQuote("aaa", "aa", 2)).toEqual({ from: 1, to: 3 });
  });

  it("readWriting lists the marked runs by name — what an agent reads (the prototype's rows)", () => {
    expect(readWriting(sheet())).toEqual({
      text: TEXT,
      runs: [
        { from: 13, to: 22, text: "on Friday", highlight: "yellow" },
        { from: 23, to: 37, text: "bake the atlas", pen: "red" },
        { from: 44, to: 59, text: "draft the intro", strike: "red" },
        { from: 70, to: 77, text: "kerning", underline: true },
      ],
    });
    expect(readWriting(inkOf({ text: TEXT }, 11)).runs).toEqual([]);
  });

  it("readWriting trims a run's spaces, lists no run of spaces alone, splits where the mark changes and never across a newline", () => {
    const v = inkOf({ text: "ship the pen\non Friday", seeds: "", marks: "" }, 1);
    expect(readWriting(mark(v, 4, 9, { highlight: "pink" })).runs).toEqual([{ from: 5, to: 8, text: "the", highlight: "pink" }]);
    expect(readWriting(mark(v, 4, 5, { highlight: "pink" })).runs).toEqual([]);
    const two = mark(mark(v, 0, 8, { highlight: "yellow" }), 5, 8, { strike: true });
    expect(readWriting(two).runs).toEqual([{ from: 0, to: 4, text: "ship", highlight: "yellow" }, { from: 5, to: 8, text: "the", highlight: "yellow", strike: true }]);
    expect(readWriting(mark(v, 9, 15, { underline: "ball" })).runs).toEqual([{ from: 9, to: 12, text: "pen", underline: "ball" }, { from: 13, to: 15, text: "on", underline: "ball" }]);
    const every = mark(mark(mark(v, 0, 4, { pen: "ball" }), 0, 4, { highlight: "pink" }), 0, 4, { strike: true });
    expect(readWriting(every).runs).toEqual([{ from: 0, to: 4, text: "ship", pen: "ball", highlight: "pink", strike: true }]);
  });

  it("no verb mutates the ink it is handed", () => {
    const ink = sheet();
    const copy = { text: ink.text, seeds: [...ink.seeds], marks: [...ink.marks] };
    const frozen: InkValue = Object.freeze({ text: ink.text, seeds: Object.freeze([...ink.seeds]), marks: Object.freeze([...ink.marks]) });
    splice(frozen, 2, 5, "xy", counter(1));
    carryInk(frozen, `x${TEXT}`, counter(1));
    mark(frozen, 0, 50, { highlight: "green" });
    mark(frozen, 0, 50, { clear: true });
    replace(frozen, 0, 4, "send", counter(1));
    lift(frozen, 0, 50);
    paste(frozen, 3, 9, { text: "ab", marks: "2:8" }, counter(1));
    readWriting(frozen);
    inkCells(frozen);
    expect(frozen).toEqual(copy);
  });
});
