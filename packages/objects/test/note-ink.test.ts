// @vitest-environment node
// THE NOTE KEEPS ITS INK (petition I60 — "Editing the Ink", the note's half): its writing is the kit's INK — the text, each glyph's
// seed and each glyph's MARK (kit/ink.ts: its pen, a highlighter under it, a line through it, one under it) — kept as ONE conflict cell,
// `desk.note:ink` = `{ text, seeds, marks }`. Pinned on a real engine and document, through the note's own typing (paper/typing.ts —
// a live write under core's `Editing`, committed whole):
//  - THE CELL: three fields in one group, `marks` "" unmarked; a cell without the field (an old note) reads unmarked, and stays so
//    through an edit;
//  - THE TYPING carries the marks with the letters (`carryInk`, the platform's caret): a letter typed inside a highlight is
//    highlighted, one typed at its edge is not; a word typed over a selection keeps the marks its letters shared for every letter of it,
//    until the caret leaves its end; a paste lays a piece's words and marks in a fresh hand; a cut lifts them and takes them away;
//  - ONE commit lands the words, the hand and the marks together; ONE ⌘Z takes them back; a typing that nets to nothing lands nothing;
//  - TWO PEERS: the committer wins, and a note's words, seeds and marks stay paired — never one peer's words with another's marks.
import { createCanvasEngine, type Entity, guardedTransaction } from "@ice/core";
import { decodeMarks, decodeSeeds, encodeMarks, findQuote, highlightOf, type InkChange, inkOf, inkTypingOn, mark, penOf, seedsFor, strikeOf, underlineOf } from "@ice/desk/kit";
import { describe, expect, it } from "vitest";
import { NOTE_INK, NOTE_PROPS, Note } from "../src";
import { createNoteTyping } from "../src/paper/typing";

type Cell = { text: string; seeds: string; marks: string };

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const note = (text = "", marks = ""): Entity => ce.ops.spawnWidget("desk.note", { x: 0, y: 0, props: { seed: 7, text, marks }, undoable: false });
  let next = 5000;
  const typing = createNoteTyping({ ink: NOTE_INK, props: NOTE_PROPS, world: ce.world, docs: ce.docs, fresh: () => next++ });
  const opened = () => { const s = ce.docs.current(); if (s === undefined) throw new Error("no doc"); return s; };
  const doc = (e: Entity) => opened().store.getComponent(e, NOTE_INK) as Cell | undefined;
  const live = (e: Entity) => ce.world.get(e, NOTE_INK) as Cell | undefined;
  const undoSteps = (): number => { let n = 0; const s = opened().store; while (s.canUndo() && n < 50) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); return n; };
  return { ce, world: ce.world, step, note, typing, doc, live, undoSteps, opened };
}

/** `text`'s marks after each `[quote, change]` (the kit's `mark` over the words `findQuote` finds), as the cell writes them. */
function marked(text: string, ...changes: readonly (readonly [string, InkChange])[]): string {
  let ink = inkOf({ text }, 7);
  for (const [q, change] of changes) {
    const r = findQuote(text, q);
    if ("error" in r) throw new Error(`no single "${q}" in "${text}"`);
    ink = mark(ink, r.from, r.to, change);
  }
  return encodeMarks(ink.marks);
}

/** Each unit's highlighter, strike, underline and pen as a cell holds them (0 none). */
const fields = (c: Cell | undefined) => {
  const m = decodeMarks(c?.marks ?? "", c?.text ?? "");
  return { hl: m.map(highlightOf), strike: m.map(strikeOf), under: m.map(underlineOf), pen: m.map(penOf) };
};

/** The platform's keys: the field's value after each, its caret after the key. */
function type(t: ReturnType<typeof createNoteTyping>, value: string, at: number, chars: string): string {
  let v = value;
  let i = at;
  for (const ch of chars) { v = v.slice(0, i) + ch + v.slice(i); i += 1; t.input(v, i); }
  return v;
}

describe("the note's ink cell (petition I60)", () => {
  it("is ONE conflict group of three fields — text, seeds, marks — the marks \"\" on a new note, the type still at version 1", () => {
    const g = Note.groups.find((q) => q.name === "ink");
    expect(Object.keys(g?.fields ?? {}).sort()).toEqual(["marks", "seeds", "text"]);
    expect(g?.component).toBe(NOTE_INK);
    expect(Note.version).toBe(1);
    const { note, step, live, doc } = makeDesk();
    const a = note("hi");
    step();
    expect(live(a)).toEqual({ text: "hi", seeds: "", marks: "" });
    expect(doc(a)?.marks).toBe("");
  });

  it("a cell with NO marks field (a note stored before them) reads unmarked, and an edit writes it unmarked", () => {
    const { world, note, step, typing, live } = makeDesk();
    const a = note("buy milk");
    step();
    world.edit(a).set(NOTE_INK, { text: "buy milk", seeds: "" } as unknown as Cell);   // the old shape, as a stranger's value reads
    expect(typing.value(a)?.marks).toEqual(new Array(8).fill(0));
    typing.begin(a);
    type(typing, "buy milk", 8, "!");
    expect(live(a)?.text).toBe("buy milk!");
    expect(live(a)?.marks).toBe("");
    typing.end();
  });
});

