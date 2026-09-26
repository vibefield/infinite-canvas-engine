/**
 * `<SelectionMenu>` — the desk's selection menu (design-015 §7, *Marks on the Mat*'s "ink bar"; D4a):
 * the ONE piece of DOM beside the focused editor that the desk keeps (design-015 §2's law), in SCREEN
 * space — one element tree, one plain transform, never a camera's. It is placed from the anchor the
 * desk publishes (`source`, structurally the desk handle's `selection`: the marks' box around the
 * selection as DRAWN — the brackets 6 px out, the union 10 px out), 10 px above it, centred; it flips
 * below when it would cross the top ruler's band (or the view's top) and keeps 16 px from the sides.
 * It steps aside for any gesture (a drag, a vellum, a pan, a pinch) — and while a note is being written
 * (the one focused editor has the keys) — in 90 ms, and comes back 200 ms after (180 ms in). Its acts are an app-extensible list: ICE ships Duplicate (gone
 * when the selection is all tape — "a copy of a taped thing is not taped"), Tape it down / Lift the tape,
 * More (every act with its key), and Delete alone past a rule, colourless until the pointer arms it red;
 * an app adds its own (VibeField: Send to agent, first). The glyphs are DESIGN.md §13's drawings and the
 * page's six, inline SVG, currentColor. The ink is the whiteboard tray's (94 % ink, cream glyphs, brass
 * hairlines, the lamp's shadow falling lower left) — CSS custom properties an app may re-point.
 *
 * `@ice/react` never imports the desk: the source is read structurally, as the ground layer is.
 */
import { Locked, selectedEntities, type CanvasEngine } from "@ice/core";
import { type ReactElement, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCanvasEngine } from "./engine-context";

/** A screen rect, CSS px. */
export interface SelectionMenuBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** What the menu is placed from — the desk handle's `selection.anchor()`, mirrored structurally. */
export interface SelectionMenuAnchor {
  /** The marks' box around the selection on screen (null: nothing selected, or none of it drawn). */
  readonly box: SelectionMenuBox | null;
  readonly count: number;
  /** Every selected object is taped. */
  readonly locked: boolean;
  /** A gesture is on: the menu steps aside. */
  readonly gesturing: boolean;
  /** A note is being written (the one focused editor): the menu steps aside as for a gesture. */
  readonly editing?: boolean;
  readonly view: { readonly width: number; readonly height: number };
  /** The rulers printed along the top and left (their margin and band, CSS px), or null. */
  readonly rulers: { readonly margin: number; readonly band: number } | null;
}

/** The anchor's source — the desk handle's `selection` (anchor + a subscription that fires when it moves). */
export interface SelectionMenuSource {
  anchor(): SelectionMenuAnchor;
  subscribe(listener: () => void): () => void;
}

/** What an act is told about the selection. */
export interface SelectionState {
  readonly count: number;
  readonly locked: boolean;
}

export interface SelectionAction {
  readonly id: string;
  /** Its name — the button's accessible label and its tip; may read the selection ("Lift the tape"). */
  readonly label: string | ((s: SelectionState) => string);
  /** A glyph from `SELECTION_GLYPHS` by name, or any node. */
  readonly glyph: string | ReactNode;
  /** The key that does the same, shown in the tip and in More (e.g. "⌘D"). */
  readonly keys?: string;
  /** `lead` sits first (the app's own act — Send), `main` in the middle, `end` alone past a rule (Delete). */
  readonly place?: "lead" | "main" | "end";
  /** `danger`: colourless until the pointer arms it red. */
  readonly tone?: "danger";
  /** A text button (the lead act's label beside its glyph). */
  readonly text?: boolean;
  /** Shown for this selection (default: always). */
  readonly when?: (s: SelectionState) => boolean;
  /** Pressed-looking (the lock turns solid cream while the selection is taped). */
  readonly on?: (s: SelectionState) => boolean;
  run(engine: CanvasEngine, s: SelectionState): void;
}

