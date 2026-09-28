/**
 * `<TrayBar>` — the pegboard drawer's HANDLE (design-018 §5–§6; ICE M22 R2): ONE piece of DOM in screen space, the selection menu's
 * sibling in the desk's ink (`DESK_INK`, the same custom properties an app re-points). The drawer stays the renderer's (design-017
 * §1); its handle and its filters are chrome, as the menu is (design-015 §2 law 2 — never under the camera).
 *
 * Closed: a 40 px pill centred 16 px above the view's foot — the pegboard glyph (three staggered stadium holes) and the word
 * Objects, titled "Objects (A)", `aria-expanded`. Open: the same pill rides the drawer's top edge, its bottom 10 px above the board —
 * `min(vh − 16, drawer.y − 10)`, written as the desk publishes each frame of the slide, so it follows the drawer exactly — its glyph a
 * close ×, the CATEGORY CHIPS grown beside the button (All, then the frame's categories in the lay's order; the chosen one
 * cream-filled with ink text, `aria-pressed`, in a `role="toolbar"`; past the drawer's width they scroll inside the bar), fading in
 * over 120 ms as the drawer arrives. It steps aside while an object is IN HAND (the held bar has the view's foot then) and while the
 * drawer has nothing to offer.
 *
 * Its pointer is chrome's: `data-canvas-interactive` flags its downs, so the tray's input never takes one (a chip never closes the
 * drawer as a click on the dimmed desk would) and the desk's tap never lends the object under it the editor. Its keys: Enter and
 * Space act on a focused button and ←/→ (Home/End) walk the chips, before the page's own listeners — the keymap keeps `a` and Esc;
 * a pointer's click leaves no focus behind, so Space still pans and ⏎ is still the desk's. No rAF of its own: it moves only when the
 * desk drew a frame that moved the drawer (idle-zero).
 *
 * `@ice/react` never imports the desk: the source is the desk handle's `tray` door, read structurally.
 */
import { type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DESK_INK } from "./selection-menu";

