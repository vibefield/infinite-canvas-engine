// @vitest-environment node
// A MENU ACT FOR THE WORDS (petition I60 — "the selection bar comes to the words"): a kind's act (widget/menu-actions.ts) says its state
// and its choices now (I61, I62), read over the selected objects. For the words of an object being written a kind needs three things
// more, each OPTIONAL: what the act is FOR (`MenuActionDef.on: "words"` — offered only while its object is written and words are
// selected; the selection's acts are `on: "objects"`, the default), THE RANGE it reads and marks (`range` on its state's context and on
// its api — so `state` and `choices` read the selected letters, and `run` marks them), and a toggle's PRESSED (`MenuActionState.pressed`,
// kept whenever it is a boolean, so a host tells a toggle that is off from a plain act). The engine runs a words act on the words it is
// TOLD (`ops.runMenuAction(id, taken?, { range })`, a third argument), never on the selection; an act that declares none of it is I61's
// act, run with one argument. Fixture types of the test's own.
import { describe, expect, it } from "vitest";
import { createCanvasEngine, defineWidget, type Entity, type MenuActionApi, type MenuActionDef, type MenuActionStateContext, menuActionsFor, p, readActChoices, readMenuActionState } from "../src";

interface Ran { readonly id: string; readonly entities: readonly Entity[]; readonly range: MenuActionApi["range"]; readonly taken: string | undefined; readonly args: number }
const ran: Ran[] = [];
/** What a run was told — its arguments counted, so a run told no choice is told exactly one argument, as before. */
const record = (id: string) => (...args: unknown[]): void => {
  const api = args[0] as MenuActionApi;
  ran.push({ id, entities: [...api.entities], range: api.range, taken: (args[1] as { id: string } | undefined)?.id, args: args.length });
};

// the words' acts: a choice act (the pens — "red" offered only over a range longer than six, so a choice is held to the letters) and a
// toggle (a line through — pressed over a range longer than three, disabled over one that starts at 9); each reads the range, never writes
const PEN: MenuActionDef = {
  id: "pen", label: "Pen", on: "words", glyph: "pen",
  choices: (ctx) => {
    const r = ctx.range;
    if (r === undefined) return undefined;
    return [{ id: "felt", label: "Felt pen", current: r.from === 0 }, { id: "ball", label: "Ball pen", swatch: "#1f2f5c" }, ...(r.to - r.from > 6 ? [{ id: "red", label: "Red pen" }] : [])];
  },
  run: record("pen"),
};
const STRIKE: MenuActionDef = {
  id: "strike", label: "Strike", on: "words", keys: "⇧⌘X",
  state: (ctx) => (ctx.range === undefined ? undefined : { pressed: ctx.range.to - ctx.range.from > 3, ...(ctx.range.from === 9 ? { enabled: false } : {}) }),
  run: (api) => { record("strike")(api); for (const e of api.entities) api.setProps(e, { marks: `struck ${api.range?.from}-${api.range?.to}` }); },
};
// the selection's acts: I61's (no new field) and one with choices
const SPIN: MenuActionDef = { id: "spin", label: "Spin", run: record("spin") };
const TINT: MenuActionDef = { id: "tint", label: "Tint", on: "objects", choices: () => [{ id: "warm", label: "Warm" }, { id: "cool", label: "Cool" }], run: record("tint") };
const SHEET = defineWidget({ type: "mw:sheet", props: { text: p.string({ default: "" }), marks: p.string({ default: "" }) }, menu: [PEN, STRIKE, SPIN, TINT] });
// a type with an OBJECTS act named as a words act elsewhere: a range never runs it
const CARD = defineWidget({ type: "mw:card", props: {}, menu: [{ id: "strike", label: "Strike the card", run: record("card strike") }, { id: "spin", label: "Spin", run: record("card spin") }] });

function engine() {
  const ce = createCanvasEngine({ widgets: [SHEET, CARD] });
  ce.docs.create();
  const at = (type: string, x: number): Entity => ce.ops.spawnWidget(type, { x, y: 0, w: 40, h: 40, undoable: false });
  const sheet = at("mw:sheet", 0);
  const other = at("mw:sheet", 100);
  const card = at("mw:card", 200);
  ce.step(16);
  return { ce, sheet, other, card };
}
const menuOf = (e: Entity, card: Entity): readonly MenuActionDef[] => (e === card ? CARD.menu : SHEET.menu);