/** The menu's numbers (*Marks on the Mat* §14): 40 tall, 10 above the marks, 16 from the sides, 8 from the view's top and foot; away 90 ms, back 200 ms after, in 180 ms. */
export const SELECTION_MENU = { height: 40, gap: 10, margin: 16, edge: 8, awayMs: 90, backMs: 200, inMs: 180, outMs: 120 } as const;

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), Math.max(a, b));

/**
 * Where the menu goes (desk.js `positionMenu`, number for number): centred on the anchor, `gap` above it; below it when
 * there is no room above (under the top ruler's band) and more below; `margin` from the sides, `edge` from the top and foot.
 * `sheet` = the height of an open sheet that must fit too. Null when there is nothing to anchor to.
 */
export function placeSelectionMenu(anchor: SelectionMenuAnchor, size: { readonly w: number; readonly h: number }, sheet = 0): { readonly x: number; readonly y: number; readonly below: boolean } | null {
  const b = anchor.box;
  if (b === null || anchor.count === 0) return null;
  const M = SELECTION_MENU;
  const { width: W, height: H } = anchor.view;
  let x = (b.x0 + b.x1) / 2 - size.w / 2;
  let y = b.y0 - M.gap - size.h;
  const top = anchor.rulers !== null ? anchor.rulers.margin + anchor.rulers.band + M.edge : M.edge;
  const yBelow = b.y1 + M.gap;
  const roomAbove = y - sheet - top;
  const roomBelow = H - M.edge - (yBelow + size.h + sheet);
  let below = false;
  if (roomAbove < 0 && roomBelow > roomAbove) { y = yBelow; below = true; }
  x = clamp(x, M.margin, W - size.w - M.margin);
  y = clamp(y, M.edge, H - size.h - M.edge);
  return { x, y, below };
}

// ---------------------------------------------------------------- the glyphs (the desk-chrome page's paths, objects.js `GLYPH`)

