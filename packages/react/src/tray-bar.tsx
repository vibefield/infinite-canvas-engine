/**
 * `<TrayBar>` — the pegboard drawer's HANDLE and its FILTERS (design-018 §5–§6, R4; ICE M22): DOM in screen space, the selection menu's
 * sibling (design-015 §2 law 2 — never under the camera). The drawer stays the renderer's (design-017 §1); its handle and its filters
 * are chrome, two islands under one root.
 *
 * THE PILL, in the desk's ink (`DESK_INK`, the same custom properties an app re-points): closed, a 40 px pill centred 16 px above the
 * view's foot — the pegboard glyph (three staggered stadium holes) and the word Objects, titled "Objects (A)", `aria-expanded`; open, the
 * same pill rides the drawer's top edge, its bottom 10 px above the board — `min(vh − 16, drawer.y − 10)`, written as the desk publishes
 * each frame of the slide, so it follows the drawer exactly — its glyph a close ×.
 *
 * THE CHIPS (R4 — James: "design the filters nicely at that empty safe top space"): LABEL TAPE stuck on the board in the drawer's clear
 * HEADER (the anchor's `drawer.header`, where nothing of the board's content shows), centred on the drawer's centre line and in the
 * header, following the drawer every frame of its slide and fading in over its last part — All, then the frame's categories in the
 * lay's order, in the specimens' own tag language (`DESK_TAPE`: the embosser's near-black tape and its raised pale capitals, the desk's
 * `MARKS.label`), the chosen one CREAM tape with ink letters (the desk's "chosen is cream" — the menu's `data-on`), `aria-pressed`, in a
 * `role="toolbar"`; past the header's width they scroll inside it, each end fading where more tape lies beyond. By night the tape steps
 * back as the tags do (`night`, the anchor's).
 * Both step aside while an object is IN HAND (the held bar has the view's foot then) and while the drawer has nothing to offer.
 *
 * Its pointer is chrome's: `data-canvas-interactive` flags the downs on the pill and on the chips, so the tray's input never takes one (a
 * chip never closes the drawer as a click on the dimmed desk would) and the desk's tap never lends the object under it the editor — the
 * header's bare board beside the chips stays the drawer's. Its keys: Enter and Space act on a focused button and ←/→ (Home/End) walk
 * the chips, before the page's own listeners — the keymap keeps `a` and Esc; a pointer's click leaves no focus behind, so Space still
 * pans and ⏎ is still the desk's. No rAF of its own: it moves only when the desk drew a frame that moved the drawer (idle-zero).
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
  /**
   * The drawer's outline as drawn this frame (CSS px) and its slide — null before its first frame, or hidden — and its HEADER: the clear
   * band under its edge (from `y`, `h` high) where nothing of the board's content shows, the chips' place.
   */
  readonly drawer: { readonly x: number; readonly y: number; readonly w: number; readonly p: number; readonly header: { readonly y: number; readonly h: number } } | null;
  readonly view: { readonly width: number; readonly height: number };
  /** The theme's night, 0 day … 1 the Moon: the tape steps back by it as the specimens' tags do. */
  readonly night: number;
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

/**
 * The bar's numbers (design-018 §5, R4): the pill 40 tall, 16 above the view's foot closed, 10 above the board open, 16 from the view's
 * sides; away 90 ms, back in 180. The header's chips keep 12 in from the drawer's sides and fade in over the slide's last part — from
 * `p` 0.6 to 1, a smoothstep (D-R4.6).
 */
export const TRAY_BAR = { height: 40, foot: 16, ride: 10, margin: 16, awayMs: 90, inMs: 180, headInset: 12, headFrom: 0.6 } as const;

/** Where the bar goes: the pill's top edge (CSS px), and the HEADER strip the chips lie centred in — with its opacity (null: no drawer drawn). */
export interface TrayBarPlace {
  readonly y: number;
  readonly head: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly opacity: number } | null;
}

/**
 * Where the bar goes. The pill: its bottom `min(vh − foot, drawer.y − ride)`, so it waits at the foot while the drawer's edge is below it
 * and rides the edge from there, one continuous motion. The chips: the drawer's header as drawn, `headInset` in from its sides, at the
 * slide's `smoothstep(headFrom, 1, p)` — one motion with the board, arriving as it does.
 */
