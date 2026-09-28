/**
 * `<TrayBar>` (design-018 §5–§6; R2): the pegboard drawer's handle, the menu's sibling in the desk's ink. Closed, the pill at the
 * view's foot; open, riding the drawer's top edge `min(vh − 16, drawer.y − 10)` — written to its one element's transform on every
 * anchor, no render per frame of the slide — its glyph a ×, the chips grown beside it (All, then the frame's categories, the chosen
 * one pressed); stepping aside in hand and with nothing to offer; its downs chrome's; Enter and Space acting before the page's keys,
 * ←/→ walking the chips; no rAF of its own. happy-dom: no layout and no stylesheet cascade — the states are read off the attributes.
 */
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeTrayBar, TRAY_BAR, TrayBar, type TrayBarAnchor, type TrayBarSource } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* best-effort */ } }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const VIEW = { width: 1200, height: 800 };
const CATS = [{ id: "paper", label: "Paper", count: 4 }, { id: "surfaces", label: "Surfaces", count: 2 }, { id: "things", label: "Things", count: 1 }];
const closed = (over: Partial<TrayBarAnchor> = {}): TrayBarAnchor => ({ open: false, drawer: { x: 40, y: 800, w: 1120, p: 0 }, view: VIEW, held: false, entries: 7, category: "", categories: CATS, ...over });
const opened = (over: Partial<TrayBarAnchor> = {}): TrayBarAnchor => closed({ open: true, drawer: { x: 40, y: 448, w: 1120, p: 1 }, ...over });

function fakeSource(first: TrayBarAnchor): TrayBarSource & { set(a: TrayBarAnchor): void; readonly calls: { toggle: number; category: string[] } } {
  let anchor = first;
  const listeners = new Set<() => void>();
  const calls = { toggle: 0, category: [] as string[] };
  return {
    anchor: () => anchor,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    toggle() { calls.toggle += 1; return !anchor.open; },
    category(id) { if (id !== undefined) calls.category.push(id); return anchor.category; },
    set(a) { anchor = a; act(() => { for (const l of [...listeners]) l(); }); },
    calls,
  };
}

function mount(source: TrayBarSource): { bar: () => HTMLElement; toggle: () => HTMLButtonElement; chips: () => HTMLButtonElement[]; renders: () => number } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  let renders = 0;
  act(() => { root.render(createElement(Profiler, { id: "bar", onRender: () => { renders += 1; } }, createElement(TrayBar, { source }))); });
  const bar = (): HTMLElement => el.querySelector("[data-ice-tray-bar]") as HTMLElement;
  return {
    bar,
    toggle: () => bar().querySelector("[data-act=tray]") as HTMLButtonElement,
    chips: () => Array.from(bar().querySelectorAll<HTMLButtonElement>(".ice-tb-chip")),
    renders: () => renders,
  };
}
const key = (el: Element, type: "keydown" | "keyup", k: string, repeat = false): KeyboardEvent => {
  const ev = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, repeat });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};

describe("placeTrayBar (design-018 §5)", () => {
  it("waits at the foot, 16 above the view's edge, while the drawer's edge is below it, then rides 10 above the edge — one motion; as wide as the drawer, within the view", () => {
    expect(placeTrayBar(closed())).toEqual({ y: 800 - 16 - 40, maxWidth: 1120 });
    expect(placeTrayBar(closed({ drawer: { x: 40, y: 796, w: 1120, p: 0.01 } })).y).toBe(800 - 16 - 40);   // the edge below the foot's line: it waits
    expect(placeTrayBar(closed({ drawer: { x: 40, y: 700, w: 1120, p: 0.3 } })).y).toBe(700 - 10 - 40);    // …then rides it
    expect(placeTrayBar(opened()).y).toBe(448 - 10 - TRAY_BAR.height);
    expect(placeTrayBar(closed({ drawer: null }))).toEqual({ y: 744, maxWidth: 1200 - 32 });
    expect(placeTrayBar(opened({ view: { width: 420, height: 800 }, drawer: { x: 30, y: 448, w: 360, p: 1 } })).maxWidth).toBe(360);
    expect(placeTrayBar(opened({ view: { width: 380, height: 800 }, drawer: { x: 10, y: 448, w: 360, p: 1 } })).maxWidth).toBe(348);
  });
});

