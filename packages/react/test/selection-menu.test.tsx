/**
 * `<SelectionMenu>` (design-015 §7, *Marks on the Mat*'s ink bar; D4a): placed from the desk's anchor 10 px above
 * the marks, flipped below under the rulers' band, kept 16 px from the sides — written to ONE element's transform on
 * every anchor, no camera transform anywhere; away for a gesture at once, back 200 ms after; its acts run the engine's
 * ops (Duplicate gone for a taped selection, the lock turning into "Lift the tape"), an app's own act first, More
 * listing every act with its key, Delete past a rule with the danger tone. happy-dom: no layout, so the bar is placed
 * as the 40 px it will be.
 */
import { createCanvasEngine, defineWidget, Locked, p, type CanvasEngine, type Entity } from "@ice/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSelectionActions, EngineProvider, placeSelectionMenu, SELECTION_MENU, SelectionMenu, type SelectionAction, type SelectionMenuAnchor, type SelectionMenuSource } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

defineWidget({ type: "sm:box", props: { text: p.string({ default: "" }) }, surface: "dom", component: () => null, defaultSize: { w: 100, h: 60 } });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* best-effort */ } }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const VIEW = { width: 1200, height: 800 };
const anchorOf = (over: Partial<SelectionMenuAnchor> = {}): SelectionMenuAnchor => ({ box: { x0: 400, y0: 300, x1: 600, y1: 420 }, count: 1, locked: false, gesturing: false, view: VIEW, rulers: null, ...over });

function fakeSource(first: SelectionMenuAnchor): SelectionMenuSource & { set(a: SelectionMenuAnchor): void } {
  let anchor = first;
  const listeners = new Set<() => void>();
  return {
    anchor: () => anchor,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    set(a) { anchor = a; act(() => { for (const l of [...listeners]) l(); }); },
  };
}

function mount(source: SelectionMenuSource, actions?: readonly SelectionAction[]): { engine: CanvasEngine; menu: () => HTMLElement; step: (n?: number) => void } {
  const engine = createCanvasEngine();
  engine.docs.create();
  cleanups.push(() => engine.dispose());
  let now = 0;
  const step = (n = 1): void => { act(() => { for (let i = 0; i < n; i++) { now += 16; engine.step(now); } }); };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  act(() => { root.render(createElement(EngineProvider, { engine }, createElement(SelectionMenu, { source, ...(actions !== undefined ? { actions } : {}) }))); });
  return { engine, step, menu: () => el.querySelector("[data-ice-selection-menu]") as HTMLElement };
}
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

describe("placeSelectionMenu (desk.js positionMenu)", () => {
  it("centred on the marks, 10 above them; below them when the top ruler's band leaves no room; 16 from the sides; nothing without a selection", () => {
    const size = { w: 200, h: 40 };
    expect(placeSelectionMenu(anchorOf(), size)).toEqual({ x: 400, y: 300 - 10 - 40, below: false });
    const high = anchorOf({ box: { x0: 400, y0: 80, x1: 600, y1: 200 }, rulers: { margin: 26, band: 26 } });
    expect(placeSelectionMenu(high, size)).toEqual({ x: 400, y: 200 + 10, below: true });
    expect(placeSelectionMenu({ ...high, rulers: null }, size)).toEqual({ x: 400, y: 30, below: false });   // the view's own top edge (8) is room enough
    expect(placeSelectionMenu(anchorOf({ box: { x0: 0, y0: 300, x1: 40, y1: 360 } }), size)?.x).toBe(SELECTION_MENU.margin);
    expect(placeSelectionMenu(anchorOf({ box: { x0: 1150, y0: 300, x1: 1200, y1: 360 } }), size)?.x).toBe(1200 - 200 - 16);
    expect(placeSelectionMenu(anchorOf({ box: null }), size)).toBeNull();
    expect(placeSelectionMenu(anchorOf({ count: 0 }), size)).toBeNull();
  });
});

