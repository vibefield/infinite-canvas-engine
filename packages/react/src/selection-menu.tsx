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
  /**
   * An object is IN HAND (design-015 §8, D4b): the menu travels to the foot of the view and changes role (M1) — one element,
   * not a second toolbar — Send stays first, the kind's tools take the middle, Done ends the bar. `landing`: the object is
   * flying home — the bar steps aside and comes back above the object 200 ms after it lands. `active` (D3t-a): the mode in
   * hand — core's `HeldTool` — the one slot marked.
   */
  readonly held?: { readonly tools: readonly SelectionMenuTool[]; readonly active?: string; readonly landing: boolean; readonly settled: boolean };
  /**
   * The selection's KIND ACTS (design-016 K8a — the desk's `MenuSlot`s, mirrored structurally): what every selected object's type
   * declares (`defineObject({ menu })`); the menu shows them first among its acts and runs one through `ops.runMenuAction`.
   */
  readonly menu?: readonly SelectionMenuAct[];
}

/** A kind's act as the desk publishes it (its `MenuSlot`, mirrored structurally — K8a): plain data; the op stays on the widget type. */
export interface SelectionMenuAct {
  readonly id: string;
  readonly label: string;
  readonly glyph?: SelectionGlyph;
  readonly keys?: string;
}

/**
 * A glyph the bar draws (K8a — core's `HeldGlyph`, mirrored structurally): a NAME of its set (`SELECTION_GLYPHS`), or a tool's OWN
 * drawing — SVG path data in the 24-unit box, stroked 2 units in the bar's ink (`currentColor`) as the set's are, or filled.
 */
export type SelectionGlyph = string | { readonly path: string; readonly fill?: boolean };

/**
 * A slot of the held bar as the desk publishes it (its `HeldSlot`, mirrored structurally — D3t-a): a `mode` (pressed, it
 * becomes the tool in hand) or an `action` (pressed, it runs its op), both through `ops.useHeldTool`; no `kind` = declared
 * only, shown dim and inert. `swatch`: a colour shown instead of the glyph (a marker's ink). `glyph` (K8a): a name of the bar's
 * set or the tool's own drawing — a plugin kind's tool draws its own; a name the bar does not draw is MARKED missing (its label's
 * initial, `data-glyph-missing`, one console error), never drawn as another glyph.
 */
export interface SelectionMenuTool {
  readonly id: string;
  readonly label: string;
  readonly kind?: "mode" | "action";
  readonly hint?: string;
  readonly glyph?: SelectionGlyph;
  readonly swatch?: string;
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
  /** A glyph from `SELECTION_GLYPHS` by name, or any node — or one read off the selection (the lock opens when it is taped). */
  readonly glyph: string | ReactNode | ((s: SelectionState) => string | ReactNode);
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

/**
 * The menu's numbers (*Marks on the Mat* §14): 40 tall, 10 above the marks, 16 from the sides, 8 from the view's top and foot;
 * away 90 ms, back 200 ms after, in 180 ms. The held bar (§8, D4b): centred in the 72 px band at the foot, the travel 340 ms.
 */
export const SELECTION_MENU = { height: 40, gap: 10, margin: 16, edge: 8, awayMs: 90, backMs: 200, inMs: 180, outMs: 120, foot: 72, travelMs: 340 } as const;

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), Math.max(a, b));

/**
 * Where the menu goes (desk.js `positionMenu`, number for number): centred on the anchor, `gap` above it; below it when
 * there is no room above (under the top ruler's band) and more below; `margin` from the sides, `edge` from the top and foot.
 * `sheet` = the height of an open sheet that must fit too. Null when there is nothing to anchor to. With an object IN HAND
 * (D4b) the bar sits centred in the band at the foot of the view, whatever the selection's box.
 */
