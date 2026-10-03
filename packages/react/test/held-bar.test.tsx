/**
 * THE HELD BAR (design-015 §8, *Marks on the Mat* "The bar goes with it"; D4b): with an object in hand the selection menu
 * travels to the foot of the view and changes role (M1) — one element, not a second toolbar — Send stays first, the kind's
 * declared tools take the middle (a tool declared with no kind stays dim), Done ends the bar (`ops.putDown`); while the object
 * flies home the bar steps aside as for a gesture and comes back 200 ms after the landing; the travel's transform transition
 * is on for 340 ms and off again after (a moving selection still places instantly). happy-dom: no layout, the bar is placed
 * as 40 tall. D3t-a: the slots are LIVE — a press uses the tool through `ops.useHeldTool` (a mode becomes the tool in hand,
 * an action runs its op), the mode in hand is marked (and only it), a swatch shows a marker's ink — and the keymap routes the
 * held type's keys to its tools, only while it is held.
 */
import { createCanvasEngine, defineWidget, Held, HeldTool, type CanvasEngine, type Entity, type HeldToolDef } from "@ice/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachKeymap, defaultSelectionActions, EngineProvider, placeSelectionMenu, SELECTION_GLYPHS, SELECTION_MENU, SelectionMenu, type SelectionAction, type SelectionMenuAnchor, type SelectionMenuSource } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK = defineWidget({ type: "hb:book", object: { name: "book" }, openable: true, defaultSize: { w: 180, h: 252 } });
const actions: string[] = [];
const BOARD_TOOLS: readonly HeldToolDef[] = [
  { id: "marker:black", label: "Black marker", kind: "mode", keys: ["1"], hint: "1", glyph: "pen" },
  { id: "marker:blue", label: "Blue marker", kind: "mode", keys: ["2"], hint: "2", glyph: "pen" },
  { id: "eraser", label: "Eraser", kind: "mode", keys: ["e"], hint: "E", glyph: "eraser", toggle: true },
  { id: "undo", label: "Undo", kind: "action", keys: ["mod+z"], hint: "⌘Z", glyph: "undo", run: () => { actions.push("undo"); } },
  { id: "wipe", label: "Wipe", kind: "action", keys: ["mod+Backspace"], bar: false, run: () => { actions.push("wipe"); } },
];
const BOARD = defineWidget({ type: "hb:board", object: { name: "board" }, openable: true, defaultSize: { w: 480, h: 320 }, heldTools: BOARD_TOOLS });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* best-effort */ } }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const VIEW = { width: 1200, height: 800 };
const TOOLS = [{ id: "turn:-1", label: "Previous page", keys: "←", glyph: "chevron-left" }, { id: "turn:1", label: "Next page", keys: "→", glyph: "chevron" }, { id: "pen", label: "Pens", glyph: "pen" }, { id: "undo", label: "Undo", keys: "⌘Z", glyph: "undo" }];
const anchorOf = (over: Partial<SelectionMenuAnchor> = {}): SelectionMenuAnchor => ({ box: { x0: 400, y0: 300, x1: 600, y1: 420 }, count: 1, locked: false, gesturing: false, view: VIEW, rulers: null, ...over });
const held = (over: Partial<SelectionMenuAnchor["held"]> = {}): SelectionMenuAnchor => anchorOf({ box: null, count: 0, held: { tools: TOOLS, landing: false, settled: true, ...over } });

function fakeSource(first: SelectionMenuAnchor): SelectionMenuSource & { set(a: SelectionMenuAnchor): void } {
  let anchor = first;
  const listeners = new Set<() => void>();
  return {
    anchor: () => anchor,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    set(a) { anchor = a; act(() => { for (const l of [...listeners]) l(); }); },
  };
}

const SEND: SelectionAction = { id: "send", place: "lead", text: true, glyph: "agents", label: "Send to agent", run: () => {} };

function mount(source: SelectionMenuSource): { engine: CanvasEngine; menu: () => HTMLElement; book: Entity; board: Entity } {
  const engine = createCanvasEngine({ widgets: [BOOK, BOARD] });
  engine.docs.create();
  const book = engine.ops.spawnWidget("hb:book", { x: 100, y: 100, undoable: false });
  const board = engine.ops.spawnWidget("hb:board", { x: 400, y: 100, undoable: false });
  engine.world.sync();
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | null = null;
  act(() => {
    root = createRoot(host);
    root.render(createElement(EngineProvider, { engine }, createElement(SelectionMenu, { source, actions: [SEND, ...defaultSelectionActions()] })));
  });
  cleanups.push(() => { act(() => root?.unmount()); engine.dispose(); });
  const menu = (): HTMLElement => { const el = host.querySelector<HTMLElement>("[data-ice-selection-menu]"); if (el === null) throw new Error("no menu"); return el; };
  return { engine, menu, book, board };
}

