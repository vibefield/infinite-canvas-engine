// The desk's DEV PANEL (D5a — the prototype's tweak panel, lab/panel.ts + lab/params.ts, as apps/desk's): the backtick key opens
// it; screen-space DOM (the law allows the DOM for chrome, never under the camera), an island in the tools' ink. `mountPanel` is
// the lab's renderer, row for row — a declarative schema of rows bound to getters and setters, nothing here knowing what a
// parameter means. `installDevPanel` binds the rows to the desk's params (./params.ts) and projects every change through the
// layer's handle (the mat's config and its rulers, the lattice's fade-in, the mini mat's live law, the live insides), the
// theme control (the colours and the night), the springs object the builder reads, and core's live nav settings. "reset to
// product" IS the product. A desk with no room keeps the params in this browser (a per-viewer convenience); in a room nothing
// here touches storage — the room is the truth.

import { type CanvasEngine, type Entity, NavTransitionSettings, PrefabId, selectedEntities, writeRuntimeResource, ZoomThroughSettings } from "@ice/core";
import type { DeskLayerHandle, PlateName } from "@ice/desk";
import { MINIMAT_TYPE, MiniMat, VINYLS } from "@ice/objects";
import { cssColor, type GroundTheme, MARKS, type RGB, type ThemeName } from "@ice/desk";
import { type ColorRole, type DeskParams, defaultParams, matConfigOf, resetParams, restoreParams, snapshotParams, themeWith } from "./params";

export type Row =
  | { kind: "range"; label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; unit?: string }
  | { kind: "select"; label: string; options: readonly string[]; get: () => string; set: (v: string) => void }
  | { kind: "toggle"; label: string; get: () => boolean; set: (v: boolean) => void }
  | { kind: "color"; label: string; get: () => readonly number[]; set: (v: RGB) => void }
  | { kind: "actions"; items: { label: string; run: () => void }[] }
  | { kind: "note"; get: () => string };

export interface Section { title: string; rows: Row[]; open?: boolean }

const hex = (c: readonly number[]): string => `#${c.slice(0, 3).map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, "0")).join("")}`;
const unhex = (h: string): RGB => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as unknown as RGB;
const fmt = (v: number, step: number): string => (step >= 1 ? String(Math.round(v)) : v.toFixed(Math.min(3, Math.max(0, -Math.floor(Math.log10(step))))));

