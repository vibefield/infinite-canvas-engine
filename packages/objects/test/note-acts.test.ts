// @vitest-environment node
// THE NOTE'S WORDS ACTS (petition I60 — "Editing the Ink": the selection bar over the selected words, the desk's pens by name, the
// calendar's five highlighters, a line through and a line under): the note's menu is the kit's `inkActs`, so `SelectionAnchor.words`
// offers Pen ▾, Highlight ▾, Strike, Underline and Clear over a note's selected words. Pinned on a real engine and document through
// `ops.runMenuAction(id, taken?, { range })`:
//  - each act on a selected range, with its state's `pressed` (the toggles) and its `current` choice (the choice acts) read from the
//    same words;
//  - each act is ONE undo step on the ink cell, the marks alone moving; nothing when nothing would move;
//  - the note's typing is LIVE, so the stored cell is the field: an act run while the note is written marks the letters the field shows
//    selected — the live write still pending landed first, its own step — the typing goes on after it, and the act is one undo step.
import { createCanvasEngine, type Entity, type MenuActionDef, type MenuActionStateContext } from "@ice/core";
import { decodeMarks, findQuote, highlightOf, INK_ACTS, inkTypingOn, NO_HIGHLIGHT, penOf, strikeOf, underlineOf } from "@ice/desk/kit";
import { describe, expect, it } from "vitest";
import { NOTE_INK, NOTE_PROPS, Note } from "../src";
import { createNoteTyping } from "../src/paper/typing";

type Cell = { text: string; seeds: string; marks: string };

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const note = (text: string): Entity => ce.ops.spawnWidget("desk.note", { x: 0, y: 0, props: { seed: 7, text, pen: "fountain" }, undoable: false });
  let next = 5000;
  const typing = createNoteTyping({ ink: NOTE_INK, props: NOTE_PROPS, world: ce.world, docs: ce.docs, fresh: () => next++ });
  const opened = () => { const s = ce.docs.current(); if (s === undefined) throw new Error("no doc"); return s; };
  const doc = (e: Entity) => opened().store.getComponent(e, NOTE_INK) as Cell | undefined;
  const live = (e: Entity) => ce.world.get(e, NOTE_INK) as Cell | undefined;
  const undoSteps = (): number => { let n = 0; const s = opened().store; while (s.canUndo() && n < 50) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); return n; };
  /** The words `quote` of note `e` as a range — in the words the world holds now (the field's, while it is written). */
  const range = (e: Entity, quote: string) => {
    const r = findQuote(live(e)?.text ?? "", quote);
    if ("error" in r) throw new Error(`no single "${quote}"`);
    return { entity: e, from: r.from, to: r.to };
  };
  /** What the bar reads of an act over `quote` (a fresh `MenuActionStateContext`, as the anchor composes one). */
  const ctx = (e: Entity, quote: string): MenuActionStateContext => ({
    world: ce.world,
    entities: [e],
    local: undefined,
    range: range(e, quote),
    props: (x) => Object.assign({}, ...Note.groups.map((g) => (ce.world.get(x, g.component) as Record<string, unknown> | undefined) ?? {})),
  });
  /**
   * THE ONE DOOR to the acts (the menu act's shape is core's and moves: every run and every state read in this file goes through
   * here). `run` — the act `id` over the words `quote` of note `e`, handed `choice` taken, as the bar runs it; `state` — what the bar
   * shows of it there: a toggle's `pressed` (its state, I61), a choice act's `current` choice (I62).
   */
  const acts = {
    run: (id: string, e: Entity, quote: string, choice?: string): boolean => ce.ops.runMenuAction(id, choice === undefined ? undefined : { id: choice }, { range: range(e, quote) }),
    state: (id: string, e: Entity, quote: string): { readonly pressed: boolean | undefined; readonly current: string | undefined } => {
      const a = act(id);
      const c = ctx(e, quote);
      return { pressed: a.state?.(c)?.pressed, current: a.choices?.(c)?.find((x) => x.current === true)?.id };
    },
  };
  return { ce, world: ce.world, step, note, typing, doc, live, undoSteps, opened, acts };
}

const act = (id: string): MenuActionDef => {
  const a = Note.menu.find((m) => m.id === id);
  if (a === undefined) throw new Error(`the note has no act ${id}`);
  return a;
};
/** Each unit's fields as a cell holds them. */
const fields = (c: Cell | undefined) => {
  const m = decodeMarks(c?.marks ?? "", c?.text ?? "");
  return { hl: m.map(highlightOf), strike: m.map(strikeOf), under: m.map(underlineOf), pen: m.map(penOf) };
};