/** The board's slots as the desk publishes them (its `HeldSlot`s): the bar's five — the wipe is keys-only — with the markers' swatches. */
const BOARD_SLOTS = [
  { id: "marker:black", label: "Black marker", kind: "mode" as const, hint: "1", glyph: "pen", swatch: "rgb(20 20 22)" },
  { id: "marker:blue", label: "Blue marker", kind: "mode" as const, hint: "2", glyph: "pen", swatch: "rgb(30 80 200)" },
  { id: "eraser", label: "Eraser", kind: "mode" as const, hint: "E", glyph: "eraser" },
  { id: "undo", label: "Undo", kind: "action" as const, hint: "⌘Z", glyph: "undo" },
  { id: "later", label: "Declared only", glyph: "today" },
];
const heldBoard = (active: string): SelectionMenuAnchor => anchorOf({ box: null, count: 0, held: { tools: BOARD_SLOTS, active, landing: false, settled: true } });

describe("the held bar (design-015 §8)", () => {
  it("is placed centred in the 72 px band at the foot, whatever the selection's box", () => {
    const p = placeSelectionMenu(held(), { w: 300, h: 40 });
    expect(p).toEqual({ x: 450, y: 800 - 72 + 16, below: false });
    // kept from the sides; nothing to anchor to once it flies home (the bar hides)
    expect(placeSelectionMenu(held(), { w: 1300, h: 40 })?.x).toBe(SELECTION_MENU.margin);
    expect(placeSelectionMenu(held({ landing: true }), { w: 300, h: 40 })).toBeNull();
  });

  it("changes role in place: Send first, the kind's tools dim in the middle, Done past a rule — and back to the selection's acts when the object lands", () => {
    const source = fakeSource(anchorOf());
    const { menu } = mount(source);
    expect(menu().dataset.held).toBe("false");
    expect(menu().querySelector('[data-act="delete"]')).not.toBeNull();
    source.set(held());
    const el = menu();
    expect(el.dataset.held).toBe("true");
    expect(el.dataset.visible).toBe("true");   // visible though the selection's box is gone: the hand is the anchor
    expect(el.getAttribute("aria-label")).toBe("In hand");
    expect(el.querySelector('[data-act="send"]')).not.toBeNull();
    expect(Array.from(el.querySelectorAll<HTMLElement>("[data-tool]")).map((b) => b.dataset.tool)).toEqual(["turn:-1", "turn:1", "pen", "undo"]);
    for (const b of Array.from(el.querySelectorAll<HTMLElement>("[data-tool]"))) { expect(b.classList.contains("is-dim")).toBe(true); expect(b.getAttribute("aria-disabled")).toBe("true"); }
    expect(el.querySelector('[data-act="done"]')?.textContent).toContain("Done");
    expect(el.querySelector('[data-act="delete"]')).toBeNull();
    expect(el.querySelector('[data-act="more"]')).toBeNull();
    expect(el.querySelectorAll(".ice-sm-rule")).toHaveLength(2);
    // the travel: the transform's transition is on
    expect(el.style.transition).toContain(`transform ${SELECTION_MENU.travelMs}ms`);
    expect(el.style.transform).toBe(`translate(${(600 - (el.firstElementChild as HTMLElement).offsetWidth / 2).toFixed(1)}px, ${(744).toFixed(1)}px)`);
    // landed: the selection's bar again
    source.set(anchorOf());
    expect(menu().dataset.held).toBe("false");
    expect(menu().querySelector('[data-act="done"]')).toBeNull();
    expect(menu().querySelector('[data-act="delete"]')).not.toBeNull();
  });

  it("Done puts the object down through the engine's op", () => {
    const source = fakeSource(anchorOf());
    const { engine, menu, book } = mount(source);
    engine.ops.open(book);
    source.set(held());
    const done = menu().querySelector<HTMLButtonElement>('[data-act="done"]');
    expect(done).not.toBeNull();
    expect(engine.world.hasTag(book, Held)).toBe(true);
    act(() => { done?.click(); });
    expect(engine.world.hasTag(book, Held)).toBe(false);
  });

  it("steps aside while the object flies home and comes back 200 ms after the landing; the travel's transition leaves after 340 ms", () => {
    vi.useFakeTimers();
    const source = fakeSource(held());
    const { menu } = mount(source);
    expect(menu().dataset.away).toBe("false");
    source.set(held({ landing: true }));
    expect(menu().dataset.away).toBe("true");
    expect(menu().dataset.held).toBe("false");
    source.set(anchorOf());
    expect(menu().dataset.away).toBe("true");
    act(() => { vi.advanceTimersByTime(SELECTION_MENU.backMs + 1); });
    expect(menu().dataset.away).toBe("false");
    act(() => { vi.advanceTimersByTime(SELECTION_MENU.travelMs + 1); });
    expect(menu().style.transition).not.toContain("transform");
  });

  it("I20: travels over the HOST's travel when the anchor carries one — 560 ms, still on where its own 340 would end — and back over it once the hand is gone", () => {
    vi.useFakeTimers();
    const source = fakeSource(anchorOf());
    const { menu } = mount(source);
    source.set(held({ travelMs: 560 }));
    expect(menu().style.transition).toContain("transform 560ms");
    act(() => { vi.advanceTimersByTime(SELECTION_MENU.travelMs + 1); });
    expect(menu().style.transition).toContain("transform 560ms");
    act(() => { vi.advanceTimersByTime(560 - SELECTION_MENU.travelMs); });
    expect(menu().style.transition).not.toContain("transform");
    // the way back: the anchor names no hand at all now (the object gone from it) — the bar travels over the last travel it was told
    source.set(anchorOf());
    expect(menu().style.transition).toContain("transform 560ms");
    act(() => { vi.advanceTimersByTime(561); });
    expect(menu().style.transition).not.toContain("transform");
  });
});