/** The lab's renderer: each section a `<details>`, each row its control, every change → `onChange` and a refresh of every row. */
export function mountPanel(root: HTMLElement, sections: Section[], onChange: () => void): { refresh: () => void } {
  const refreshers: (() => void)[] = [];
  const el = (tag: string, cls?: string, text?: string): HTMLElement => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const changed = (): void => { onChange(); for (const r of refreshers) r(); };
  for (const sec of sections) {
    const details = el("details", "p-section") as HTMLDetailsElement;
    details.open = sec.open ?? false;
    details.appendChild(el("summary", "p-title", sec.title));
    for (const row of sec.rows) {
      const line = el("div", `p-row p-${row.kind}`);
      if (row.kind === "range") {
        line.appendChild(el("label", "p-label", row.label));
        const num = el("input", "p-num") as HTMLInputElement; num.type = "number"; num.step = String(row.step); num.min = String(row.min); num.max = String(row.max);
        const slider = el("input", "p-slider") as HTMLInputElement; slider.type = "range"; slider.step = String(row.step); slider.min = String(row.min); slider.max = String(row.max);
        const unit = el("span", "p-unit", row.unit ?? "");
        const sync = (): void => { const v = row.get(); num.value = fmt(v, row.step); slider.value = String(v); };
        const apply = (v: number): void => { if (Number.isFinite(v)) { row.set(v); changed(); } };
        slider.addEventListener("input", () => apply(Number(slider.value)));
        num.addEventListener("change", () => apply(Number(num.value)));
        line.append(num, unit, slider); refreshers.push(sync); sync();
      } else if (row.kind === "select") {
        line.appendChild(el("label", "p-label", row.label));
        const sel = el("select", "p-select") as HTMLSelectElement;
        for (const o of row.options) { const opt = el("option", undefined, o) as HTMLOptionElement; opt.value = o; sel.appendChild(opt); }
        sel.addEventListener("change", () => { row.set(sel.value); changed(); });
        const sync = (): void => { sel.value = row.get(); };
        line.appendChild(sel); refreshers.push(sync); sync();
      } else if (row.kind === "toggle") {
        const lab = el("label", "p-label p-check");
        const box = el("input") as HTMLInputElement; box.type = "checkbox";
        box.addEventListener("change", () => { row.set(box.checked); changed(); });
        lab.append(box, document.createTextNode(row.label));
        const sync = (): void => { box.checked = row.get(); };
        line.appendChild(lab); refreshers.push(sync); sync();
      } else if (row.kind === "color") {
        line.appendChild(el("label", "p-label", row.label));
        const pick = el("input", "p-color") as HTMLInputElement; pick.type = "color";
        pick.addEventListener("input", () => { row.set(unhex(pick.value)); changed(); });
        const sync = (): void => { pick.value = hex(row.get()); };
        line.append(pick); refreshers.push(sync); sync();
      } else if (row.kind === "actions") {
        for (const a of row.items) { const b = el("button", "p-btn", a.label) as HTMLButtonElement; b.type = "button"; b.addEventListener("click", () => { a.run(); changed(); }); line.appendChild(b); }
      } else {
        const note = el("div", "p-note");
        const sync = (): void => { note.textContent = row.get(); note.hidden = !note.textContent; };
        line.appendChild(note); refreshers.push(sync); sync();
      }
      details.appendChild(line);
    }
    root.appendChild(details);
  }
  return { refresh: () => { for (const r of refreshers) r(); } };
}

/** The island's look, from the desk's own inks (theme.ts `MARKS.inks` — no colour is named here): the tools' ink, the paper's type, the pencil's accent. A row carries its kind's class too (`p-select`, the lab's), so the controls are styled by element. */
function panelCss(): string {
  const c = (css: string, a = 1): string => { const [r, g, b] = cssColor(css); return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`; };
  const ink = MARKS.inks.tray.css;
  const paper = MARKS.inks.paper.css;
  const pencil = MARKS.inks.pencil.css;
  return `
#desk-panel { position: fixed; top: 12px; right: 12px; z-index: 30; width: 300px; max-height: calc(100vh - 24px); overflow: auto; padding: 6px 10px 10px;
  border-radius: 10px; background: ${c(ink, 0.94)}; color: ${c(paper)}; box-shadow: 0 0 0 1px ${c(paper, 0.12)}, -2px 6px 18px ${c(ink, 0.35)};
  font: 11px/1.35 var(--vf-font-mono, ui-monospace, monospace); }
#desk-panel[hidden] { display: none; }
#desk-panel .p-title { cursor: pointer; padding: 5px 0; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: ${c(paper, 0.72)}; }
#desk-panel .p-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
#desk-panel .p-label { flex: 1 1 auto; min-width: 0; color: ${c(paper, 0.86)}; }
#desk-panel input.p-num { width: 58px; background: transparent; color: inherit; border: 1px solid ${c(paper, 0.2)}; border-radius: 4px; font: inherit; padding: 1px 3px; }
#desk-panel input.p-slider { width: 86px; accent-color: ${c(pencil)}; }
#desk-panel select.p-select { background: transparent; color: inherit; border: 1px solid ${c(paper, 0.2)}; border-radius: 4px; font: inherit; }
#desk-panel .p-check input { accent-color: ${c(pencil)}; margin-right: 6px; }
#desk-panel button.p-btn { background: ${c(paper, 0.1)}; color: inherit; border: 1px solid ${c(paper, 0.2)}; border-radius: 5px; font: inherit; padding: 3px 8px; cursor: pointer; }
#desk-panel div.p-note { color: ${c(paper, 0.6)}; }
#desk-panel .p-unit { color: ${c(paper, 0.5)}; }`;
}