export function placeTrayBar(a: TrayBarAnchor, height: number = TRAY_BAR.height): TrayBarPlace {
  const B = TRAY_BAR;
  const foot = a.view.height - B.foot;
  const d = a.drawer;
  const bottom = d === null ? foot : Math.min(foot, d.y - B.ride);
  if (d === null) return { y: bottom - height, head: null };
  const t = Math.min(Math.max((d.p - B.headFrom) / (1 - B.headFrom), 0), 1);
  return { y: bottom - height, head: { x: d.x + B.headInset, y: d.header.y, w: Math.max(0, d.w - 2 * B.headInset), h: d.header.h, opacity: t * t * (3 - 2 * t) } };
}

const stadium = (x: number, y: number): ReactNode => <rect x={x} y={y} width="3.5" height="8.5" rx="1.75" />;
/** The bar's two drawings (24-unit boxes, currentColor): the PEGBOARD — three staggered stadium holes, a board's punched slots — and the close ×. */
export const TRAY_BAR_GLYPHS = {
  pegboard: <g fill="currentColor">{stadium(5.75, 3.5)}{stadium(14.75, 3.5)}{stadium(10.25, 12)}</g>,
  close: <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />,
} as const;

/**
 * The LABEL TAPE (design-018 R4) as custom properties an app re-points, as it does the ink's: the specimens' own tags — the embosser's
 * near-black tape and the pale plastic of its raised capitals (the desk's `MARKS.label`, the marks pass's `tagMarks`) — the CHOSEN tape,
 * cream with ink letters, and the capitals' face (the page's mono stack, `--vf-font-mono`, as the tags' glyph atlas draws them).
 */
export const DESK_TAPE = "--ice-tape:#17181b;--ice-tape-letters-rgb:236 235 228;--ice-tape-chosen:#efe9da;--ice-tape-chosen-ink:rgb(16 9 4);--ice-tape-font:var(--vf-font-mono,ui-monospace,\"SF Mono\",Menlo,monospace)";

// ---------------------------------------------------------------- the ink (the menu's, `DESK_INK`) and the tape (`DESK_TAPE`)