export function placeSelectionMenu(anchor: SelectionMenuAnchor, size: { readonly w: number; readonly h: number }, sheet = 0): { readonly x: number; readonly y: number; readonly below: boolean } | null {
  const M = SELECTION_MENU;
  const { width: W, height: H } = anchor.view;
  if (anchor.held !== undefined && !anchor.held.landing) {
    return { x: clamp(W / 2 - size.w / 2, M.margin, W - size.w - M.margin), y: H - M.foot + (M.foot - size.h) / 2, below: false };
  }
  const b = anchor.box;
  if (b === null || anchor.count === 0) return null;
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
  // the held bar's (design-015 §8, D4b): the kinds' declared tools and Done — the same 24-box, one 2-unit stroke
  "chevron-left": stroke(<path d="M14.5 6l-6 6 6 6" />),
  pen: stroke(<><path d="M5 19l1.2-4.2L15.6 5.4a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L9.2 17.8z" /><path d="M13.5 7.5l3 3" /></>),
  eraser: stroke(<><path d="M4.5 15.5l7-7a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8l-4 4H9.3l-4.8-4z" /><path d="M9 19.5h11" /></>),
  undo: stroke(<><path d="M8.5 7.5H15a4.5 4.5 0 0 1 0 9H7" /><path d="M11 4.5l-3.5 3 3.5 3" /></>),
  redo: stroke(<><path d="M15.5 7.5H9a4.5 4.5 0 0 0 0 9h8" /><path d="M13 4.5l3.5 3-3.5 3" /></>),
  today: stroke(<><rect x="4.5" y="6" width="15" height="13.5" rx="2.5" /><path d="M4.5 10.5h15M8.5 4v3.5M15.5 4v3.5" /><circle cx="12" cy="15" r="1.4" /></>),
  check: stroke(<path d="M5 12.5l4.5 4.5L19 7.5" />),
};
function Glyph({ glyph, size = 16 }: { readonly glyph: string | ReactNode; readonly size?: number }): ReactElement {
  const body = typeof glyph === "string" ? SELECTION_GLYPHS[glyph] : glyph;
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">{body}</svg>;
}

/** Is this glyph a DRAWING (`{ path }`) rather than a name or a node? */
const isDrawing = (g: unknown): g is { readonly path: string; readonly fill?: boolean } => typeof g === "object" && g !== null && typeof (g as { path?: unknown }).path === "string";
/** A drawing in the bar's hand: the path in the 24-unit box, stroked like the set's (or filled). */
const drawn = (g: { readonly path: string; readonly fill?: boolean }): ReactNode => (g.fill === true ? <path fill="currentColor" fillRule="evenodd" d={g.path} /> : stroke(<path d={g.path} />));
/** A glyph a tool named that the bar cannot draw: its label's initial, unmistakably not a glyph of the set (K8a — never "ellipsis"). */
const initial = (label: string): ReactNode => <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor">{(label.trim()[0] ?? "?").toUpperCase()}</text>;
/** Each missing name said once, loudly: a declaration error, not a look. */
const missingSaid = new Set<string>();

/** A kind act's glyph as the menu draws it (K8a): its drawing, a name of the set, or — a name the set lacks, or none — its initial, the missing name said once. */
function actGlyph(k: SelectionMenuAct): ReactNode {
  return toolGlyph({ id: k.id, label: k.label, ...(k.glyph !== undefined ? { glyph: k.glyph } : {}) }).node;
}

/** A held tool's glyph as the bar draws it — and whether a NAME it gave is missing from the set. */
function toolGlyph(t: SelectionMenuTool): { readonly node: ReactNode; readonly missing: string | undefined } {
  const g = t.glyph;
  if (isDrawing(g)) return { node: drawn(g), missing: undefined };
  if (typeof g === "string" && g in SELECTION_GLYPHS) return { node: SELECTION_GLYPHS[g], missing: undefined };
  if (typeof g === "string" && !missingSaid.has(g)) {
    missingSaid.add(g);
    console.error(`[ice] the held tool "${t.id}" names the glyph "${g}", which the bar does not draw — declare its drawing (\`glyph: { path }\`) or a name of SELECTION_GLYPHS`);
  }
  // no glyph at all, or a name the bar does not know: the tool's initial — honest, and never another tool's glyph
  return { node: initial(t.label), missing: typeof g === "string" ? g : undefined };
}

// ---------------------------------------------------------------- the acts ICE ships

/** ICE's own acts, in the bar's order: Duplicate (not for tape), Tape it down / Lift the tape, More, and Delete past a rule. */
export function defaultSelectionActions(): SelectionAction[] {
  return [
    { id: "duplicate", label: "Duplicate", glyph: "duplicate", keys: "⌘D", when: (s) => !s.locked, run: (e) => { e.ops.duplicateSelection(); } },
    {
      id: "tape", label: (s) => (s.locked ? "Lift the tape" : "Tape it down"), glyph: (s) => (s.locked ? "unlock" : "lock"), keys: "⇧⌘L", on: (s) => s.locked,
      run: (e, s) => { e.ops.setLocked(selectedEntities(e.world), !s.locked); },
    },
    { id: "more", label: "More", glyph: "ellipsis", run: () => {} },
    { id: "delete", label: "Delete", glyph: "trash", keys: "⌫", place: "end", tone: "danger", run: (e) => { e.ops.deleteSelection(); } },
  ];
}