export interface DevPanel {
  readonly element: HTMLElement;
  readonly params: DeskParams;
  readonly open: boolean;
  toggle(): void;
  /** An edit from the app's keys (`u` prints the rulers or not, K1): taken and kept as the panel's own, and its rows follow. */
  tweak(edit: (p: DeskParams) => void): void;
  /** The theme the layer draws for `name`: the desk's own until the panel is touched, then with the panel's colours and night. */
  themeOf(name: ThemeName, base: GroundTheme): GroundTheme;
}

export interface DevPanelHost {
  readonly engine: CanvasEngine;
  readonly handle: DeskLayerHandle;
  readonly params: DeskParams;
  /** The app's theme control: the name in force, a pinned switch, and a re-projection into the layer. */
  readonly theme: { name(): ThemeName; set(name: ThemeName, pin: boolean): void; apply(): void };
  /** Where the params live between visits — undefined (a room) keeps nothing. */
  readonly storageKey: string | undefined;
}

/** Where the params live between visits: the browser's storage, or a unit's double. */
export interface ParamStore {
  read(key: string): unknown;
  write(key: string, value: string): void;
  clear(key: string): void;
}

/** The storage, wrapped: a private window, blocked site data or a preview throws — the panel works without it. */
const browserStore: ParamStore = {
  read(key: string): unknown { try { const s = globalThis.localStorage?.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } },
  write(key: string, value: string): void { try { globalThis.localStorage?.setItem(key, value); } catch { /* per-viewer convenience only */ } },
  clear(key: string): void { try { globalThis.localStorage?.removeItem(key); } catch { /* per-viewer convenience only */ } },
};

/** The params bound to the desk: what the panel's rows, and the app's keys, change them through. */
export interface DeskParamsBinding {
  /** A change made to the params: the desk takes it; the browser keeps it — unless they ARE the product again (a reset), when nothing is kept. */
  changed(): void;
  /** An edit from outside the rows (the app's keys: `u`, K1) — made, then taken and kept exactly as a row's change is. */
  tweak(edit: (p: DeskParams) => void): void;
  /** Whether the params are no longer the product's (the theme then draws with the panel's colours and night). */
  readonly touched: boolean;
}

/**
 * The params BOUND to the desk (DOM-free: the units drive it in Node): every change projected through the layer's handle, the theme
 * control and core, and kept in the browser. At install a saved desk is restored over the live params (the springs object the
 * layer holds stays that object) and then everything is APPLIED, saved or not — so the desk draws what the panel says from its
 * first frame, never the mount's grid by coincidence (K1: before, only a restore or a change projected), and a snapshot a
 * version bump dropped is cleared, not kept.
 */
export function bindDeskParams(host: DevPanelHost, store: ParamStore = browserStore): DeskParamsBinding {
  const { engine, handle, params: p, theme, storageKey } = host;
  const { world } = engine;
  let touched = false;
  /** Everything the params say, through the handle, the theme and core — the product's own numbers until someone moves one. */
  const project = (): void => {
    handle.configureMat(matConfigOf(p.mat, p.ruler));
    handle.configureFadeIn([p.grid.fadeIn[0], p.grid.fadeIn[1]]);
    handle.tuneLaw("minimat", p.minimat);
    handle.setPortals(p.portal.on);
    writeRuntimeResource(world, NavTransitionSettings, { responseMs: p.nav.responseMs });
    writeRuntimeResource(world, ZoomThroughSettings, { enabled: p.nav.through, in: p.nav.throughIn, out: p.nav.throughOut, gate0: p.nav.gate0, gate1: p.nav.gate1 });
    theme.apply();
  };
  const product = snapshotParams(defaultParams());
  const changed = (): void => {
    const snap = snapshotParams(p);
    touched = snap !== product;
    project();
    if (storageKey !== undefined) { if (touched) store.write(storageKey, snap); else store.clear(storageKey); }
  };
  if (storageKey !== undefined) {
    const saved = store.read(storageKey);
    if (saved !== null) restoreParams(saved, p);
  }
  changed();
  return { changed, tweak(edit) { edit(p); changed(); }, get touched() { return touched; } };
}