/** A category chip as the door lists it (core's `TrayCategory`, mirrored structurally): its id, its label, how many entries it holds. */
export interface TrayBarCategory {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** What the bar is placed from — the desk handle's `tray.anchor()` (`TrayAnchor`), mirrored structurally. */
export interface TrayBarAnchor {
  /** The drawer is out (the fact — its slide may still be on its way). */
  readonly open: boolean;
  /** The drawer's outline as drawn this frame (CSS px) and its slide — null before its first frame, or hidden. */
  readonly drawer: { readonly x: number; readonly y: number; readonly w: number; readonly p: number } | null;
  readonly view: { readonly width: number; readonly height: number };
  /** An object is in hand: the held bar has the view's foot — the bar steps aside. */
  readonly held: boolean;
  /** How many entries the drawer's frame hangs (0: nothing to offer — the bar steps aside). */
  readonly entries: number;
  /** The category shown ("" all) and the frame's categories in the lay's order. */
  readonly category: string;
  readonly categories: readonly TrayBarCategory[];
}

/** The bar's source — the desk handle's `tray` door: the anchor, a subscription that fires after each frame that moved it, and the acts. */
export interface TrayBarSource {
  anchor(): TrayBarAnchor;
  subscribe(listener: () => void): () => void;
  toggle(): boolean;
  category(id?: string): string;
}

/** The bar's numbers (design-018 §5): 40 tall, 16 above the view's foot closed, 10 above the board open, 16 from the sides; away 90 ms, back in 180; the chips in 120 ms as the drawer's 340 ms slide arrives. */
export const TRAY_BAR = { height: 40, foot: 16, ride: 10, margin: 16, awayMs: 90, inMs: 180, chipsMs: 120, growMs: 340 } as const;

/**
 * Where the bar goes: its top edge (CSS px) — its bottom `min(vh − foot, drawer.y − ride)`, so it waits at the foot while the drawer's
 * edge is below it and rides the edge from there, one continuous motion — and how wide it may grow (the drawer's width, within the view).
 */
export function placeTrayBar(a: TrayBarAnchor, height: number = TRAY_BAR.height): { readonly y: number; readonly maxWidth: number } {
  const B = TRAY_BAR;
  const foot = a.view.height - B.foot;
  const bottom = a.drawer === null ? foot : Math.min(foot, a.drawer.y - B.ride);
  const room = Math.max(0, a.view.width - 2 * B.margin);
  return { y: bottom - height, maxWidth: a.drawer === null ? room : Math.min(a.drawer.w, room) };
}

const stadium = (x: number, y: number): ReactNode => <rect x={x} y={y} width="3.5" height="8.5" rx="1.75" />;
/** The bar's two drawings (24-unit boxes, currentColor): the PEGBOARD — three staggered stadium holes, a board's punched slots — and the close ×. */
export const TRAY_BAR_GLYPHS = {
  pegboard: <g fill="currentColor">{stadium(5.75, 3.5)}{stadium(14.75, 3.5)}{stadium(10.25, 12)}</g>,
  close: <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />,
} as const;

// ---------------------------------------------------------------- the ink (the menu's, `DESK_INK`)

const STYLE = `
[data-ice-tray-bar]{${DESK_INK};position:absolute;left:0;right:0;top:0;z-index:19;display:flex;justify-content:center;pointer-events:none;will-change:transform;font:500 12.5px/1 var(--ice-menu-font,system-ui,-apple-system,sans-serif);user-select:none}
[data-ice-tray-bar] .ice-tb-bar{pointer-events:auto;display:flex;align-items:center;height:40px;padding:4px;box-sizing:border-box;white-space:nowrap;border-radius:20px;background:var(--ice-menu-ink);color:var(--ice-menu-cream);box-shadow:inset 0 0 0 1px var(--ice-menu-hair),var(--ice-menu-shadow);opacity:1;visibility:visible;transition:opacity ${TRAY_BAR.inMs}ms ease-out}
[data-ice-tray-bar][data-visible="false"] .ice-tb-bar{opacity:0;visibility:hidden;pointer-events:none;transition:opacity ${TRAY_BAR.awayMs}ms ease-out,visibility 0s linear ${TRAY_BAR.awayMs}ms}
[data-ice-tray-bar] button{appearance:none;border:0;margin:0;padding:0;background:none;color:inherit;font:inherit;cursor:pointer}
[data-ice-tray-bar] button:focus-visible{outline:2px solid var(--ice-menu-brass);outline-offset:1px}
[data-ice-tray-bar] .ice-tb-toggle{flex:none;height:32px;padding:0 12px 0 9px;border-radius:16px;display:inline-flex;align-items:center;gap:7px;background:rgb(var(--ice-menu-cream-rgb) / .08);transition:background 120ms ease,transform 120ms ease}
[data-ice-tray-bar] .ice-tb-toggle:hover{background:rgb(var(--ice-menu-cream-rgb) / .15)}
[data-ice-tray-bar] .ice-tb-toggle:active{transform:scale(.97)}
[data-ice-tray-bar] .ice-tb-more{display:grid;grid-template-columns:0fr;min-width:0;transition:grid-template-columns ${TRAY_BAR.growMs}ms cubic-bezier(.32,.72,0,1)}
[data-ice-tray-bar][data-open="true"] .ice-tb-more{grid-template-columns:1fr}
[data-ice-tray-bar] .ice-tb-inner{display:flex;align-items:center;min-width:0;overflow:hidden;visibility:hidden;transition:visibility 0s linear ${TRAY_BAR.growMs}ms}
[data-ice-tray-bar][data-open="true"] .ice-tb-inner{visibility:visible;transition:none}
[data-ice-tray-bar] .ice-tb-rule{flex:none;width:0;height:22px;margin:0 4px 0 6px;border-left:1px dashed var(--ice-menu-rule)}
[data-ice-tray-bar] .ice-tb-chips{display:flex;align-items:center;gap:2px;min-width:0;overflow-x:auto;scrollbar-width:none;opacity:0;transition:opacity ${TRAY_BAR.awayMs}ms ease-out}
[data-ice-tray-bar] .ice-tb-chips::-webkit-scrollbar{display:none}
[data-ice-tray-bar][data-open="true"] .ice-tb-chips{opacity:1;transition:opacity ${TRAY_BAR.chipsMs}ms ease-out}
[data-ice-tray-bar] .ice-tb-chip{flex:none;height:32px;padding:0 12px;border-radius:16px;color:rgb(var(--ice-menu-cream-rgb) / .86);transition:background 120ms ease,color 120ms ease,transform 120ms ease}
[data-ice-tray-bar] .ice-tb-chip:hover{background:rgb(var(--ice-menu-cream-rgb) / .09);color:var(--ice-menu-cream)}
[data-ice-tray-bar] .ice-tb-chip:active{transform:scale(.95)}
[data-ice-tray-bar] .ice-tb-chip[data-on="true"]{background:var(--ice-menu-cream);color:var(--ice-menu-ink-solid)}
`;

export interface TrayBarProps {
  /** The drawer's door — the desk handle's `tray`. */
  readonly source: TrayBarSource;
  /** The button's word (default "Objects") and the key named in its tip (default "A" — the app's toggle). */
  readonly label?: string;
  readonly keys?: string;
}

/** What the bar renders from (the placement is written straight to the element: no render per frame of the slide). */
interface Shown { readonly visible: boolean; readonly open: boolean; readonly category: string; readonly chips: string; readonly maxWidth: number }
const shownOf = (a: TrayBarAnchor): Shown => ({
  visible: !a.held && a.entries > 0,
  open: a.open,
  category: a.category,
  chips: a.categories.map((c) => `${c.id}:${c.label}:${c.count}`).join("|"),
  maxWidth: Math.round(placeTrayBar(a).maxWidth),
});
const sameShown = (a: Shown, b: Shown): boolean => a.visible === b.visible && a.open === b.open && a.category === b.category && a.chips === b.chips && a.maxWidth === b.maxWidth;

/** Enter and Space on a focused button act HERE, before the page's listeners (the keymap's ⏎, the pan's Space — both stand down for a handled key), the platform's own activation cancelled with them: once. */
const pressed = (run: () => void) => (e: KeyboardEvent<HTMLButtonElement>): void => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  if (!e.repeat) run();
};
const spaceUp = (e: KeyboardEvent<HTMLButtonElement>): void => { if (e.key === " ") e.preventDefault(); };
/** A pointer's click leaves no focus behind (the keys stay the desk's: Space pans, ⏎ opens the selection); a key's focus stays. */
const clicked = (run: () => void) => (e: MouseEvent<HTMLButtonElement>): void => { run(); if (e.detail > 0) e.currentTarget.blur(); };