describe("<TrayBar>", () => {
  it("closed: one pill at the foot — the pegboard glyph and the word Objects, titled with its key, not expanded; its chips out of reach", () => {
    const m = mount(fakeSource(closed()));
    expect(m.bar().style.transform).toBe("translateY(744.0px)");
    expect(m.bar().dataset.open).toBe("false");
    expect(m.bar().dataset.visible).toBe("true");
    const t = m.toggle();
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(t.title).toBe("Objects (A)");
    expect(t.textContent).toBe("Objects");
    expect(t.querySelectorAll("svg rect").length).toBe(3);   // three staggered stadium holes
    expect(m.chips().every((c) => c.tabIndex === -1)).toBe(true);
  });

  it("open: riding the drawer's top edge, the glyph a close ×, the chips All · Paper · Surfaces · Things with the chosen one pressed — in a toolbar", () => {
    const s = fakeSource(closed());
    const m = mount(s);
    s.set(opened({ category: "surfaces" }));
    expect(m.bar().style.transform).toBe(`translateY(${(448 - 10 - 40).toFixed(1)}px)`);
    expect(m.bar().dataset.open).toBe("true");
    expect(m.toggle().getAttribute("aria-expanded")).toBe("true");
    expect(m.toggle().querySelector("svg path")).not.toBeNull();
    expect(m.toggle().querySelectorAll("svg rect").length).toBe(0);
    expect(m.chips().map((c) => c.textContent)).toEqual(["All", "Paper", "Surfaces", "Things"]);
    expect(m.chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
    expect(m.chips().map((c) => c.dataset.on ?? "")).toEqual(["", "", "true", ""]);
    expect(m.chips().every((c) => c.tabIndex === 0)).toBe(true);
    expect(m.bar().querySelector(".ice-tb-chips")?.getAttribute("role")).toBe("toolbar");
    s.set(opened({ category: "" }));
    expect(m.chips()[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the slide frame by frame — each anchor written to its transform, no render for a frame that moved only the drawer", () => {
    const s = fakeSource(closed());
    const m = mount(s);
    s.set(closed({ open: true, drawer: { x: 40, y: 790, w: 1120, p: 0.03 } }));
    const r0 = m.renders();
    for (const y of [760, 640, 520, 470, 452, 448]) {
      s.set(closed({ open: true, drawer: { x: 40, y, w: 1120, p: (800 - y) / 352 } }));
      expect(m.bar().style.transform).toBe(`translateY(${(Math.min(784, y - 10) - 40).toFixed(1)}px)`);
    }
    expect(m.renders()).toBe(r0);
  });

  it("acts through its source: the button toggles the drawer, a chip chooses its category — All is \"\"", () => {
    const s = fakeSource(opened());
    const m = mount(s);
    act(() => { m.toggle().click(); });
    expect(s.calls.toggle).toBe(1);
    act(() => { m.chips()[2]?.click(); });
    act(() => { m.chips()[0]?.click(); });
    expect(s.calls.category).toEqual(["surfaces", ""]);
  });

  it("its pointer is chrome's: the pill carries the canvas's interactive marker, and a down on it goes no further than the bar", () => {
    const m = mount(fakeSource(opened()));
    const pill = m.bar().querySelector(".ice-tb-bar") as HTMLElement;
    expect(pill.hasAttribute("data-canvas-interactive")).toBe(true);
    const heard: string[] = [];
    const onDoc = (): void => { heard.push("down"); };
    document.addEventListener("pointerdown", onDoc);
    cleanups.push(() => document.removeEventListener("pointerdown", onDoc));
    act(() => { m.chips()[1]?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(heard).toEqual([]);
  });

  it("keys: Enter and Space act on a focused button before the page hears them (handled — `defaultPrevented`), once; a held key's repeats do nothing; ←/→, Home and End walk the chips", () => {
    const s = fakeSource(opened());
    const m = mount(s);
    const down = key(m.toggle(), "keydown", "Enter");
    expect(down.defaultPrevented).toBe(true);
    expect(s.calls.toggle).toBe(1);
    expect(key(m.toggle(), "keydown", " ").defaultPrevented).toBe(true);
    expect(key(m.toggle(), "keyup", " ").defaultPrevented).toBe(true);   // the platform's own Space activation, cancelled
    key(m.toggle(), "keydown", "Enter", true);
    expect(s.calls.toggle).toBe(2);
    const chip = m.chips()[1] as HTMLButtonElement;
    key(chip, "keydown", " ");
    expect(s.calls.category).toEqual(["paper"]);
    act(() => { chip.focus(); });
    expect(key(chip, "keydown", "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(m.chips()[2]);
    key(document.activeElement as Element, "keydown", "End");
    expect(document.activeElement).toBe(m.chips()[3]);
    key(document.activeElement as Element, "keydown", "ArrowRight");
    expect(document.activeElement).toBe(m.chips()[3]);
    key(document.activeElement as Element, "keydown", "Home");
    expect(document.activeElement).toBe(m.chips()[0]);
    expect(key(document.activeElement as Element, "keydown", "a").defaultPrevented).toBe(false);   // the desk's keys pass through
  });

  it("a pointer's click leaves no focus behind (Space pans, ⏎ is the desk's); a chip that has the keys' focus when the drawer shuts hands it to the button", () => {
    const s = fakeSource(opened());
    const m = mount(s);
    act(() => { m.toggle().focus(); });
    act(() => { m.toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
    expect(document.activeElement).not.toBe(m.toggle());
    act(() => { m.chips()[2]?.focus(); });
    s.set(closed());
    expect(document.activeElement).toBe(m.toggle());
  });

  it("steps aside while an object is in hand and while the drawer has nothing to offer — and comes back", () => {
    const s = fakeSource(closed());
    const m = mount(s);
    s.set(closed({ held: true }));
    expect([m.bar().dataset.visible, m.bar().getAttribute("aria-hidden")]).toEqual(["false", "true"]);
    s.set(closed());
    expect([m.bar().dataset.visible, m.bar().getAttribute("aria-hidden")]).toEqual(["true", "false"]);
    s.set(closed({ entries: 0, categories: [] }));
    expect(m.bar().dataset.visible).toBe("false");
  });

  it("has no rAF of its own: mounted, ridden, clicked and keyed, it never asks for a frame", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    const s = fakeSource(closed());
    const m = mount(s);
    for (const y of [700, 560, 448]) s.set(opened({ drawer: { x: 40, y, w: 1120, p: 1 } }));
    act(() => { m.chips()[1]?.click(); });
    key(m.toggle(), "keydown", "Enter");
    s.set(closed());
    expect(raf).not.toHaveBeenCalled();
  });

  it("wears the menu's ink: the same custom properties on its own root, so an app re-points both", () => {
    const m = mount(fakeSource(closed()));
    const css = m.bar().querySelector("style")?.textContent ?? "";
    expect(css).toContain("[data-ice-tray-bar]{--ice-menu-ink:rgb(16 9 4 / .94);");
    expect(css).toContain("--ice-menu-shadow:-1px 2px 3px rgb(14 26 10 / .25),-8px 14px 32px rgb(14 26 10 / .38)");
  });
});