export function installDevPanel(host: DevPanelHost): DevPanel {
  const { engine, params: p, theme, storageKey } = host;
  const { world } = engine;
  const bound = bindDeskParams(host);

  const range = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit?: string): Row => ({ kind: "range", label, min, max, step, get, set, ...(unit !== undefined ? { unit } : {}) });
  const miniMats = (): Entity[] => selectedEntities(world).filter((e) => world.get(e, PrefabId)?.id === MINIMAT_TYPE);
  const vinylOf = (e: Entity): string => (world.get(e, MiniMat.groups[0]?.component as never) as { vinyl?: string } | undefined)?.vinyl ?? VINYLS[0];
  // the theme's own colour for a role when nothing overrides it: the base the theme control last projected
  let lastBase: GroundTheme | null = null;
  const colours = (role: ColorRole, label: string): Row => ({
    kind: "color", label: `${label} (this theme)`,
    get: () => p.colors[theme.name()][role] ?? lastBase?.[role] ?? [0, 0, 0],
    set: (v) => { p.colors[theme.name()][role] = v; },
  });

  const sections: Section[] = [
    { title: "the desk", open: true, rows: [
      { kind: "select", label: "theme", options: ["light", "dark"], get: () => theme.name(), set: (v) => theme.set(v as ThemeName, true) },
      { kind: "actions", items: [
        { label: "reset to product", run: () => { resetParams(p); } },
        { label: "copy snapshot", run: () => { void navigator.clipboard?.writeText(snapshotParams(p)).catch(() => {}); } },
      ] },
      { kind: "note", get: () => (storageKey === undefined ? "in a room: nothing is kept between visits" : "") },
    ] },
    { title: "the mat", rows: [
      range("line, thin (device px)", 0, 3, 0.05, () => p.mat.thin, (v) => { p.mat.thin = v; }),
      range("line, thick (device px)", 0, 3, 0.05, () => p.mat.thick, (v) => { p.mat.thick = v; }),
      range("thin alpha", 0, 1, 0.01, () => p.mat.alphaThin, (v) => { p.mat.alphaThin = v; }),
      range("thick alpha", 0, 1, 0.01, () => p.mat.alphaThick, (v) => { p.mat.alphaThick = v; }),
      range("grain", 0, 0.1, 0.001, () => p.mat.grain, (v) => { p.mat.grain = v; }),
      { kind: "color", label: "the mat's green", get: () => p.mat.ground, set: (v) => { p.mat.ground = v; } },
      { kind: "color", label: "the lines' cream", get: () => p.mat.ink, set: (v) => { p.mat.ink = v; } },
      range("gobo opacity", 0, 1, 0.01, () => p.mat.opacity, (v) => { p.mat.opacity = v; }),
      range("gobo blur (texels)", 0, 16, 0.1, () => p.mat.blurTexels, (v) => { p.mat.blurTexels = v; }),
      range("shade mix", 0, 1, 0.01, () => p.mat.shadeMix, (v) => { p.mat.shadeMix = v; }),
      range("dark floor", 0, 1, 0.01, () => p.mat.darkFloor, (v) => { p.mat.darkFloor = v; }),
      range("saturate", 0, 2, 0.01, () => p.mat.saturate, (v) => { p.mat.saturate = v; }),
      range("blur ramp, sharp", 0, 4, 0.01, () => p.mat.sharp, (v) => { p.mat.sharp = v; }),
      range("blur ramp, soft", 0, 4, 0.01, () => p.mat.soft, (v) => { p.mat.soft = v; }),
      { kind: "select", label: "gobo plate", options: ["c", "b"], get: () => p.mat.plate, set: (v) => { p.mat.plate = v as PlateName; } },
      range("metres per unit", 0.0001, 0.01, 0.0001, () => p.mat.metresPerUnit, (v) => { p.mat.metresPerUnit = v; }),
    ] },
    { title: "the rulers", rows: [
      { kind: "toggle", label: "print the rulers (u)", get: () => p.ruler.on, set: (v) => { p.ruler.on = v; } },
      range("band", 10, 60, 1, () => p.ruler.band, (v) => { p.ruler.band = v; }, "px"),
      range("margin", 0, 60, 1, () => p.ruler.margin, (v) => { p.ruler.margin = v; }, "px"),
      range("tick, minor", 0, 30, 1, () => p.ruler.tick[0], (v) => { p.ruler.tick[0] = v; }, "px"),
      range("tick, mid", 0, 30, 1, () => p.ruler.tick[1], (v) => { p.ruler.tick[1] = v; }, "px"),
      range("tick, major", 0, 30, 1, () => p.ruler.tick[2], (v) => { p.ruler.tick[2] = v; }, "px"),
      range("line", 0, 3, 0.1, () => p.ruler.line, (v) => { p.ruler.line = v; }, "px"),
      range("frame alpha", 0, 1, 0.01, () => p.ruler.frameAlpha, (v) => { p.ruler.frameAlpha = v; }),
      range("tick alpha", 0, 1, 0.01, () => p.ruler.tickAlpha, (v) => { p.ruler.tickAlpha = v; }),
      range("label alpha", 0, 1, 0.01, () => p.ruler.label, (v) => { p.ruler.label = v; }),
      // K1, the demo's rows (lab/main.ts): the density — each pair kept in order, the demo's way — and the text (its size is the atlas's em: a change re-renders it)
      range("fine ticks from (pitch)", 1, 40, 0.5, () => p.ruler.ticksFrom[0], (v) => { p.ruler.ticksFrom = [v, Math.max(p.ruler.ticksFrom[1], v + 0.5)]; }, "px"),
      range("fine ticks full (pitch)", 1.5, 60, 0.5, () => p.ruler.ticksFrom[1], (v) => { p.ruler.ticksFrom = [Math.min(p.ruler.ticksFrom[0], v - 0.5), v]; }, "px"),
      range("labels from (pitch)", 10, 300, 1, () => p.ruler.labelsFrom[0], (v) => { p.ruler.labelsFrom = [v, Math.max(p.ruler.labelsFrom[1], v + 1)]; }, "px"),
      range("labels full (pitch)", 11, 400, 1, () => p.ruler.labelsFrom[1], (v) => { p.ruler.labelsFrom = [Math.min(p.ruler.labelsFrom[0], v - 1), v]; }, "px"),
      range("text size", 6, 20, 0.5, () => p.ruler.text.size, (v) => { p.ruler.text.size = v; }, "px"),
      range("text inset (from the outer line)", 0, 40, 0.5, () => p.ruler.text.top, (v) => { p.ruler.text.top = v; }, "px"),
      range("text gap (after the tick)", 0, 20, 0.5, () => p.ruler.text.gap, (v) => { p.ruler.text.gap = v; }, "px"),
      range("most characters in a label", 1, 12, 1, () => p.ruler.maxChars, (v) => { p.ruler.maxChars = v; }),
    ] },
    { title: "the lattice", rows: [
      range("fade-in from", 0, 80, 1, () => p.grid.fadeIn[0], (v) => { p.grid.fadeIn[0] = v; }, "px"),
      range("fade-in to", 0, 80, 1, () => p.grid.fadeIn[1], (v) => { p.grid.fadeIn[1] = v; }, "px"),
    ] },
    { title: "the night", rows: [
      range("the Moon's temperature", 2000, 8000, 50, () => p.night.kelvin, (v) => { p.night.kelvin = v; }, "K"),
      range("the Moon's illuminance", 0.01, 2, 0.01, () => p.night.lux, (v) => { p.night.lux = v; }, "lx"),
      range("the sky's share", 0, 1, 0.01, () => p.night.fill, (v) => { p.night.fill = v; }),
      range("the rods' hue", 440, 560, 1, () => p.night.rodNm, (v) => { p.night.rodNm = v; }, "nm"),
      range("the rods' purity", 0, 1, 0.01, () => p.night.rodPurity, (v) => { p.night.rodPurity = v; }),
      range("lit sage over the day's", 0, 1, 0.01, () => p.night.litOverDay, (v) => { p.night.litOverDay = v; }),
      range("snow", 0, 0.2, 0.001, () => p.night.snow, (v) => { p.night.snow = v; }),
    ] },
    { title: "colours", rows: [colours("canvasBg", "the clear"), colours("select", "the selection")] },
    { title: "the mini mats", open: true, rows: [
      range("border (the face inset by it)", 0, 96, 1, () => p.minimat.margin, (v) => { p.minimat.margin = v; }),
      range("corner", 0, 40, 0.5, () => p.minimat.radius, (v) => { p.minimat.radius = v; }),
      range("thickness", 0, 12, 0.5, () => p.minimat.thick, (v) => { p.minimat.thick = v; }),
      range("lift, held", 0, 40, 0.5, () => p.minimat.lift.height, (v) => { p.minimat.lift.height = v; }),
      range("hover rise (of the lift)", 0, 1, 0.01, () => p.minimat.hover, (v) => { p.minimat.hover = v; }),
      { kind: "select", label: "vinyl (the selected one's; t cycles)", options: VINYLS, get: () => { const m = miniMats()[0]; return m === undefined ? VINYLS[0] : vinylOf(m); }, set: (v) => { for (const m of miniMats()) engine.ops.setWidgetProps(m, { vinyl: v }); } },
      { kind: "toggle", label: "live insides", get: () => p.portal.on, set: (v) => { p.portal.on = v; } },
    ] },
    { title: "the springs", rows: [
      range("lift and hover, Hz", 0.5, 12, 0.1, () => p.motion.liftHz, (v) => { p.motion.liftHz = v; }),
      range("lift and hover, damping", 0.1, 2, 0.01, () => p.motion.liftDamp, (v) => { p.motion.liftDamp = v; }),
      // the ring's two rows are gone with its spring (D6): the marks draw the selection, and nothing moves for it
    ] },
    { title: "nav", rows: [
      range("the flight's response", 60, 2000, 10, () => p.nav.responseMs, (v) => { p.nav.responseMs = v; }, "ms"),
      { kind: "toggle", label: "zoom-through", get: () => p.nav.through, set: (v) => { p.nav.through = v; } },
      range("zoom-through, in", 0, 20, 0.5, () => p.nav.throughIn, (v) => { p.nav.throughIn = v; }, "px"),
      range("zoom-through, out", 0, 40, 0.5, () => p.nav.throughOut, (v) => { p.nav.throughOut = v; }, "px"),
      range("the gate, from", 0, 400, 1, () => p.nav.gate0, (v) => { p.nav.gate0 = v; }, "px"),
      range("the gate, to", 0, 400, 1, () => p.nav.gate1, (v) => { p.nav.gate1 = v; }, "px"),
    ] },
  ];

  if (document.getElementById("desk-panel-css") === null) {
    const style = document.createElement("style");
    style.id = "desk-panel-css";
    style.textContent = panelCss();
    document.head.appendChild(style);
  }
  document.getElementById("desk-panel")?.remove();   // a remount (StrictMode's, in dev) replaces the panel, never doubles it
  const element = document.createElement("aside");
  element.id = "desk-panel";
  element.setAttribute("aria-label", "the desk's dev panel");
  element.hidden = true;
  document.body.appendChild(element);
  const mounted = mountPanel(element, sections, bound.changed);
  return {
    element,
    params: p,
    get open() { return !element.hidden; },
    toggle() { element.hidden = !element.hidden; if (!element.hidden) mounted.refresh(); },
    tweak(edit) { bound.tweak(edit); mounted.refresh(); },
    themeOf(_name, base) { lastBase = base; return bound.touched ? themeWith(base, p) : base; },
  };
}