describe("the note's typing carries the marks with the letters (petition I60)", () => {
  it("a letter typed INSIDE a highlight is highlighted; one typed at its EDGE is not", () => {
    const { note, step, typing, live } = makeDesk();
    const a = note("buy milk now", marked("buy milk now", ["milk", { highlight: "yellow" }]));
    step();
    typing.begin(a);
    let v = type(typing, "buy milk now", 6, "i");   // "buy mi|lk" → "buy miilk now"
    expect(v).toBe("buy miilk now");
    expect(fields(live(a)).hl.slice(4, 9)).toEqual([1, 1, 1, 1, 1]);
    v = type(typing, v, 9, "s");   // after "miilk", before the space: the highlight's edge
    expect(v).toBe("buy miilks now");
    expect(fields(live(a)).hl[9]).toBe(0);
    expect(fields(live(a)).hl.slice(4, 9)).toEqual([1, 1, 1, 1, 1]);
    typing.end();
  });

  it("the platform's caret says where a letter typed beside its twin went: a second \"l\" typed after the highlight's first lands inside it", () => {
    const { note, step, typing, live } = makeDesk();
    const a = note("al x", marked("al x", ["al", { strike: true }]));
    step();
    typing.begin(a);
    // "a|l" + "l" → "all": greedy reading puts the new "l" after the struck one; the caret (2) says it was typed between them
    typing.input("all x", 2);
    expect(fields(live(a)).strike.slice(0, 3)).toEqual([1, 1, 1]);
    typing.end();
  });

  it("a word TYPED OVER a selection keeps the marks its letters shared for every letter of it — until the caret leaves its end", () => {
    const { note, step, typing, live } = makeDesk();
    const text = "on Friday at 9";
    const a = note(text, marked(text, ["Friday", { highlight: "pink" }], ["Friday", { underline: true }]));
    step();
    typing.begin(a);
    // the selection [3, 9) typed over: the first key replaces it, the rest are typed on at its end
    let v = "on M at 9";
    typing.input(v, 4);
    v = type(typing, v, 4, "onday");
    expect(v).toBe("on Monday at 9");
    const f = fields(live(a));
    expect(f.hl.slice(3, 9)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(f.under.slice(3, 9)).toEqual([1, 1, 1, 1, 1, 1]);
    // the caret leaves the word: a letter typed back at its end is the neighbours' join again (the space after carries nothing)
    typing.moved(0, 0);
    v = type(typing, v, 9, "s");
    expect(v).toBe("on Mondays at 9");
    expect(fields(live(a)).hl[9]).toBe(0);
    typing.end();
  });

  it("a PASTE lays a piece's words and marks in a fresh hand, the words around it keeping theirs; the arrived range is the piece's", () => {
    const { note, step, typing, live } = makeDesk();
    const a = note("buy milk");
    step();
    typing.begin(a);
    const piece = { text: "red ", marks: marked("red ", ["red", { strike: true }]) };
    expect(typing.paste(piece, 4, 4)).toEqual({ from: 4, to: 8 });
    const c = live(a);
    expect(c?.text).toBe("buy red milk");
    expect(fields(c).strike.slice(4, 7)).toEqual([1, 1, 1]);
    expect(fields(c).strike.slice(0, 4)).toEqual([0, 0, 0, 0]);
    const seeds = decodeSeeds(c?.seeds ?? "");
    expect(seeds.slice(0, 4)).toEqual(seedsFor("buy milk", "", 7).slice(0, 4));
    expect(seeds.slice(8)).toEqual(seedsFor("buy milk", "", 7).slice(4));
    expect(seeds.slice(4, 8).every((s) => s >= 5000)).toBe(true);   // the pasted words written again in a fresh hand
    typing.end();
  });

  it("a CUT lifts the words with their marks and takes them away; the words left keep theirs", () => {
    const { note, step, typing, live } = makeDesk();
    const text = "buy milk now";
    const a = note(text, marked(text, ["milk", { highlight: "yellow" }], ["now", { underline: true }]));
    step();
    typing.begin(a);
    const piece = typing.lift(4, 9);
    expect(piece).toEqual({ text: "milk ", marks: marked("milk ", ["milk", { highlight: "yellow" }]) });
    typing.input("buy now", 4);
    const f = fields(live(a));
    expect(live(a)?.text).toBe("buy now");
    expect(f.hl).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(f.under.slice(4)).toEqual([1, 1, 1]);
    typing.end();
  });

  it("ONE commit lands the words, the hand and the marks together, ONE ⌘Z takes them back; a typing that nets to nothing lands nothing", () => {
    const { note, step, typing, doc, live, undoSteps, opened } = makeDesk();
    const text = "buy milk";
    const a = note(text, marked(text, ["milk", { highlight: "green" }]));
    step();
    const before = undoSteps();
    typing.begin(a);
    type(typing, text, 6, "i");
    expect(doc(a)?.text).toBe(text);   // live: the document untouched
    expect(typing.commit()).toBe(true);
    step();
    expect(doc(a)?.text).toBe("buy miilk");
    expect(fields(doc(a)).hl.slice(4)).toEqual([2, 2, 2, 2, 2]);
    expect(undoSteps()).toBe(before + 1);
    opened().store.undo();
    step();
    expect(live(a)?.text).toBe(text);
    expect(live(a)?.marks).toBe(marked(text, ["milk", { highlight: "green" }]));
    opened().store.redo();
    step();
    // there and back again — the same words, hand and marks — lands nothing
    type(typing, "buy miilk", 9, "x");
    typing.input("buy miilk", 9);
    expect(typing.commit()).toBe(false);
    expect(undoSteps()).toBe(before + 1);
    typing.end();
  });

  it("registers on its world as a typing of another shape (the kit's `registerInkTyping`), so a static act finds it on its note (`inkTypingOn`) — none when the editor is off it", () => {
    const { world, note, step, typing } = makeDesk();
    const a = note("hi");
    const b = note("yo");
    step();
    expect(inkTypingOn(world, a)).toBeUndefined();
    typing.begin(a);
    const door = inkTypingOn(world, a);
    expect(door?.type).toBe("desk.note");
    expect(door?.group).toBe("ink");
    expect(inkTypingOn(world, b)).toBeUndefined();
    type(typing, "hi", 2, "!");
    expect([door?.open(), door?.ink(a)?.text]).toEqual([true, "hi!"]);   // the words the field shows, not yet landed
    expect(door?.commit()).toBe(true);
    expect(typing.open()).toBe(false);
    typing.end();
    expect(inkTypingOn(world, a)).toBeUndefined();
  });
});

describe("the note's ink across peers: the committer wins, and words, seeds and marks stay paired (petition I60)", () => {
  function pair(text: string, marks: string) {
    const A = makeDesk();
    const a = A.note(text, marks);
    A.step();
    const B = makeDesk();
    B.ce.docs.open(A.opened().exportEnvelope());
    B.step();
    const key = A.opened().store.keyOf(a);
    const b = key === undefined ? undefined : B.opened().store.resolve(key);
    if (b === undefined) throw new Error("B has no twin of A's note");
    const sync = (from: typeof A, to: typeof A) => { to.opened().applyRemote(from.opened().exportSnapshot()); to.step(); };
    return { A, B, a, b, sync };
  }

  it("B marks the words while A is typing on them: A's commit wins whole — A's words with A's marks and A's hand, on both peers", () => {
    const text = "buy milk";
    const { A, B, a, b, sync } = pair(text, "");
    A.typing.begin(a);
    type(A.typing, text, 8, " now");
    // B strikes "milk" and lands it
    guardedTransaction(B.opened().store, B.world, (tx) => { tx.edit(b).set(NOTE_INK, { text, seeds: "", marks: marked(text, ["milk", { strike: true }]) }); });
    B.step();
    sync(B, A);
    expect(A.live(a)?.text).toBe("buy milk now");   // held off: the gesture owns the cell
    A.typing.end();
    A.step();
    sync(A, B);
    for (const c of [A.doc(a), B.live(b)]) {
      expect(c?.text).toBe("buy milk now");
      expect(fields(c).strike).toEqual(new Array(12).fill(0));   // never A's words with B's marks
      expect(decodeSeeds(c?.seeds ?? "").length).toBe(12);
    }
    expect(B.live(b)).toEqual(A.doc(a));
  });

  it("between A's typings B's marked words apply whole, and A's next keys carry them", () => {
    const text = "buy milk";
    const { A, B, a, b, sync } = pair(text, "");
    A.typing.begin(a);
    guardedTransaction(B.opened().store, B.world, (tx) => { tx.edit(b).set(NOTE_INK, { text, seeds: "", marks: marked(text, ["milk", { highlight: "blue" }]) }); });
    B.step();
    sync(B, A);
    expect(fields(A.live(a)).hl.slice(4)).toEqual([4, 4, 4, 4]);
    type(A.typing, text, 6, "i");
    A.typing.end();
    A.step();
    expect(A.doc(a)?.text).toBe("buy miilk");
    expect(fields(A.doc(a)).hl.slice(4)).toEqual([4, 4, 4, 4, 4]);
  });
});
