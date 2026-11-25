/**
 * THE WORDS' ROW (petition I60 — "the selection bar comes to the words"): until now `<SelectionMenu>` stepped aside while a part was
 * written (`editing`); its kind acts say their state and their choices (I61, I62). While the desk's anchor carries WORDS (selected in
 * the part being written, with the object's words acts as slots), the bar is the words' row: placed over `words.box` by the rules it is
 * placed by over objects, a plain act a cell, a TOGGLE shown pressed (`aria-pressed`, off said too), a CHOICE act a cell that swaps the
 * row for its choices — Back first, the current one marked, a rule where the group changes — and every act run through the engine with
 * the words' range as the anchor says it now (`ops.runMenuAction(id, taken?, { range })`). A press on the row keeps the editor's focus.
 * The selection's kind acts keep I62's list, and show a toggle pressed. happy-dom: no layout, so the bar is placed as the 40 px it
 * will be.
 */
import { createCanvasEngine, type CanvasEngine, type Entity } from "@ice/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSelectionActions, EngineProvider, placeSelectionMenu, SELECTION_MENU, SelectionMenu, type SelectionMenuAnchor, type SelectionMenuSource, type SelectionMenuWords } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* best-effort */ } }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const VIEW = { width: 1200, height: 800 };
const NOTE = 7 as Entity;
const PENS = [{ id: "felt", label: "Felt pen", swatch: "#2b2a33" }, { id: "ball", label: "Ball pen", swatch: "#1f2f5c", current: true }, { id: "red", label: "Red pen", group: "more" }];
const WORDS: SelectionMenuWords = {
  box: { x0: 500, y0: 300, x1: 620, y1: 324 }, entity: NOTE, from: 4, to: 13,
  menu: [
    { id: "pen", label: "Pen", glyph: "pen", choices: PENS },
    { id: "strike", label: "Strike", keys: "⇧⌘X", pressed: true },
    { id: "underline", label: "Underline", pressed: false },
    { id: "clear", label: "Clear" },
  ],
};
/** The anchor while a note is written and four of its words are selected (the note itself selected too). */
const anchorOf = (over: Partial<SelectionMenuAnchor> = {}): SelectionMenuAnchor => ({ box: { x0: 400, y0: 200, x1: 700, y1: 420 }, count: 1, locked: false, gesturing: false, editing: true, view: VIEW, rulers: null, words: WORDS, ...over });

function fakeSource(first: SelectionMenuAnchor): SelectionMenuSource & { set(a: SelectionMenuAnchor): void } {
  let anchor = first;
  const listeners = new Set<() => void>();
  return {
    anchor: () => anchor,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    set(a) { anchor = a; act(() => { for (const l of [...listeners]) l(); }); },
  };
}

function mount(source: SelectionMenuSource): { engine: CanvasEngine; menu: () => HTMLElement; runs: unknown[][] } {
  const engine = createCanvasEngine();
  engine.docs.create();
  cleanups.push(() => engine.dispose());
  const runs: unknown[][] = [];
  vi.spyOn(engine.ops, "runMenuAction").mockImplementation((...args: unknown[]) => { runs.push(args); return true; });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  act(() => { root.render(createElement(EngineProvider, { engine }, createElement(SelectionMenu, { source, actions: defaultSelectionActions() }))); });
  return { engine, runs, menu: () => el.querySelector("[data-ice-selection-menu]") as HTMLElement };
}
const click = (el: Element | null | undefined): void => { if (el === null || el === undefined) throw new Error("no such cell"); act(() => { (el as HTMLElement).click(); }); };
const cells = (menu: HTMLElement): string[] => Array.from(menu.querySelectorAll<HTMLElement>(".ice-sm-bar button"), (b) => b.dataset.act ?? b.dataset.choice ?? "?");

describe("placeSelectionMenu over the words (petition I60)", () => {
  it("the words' box places the bar by the rules over objects — centred, 10 above, below under the top ruler's band — while words carry acts; the hand wins", () => {
    const size = { w: 200, h: 40 };
    expect(placeSelectionMenu(anchorOf(), size)).toEqual({ x: 460, y: 300 - 10 - 40, below: false });
    const high = anchorOf({ words: { ...WORDS, box: { x0: 500, y0: 40, x1: 620, y1: 64 } }, rulers: { margin: 26, band: 26 } });
    expect(placeSelectionMenu(high, size)).toEqual({ x: 460, y: 64 + 10, below: true });
    // no acts for the words: the objects' box, as before
    expect(placeSelectionMenu(anchorOf({ words: { ...WORDS, menu: [] } }), size)).toEqual({ x: 450, y: 200 - 10 - 40, below: false });
    // nothing selected but the words: still placed over them
    expect(placeSelectionMenu(anchorOf({ count: 0, box: null }), size)).toEqual({ x: 460, y: 250, below: false });
    // an object in hand: the foot, whatever the words
    expect(placeSelectionMenu(anchorOf({ held: { tools: [], landing: false, settled: true } }), size)?.y).toBe(VIEW.height - SELECTION_MENU.foot + (SELECTION_MENU.foot - 40) / 2);
  });
});