describe("<SelectionMenu>", () => {
  it("one element, one plain transform: 10 px above the marks for a selection, hidden without one", () => {
    const source = fakeSource(anchorOf({ count: 0, box: null }));
    const { menu } = mount(source);
    expect(menu().dataset.visible).toBe("false");
    expect(menu().style.visibility).toBe("hidden");
    source.set(anchorOf());
    expect(menu().dataset.visible).toBe("true");
    expect(menu().style.opacity).toBe("1");
    expect(menu().style.transform).toBe(`translate(500.0px, ${(300 - 10 - 40).toFixed(1)}px)`);
    expect(menu().style.transform).not.toMatch(/matrix|scale/);
    source.set(anchorOf({ box: { x0: 100, y0: 500, x1: 300, y1: 600 } }));
    expect(menu().style.transform).toBe(`translate(200.0px, ${(500 - 50).toFixed(1)}px)`);
    expect(menu().getAttribute("role")).toBe("toolbar");
    expect(menu().hasAttribute("data-canvas-interactive")).toBe(true);
  });

  it("steps aside for a gesture at once and comes back 200 ms after the hand lets go", () => {
    vi.useFakeTimers();
    const source = fakeSource(anchorOf());
    const { menu } = mount(source);
    expect(menu().dataset.away).toBe("false");
    source.set(anchorOf({ gesturing: true }));
    expect(menu().dataset.away).toBe("true");
    expect(menu().style.opacity).toBe("0");
    expect(menu().style.transition).toContain(`${SELECTION_MENU.awayMs}ms`);
    source.set(anchorOf({ gesturing: false }));
    act(() => { vi.advanceTimersByTime(SELECTION_MENU.backMs - 10); });
    expect(menu().dataset.away).toBe("true");
    act(() => { vi.advanceTimersByTime(20); });
    expect(menu().dataset.away).toBe("false");
    expect(menu().style.opacity).toBe("1");
    // a note being written steps it aside the same way, and back 200 ms after the pen is put down
    source.set(anchorOf({ editing: true }));
    expect(menu().dataset.away).toBe("true");
    source.set(anchorOf({ editing: false }));
    act(() => { vi.advanceTimersByTime(SELECTION_MENU.backMs + 10); });
    expect(menu().dataset.away).toBe("false");
  });

  it("its acts run the engine's ops: Duplicate, Tape it down → Lift the tape (Duplicate gone for tape), Delete past a rule, colourless until armed", () => {
    const source = fakeSource(anchorOf());
    const { engine, menu, step } = mount(source);
    const e = engine.ops.spawnWidget("sm:box", { x: 50, y: 50 }) as Entity;
    step(2);
    engine.ops.setSelection([e]);
    const dup = vi.spyOn(engine.ops, "duplicateSelection").mockImplementation(() => []);   // (the real one would select its clones)
    click(menu().querySelector('[data-act="duplicate"]'));
    expect(dup).toHaveBeenCalledTimes(1);
    click(menu().querySelector('[data-act="tape"]'));
    step();
    expect(engine.world.hasTag(e, Locked)).toBe(true);
    source.set(anchorOf({ locked: true }));
    expect(menu().querySelector('[data-act="duplicate"]')).toBeNull();
    const tape = menu().querySelector('[data-act="tape"]') as HTMLElement;
    expect(tape.getAttribute("aria-label")).toBe("Lift the tape");
    expect(tape.dataset.on).toBe("true");
    click(tape);
    step();
    expect(engine.world.hasTag(e, Locked)).toBe(false);
    const del = menu().querySelector('[data-act="delete"]') as HTMLElement;
    expect(del.dataset.tone).toBe("danger");
    expect(del.previousElementSibling?.className).toBe("ice-sm-rule");
    const gone = vi.spyOn(engine.ops, "deleteSelection");
    click(del);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("an app's own act goes first with its label and a rule after it; More lists every act with its key", () => {
    const sent: number[] = [];
    const send: SelectionAction = { id: "send", label: (s) => (s.count > 1 ? `Send ${s.count} to agent` : "Send to agent"), glyph: "agents", place: "lead", text: true, keys: "⌘↩", run: (_e, s) => { sent.push(s.count); } };
    const source = fakeSource(anchorOf({ count: 3 }));
    const { menu } = mount(source, [send, ...defaultSelectionActions()]);
    const bar = menu().querySelector(".ice-sm-bar") as HTMLElement;
    const first = bar.firstElementChild as HTMLElement;
    expect(first.dataset.act).toBe("send");
    expect(first.textContent).toBe("Send 3 to agent");
    expect(first.nextElementSibling?.className).toBe("ice-sm-rule");
    click(first);
    expect(sent).toEqual([3]);
    click(menu().querySelector('[data-act="more"]'));
    const items = Array.from(menu().querySelectorAll(".ice-sm-item"), (i) => i.textContent);
    expect(items).toEqual(["Send 3 to agent⌘↩", "Duplicate⌘D", "Tape it down⇧⌘L", "Delete⌫"]);
    source.set(anchorOf({ count: 1 }));
    expect(menu().querySelector(".ice-sm-sheet")).toBeNull();   // a new selection closes More
  });
});