// The tape by night (`--ice-tb-night`, 0 … 1 — the anchor's, written with the placement) steps back as `tagMarks` has the tags do: the
// capitals' plastic to 55 % over the tape, the gloss gone, the contact shadow at half; the CREAM tape — no tag to follow — steps back to
// the brightness those capitals reach (brightness .6: ≈ 140, still the brightest tape, its ink ≈ 6:1) and loses its colour as the desk's
// masking tape does by night (`MARKS.tape.night`'s saturate .3). The shadows fall down the tray lamp's ground direction
// (≈ 0.47, 0.88 — the tags' 0.6, 0.9 px): a contact shadow on the board, and a soft one that grows as a hovered tape lifts 1 px.
const STYLE = `
[data-ice-tray-bar]{${DESK_INK};${DESK_TAPE};--ice-tb-night:0;position:absolute;left:0;right:0;top:0;height:0;z-index:19;pointer-events:none;font:500 12.5px/1 var(--ice-menu-font,system-ui,-apple-system,sans-serif);user-select:none}
[data-ice-tray-bar] .ice-tb-handle{position:absolute;left:0;right:0;top:0;display:flex;justify-content:center;pointer-events:none;will-change:transform}
[data-ice-tray-bar] .ice-tb-bar{pointer-events:auto;display:flex;align-items:center;height:40px;padding:4px;box-sizing:border-box;white-space:nowrap;border-radius:20px;background:var(--ice-menu-ink);color:var(--ice-menu-cream);box-shadow:inset 0 0 0 1px var(--ice-menu-hair),var(--ice-menu-shadow);opacity:1;visibility:visible;transition:opacity ${TRAY_BAR.inMs}ms ease-out}
[data-ice-tray-bar][data-visible="false"] .ice-tb-bar{opacity:0;visibility:hidden;pointer-events:none;transition:opacity ${TRAY_BAR.awayMs}ms ease-out,visibility 0s linear ${TRAY_BAR.awayMs}ms}
[data-ice-tray-bar] button{appearance:none;border:0;margin:0;padding:0;background:none;color:inherit;font:inherit;cursor:pointer}
[data-ice-tray-bar] button:focus-visible{outline:2px solid var(--ice-menu-brass);outline-offset:1px}
[data-ice-tray-bar] .ice-tb-toggle{flex:none;height:32px;padding:0 12px 0 9px;border-radius:16px;display:inline-flex;align-items:center;gap:7px;background:rgb(var(--ice-menu-cream-rgb) / .08);transition:background 120ms ease,transform 120ms ease}
[data-ice-tray-bar] .ice-tb-toggle:hover{background:rgb(var(--ice-menu-cream-rgb) / .15)}
[data-ice-tray-bar] .ice-tb-toggle:active{transform:scale(.97)}
[data-ice-tray-bar] .ice-tb-head{position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;visibility:visible;will-change:transform,opacity}
[data-ice-tray-bar][data-visible="false"] .ice-tb-head,[data-ice-tray-bar] .ice-tb-head[data-shown="false"]{visibility:hidden}
[data-ice-tray-bar] .ice-tb-chips{pointer-events:auto;display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding:8px 7px;box-sizing:border-box;overflow-x:auto;scrollbar-width:none}
[data-ice-tray-bar] .ice-tb-chips::-webkit-scrollbar{display:none}
[data-ice-tray-bar] .ice-tb-chips[data-before="true"]{mask-image:linear-gradient(90deg,transparent 0,#000 18px)}
[data-ice-tray-bar] .ice-tb-chips[data-after="true"]{mask-image:linear-gradient(90deg,#000 calc(100% - 18px),transparent 100%)}
[data-ice-tray-bar] .ice-tb-chips[data-before="true"][data-after="true"]{mask-image:linear-gradient(90deg,transparent 0,#000 18px,#000 calc(100% - 18px),transparent 100%)}
[data-ice-tray-bar] .ice-tb-chip{--n:var(--ice-tb-night);flex:none;height:26px;padding:0 10px;border-radius:2.5px;display:inline-flex;align-items:center;font:600 11px/1 var(--ice-tape-font);letter-spacing:.08em;text-transform:uppercase;color:rgb(var(--ice-tape-letters-rgb) / calc(1 - .45 * var(--n)));background:linear-gradient(180deg,rgb(255 255 255 / calc(.1 * (1 - var(--n)))) 0,rgb(255 255 255 / calc(.035 * (1 - var(--n)))) 46%,rgb(255 255 255 / 0) 54%),var(--ice-tape);text-shadow:0 1px 0 rgb(0 0 0 / .55),0 -.5px 0 rgb(255 255 255 / calc(.1 * (1 - var(--n))));box-shadow:inset 0 .75px 0 rgb(255 255 255 / calc(.1 * (1 - var(--n)))),.6px .9px 0 rgb(0 0 0 / calc(.24 * (1 - .5 * var(--n)))),1px 2px 3px rgb(0 0 0 / calc(.16 * (1 - .5 * var(--n))));transition:transform 120ms ease,box-shadow 120ms ease}
[data-ice-tray-bar] .ice-tb-chip:hover{transform:translateY(-1px);box-shadow:inset 0 .75px 0 rgb(255 255 255 / calc(.1 * (1 - var(--n)))),1px 1.8px .5px rgb(0 0 0 / calc(.22 * (1 - .5 * var(--n)))),1.6px 3.2px 5px rgb(0 0 0 / calc(.2 * (1 - .5 * var(--n))))}
[data-ice-tray-bar] .ice-tb-chip:active{transform:none}
[data-ice-tray-bar] .ice-tb-chip:focus-visible{outline:2px solid var(--ice-menu-brass);outline-offset:2px}
[data-ice-tray-bar] .ice-tb-chip[data-on="true"]{--ice-tape:var(--ice-tape-chosen);color:var(--ice-tape-chosen-ink);text-shadow:0 1px 0 rgb(255 255 255 / .5),0 -.5px 0 rgb(60 40 20 / .18);filter:saturate(calc(1 - .7 * var(--n))) brightness(calc(1 - .4 * var(--n)))}
`;

