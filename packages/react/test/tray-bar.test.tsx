/**
 * `<TrayBar>` (design-018 §5–§6; R2, R4): the pegboard drawer's handle, the menu's sibling in the desk's ink, and its filters. Closed,
 * the pill at the view's foot; open, riding the drawer's top edge `min(vh − 16, drawer.y − 10)` — written to its element's transform on
 * every anchor, no render per frame of the slide — its glyph a ×. The chips (R4) are LABEL TAPE in the drawer's clear header — the
 * anchor's `drawer.header`, the strip centred on the drawer, fading in over the slide's last part — never in the pill (All, then the
 * frame's categories, the chosen one pressed); by night the tape steps back by the anchor's `night`. Both step aside in hand and with
 * nothing to offer; their downs chrome's; Enter and Space acting before the page's keys, ←/→ walking the chips; no rAF of its own.
 * happy-dom: no layout and no stylesheet cascade — the states are read off the attributes and the written styles.
 */
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESK_TAPE, placeTrayBar, TRAY_BAR, TrayBar, type TrayBarAnchor, type TrayBarSource } from "../src";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* best-effort */ } }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const VIEW = { width: 1200, height: 800 };
const CATS = [{ id: "paper", label: "Paper", count: 4 }, { id: "surfaces", label: "Surfaces", count: 2 }, { id: "things", label: "Things", count: 1 }];
/** The drawer as drawn at `y`, its slide `p` — its header the 48 px under the edge's inside (the desk's arris 1.5, `DRAWER.header`). */
const drawn = (y: number, p: number, x = 40, w = 1120): NonNullable<TrayBarAnchor["drawer"]> => ({ x, y, w, p, header: { y: y + 1.5, h: 48 } });
const closed = (over: Partial<TrayBarAnchor> = {}): TrayBarAnchor => ({ open: false, drawer: drawn(800, 0), view: VIEW, night: 0, held: false, entries: 7, category: "", categories: CATS, ...over });
const opened = (over: Partial<TrayBarAnchor> = {}): TrayBarAnchor => closed({ open: true, drawer: drawn(448, 1), ...over });

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