const labelOf = (a: SelectionAction, s: SelectionState): string => (typeof a.label === "function" ? a.label(s) : a.label);
const glyphOf = (a: SelectionAction, s: SelectionState): string | ReactNode => (typeof a.glyph === "function" ? a.glyph(s) : a.glyph);

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
[data-ice-selection-menu] .ice-sm-text svg:last-child{transform:rotate(-90deg);opacity:.55;margin-left:-1px;transition:transform 240ms cubic-bezier(.25,1,.3,1)}
[data-ice-selection-menu][data-below="true"] .ice-sm-text svg:last-child{transform:rotate(90deg)}
[data-ice-selection-menu] .ice-sm-rule{flex:none;width:0;height:22px;margin:0 4px;border-left:1px dashed var(--ice-menu-rule)}
[data-ice-selection-menu] .ice-sm-sheet{position:absolute;left:0;min-width:208px;padding:6px;box-sizing:border-box;border-radius:14px;background:var(--ice-menu-ink);color:var(--ice-menu-cream);box-shadow:inset 0 0 0 1px var(--ice-menu-hair),var(--ice-menu-shadow)}
[data-ice-selection-menu] .ice-sm-item{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;padding:8px 10px;border-radius:8px;text-align:left}
[data-ice-selection-menu] .ice-sm-item:hover{background:rgb(var(--ice-menu-cream-rgb) / .09)}
[data-ice-selection-menu] .ice-sm-item[data-tone="danger"]:hover{color:var(--ice-menu-danger);background:var(--ice-menu-danger-bg)}
[data-ice-selection-menu] .ice-sm-item kbd{font:500 11px/1 var(--ice-menu-mono,ui-monospace,monospace);color:var(--ice-menu-brass)}
[data-ice-selection-menu] .ice-sm-btn.is-dim{color:rgb(var(--ice-menu-cream-rgb) / .38);cursor:default}
[data-ice-selection-menu] .ice-sm-btn.is-dim:hover{background:none;color:rgb(var(--ice-menu-cream-rgb) / .38)}
[data-ice-selection-menu] .ice-sm-btn.is-dim:active{transform:none;background:none}
[data-ice-selection-menu][data-held="true"] .ice-sm-text svg:last-child{display:none}
[data-ice-selection-menu] .ice-sm-ink{width:28px;height:32px;border-radius:14px;display:grid;place-items:center}
[data-ice-selection-menu] .ice-sm-ink i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(255 255 255 / .16);transition:transform 160ms cubic-bezier(.3,1.4,.5,1),box-shadow 160ms ease}
[data-ice-selection-menu] .ice-sm-ink:hover i{transform:scale(1.18)}
[data-ice-selection-menu] .ice-sm-ink[data-on="true"] i{box-shadow:0 0 0 2px var(--ice-menu-ink-solid),0 0 0 3.5px var(--ice-menu-cream)}
`;

export interface SelectionMenuProps {
  /** Where to go — the desk handle's `selection`. */
  readonly source: SelectionMenuSource;
  /** The acts, in the bar's order within their places (default: `defaultSelectionActions()`); an app prepends its own. */
  readonly actions?: readonly SelectionAction[];
  /** The engine the acts run on (default: the `EngineProvider`'s — the one `<Desk>` is mounted under). */
  readonly engine?: CanvasEngine;
}

interface Shown { readonly count: number; readonly locked: boolean; readonly visible: boolean; readonly gesturing: boolean; readonly held: boolean; readonly tools: string; readonly active: string; readonly menu: string }
const shownOf = (a: SelectionMenuAnchor): Shown => {
  const held = a.held !== undefined && !a.held.landing;
  // flying home the bar steps aside as for a gesture — and comes back 200 ms after the landing
  const landing = a.held?.landing === true;
  const tools = held ? (a.held?.tools ?? []).map((t) => `${t.id}:${t.kind ?? ""}:${t.swatch ?? ""}`).join("|") : "";
  const menu = (a.menu ?? []).map((m) => `${m.id}:${m.label}`).join("|");
  return { count: a.count, locked: a.locked, visible: (a.count > 0 && a.box !== null) || held, gesturing: a.gesturing || a.editing === true || landing, held, tools, active: held ? (a.held?.active ?? "") : "", menu };
};
const sameShown = (a: Shown, b: Shown): boolean => a.count === b.count && a.locked === b.locked && a.visible === b.visible && a.gesturing === b.gesturing && a.held === b.held && a.tools === b.tools && a.active === b.active && a.menu === b.menu;
/** The one element's transitions: the opacity's, and — while the bar travels between the selection and the foot (M1) — the transform's. */
const transitionOf = (away: boolean, visible: boolean, traveling: boolean): string => {
  const M = SELECTION_MENU;
  const opacity = away ? `opacity ${M.awayMs}ms ease-out` : visible ? `opacity ${M.inMs}ms ease-out` : `opacity ${M.outMs}ms ease-out, visibility 0s linear ${M.outMs}ms`;
  return traveling ? `${opacity}, transform ${M.travelMs}ms cubic-bezier(.25,1,.3,1)` : opacity;
};

export function SelectionMenu({ source, actions, engine: given }: SelectionMenuProps): ReactElement | null {
  const provided = useOptionalEngine();
  const engine = given ?? provided;
  const acts = useMemo(() => actions ?? defaultSelectionActions(), [actions]);
  const root = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<Shown>(() => shownOf(source.anchor()));
  const [away, setAway] = useState(false);
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const tools = useRef<readonly SelectionMenuTool[]>(source.anchor().held?.tools ?? []);
  const kindActs = useRef<readonly SelectionMenuAct[]>(source.anchor().menu ?? []);
  const heldRef = useRef(shown.held);
  const travelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // placement: written straight to the one element's transform on every anchor the desk publishes (no render per frame)
  const placeRef = useRef<() => void>(() => {});
  placeRef.current = (): void => {
    const el = root.current;
    const a = source.anchor();
    const next = shownOf(a);
    if (next.held) tools.current = a.held?.tools ?? [];
    kindActs.current = a.menu ?? [];
    setShown((prev) => (sameShown(prev, next) ? prev : next));
    if (el === null) return;
    // THE TRAVEL (M1, D4b): the bar changes place and role — the transform's transition must be on BEFORE the new place is
    // written, or the bar jumps (desk.js `morphBar`); it stays on for the travel and no longer, so a moving selection still
    // places instantly
    if (next.held !== heldRef.current) {
      heldRef.current = next.held;
      el.style.transition = transitionOf(away, next.visible, true);
      setTraveling(true);
      if (travelTimer.current !== null) clearTimeout(travelTimer.current);
      travelTimer.current = setTimeout(() => { travelTimer.current = null; setTraveling(false); }, SELECTION_MENU.travelMs);
    }
    const bar = el.firstElementChild as HTMLElement | null;
    const sheet = el.querySelector<HTMLElement>(".ice-sm-sheet");
    // a bar not laid out yet (0 tall) is placed as the 40 it will be
    const p = placeSelectionMenu(a, { w: bar?.offsetWidth ?? 0, h: bar?.offsetHeight || SELECTION_MENU.height }, sheet?.offsetHeight ?? 0);
    if (p === null) return;
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    el.dataset.below = String(p.below);
    setBelow((prev) => (prev === p.below ? prev : p.below));
  };
  useEffect(() => () => { if (travelTimer.current !== null) clearTimeout(travelTimer.current); }, []);
  useLayoutEffect(() => {
    const run = (): void => placeRef.current();
    run();
    return source.subscribe(run);
  }, [source]);
  // re-place after the bar's contents change size (a taped selection drops Duplicate; More opens; the bar becomes the held bar)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the placement follows what was rendered — these are its triggers, not its inputs
  useLayoutEffect(() => { placeRef.current(); }, [shown.count, shown.locked, shown.visible, shown.held, shown.tools, shown.menu, open]);

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
  // the selection's KIND ACTS (K8a) first among the main acts: each runs its op through the engine, on the types that declare it
  const kinds: SelectionAction[] = kindActs.current.map((k) => ({
    id: `kind.${k.id}`, label: k.label, glyph: actGlyph(k), ...(k.keys !== undefined ? { keys: k.keys } : {}),
    run: (e) => { e.ops.runMenuAction(k.id); },
  }));
  const listed = [...kinds, ...acts].filter((a) => a.when === undefined || a.when(state));
  const at = (place: "lead" | "main" | "end") => listed.filter((a) => (a.place ?? "main") === place);
  const button = (a: SelectionAction): ReactElement => {
    const label = labelOf(a, state);
    const tip = a.keys !== undefined ? `${label} (${a.keys})` : label;
    const run = (): void => { if (a.id === "more") { setOpen((o) => !o); return; } setOpen(false); a.run(engine, state); };
    if (a.text === true) {
      return (
        <button key={a.id} type="button" className="ice-sm-text" data-act={a.id} aria-label={label} title={tip} onClick={run}>
          <Glyph glyph={glyphOf(a, state)} />
          <span>{label}</span>
          <Glyph glyph="chevron" size={12} />
        </button>
      );
    }
    return (
      <button key={a.id} type="button" className="ice-sm-btn" data-act={a.id} data-on={a.on?.(state) === true ? "true" : undefined} data-tone={a.tone} data-glyph={typeof glyphOf(a, state) === "string" ? (glyphOf(a, state) as string) : undefined} aria-label={label} title={tip} aria-haspopup={a.id === "more" ? "menu" : undefined} aria-expanded={a.id === "more" ? open : undefined} onClick={run}>
        <Glyph glyph={glyphOf(a, state)} />
      </button>
    );
  };
  const lead = at("lead");
  const main = at("main");
  const end = at("end");
  const opacity = visible && !away ? 1 : 0;
  // THE HELD BAR (design-015 §8, D4b): Send stays first, the kind's tools take the middle, Done ends it. D3t-a: a slot is LIVE —
  // pressed, it uses its tool through the engine (`ops.useHeldTool`: a mode becomes the tool in hand, an action runs its op); the
  // mode in hand is marked in cream, the tray's own ink (*Marks on the Mat* Q-f: never `--hot`), and only it; a tool declared with
  // no kind stays dim and inert
  const slot = (t: SelectionMenuTool): ReactElement => {
    const tip = t.hint !== undefined ? `${t.label} (${t.hint})` : t.label;
    const g = toolGlyph(t);
    const glyph = <Glyph glyph={g.node} />;
    if (t.kind === undefined) {
      return (
        <button key={t.id} type="button" className="ice-sm-btn is-dim" data-tool={t.id} data-glyph-missing={g.missing} aria-label={t.label} aria-disabled="true" title={tip} tabIndex={-1}>
          {glyph}
        </button>
      );
    }
    const on = t.kind === "mode" && t.id === shown.active;
    return (
      <button
        key={t.id} type="button" className={t.swatch !== undefined ? "ice-sm-ink" : "ice-sm-btn"} data-tool={t.id} data-kind={t.kind} data-glyph-missing={g.missing}
        data-on={on ? "true" : undefined} aria-pressed={t.kind === "mode" ? on : undefined} aria-label={t.label} title={tip}
        onClick={() => { setOpen(false); engine.ops.useHeldTool(t.id); }}
      >
        {t.swatch !== undefined ? <i style={{ background: t.swatch }} /> : glyph}
      </button>
    );
  };
  const done = (
    <button key="done" type="button" className="ice-sm-text" data-act="done" aria-label="Done" title="Done (Esc)" onClick={() => { setOpen(false); engine.ops.putDown(); }}>
      <Glyph glyph="check" />
      <span>Done</span>
    </button>
  );
  return (
    <div
      ref={root}
      data-ice-selection-menu=""
      data-canvas-interactive=""
      data-away={String(away)}
      data-visible={String(visible)}
      data-held={String(shown.held)}
      role="toolbar"
      aria-label={shown.held ? "In hand" : "Selection"}
      aria-hidden={!visible}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        opacity,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: opacity === 1 ? "auto" : "none",
        transition: transitionOf(away, visible, traveling),
      }}
    >
      <div className="ice-sm-bar">
        {shown.held ? (
          <>
            {lead.map(button)}
            {lead.length > 0 ? <span className="ice-sm-rule" aria-hidden="true" /> : null}
            {tools.current.map(slot)}
            {tools.current.length > 0 ? <span className="ice-sm-rule" aria-hidden="true" /> : null}
            {done}
          </>
        ) : (
          <>
            {lead.map(button)}
            {lead.length > 0 && main.length > 0 ? <span className="ice-sm-rule" aria-hidden="true" /> : null}
            {main.map(button)}
            {end.length > 0 && lead.length + main.length > 0 ? <span className="ice-sm-rule" aria-hidden="true" /> : null}
            {end.map(button)}
          </>
        )}
      </div>
      {open && !shown.held ? (
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

/** The provider's engine when there is one (the menu may also be mounted outside an `EngineProvider` with `engine` given). */
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