export function TrayBar({ source, label = "Objects", keys = "A" }: TrayBarProps): ReactElement {
  const root = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const cats = useRef<readonly TrayBarCategory[]>(source.anchor().categories);
  const [shown, setShown] = useState<Shown>(() => shownOf(source.anchor()));

  // placement: written straight to the one element's transform on every anchor the desk publishes (no render per frame)
  const placeRef = useRef<() => void>(() => {});
  placeRef.current = (): void => {
    const a = source.anchor();
    cats.current = a.categories;
    const next = shownOf(a);
    setShown((prev) => (sameShown(prev, next) ? prev : next));
    const el = root.current;
    if (el !== null) el.style.transform = `translateY(${placeTrayBar(a).y.toFixed(1)}px)`;
  };
  useLayoutEffect(() => {
    const run = (): void => placeRef.current();
    run();
    return source.subscribe(run);
  }, [source]);
  // the drawer shut under a focused chip: the focus goes back to the button, never to the page's body mid-walk
  useEffect(() => {
    if (!shown.open && chipsRef.current?.contains(document.activeElement) === true) toggleRef.current?.focus();
  }, [shown.open]);

  const toggle = (): void => { source.toggle(); };
  // ←/→ (Home/End) walk the chips — WAI-ARIA's toolbar; the desk's own arrows are quiet while the drawer is out
  const walk = (e: KeyboardEvent<HTMLDivElement>): void => {
    const found = chipsRef.current?.querySelectorAll<HTMLButtonElement>("button");
    const list: HTMLButtonElement[] = found === undefined ? [] : Array.from(found);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : null;
    if (at < 0 || to === null) return;
    e.preventDefault();
    list[Math.min(Math.max(to, 0), list.length - 1)]?.focus();
  };
  const chips: readonly TrayBarCategory[] = [{ id: "", label: "All", count: 0 }, ...cats.current];
  return (
    <div ref={root} data-ice-tray-bar="" data-open={String(shown.open)} data-visible={String(shown.visible)} aria-hidden={!shown.visible}>
      <div className="ice-tb-bar" data-canvas-interactive="" style={{ maxWidth: shown.maxWidth }} onPointerDown={(e) => e.stopPropagation()}>
        <button
          ref={toggleRef} type="button" className="ice-tb-toggle" data-act="tray" aria-expanded={shown.open} aria-keyshortcuts={keys} title={`${label} (${keys})`}
          onClick={clicked(toggle)} onKeyDown={pressed(toggle)} onKeyUp={spaceUp}
        >
          <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false">{shown.open ? TRAY_BAR_GLYPHS.close : TRAY_BAR_GLYPHS.pegboard}</svg>
          <span>{label}</span>
        </button>
        <div className="ice-tb-more">
          <div className="ice-tb-inner">
            <span className="ice-tb-rule" aria-hidden="true" />
            <div ref={chipsRef} className="ice-tb-chips" role="toolbar" aria-label="Categories" onKeyDown={walk}>
              {chips.map((c) => {
                const on = c.id === shown.category;
                const choose = (): void => { source.category(c.id); };
                return (
                  <button
                    key={c.id === "" ? "*" : `=${c.id}`} type="button" className="ice-tb-chip" data-category={c.id} data-on={on ? "true" : undefined} aria-pressed={on}
                    tabIndex={shown.open ? undefined : -1} onClick={clicked(choose)} onKeyDown={pressed(choose)} onKeyUp={spaceUp}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <style>{STYLE}</style>
    </div>
  );
}