describe("a menu act for the words: what it is for, the range it reads and marks, a toggle's pressed (petition I60, on I61 and I62)", () => {
  it("`on` is optional and kept on the type — `defineWidget` refuses another value by name — and a state's `pressed` is kept whenever it is a boolean", () => {
    expect(SHEET.menu.map((a) => a.id)).toEqual(["pen", "strike", "spin", "tint"]);
    expect(SHEET.menu[0]?.on).toBe("words");
    expect(SHEET.menu[2]?.on).toBeUndefined();   // I61's act: on the objects, by default
    expect(SHEET.menu[3]?.on).toBe("objects");
    const bad = (type: string, act: Partial<MenuActionDef>): (() => void) => () => defineWidget({ type, menu: [{ id: "a", label: "A", run: () => {}, ...act } as MenuActionDef] });
    expect(bad("mw:bad-on", { on: "lines" as never })).toThrow(/is on "objects" or "words"/);
    // the state and the choices read the range they are handed — the selected letters
    const { ce, sheet } = engine();
    try {
      const ctx = (from: number, to: number): MenuActionStateContext => ({ world: ce.world, entities: [sheet], props: () => ({}), local: undefined, range: { entity: sheet, from, to } });
      expect(readMenuActionState(STRIKE, ctx(0, 5))).toEqual({ pressed: true });
      // OFF is said too: a toggle that is off is not a plain act (an act that never says `pressed` is I61's, byte for byte)
      expect(readMenuActionState(STRIKE, ctx(0, 2))).toEqual({ pressed: false });
      expect(readMenuActionState(STRIKE, ctx(9, 11))).toEqual({ enabled: false, pressed: false });
      expect(readMenuActionState({ ...STRIKE, state: () => ({ pressed: "yes" as never }) }, ctx(0, 5))).toBeUndefined();
      expect(readMenuActionState(SPIN, ctx(0, 5))).toBeUndefined();
      expect(readActChoices(PEN, ctx(0, 4))?.map((c) => [c.id, c.current === true])).toEqual([["felt", true], ["ball", false]]);
      expect(readActChoices(PEN, ctx(1, 9))?.map((c) => [c.id, c.current === true])).toEqual([["felt", false], ["ball", false], ["red", false]]);
    } finally {
      ce.dispose();
    }
  });

  it("an act that declares none of it is I61's act: offered for the selection, run on it with one argument — and a words act is never the selection's", () => {
    const { ce, sheet, other, card } = engine();
    try {
      ran.length = 0;
      expect(menuActionsFor([sheet, other], (e) => menuOf(e, card)).map((a) => a.id)).toEqual(["spin", "tint"]);
      ce.ops.setSelection([sheet, other], "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(true);
      expect(ran).toEqual([{ id: "spin", entities: [sheet, other], range: undefined, taken: undefined, args: 1 }]);
      // a words act named without its words: nothing to run it on
      ran.length = 0;
      expect(ce.ops.runMenuAction("strike")).toBe(false);
      expect(ce.ops.runMenuAction("pen", { id: "felt" })).toBe(false);
      expect(ran).toEqual([]);
      // the card's "strike" is an objects act: the selection's when the card is selected, the sheet's words act standing aside
      ce.ops.setSelection([sheet, card], "replace");
      expect(ce.ops.runMenuAction("strike")).toBe(true);
      expect(ran.map((r) => r.id)).toEqual(["card strike"]);
    } finally {
      ce.dispose();
    }
  });

  it("a words act runs on the words it is TOLD — `runMenuAction(id, undefined, { range })`: the object being written, alone, and the range; its writes one transaction — never on the selection", () => {
    const { ce, sheet, other, card } = engine();
    try {
      ran.length = 0;
      ce.ops.setSelection([other], "replace");   // the selection is another object's: a words act is told its object by the range
      expect(ce.ops.runMenuAction("strike", undefined, { range: { entity: sheet, from: 2, to: 7 } })).toBe(true);
      expect(ran).toEqual([{ id: "strike", entities: [sheet], range: { entity: sheet, from: 2, to: 7 }, taken: undefined, args: 1 }]);
      ce.step(32);
      expect((ce.world.get(sheet, SHEET.groups[0]?.component as never) as { marks: string }).marks).toBe("struck 2-7");
      expect((ce.world.get(other, SHEET.groups[0]?.component as never) as { marks: string }).marks).toBe("");
      // ONE step of the document's history: undone, the words are as they were
      expect(ce.docs.undo()).toBe(true);
      ce.step(48);
      expect((ce.world.get(sheet, SHEET.groups[0]?.component as never) as { marks: string }).marks).toBe("");
      // its state is read over the range (I61's refusal): disabled over these letters, it does nothing
      ran.length = 0;
      expect(ce.ops.runMenuAction("strike", undefined, { range: { entity: sheet, from: 9, to: 12 } })).toBe(false);
      // told words, an objects act is not run: the range names a words act, or nothing
      expect(ce.ops.runMenuAction("spin", undefined, { range: { entity: sheet, from: 0, to: 3 } })).toBe(false);
      expect(ce.ops.runMenuAction("strike", undefined, { range: { entity: card, from: 0, to: 3 } })).toBe(false);   // the card's strike is the objects'
      expect(ce.ops.runMenuAction("nope", undefined, { range: { entity: sheet, from: 0, to: 3 } })).toBe(false);
      ce.ops.setSelection([other], "replace");
      ce.ops.deleteSelection();
      ce.step(16);
      expect(ce.ops.runMenuAction("strike", undefined, { range: { entity: other, from: 0, to: 3 } })).toBe(false);   // gone
      expect(ran).toEqual([]);
    } finally {
      ce.dispose();
    }
  });

  it("a choice act is handed the choice taken — one it offers over THESE letters — or none (its plain op, one argument); a choice it does not offer runs nothing", () => {
    const { ce, sheet, other, card } = engine();
    try {
      ran.length = 0;
      const range = { entity: sheet, from: 0, to: 4 };
      expect(ce.ops.runMenuAction("pen", { id: "ball" }, { range })).toBe(true);
      expect(ce.ops.runMenuAction("pen", undefined, { range })).toBe(true);
      expect(ce.ops.runMenuAction("pen", { id: "gold" }, { range })).toBe(false);
      // "red" is offered only over a range longer than six: the choices are read with the range the run is told
      expect(ce.ops.runMenuAction("pen", { id: "red" }, { range })).toBe(false);
      expect(ce.ops.runMenuAction("pen", { id: "red" }, { range: { entity: sheet, from: 1, to: 9 } })).toBe(true);
      expect(ce.ops.runMenuAction("strike", { id: "felt" }, { range })).toBe(false);   // a toggle offers no choices
      expect(ran.map((r) => [r.id, r.taken, r.args])).toEqual([["pen", "ball", 2], ["pen", undefined, 1], ["pen", "red", 2]]);
      // on the selection alike (I62): the objects' choice act handed its choice, an act with none refusing one
      ran.length = 0;
      ce.ops.setSelection([sheet, other], "replace");
      expect(ce.ops.runMenuAction("tint", { id: "cool" })).toBe(true);
      expect(ce.ops.runMenuAction("spin", { id: "cool" })).toBe(false);
      expect(ran).toEqual([{ id: "tint", entities: [sheet, other], range: undefined, taken: "cool", args: 2 }]);
      expect(card).toBeDefined();
    } finally {
      ce.dispose();
    }
  });

  it("`menuActionsFor(…, \"words\")` lists the words acts the object's type declares, in its order; a malformed range is refused by name, as the ops' own are", () => {
    const { ce, sheet, card } = engine();
    try {
      expect(menuActionsFor([sheet], (e) => menuOf(e, card), "words").map((a) => a.id)).toEqual(["pen", "strike"]);
      expect(menuActionsFor([card], (e) => menuOf(e, card), "words")).toEqual([]);
      const call = (opts: unknown): (() => boolean) => () => ce.ops.runMenuAction("strike", undefined, opts as never);
      expect(call({ range: { entity: sheet, from: 3, to: 3 } })).toThrow(/ops\.runMenuAction\("strike"\) — the range is 3\.\.3: text indices, 0 ≤ from < to \(a range, not a caret\)/);
      expect(call({ range: { entity: sheet, from: -1, to: 2 } })).toThrow(/the range is -1\.\.2/);
      expect(call({ range: { entity: sheet, from: 0.5, to: 2 } })).toThrow(/the range is 0\.5\.\.2/);
      expect(call({ range: { entity: "sheet", from: 0, to: 2 } })).toThrow(/the range's entity is "sheet": the object being written/);
      expect(call({ range: 7 })).toThrow(/a range is \{ entity, from, to \}/);
      expect(call(5)).toThrow(/its options are \{ range\? \}/);
      expect(ce.ops.runMenuAction("strike", undefined, undefined)).toBe(false);   // no options: I61's call
    } finally {
      ce.dispose();
    }
  });
});
