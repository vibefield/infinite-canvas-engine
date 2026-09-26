/**
 * THE HELD BAR (design-015 §8, *Marks on the Mat* "The bar goes with it"; D4b): with an object in hand the selection menu
 * travels to the foot of the view and changes role (M1) — one element, not a second toolbar — Send stays first, the kind's
 * declared tools take the middle (dim until D3t builds them), Done ends the bar (`ops.putDown`); while the object flies home
 * the bar steps aside as for a gesture and comes back 200 ms after the landing; the travel's transform transition is on for
 * 340 ms and off again after (a moving selection still places instantly). happy-dom: no layout, the bar is placed as 40 tall.
 */
import { createCanvasEngine, defineWidget, Held, type CanvasEngine, type Entity } from "@ice/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSelectionActions, EngineProvider, placeSelectionMenu, SELECTION_MENU, SelectionMenu, type SelectionAction, type SelectionMenuAnchor, type SelectionMenuSource } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK = defineWidget({ type: "hb:book", object: { name: "book" }, openable: true, defaultSize: { w: 180, h: 252 } });

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

function mount(source: SelectionMenuSource): { engine: CanvasEngine; menu: () => HTMLElement; book: Entity } {
  const engine = createCanvasEngine({ widgets: [BOOK] });
  engine.docs.create();
  const book = engine.ops.spawnWidget("hb:book", { x: 100, y: 100, undoable: false });
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
  return { engine, menu, book };
}

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
});