describe("the held bar's live tools (design-015 §8, D3t-a)", () => {
  it("a slot is live: a press uses its tool through the engine — a mode becomes the tool in hand, an action runs its op", () => {
    actions.length = 0;
    const source = fakeSource(anchorOf());
    const { engine, menu, board } = mount(source);
    engine.ops.open(board);
    source.set(heldBoard("marker:black"));
    const slot = (id: string) => menu().querySelector<HTMLButtonElement>(`[data-tool="${id}"]`);
    expect(slot("marker:blue")?.classList.contains("is-dim")).toBe(false);
    act(() => { slot("marker:blue")?.click(); });
    expect(engine.world.get(board, HeldTool)).toEqual({ id: "marker:blue", prev: "marker:black" });
    act(() => { slot("undo")?.click(); });
    expect(actions).toEqual(["undo"]);
    // a tool declared with no kind: dim and inert
    expect(slot("later")?.classList.contains("is-dim")).toBe(true);
    expect(slot("later")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("the mode in hand is marked — and only it; a marker shows its ink as a swatch", () => {
    const source = fakeSource(heldBoard("marker:blue"));
    const { menu } = mount(source);
    const pressed = () => Array.from(menu().querySelectorAll<HTMLElement>('[data-tool][aria-pressed="true"]')).map((b) => b.dataset.tool);
    expect(pressed()).toEqual(["marker:blue"]);
    expect(menu().querySelectorAll('[data-on="true"]')).toHaveLength(1);
    expect(menu().querySelector('[data-tool="undo"]')?.hasAttribute("aria-pressed")).toBe(false);   // an action is never "on"
    const ink = menu().querySelector<HTMLElement>('[data-tool="marker:blue"]');
    expect(ink?.className).toBe("ice-sm-ink");
    expect(ink?.querySelector("i")?.style.background).toBe("rgb(30 80 200)");
    source.set(heldBoard("eraser"));
    expect(pressed()).toEqual(["eraser"]);
    expect(menu().querySelector<HTMLElement>('[data-tool="eraser"]')?.className).toBe("ice-sm-btn");
  });

  it("the keymap routes the held type's keys to its tools — only while it is held", () => {
    actions.length = 0;
    const source = fakeSource(anchorOf());
    const { engine, board } = mount(source);
    cleanups.push(attachKeymap(engine, window));
    const key = (k: string, m: { meta?: boolean; shift?: boolean } = {}): KeyboardEvent => {
      const e = new KeyboardEvent("keydown", { key: k, metaKey: m.meta === true, shiftKey: m.shift === true, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      return e;
    };
    // nothing held: `2` and ⌘⌫ are nobody's here
    expect(key("2").defaultPrevented).toBe(false);
    key("Backspace", { meta: true });
    expect(actions).toEqual([]);
    engine.ops.open(board);
    expect(engine.world.get(board, HeldTool)?.id).toBe("marker:black");
    expect(key("2").defaultPrevented).toBe(true);
    expect(engine.world.get(board, HeldTool)?.id).toBe("marker:blue");
    key("e");
    expect(engine.world.get(board, HeldTool)?.id).toBe("eraser");
    key("E");   // Caps Lock: the same key
    expect(engine.world.get(board, HeldTool)?.id).toBe("marker:blue");
    key("z", { meta: true });
    key("Backspace", { meta: true });
    expect(actions).toEqual(["undo", "wipe"]);   // the tool's ⌘Z before the keymap's own
    engine.ops.putDown();
    key("Backspace", { meta: true });
    expect(actions).toEqual(["undo", "wipe"]);
  });
});

// K8a (design-016 §5 · K-L2 — "held-tool glyphs … a plugin kind declares the same way"): the bar drew only its own set — a tool whose
// glyph name it lacked (or a plugin's, which draws no React) was drawn SILENTLY as "ellipsis". A tool's glyph is a name of the set or
// its OWN drawing (core's `HeldGlyph`), and a name the bar lacks is marked missing — its initial, `data-glyph-missing`, one error.
describe("the held bar draws a plugin tool's own glyph, and never passes an unknown name off as another (K8a)", () => {
  const ELLIPSIS = String((SELECTION_GLYPHS.ellipsis as { props: { d: string } }).props.d);
  const PLUGIN_TOOLS = [
    { id: "wind", label: "Wind the clock", kind: "action" as const, glyph: { path: "M12 5v7l4 2M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0" } },
    { id: "chime", label: "Chime", kind: "mode" as const, glyph: { path: "M6 6h12v12H6z", fill: true } },
    { id: "gear", label: "gears", kind: "mode" as const, glyph: "no-such-glyph" },
    { id: "bare", label: "Bare", kind: "mode" as const },
  ];

  it("a drawing is drawn in the bar's hand — stroked like the set, or filled — and a missing name is the tool's initial, marked and said once", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const source = fakeSource(anchorOf());
      const { menu } = mount(source);
      source.set(held({ tools: PLUGIN_TOOLS }));
      source.set(held({ tools: PLUGIN_TOOLS, active: "chime" }));   // a re-render: the missing name is said ONCE
      const slot = (id: string): HTMLElement => { const el = menu().querySelector<HTMLElement>(`[data-tool="${id}"]`); if (el === null) throw new Error(`no slot ${id}`); return el; };
      const wind = slot("wind").querySelector("path");
      expect(wind?.getAttribute("d")).toBe("M12 5v7l4 2M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0");
      expect(wind?.closest("g")?.getAttribute("stroke")).toBe("currentColor");
      const chime = slot("chime").querySelector("path");
      expect(chime?.getAttribute("fill")).toBe("currentColor");
      // the unknown name: its initial, marked — never the ellipsis
      const gear = slot("gear");
      expect(gear.dataset.glyphMissing).toBe("no-such-glyph");
      expect(gear.querySelector("text")?.textContent).toBe("G");
      expect(gear.innerHTML).not.toContain(ELLIPSIS);
      expect(errors.mock.calls.filter((c) => String(c[0]).includes("no-such-glyph"))).toHaveLength(1);
      // no glyph at all: its initial, and nothing is missing
      const bare = slot("bare");
      expect(bare.dataset.glyphMissing).toBeUndefined();
      expect(bare.querySelector("text")?.textContent).toBe("B");
      for (const t of PLUGIN_TOOLS) expect(slot(t.id).innerHTML, t.id).not.toContain(ELLIPSIS);
      // a name of the set is drawn as before
      source.set(held());
      const undo = menu().querySelector<HTMLElement>('[data-tool="undo"]');
      expect(undo?.querySelector("path")).not.toBeNull();
      expect(undo?.dataset.glyphMissing).toBeUndefined();
      expect(undo?.innerHTML).not.toContain(ELLIPSIS);
    } finally {
      errors.mockRestore();
    }
  });

  it("core takes a tool's drawing and refuses an empty one — a glyph is a name or a path", () => {
    expect(() => defineWidget({ type: "hb:plugin-ok", object: { name: "plug" }, openable: true, heldTools: [{ id: "wind", label: "Wind", kind: "mode", glyph: { path: "M0 0h24" } }] })).not.toThrow();
    expect(() => defineWidget({ type: "hb:plugin-bad", object: { name: "plug" }, openable: true, heldTools: [{ id: "wind", label: "Wind", kind: "mode", glyph: { path: " " } }] })).toThrow(/a glyph is a name of the bar's set or a drawing/);
    expect(() => defineWidget({ type: "hb:plugin-empty", object: { name: "plug" }, openable: true, heldTools: [{ id: "wind", label: "Wind", kind: "mode", glyph: "" }] })).toThrow(/a glyph is a name/);
  });
});