function mount(source: TrayBarSource): { bar: () => HTMLElement; pill: () => HTMLElement; head: () => HTMLElement; toggle: () => HTMLButtonElement; chips: () => HTMLButtonElement[]; renders: () => number } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  let renders = 0;
  act(() => { root.render(createElement(Profiler, { id: "bar", onRender: () => { renders += 1; } }, createElement(TrayBar, { source }))); });
  const bar = (): HTMLElement => el.querySelector("[data-ice-tray-bar]") as HTMLElement;
  return {
    bar,
    pill: () => bar().querySelector(".ice-tb-handle") as HTMLElement,
    head: () => bar().querySelector(".ice-tb-head") as HTMLElement,
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

describe("placeTrayBar (design-018 §5, R4)", () => {
  it("the pill waits at the foot, 16 above the view's edge, while the drawer's edge is below it, then rides 10 above the edge — one motion", () => {
    expect(placeTrayBar(closed()).y).toBe(800 - 16 - 40);
    expect(placeTrayBar(closed({ drawer: drawn(796, 0.01) })).y).toBe(800 - 16 - 40);   // the edge below the foot's line: it waits
    expect(placeTrayBar(closed({ drawer: drawn(700, 0.3) })).y).toBe(700 - 10 - 40);    // …then rides it
    expect(placeTrayBar(opened()).y).toBe(448 - 10 - TRAY_BAR.height);
    expect(placeTrayBar(closed({ drawer: null }))).toEqual({ y: 744, head: null });
  });

  it("the chips' strip is the drawer's HEADER as drawn — 12 in from its sides, its clear band's height — fading in over the slide's last part (p 0.6 → 1, a smoothstep)", () => {
    expect(placeTrayBar(opened()).head).toEqual({ x: 52, y: 449.5, w: 1096, h: 48, opacity: 1 });
    expect(placeTrayBar(closed()).head).toEqual({ x: 52, y: 801.5, w: 1096, h: 48, opacity: 0 });
    const at = (p: number): number => placeTrayBar(closed({ drawer: drawn(800 - 352 * p, p) })).head?.opacity ?? Number.NaN;
    expect([0.3, 0.6, 0.7, 0.8, 0.9, 1].map((p) => Math.round(at(p) * 1e9) / 1e9)).toEqual([0, 0, 0.15625, 0.5, 0.84375, 1]);
    expect(placeTrayBar(closed({ drawer: drawn(700, 0.3) })).head?.y).toBe(701.5);   // one motion with the board: the header as drawn
    expect(placeTrayBar(opened({ view: { width: 420, height: 800 }, drawer: drawn(448, 1, 30, 360) })).head).toMatchObject({ x: 42, w: 336 });
  });
});

describe("<TrayBar>", () => {
  it("closed: one pill at the foot — the pegboard glyph and the word Objects, titled with its key, not expanded; its chips out of reach, their strip hidden", () => {
    const m = mount(fakeSource(closed()));
    expect(m.pill().style.transform).toBe("translateY(744.0px)");
    expect(m.head().dataset.shown).toBe("false");
    expect(m.bar().dataset.open).toBe("false");
    expect(m.bar().dataset.visible).toBe("true");
    const t = m.toggle();
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(t.title).toBe("Objects (A)");
    expect(t.textContent).toBe("Objects");
    expect(t.querySelectorAll("svg rect").length).toBe(3);   // three staggered stadium holes
    expect(m.chips().every((c) => c.tabIndex === -1)).toBe(true);
  });

  it("open: the pill rides the drawer's top edge, its glyph a close × — and no chip in it; the chips All · Paper · Surfaces · Things lie in the drawer's header, the chosen one pressed — in a toolbar", () => {
    const s = fakeSource(closed());
    const m = mount(s);
    s.set(opened({ category: "surfaces" }));
    expect(m.pill().style.transform).toBe(`translateY(${(448 - 10 - 40).toFixed(1)}px)`);
    expect(m.bar().dataset.open).toBe("true");
    expect(m.toggle().getAttribute("aria-expanded")).toBe("true");
    expect(m.toggle().querySelector("svg path")).not.toBeNull();
    expect(m.toggle().querySelectorAll("svg rect").length).toBe(0);
    // R4: the pill is the handle alone; the chips are the header's — its strip at the drawer's header as drawn, shown whole
    expect(m.bar().querySelector(".ice-tb-bar")?.querySelectorAll("button").length).toBe(1);
    expect(m.chips().every((c) => m.head().contains(c) && !m.pill().contains(c))).toBe(true);
    const h = m.head();
    expect([h.style.transform, h.style.width, h.style.height, h.style.opacity, h.dataset.shown]).toEqual(["translate(52.0px, 449.5px)", "1096px", "48px", "1.000", "true"]);
    expect(m.chips().map((c) => c.textContent)).toEqual(["All", "Paper", "Surfaces", "Things"]);
    expect(m.chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
    expect(m.chips().map((c) => c.dataset.on ?? "")).toEqual(["", "", "true", ""]);
    expect(m.chips().every((c) => c.tabIndex === 0)).toBe(true);
    expect(m.bar().querySelector(".ice-tb-chips")?.getAttribute("role")).toBe("toolbar");
    s.set(opened({ category: "" }));
    expect(m.chips()[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the slide frame by frame — each anchor written to the pill's transform and the header strip's, the chips fading in over its last part; no render for a frame that moved only the drawer", () => {
    const s = fakeSource(closed());
    const m = mount(s);
    s.set(closed({ open: true, drawer: drawn(790, 0.03) }));
    const r0 = m.renders();
    const fades: string[] = [];
    for (const y of [760, 640, 520, 470, 452, 448]) {
      const p = (800 - y) / 352;
      s.set(closed({ open: true, drawer: drawn(y, p) }));
      expect(m.pill().style.transform).toBe(`translateY(${(Math.min(784, y - 10) - 40).toFixed(1)}px)`);
      expect(m.head().style.transform).toBe(`translate(52.0px, ${(y + 1.5).toFixed(1)}px)`);
      fades.push(m.head().style.opacity);
    }
    expect(fades).toEqual(["0.000", "0.000", "0.483", "0.934", "0.998", "1.000"]);   // p .11 · .45 · .80 · .94 · .99 · 1 on smoothstep(.6, 1, p)
    expect(m.renders()).toBe(r0);
  });

  it("past the header's width the chips scroll inside it: each end fades where more tape lies beyond (told on a scroll), neither when they fit", () => {
    const m = mount(fakeSource(opened()));
    const bar = m.bar().querySelector(".ice-tb-chips") as HTMLElement;
    const edges = (): string[] => [bar.dataset.before ?? "", bar.dataset.after ?? ""];
    expect(edges()).toEqual(["false", "false"]);   // happy-dom lays nothing out: they fit
    let left = 0;
    Object.defineProperty(bar, "scrollWidth", { configurable: true, get: () => 420 });
    Object.defineProperty(bar, "clientWidth", { configurable: true, get: () => 300 });
    Object.defineProperty(bar, "scrollLeft", { configurable: true, get: () => left });
    const scrolled = (x: number): void => { left = x; act(() => { bar.dispatchEvent(new Event("scroll")); }); };
    scrolled(0);
    expect(edges()).toEqual(["false", "true"]);
    scrolled(60);
    expect(edges()).toEqual(["true", "true"]);
    scrolled(120);
    expect(edges()).toEqual(["true", "false"]);
    const css = m.bar().querySelector("style")?.textContent ?? "";
    expect(css).toContain('.ice-tb-chips[data-before="true"][data-after="true"]{mask-image:linear-gradient(90deg,transparent 0,#000 18px,#000 calc(100% - 18px),transparent 100%)}');
  });

  it("by night the tape steps back as the specimens' tags do: the anchor's night written to its root (clamped), the day's 0", () => {
    const s = fakeSource(opened());
    const m = mount(s);
    const night = (): string => m.bar().style.getPropertyValue("--ice-tb-night");
    expect(night()).toBe("0.000");
    s.set(opened({ night: 1 }));
    expect(night()).toBe("1.000");
    s.set(opened({ night: 0.25 }));
    expect(night()).toBe("0.250");
    s.set(opened({ night: 3 }));
    expect(night()).toBe("1.000");
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

  it("its pointer is chrome's: the pill and the chips' toolbar carry the canvas's interactive marker — the header's bare board beside them stays the drawer's — and a down on a chip goes no further than the bar", () => {
    const m = mount(fakeSource(opened()));
    const pill = m.bar().querySelector(".ice-tb-bar") as HTMLElement;
    expect(pill.hasAttribute("data-canvas-interactive")).toBe(true);
    expect(m.bar().querySelector(".ice-tb-chips")?.hasAttribute("data-canvas-interactive")).toBe(true);
    expect(m.head().hasAttribute("data-canvas-interactive")).toBe(false);
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
    for (const y of [700, 560, 448]) s.set(opened({ drawer: drawn(y, 1) }));
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

  it("its chips are LABEL TAPE (R4): the tags' tape and raised capitals (the desk's MARKS.label), the chosen one cream with ink letters, 26 px, uppercase in the mono stack — custom properties on its root; moonlit by night", () => {
    const m = mount(fakeSource(opened()));
    const css = m.bar().querySelector("style")?.textContent ?? "";
    expect(DESK_TAPE).toContain("--ice-tape:#17181b;");
    expect(DESK_TAPE).toContain("--ice-tape-letters-rgb:236 235 228;");
    expect(DESK_TAPE).toContain("--ice-tape-chosen:#efe9da;");
    expect(DESK_TAPE).toContain("--ice-tape-font:var(--vf-font-mono,");
    expect(css).toContain(DESK_TAPE);
    const rule = css.split("\n").find((l) => l.startsWith("[data-ice-tray-bar] .ice-tb-chip{")) ?? "";
    for (const part of ["height:26px", "padding:0 10px", "font:600 11px/1 var(--ice-tape-font)", "letter-spacing:.08em", "text-transform:uppercase", "background:linear-gradient(", "var(--ice-tape)", "text-shadow:0 1px 0 rgb(0 0 0 / .55)", "calc(1 - .45 * var(--n))"]) expect(rule).toContain(part);
    expect(css).toContain(".ice-tb-chip[data-on=\"true\"]{--ice-tape:var(--ice-tape-chosen);color:var(--ice-tape-chosen-ink);");
    expect(css).toContain("filter:saturate(calc(1 - .7 * var(--n))) brightness(calc(1 - .4 * var(--n)))");   // the chosen tape by night: as bright as the capitals
    expect(css).toContain(".ice-tb-chip:hover{transform:translateY(-1px);");
    expect(css).toContain(".ice-tb-chip:focus-visible{outline:2px solid var(--ice-menu-brass)");
  });
});