describe("the note's words acts are the kit's ink acts (petition I60)", () => {
  it("its menu offers Pen ▾, Highlight ▾, Strike, Underline and Clear — every one for the WORDS, the two choice acts with their choices", () => {
    expect(Note.menu.map((m) => m.id)).toEqual([INK_ACTS.pen, INK_ACTS.highlight, INK_ACTS.strike, INK_ACTS.underline, INK_ACTS.clear]);
    expect(Note.menu.every((m) => m.on === "words")).toBe(true);
    const bare: MenuActionStateContext = { world: undefined as never, entities: [], props: () => ({}), local: undefined };
    expect(act(INK_ACTS.pen).choices?.(bare)?.map((c) => c.id)).toEqual(["felt", "ball", "fountain", "red"]);
    expect(act(INK_ACTS.highlight).choices?.(bare)?.map((c) => c.id)).toEqual(["yellow", "green", "pink", "blue", "orange", NO_HIGHLIGHT]);
  });

  it("each act on the words it is told, its toggle's `pressed` and its current choice read from the same words — each ONE undo step, the marks alone moving", () => {
    const { note, step, acts, doc, undoSteps, opened } = makeDesk();
    const a = note("buy milk now");
    step();
    const before = undoSteps();
    expect(acts.state(INK_ACTS.highlight, a, "milk").current).toBe(NO_HIGHLIGHT);
    expect(acts.run(INK_ACTS.highlight, a, "milk", "pink")).toBe(true);
    step();
    expect(fields(doc(a)).hl).toEqual([0, 0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0]);
    expect(acts.state(INK_ACTS.highlight, a, "milk").current).toBe("pink");
    expect(acts.state(INK_ACTS.highlight, a, "buy milk").current).toBeUndefined();   // two values among the letters
    // the toggles: pressed when every LETTER carries one; pressed again they lift it
    expect(acts.state(INK_ACTS.strike, a, "now").pressed).toBe(false);
    acts.run(INK_ACTS.strike, a, "now");
    step();
    expect(fields(doc(a)).strike.slice(9)).toEqual([1, 1, 1]);
    expect(acts.state(INK_ACTS.strike, a, "now").pressed).toBe(true);
    acts.run(INK_ACTS.underline, a, "buy");
    step();
    expect(fields(doc(a)).under.slice(0, 3)).toEqual([1, 1, 1]);
    // a pen by name; the sheet's own pen (its `pen` prop, fountain) chosen clears the field
    expect(acts.state(INK_ACTS.pen, a, "milk").current).toBe("fountain");
    acts.run(INK_ACTS.pen, a, "milk", "red");
    step();
    expect(fields(doc(a)).pen.slice(4, 8)).toEqual([4, 4, 4, 4]);
    expect(acts.state(INK_ACTS.pen, a, "milk").current).toBe("red");
    expect(doc(a)?.text).toBe("buy milk now");   // the marks alone moved
    expect(undoSteps()).toBe(before + 4);
    // the strike pressed again lifts it; Clear lifts all four
    acts.run(INK_ACTS.strike, a, "now");
    step();
    expect(fields(doc(a)).strike).toEqual(new Array(12).fill(0));
    acts.run(INK_ACTS.clear, a, "buy milk now");
    step();
    expect(doc(a)?.marks).toBe("");
    expect(undoSteps()).toBe(before + 6);
    // nothing to move: no step
    acts.run(INK_ACTS.clear, a, "buy milk now");
    step();
    expect(undoSteps()).toBe(before + 6);
    // each a step of its own: one undo brings Clear's marks back
    opened().store.undo();
    step();
    expect(fields(doc(a)).pen.slice(4, 8)).toEqual([4, 4, 4, 4]);
  });

  it("run while the note is WRITTEN: the live write landed first (its own step), the letters the field shows selected marked, the typing going on after — the act ONE undo step", () => {
    const { world, note, step, typing, acts, live, doc, undoSteps, opened } = makeDesk();
    const a = note("buy milk");
    step();
    const before = undoSteps();
    typing.begin(a);
    // typed, not yet landed: the field shows "buy oat milk"
    let v = "buy milk";
    let at = 4;
    for (const ch of "oat ") { v = v.slice(0, at) + ch + v.slice(at); at += 1; typing.input(v, at); }
    expect(live(a)?.text).toBe("buy oat milk");
    expect(doc(a)?.text).toBe("buy milk");
    expect(inkTypingOn(world, a)?.open()).toBe(true);   // the acts find the note's live typing through the world
    // the words the field shows selected: "oat"
    expect(acts.run(INK_ACTS.highlight, a, "oat", "yellow")).toBe(true);
    step();
    expect(doc(a)?.text).toBe("buy oat milk");   // landed first
    expect(fields(doc(a)).hl).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0]);
    expect(typing.open()).toBe(false);
    expect(undoSteps()).toBe(before + 2);   // the words' step, then the act's
    // the typing goes on after it, carrying the mark: a letter typed inside the highlight is highlighted
    v = "buy oaat milk";
    typing.input(v, 7);
    expect(fields(live(a)).hl.slice(4, 8)).toEqual([1, 1, 1, 1]);
    typing.end();
    step();
    expect(doc(a)?.text).toBe("buy oaat milk");
    expect(undoSteps()).toBe(before + 3);
    // undo the typing after it, then the act alone: the words stay, the highlight goes
    opened().store.undo();
    step();
    opened().store.undo();
    step();
    expect(doc(a)?.text).toBe("buy oat milk");
    expect(fields(doc(a)).hl).toEqual(new Array(12).fill(0));
  });
});