describe("<SelectionMenu>'s words' row (petition I60)", () => {
  it("is the bar while words are selected in the part being written: the words' acts alone, in their order, over the words — not stepped aside for the writing", () => {
    const source = fakeSource(anchorOf());
    const { menu } = mount(source);
    expect(menu().dataset.visible).toBe("true");
    expect(menu().dataset.away).toBe("false");
    expect(menu().style.opacity).toBe("1");
    expect(menu().querySelector(".ice-sm-bar")?.getAttribute("data-row")).toBe("words");
    expect(menu().getAttribute("aria-label")).toBe("Words");
    expect(cells(menu())).toEqual(["word.pen", "word.strike", "word.underline", "word.clear"]);   // never Duplicate, Tape, More, Delete
    expect(menu().style.transform).toBe(`translate(560.0px, ${(300 - 10 - 40).toFixed(1)}px)`);
    const pen = menu().querySelector<HTMLElement>('[data-act="word.pen"]');
    expect(pen?.getAttribute("aria-label")).toBe("Pen");
    expect(pen?.getAttribute("aria-haspopup")).toBe("true");
    expect(menu().querySelector('[data-act="word.strike"]')?.getAttribute("title")).toBe("Strike (⇧⌘X)");
    // the words go (a caret): the objects' row again, stepped aside while the part is written, as before
    source.set(anchorOf({ words: undefined }));
    expect(menu().dataset.away).toBe("true");
    expect(menu().querySelector(".ice-sm-bar")?.getAttribute("data-row")).toBe("objects");
  });

  it("a toggle shows pressed — `aria-pressed`, on in cream — a plain act is a cell, and each runs its op on the engine with the words' range", () => {
    const source = fakeSource(anchorOf());
    const { menu, runs } = mount(source);
    const strike = menu().querySelector<HTMLElement>('[data-act="word.strike"]');
    expect(strike?.getAttribute("aria-pressed")).toBe("true");
    expect(strike?.dataset.on).toBe("true");
    const under = menu().querySelector<HTMLElement>('[data-act="word.underline"]');
    expect(under?.getAttribute("aria-pressed")).toBe("false");
    expect(under?.dataset.on).toBeUndefined();
    const clear = menu().querySelector<HTMLElement>('[data-act="word.clear"]');
    expect(clear?.hasAttribute("aria-pressed")).toBe(false);
    click(strike);
    click(clear);
    expect(runs).toEqual([["strike", undefined, { range: { entity: NOTE, from: 4, to: 13 } }], ["clear", undefined, { range: { entity: NOTE, from: 4, to: 13 } }]]);
    // the toggle's state moves with the anchor
    source.set(anchorOf({ words: { ...WORDS, menu: WORDS.menu.map((m) => (m.id === "strike" ? { ...m, pressed: false } : m)) } }));
    expect(menu().querySelector('[data-act="word.strike"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("a choice act swaps the row for its choices — Back first, the current one marked, a rule where the group changes — a choice runs the act with it and the row comes back; Back runs nothing", () => {
    const source = fakeSource(anchorOf());
    const { menu, runs } = mount(source);
    click(menu().querySelector('[data-act="word.pen"]'));
    expect(cells(menu())).toEqual(["back", "felt", "ball", "red"]);
    expect(menu().querySelector('[data-act="back"]')?.getAttribute("aria-label")).toBe("Back");
    const ball = menu().querySelector<HTMLElement>('[data-choice="ball"]');
    expect(ball?.getAttribute("aria-pressed")).toBe("true");
    expect(ball?.getAttribute("aria-label")).toBe("Ball pen");
    expect(menu().querySelector('[data-choice="felt"]')?.getAttribute("aria-pressed")).toBe("false");
    // a swatch is the kind's CSS colour, drawn as a dot (I62's); a choice with none is its label alone; a new group starts with a rule
    expect(menu().querySelector('[data-choice="felt"] i')?.getAttribute("data-swatch")).toBe("#2b2a33");
    expect(menu().querySelector('[data-choice="red"] i')).toBeNull();
    expect(menu().querySelector('[data-choice="red"]')?.getAttribute("data-group-start")).toBe("true");
    expect(menu().querySelector('[data-choice="ball"]')?.hasAttribute("data-group-start")).toBe(false);
    click(menu().querySelector('[data-choice="felt"]'));
    expect(runs).toEqual([["pen", { id: "felt" }, { range: { entity: NOTE, from: 4, to: 13 } }]]);
    expect(cells(menu())).toEqual(["word.pen", "word.strike", "word.underline", "word.clear"]);
    click(menu().querySelector('[data-act="word.pen"]'));
    click(menu().querySelector('[data-act="back"]'));
    expect(cells(menu())).toEqual(["word.pen", "word.strike", "word.underline", "word.clear"]);
    expect(runs).toHaveLength(1);
    // choosing, the words go (a press on the writing): the choices close with them
    click(menu().querySelector('[data-act="word.pen"]'));
    source.set(anchorOf({ words: undefined }));
    source.set(anchorOf());
    expect(cells(menu())).toEqual(["word.pen", "word.strike", "word.underline", "word.clear"]);
  });

  it("an act runs with the words as the anchor says them NOW — a range moved since the row was drawn runs with the new one", () => {
    const source = fakeSource(anchorOf());
    const { menu, runs } = mount(source);
    source.set(anchorOf({ words: { ...WORDS, from: 6, to: 9, box: { x0: 520, y0: 300, x1: 550, y1: 324 } } }));
    click(menu().querySelector('[data-act="word.clear"]'));
    expect(runs).toEqual([["clear", undefined, { range: { entity: NOTE, from: 6, to: 9 } }]]);
    expect(menu().style.transform).toBe(`translate(535.0px, ${(300 - 10 - 40).toFixed(1)}px)`);
  });

  it("with no acts for the words the bar steps aside while the part is written, as before; a press on the words' row keeps the editor's focus (its default prevented), a press on the objects' row does not", () => {
    const source = fakeSource(anchorOf({ words: { ...WORDS, menu: [] } }));
    const { menu } = mount(source);
    expect(menu().dataset.away).toBe("true");
    source.set(anchorOf({ editing: false, words: undefined }));
    const objects = menu().querySelector('[data-act="duplicate"]') as HTMLElement;
    const plain = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    objects.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    source.set(anchorOf());
    const cell = menu().querySelector('[data-act="word.strike"]') as HTMLElement;
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    const mouse = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    cell.dispatchEvent(down);
    cell.dispatchEvent(mouse);
    expect(down.defaultPrevented).toBe(true);
    expect(mouse.defaultPrevented).toBe(true);
  });

  it("the selection's kind acts show a toggle pressed — off said too — and a choice act among them keeps I62's list (run on the selection, told no range)", () => {
    const source = fakeSource(anchorOf({
      editing: false, words: undefined,
      menu: [{ id: "tint", label: "Tint", choices: [{ id: "warm", label: "Warm", swatch: "#e8a040" }, { id: "cool", label: "Cool", current: true }] }, { id: "mute", label: "Mute", pressed: true }, { id: "loop", label: "Loop", pressed: false }, { id: "spin", label: "Spin" }],
    }));
    const { menu, runs } = mount(source);
    expect(cells(menu())).toEqual(["kind.tint", "kind.mute", "kind.loop", "kind.spin", "duplicate", "tape", "more", "delete"]);
    expect(menu().querySelector('[data-act="kind.mute"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(menu().querySelector('[data-act="kind.mute"]')?.getAttribute("data-on")).toBe("true");
    expect(menu().querySelector('[data-act="kind.loop"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(menu().querySelector('[data-act="kind.spin"]')?.hasAttribute("aria-pressed")).toBe(false);
    // the objects' row stays; the act's choices are I62's list beside it
    click(menu().querySelector('[data-act="kind.tint"]'));
    expect(menu().querySelector(".ice-sm-bar")?.getAttribute("data-row")).toBe("objects");
    expect(menu().querySelector('[data-choices="tint"] [data-choice="cool"]')?.getAttribute("aria-checked")).toBe("true");
    click(menu().querySelector('[data-choices="tint"] [data-choice="warm"]'));
    click(menu().querySelector('[data-act="kind.mute"]'));
    expect(runs).toEqual([["tint", { id: "warm" }], ["mute"]]);
  });
});