export interface TrayBarProps {
  /** The drawer's door — the desk handle's `tray`. */
  readonly source: TrayBarSource;
  /** The button's word (default "Objects") and the key named in its tip (default "A" — the app's toggle). */
  readonly label?: string;
  readonly keys?: string;
}

/** What the bar renders from (the placement is written straight to the elements: no render per frame of the slide). */
interface Shown { readonly visible: boolean; readonly open: boolean; readonly category: string; readonly chips: string }
const shownOf = (a: TrayBarAnchor): Shown => ({
  visible: !a.held && a.entries > 0,
  open: a.open,
  category: a.category,
  chips: a.categories.map((c) => `${c.id}:${c.label}:${c.count}`).join("|"),
});
const sameShown = (a: Shown, b: Shown): boolean => a.visible === b.visible && a.open === b.open && a.category === b.category && a.chips === b.chips;

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
  const handle = useRef<HTMLDivElement | null>(null);
  const head = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const cats = useRef<readonly TrayBarCategory[]>(source.anchor().categories);
  const [shown, setShown] = useState<Shown>(() => shownOf(source.anchor()));

  // the chips scrolled inside the header (past its width): each end fades where more tape lies beyond it — told on a scroll, a render,
  // and a new width (never per frame: reading the layout is once per change)
  const edges = (): void => {
    const c = chipsRef.current;
    if (c === null) return;
    const more = c.scrollWidth - c.clientWidth;
    c.dataset.before = String(more > 0.5 && c.scrollLeft > 0.5);
    c.dataset.after = String(more > 0.5 && c.scrollLeft < more - 0.5);
  };
  const width = useRef(-1);
  // placement: written straight to the elements on every anchor the desk publishes (no render per frame) — the pill's rise, the header
  // strip's rect and its fade, the night the tape steps back by
  const placeRef = useRef<() => void>(() => {});
  placeRef.current = (): void => {
    const a = source.anchor();
    cats.current = a.categories;
    const next = shownOf(a);
    setShown((prev) => (sameShown(prev, next) ? prev : next));
    const at = placeTrayBar(a);
    if (handle.current !== null) handle.current.style.transform = `translateY(${at.y.toFixed(1)}px)`;
    const h = head.current;
    if (h !== null) {
      const box = at.head;
      h.dataset.shown = String(box !== null && box.opacity > 0);
      if (box !== null) {
        h.style.transform = `translate(${box.x.toFixed(1)}px, ${box.y.toFixed(1)}px)`;
        h.style.width = `${box.w.toFixed(1)}px`;
        h.style.height = `${box.h.toFixed(1)}px`;
        h.style.opacity = box.opacity.toFixed(3);
        if (box.w !== width.current) { width.current = box.w; edges(); }
      }
    }
    root.current?.style.setProperty("--ice-tb-night", Math.min(Math.max(a.night, 0), 1).toFixed(3));
  };
  useLayoutEffect(() => {
    const run = (): void => placeRef.current();
    run();
    return source.subscribe(run);
  }, [source]);
  useLayoutEffect(() => { edges(); });
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
      <div ref={handle} className="ice-tb-handle">
        <div className="ice-tb-bar" data-canvas-interactive="" onPointerDown={(e) => e.stopPropagation()}>
          <button
            ref={toggleRef} type="button" className="ice-tb-toggle" data-act="tray" aria-expanded={shown.open} aria-keyshortcuts={keys} title={`${label} (${keys})`}
            onClick={clicked(toggle)} onKeyDown={pressed(toggle)} onKeyUp={spaceUp}
          >
            <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" focusable="false">{shown.open ? TRAY_BAR_GLYPHS.close : TRAY_BAR_GLYPHS.pegboard}</svg>
            <span>{label}</span>
          </button>
        </div>
      </div>
      <div ref={head} className="ice-tb-head">
        <div ref={chipsRef} className="ice-tb-chips" role="toolbar" aria-label="Categories" data-canvas-interactive="" onKeyDown={walk} onScroll={edges} onPointerDown={(e) => e.stopPropagation()}>
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
      <style>{STYLE}</style>
    </div>
  );
}