const stroke = (children: ReactNode): ReactNode => <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</g>;
/** DESIGN.md §13's drawings the bar uses and the six *Marks on the Mat* adds — 24-unit boxes, one 2-unit stroke, currentColor. */
export const SELECTION_GLYPHS: Readonly<Record<string, ReactNode>> = {
  agents: stroke(<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="4.5" r="2" /><circle cx="5.5" cy="15.75" r="2" /><circle cx="18.5" cy="15.75" r="2" /></>),
  chevron: stroke(<path d="M9.5 6l6 6-6 6" />),
  trash: stroke(<path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5l.9 12.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8l.9-12.2M10 10.5v6M14 10.5v6" />),
  duplicate: stroke(<><rect x="8.5" y="8.5" width="12" height="12" rx="3" /><path d="M15.5 8.5V6.5a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2" /></>),
  lock: stroke(<><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" /></>),
  unlock: stroke(<><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5M12 14.5v2" /></>),
  ellipsis: <path fill="currentColor" fillRule="evenodd" d="M3.7 10.4h1.9a0.7 0.7 0 0 1 0.7 0.7v1.9a0.7 0.7 0 0 1 -0.7 0.7h-1.9a0.7 0.7 0 0 1 -0.7 -0.7v-1.9a0.7 0.7 0 0 1 0.7 -0.7ZM11.05 10.4h1.9a0.7 0.7 0 0 1 0.7 0.7v1.9a0.7 0.7 0 0 1 -0.7 0.7h-1.9a0.7 0.7 0 0 1 -0.7 -0.7v-1.9a0.7 0.7 0 0 1 0.7 -0.7ZM18.4 10.4h1.9a0.7 0.7 0 0 1 0.7 0.7v1.9a0.7 0.7 0 0 1 -0.7 0.7h-1.9a0.7 0.7 0 0 1 -0.7 -0.7v-1.9a0.7 0.7 0 0 1 0.7 -0.7Z" />,
};
function Glyph({ glyph, size = 16 }: { readonly glyph: string | ReactNode; readonly size?: number }): ReactElement {
  const body = typeof glyph === "string" ? SELECTION_GLYPHS[glyph] : glyph;
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">{body}</svg>;
}

// ---------------------------------------------------------------- the acts ICE ships

/** ICE's own acts, in the bar's order: Duplicate (not for tape), Tape it down / Lift the tape, More, and Delete past a rule. */
export function defaultSelectionActions(): SelectionAction[] {
  return [
    { id: "duplicate", label: "Duplicate", glyph: "duplicate", keys: "⌘D", when: (s) => !s.locked, run: (e) => { e.ops.duplicateSelection(); } },
    {
      id: "tape", label: (s) => (s.locked ? "Lift the tape" : "Tape it down"), glyph: "lock", keys: "⇧⌘L", on: (s) => s.locked,
      run: (e, s) => { e.ops.setLocked(selectedEntities(e.world), !s.locked); },
    },
    { id: "more", label: "More", glyph: "ellipsis", run: () => {} },
    { id: "delete", label: "Delete", glyph: "trash", keys: "⌫", place: "end", tone: "danger", run: (e) => { e.ops.deleteSelection(); } },
  ];
}

const labelOf = (a: SelectionAction, s: SelectionState): string => (typeof a.label === "function" ? a.label(s) : a.label);

// ---------------------------------------------------------------- the ink (desk.css `.sel-menu`, the tray's material)

const STYLE = `
[data-ice-selection-menu]{--ice-menu-ink:rgb(16 9 4 / .94);--ice-menu-ink-solid:rgb(16 9 4);--ice-menu-cream:rgb(255 237 215);--ice-menu-cream-rgb:255 237 215;--ice-menu-brass:rgb(196 165 116);--ice-menu-hair:rgb(196 165 116 / .24);--ice-menu-rule:rgb(196 165 116 / .34);--ice-menu-danger:rgb(255 69 58);--ice-menu-danger-bg:rgb(255 69 58 / .16);--ice-menu-shadow:-1px 2px 3px rgb(14 26 10 / .25),-8px 14px 32px rgb(14 26 10 / .38);position:absolute;left:0;top:0;z-index:20;will-change:transform,opacity;font:500 12.5px/1 var(--ice-menu-font,system-ui,-apple-system,sans-serif);user-select:none}
[data-ice-selection-menu] .ice-sm-bar{position:relative;display:flex;align-items:center;gap:2px;height:40px;padding:4px;box-sizing:border-box;white-space:nowrap;border-radius:20px;background:var(--ice-menu-ink);color:var(--ice-menu-cream);box-shadow:inset 0 0 0 1px var(--ice-menu-hair),var(--ice-menu-shadow)}
[data-ice-selection-menu] button{appearance:none;border:0;margin:0;padding:0;background:none;color:inherit;font:inherit;cursor:pointer}
[data-ice-selection-menu] .ice-sm-btn{width:32px;height:32px;border-radius:16px;display:grid;place-items:center;color:rgb(var(--ice-menu-cream-rgb) / .86);transition:background 120ms ease,color 120ms ease,transform 120ms ease}
[data-ice-selection-menu] .ice-sm-btn:hover{background:rgb(var(--ice-menu-cream-rgb) / .09);color:var(--ice-menu-cream)}
[data-ice-selection-menu] .ice-sm-btn:active{transform:scale(.95);background:rgb(var(--ice-menu-cream-rgb) / .15)}
[data-ice-selection-menu] .ice-sm-btn[data-on="true"]{background:var(--ice-menu-cream);color:var(--ice-menu-ink-solid)}
[data-ice-selection-menu] .ice-sm-btn[data-tone="danger"]:hover{color:var(--ice-menu-danger);background:var(--ice-menu-danger-bg)}
[data-ice-selection-menu] .ice-sm-text{height:32px;padding:0 9px;border-radius:16px;display:inline-flex;align-items:center;gap:7px;color:var(--ice-menu-cream);background:rgb(var(--ice-menu-cream-rgb) / .08);transition:background 120ms ease,transform 120ms ease}
[data-ice-selection-menu] .ice-sm-text:hover{background:rgb(var(--ice-menu-cream-rgb) / .15)}
[data-ice-selection-menu] .ice-sm-text:active{transform:scale(.97)}
[data-ice-selection-menu] .ice-sm-rule{flex:none;width:0;height:22px;margin:0 4px;border-left:1px dashed var(--ice-menu-rule)}
[data-ice-selection-menu] .ice-sm-sheet{position:absolute;left:0;min-width:208px;padding:6px;box-sizing:border-box;border-radius:14px;background:var(--ice-menu-ink);color:var(--ice-menu-cream);box-shadow:inset 0 0 0 1px var(--ice-menu-hair),var(--ice-menu-shadow)}
[data-ice-selection-menu] .ice-sm-item{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;padding:8px 10px;border-radius:8px;text-align:left}
[data-ice-selection-menu] .ice-sm-item:hover{background:rgb(var(--ice-menu-cream-rgb) / .09)}
[data-ice-selection-menu] .ice-sm-item[data-tone="danger"]:hover{color:var(--ice-menu-danger);background:var(--ice-menu-danger-bg)}
[data-ice-selection-menu] .ice-sm-item kbd{font:500 11px/1 var(--ice-menu-mono,ui-monospace,monospace);color:var(--ice-menu-brass)}
`;

export interface SelectionMenuProps {
  /** Where to go — the desk handle's `selection`. */
  readonly source: SelectionMenuSource;
  /** The acts, in the bar's order within their places (default: `defaultSelectionActions()`); an app prepends its own. */
  readonly actions?: readonly SelectionAction[];
  /** The engine the acts run on (default: the `EngineProvider`'s — `<InfiniteCanvas>` provides one to its children). */
  readonly engine?: CanvasEngine;
}

interface Shown { readonly count: number; readonly locked: boolean; readonly visible: boolean; readonly gesturing: boolean }
const shownOf = (a: SelectionMenuAnchor): Shown => ({ count: a.count, locked: a.locked, visible: a.count > 0 && a.box !== null, gesturing: a.gesturing || a.editing === true });
const sameShown = (a: Shown, b: Shown): boolean => a.count === b.count && a.locked === b.locked && a.visible === b.visible && a.gesturing === b.gesturing;

export function SelectionMenu({ source, actions, engine: given }: SelectionMenuProps): ReactElement | null {
  const provided = useOptionalEngine();
  const engine = given ?? provided;
  const acts = useMemo(() => actions ?? defaultSelectionActions(), [actions]);
  const root = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Shown>(() => shownOf(source.anchor()));
  const [away, setAway] = useState(false);
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);

  // placement: written straight to the one element's transform on every anchor the desk publishes (no render per frame)
  const placeRef = useRef<() => void>(() => {});
  placeRef.current = (): void => {
    const el = root.current;
    const a = source.anchor();
    const next = shownOf(a);
    setShown((prev) => (sameShown(prev, next) ? prev : next));
    if (el === null) return;
    const bar = el.firstElementChild as HTMLElement | null;
    const sheet = el.querySelector<HTMLElement>(".ice-sm-sheet");
    // a bar not laid out yet (0 tall) is placed as the 40 it will be
    const p = placeSelectionMenu(a, { w: bar?.offsetWidth ?? 0, h: bar?.offsetHeight || SELECTION_MENU.height }, sheet?.offsetHeight ?? 0);
    if (p === null) return;
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    el.dataset.below = String(p.below);
    setBelow((prev) => (prev === p.below ? prev : p.below));
  };
  useLayoutEffect(() => {
    const run = (): void => placeRef.current();
    run();
    return source.subscribe(run);
  }, [source]);
  // re-place after the bar's contents change size (a taped selection drops Duplicate; More opens)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the placement follows what was rendered — these are its triggers, not its inputs
  useLayoutEffect(() => { placeRef.current(); }, [shown.count, shown.locked, shown.visible, open]);

  // a gesture: away in 90 ms at once; back 200 ms after the hand lets go
  useEffect(() => {
    if (shown.gesturing) { setAway(true); setOpen(false); return; }
    const t = setTimeout(() => setAway(false), SELECTION_MENU.backMs);
    return () => clearTimeout(t);
  }, [shown.gesturing]);
  // a new selection closes More
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger, not an input
  useEffect(() => { setOpen(false); }, [shown.count]);

  if (engine === undefined) return null;
  const state: SelectionState = { count: shown.count, locked: shown.locked };
  const visible = shown.visible;
  const listed = acts.filter((a) => a.when === undefined || a.when(state));
  const at = (place: "lead" | "main" | "end") => listed.filter((a) => (a.place ?? "main") === place);
  const button = (a: SelectionAction): ReactElement => {
    const label = labelOf(a, state);
    const tip = a.keys !== undefined ? `${label} (${a.keys})` : label;
    const run = (): void => { if (a.id === "more") { setOpen((o) => !o); return; } setOpen(false); a.run(engine, state); };
    if (a.text === true) {
      return (
        <button key={a.id} type="button" className="ice-sm-text" data-act={a.id} aria-label={label} title={tip} onClick={run}>
          <Glyph glyph={a.glyph} />
          <span>{label}</span>
          <Glyph glyph="chevron" size={12} />
        </button>
      );
    }
    return (
      <button key={a.id} type="button" className="ice-sm-btn" data-act={a.id} data-on={a.on?.(state) === true ? "true" : undefined} data-tone={a.tone} aria-label={label} title={tip} aria-haspopup={a.id === "more" ? "menu" : undefined} aria-expanded={a.id === "more" ? open : undefined} onClick={run}>
        <Glyph glyph={a.glyph} />
      </button>
    );
  };
  const lead = at("lead");
  const main = at("main");
  const end = at("end");
  const opacity = visible && !away ? 1 : 0;
  return (
    <div
      ref={root}
      data-ice-selection-menu=""
      data-canvas-interactive=""
      data-away={String(away)}
      data-visible={String(visible)}
      role="toolbar"
      aria-label="Selection"
      aria-hidden={!visible}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        opacity,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: opacity === 1 ? "auto" : "none",
        transition: away ? `opacity ${SELECTION_MENU.awayMs}ms ease-out` : visible ? `opacity ${SELECTION_MENU.inMs}ms ease-out` : `opacity ${SELECTION_MENU.outMs}ms ease-out, visibility 0s linear ${SELECTION_MENU.outMs}ms`,
      }}
    >
      <div className="ice-sm-bar">
        {lead.map(button)}
        {lead.length > 0 && main.length > 0 ? <span className="ice-sm-rule" aria-hidden="true" /> : null}
        {main.map(button)}
        {end.length > 0 && lead.length + main.length > 0 ? <span className="ice-sm-rule" aria-hidden="true" /> : null}
        {end.map(button)}
      </div>
      {open ? (
        <div className="ice-sm-sheet" role="menu" style={below ? { top: "calc(100% + 6px)" } : { bottom: "calc(100% + 6px)" }}>
          {listed.filter((a) => a.id !== "more").map((a) => (
            <button key={a.id} type="button" role="menuitem" className="ice-sm-item" data-act={a.id} data-tone={a.tone} onClick={() => { setOpen(false); a.run(engine, state); }}>
              <span>{labelOf(a, state)}</span>
              {a.keys !== undefined ? <kbd>{a.keys}</kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
      <style>{STYLE}</style>
    </div>
  );
}

/** The provider's engine when there is one (the menu may also be mounted outside `<InfiniteCanvas>` with `engine` given). */
function useOptionalEngine(): CanvasEngine | undefined {
  try {
    return useCanvasEngine();
  } catch {
    return undefined;
  }
}

/** Is every selected widget taped? (for an app's own acts) */
export function selectionTaped(engine: CanvasEngine): boolean {
  const sel = selectedEntities(engine.world);
  return sel.length > 0 && sel.every((e) => engine.world.hasTag(e, Locked));
}
