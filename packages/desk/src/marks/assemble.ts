// ASSEMBLE the frame's marks — pure (design-015 §7; D4a): the one place the desk's STATE becomes what
// its chrome draws, shared by the builder (compose/marks.ts, from the world) and the Node oracle (from a
// scene's still), so the two draw the same marks for the same state by construction. The rules are
// desk.js's `drawChrome`, number for number: one selected object wears the brackets (its lock-on and
// presence the caller's clocks; an object that has just left keeps its fading brackets while no several
// is selected); several wear member ticks under ONE union square to the mat; what the vellum touches is
// ticked at once (never the tape — Q-g), the count riding the cursor; released, the vellum folds onto
// the union on the island ease (onto the one object, fading, when it gathered one); knobs only where an
// object resizes, is not taped and nothing moves it; the laser from the snap's facts (marks/laser.ts); a
// taped object's tape; your extent on the rulers while something is selected and no vellum is drawn.

import { easeIsland } from "./ease";
import { type LaserCamera, laserOf, type WorldBar, type WorldBox, type WorldGuide } from "./laser";
import { frameOnScreen, framesBox, type MarkBox, type MarkFrame, type MarkObject, type MarkRuler, type MarksInput, type MarkTape, type MarkUnion } from "./layout";
import { MARKS } from "../theme";

/** One object as its marks need it — the builder's cached facts and flux, or a still's. */
export interface MarkedObject {
  /** Its silhouette AS DRAWN, world units (the kind's `frame` on this frame's geometry). */
  readonly frame: MarkFrame;
  /** ICE's rect (Position + Size), unturned, world units — what the snap aligned and the vellum touches. */
  readonly rect: WorldBox;
  readonly selected: boolean;
  /** Taped down (`Locked`): no knobs, and the vellum passes over it. */
  readonly locked: boolean;
  /** Carried (`Grab`): its knobs hide, and it is the laser's dragged set. */
  readonly moving: boolean;
  readonly resizable: boolean;
  /** The selection's clocks: the lock-on's LINEAR progress and the presence (1 at rest; the leave fades it). */
  readonly lock: { readonly t: number; readonly a: number };
  /** The tape's clocks: each strip's press (0..1, linear) and the tape's presence (0 = none drawn). */
  readonly tape: { readonly press: readonly [number, number]; readonly a: number };
}

export interface MarksState {
  readonly view: MarksInput["view"];
  /** The ROOT slot's camera (`Camera.x/y` = the view's world top-left). */
  readonly cam: LaserCamera;
  readonly night: boolean;
  /** The desk's objects in paint order. */
  readonly objects: readonly MarkedObject[];
  /** Several's union: its lock-on (linear) and presence. */
  readonly union: { readonly t: number; readonly a: number };
  /** The vellum being drawn: its WORLD rect (core's `MarqueeBuffer.rect`) and the cursor on screen. */
  readonly marquee: { readonly rect: WorldBox; readonly pointer: { readonly x: number; readonly y: number } | null } | null;
  /** The vellum released: its last rect ON SCREEN and the fold's linear progress. */
  readonly fold: { readonly rect: MarkBox; readonly t: number } | null;
  /** The snap's facts, world units (core's `GuideLine` / `SpacingBar`). */
  readonly guides: readonly WorldGuide[];
  readonly bars: readonly WorldBar[];
  readonly strike: number;
  /** The rulers printed on this desk (their margin and band, CSS px), or null. */
  readonly ruler: { readonly margin: number; readonly band: number } | null;
}

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const lerpBox = (a: MarkBox, b: MarkBox, e: number): MarkBox => ({ x0: a.x0 + (b.x0 - a.x0) * e, y0: a.y0 + (b.y0 - a.y0) * e, x1: a.x1 + (b.x1 - a.x1) * e, y1: a.y1 + (b.y1 - a.y1) * e });
const touches = (a: WorldBox, b: WorldBox): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** The vellum's world rect, normalised (a drag may run any way). */
export const normalBox = (b: WorldBox): WorldBox => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });

/** What the vellum touches — never the tape (Q-g); core's `queryHits` on the same rects. */
export function vellumHits(objects: readonly MarkedObject[], rect: WorldBox): MarkedObject[] {
  const r = normalBox(rect);
  return objects.filter((o) => !o.locked && touches(o.rect, r));
}

export function assembleMarks(s: MarksState): MarksInput {
  const cam = s.cam;
  const z = cam.zoom;
  const on = (f: MarkFrame): MarkFrame => frameOnScreen(f, cam);
  const sel = s.objects.filter((o) => o.selected);
  const several = sel.length > 1;
  // the vellum, mid-drag: what it touches is ticked at once, the count by the cursor
  let marquee: MarksInput["marquee"] = null;
  const touched = new Set<MarkedObject>();
  if (s.marquee !== null) {
    for (const o of vellumHits(s.objects, s.marquee.rect)) touched.add(o);
    const q = s.marquee.rect;
    marquee = { rect: { x0: (q.x0 - cam.x) * z, y0: (q.y0 - cam.y) * z, x1: (q.x1 - cam.x) * z, y1: (q.y1 - cam.y) * z }, count: touched.size, pointer: s.marquee.pointer };
  }
  const objects: MarkObject[] = [];
  const tape: MarkTape[] = [];
  for (const o of s.objects) {
    const f = on(o.frame);
    if (o.tape.a > 0) {
      const half = (o.rect.x1 - o.rect.x0) / 2;
      tape.push({ frame: f, units: z * (half > 0 ? o.frame.hx / half : 1), press: o.tape.press, alpha: o.tape.a });
    }
    if (touched.has(o) && !o.selected) { objects.push({ frame: f, style: "member", t: 1, alpha: 1, knobs: false }); continue; }
    if (several) { if (o.selected) objects.push({ frame: f, style: "member", t: 1, alpha: o.lock.a, knobs: false }); continue; }
    if (o.selected || o.lock.a > 0) objects.push({ frame: f, style: "brackets", t: o.lock.t, alpha: o.lock.a, knobs: o.selected && o.resizable && !o.locked && !o.moving });
  }
  // several's union — or, released, the vellum folding onto it (onto the one object it gathered, fading as it lands)
  let union: MarkUnion | null = null;
  const selBox = framesBox(sel.map((o) => on(o.frame)));
  if (several && selBox !== null && s.union.a > 0) {
    let box = selBox;
    if (s.fold !== null) box = lerpBox(s.fold.rect, selBox, easeIsland(clamp01(s.fold.t)));
    union = { box, t: s.fold !== null ? 1 : s.union.t, alpha: s.union.a };
  } else if (s.fold !== null && sel.length === 1 && selBox !== null) {
    const e = easeIsland(clamp01(s.fold.t));
    const g = MARKS.select.gap;
    const to: MarkBox = { x0: selBox.x0 - g, y0: selBox.y0 - g, x1: selBox.x1 + g, y1: selBox.y1 + g };
    if (e < 0.98) union = { box: lerpBox(s.fold.rect, to, e), t: 1, alpha: 1 - e * 0.9 };
  }
  // the laser: the carried set is what the snap dragged; everything else is what it aligned against
  const moving = s.objects.filter((o) => o.moving);
  let dragged: WorldBox | null = null;
  for (const o of moving) dragged = dragged === null ? o.rect : { x0: Math.min(dragged.x0, o.rect.x0), y0: Math.min(dragged.y0, o.rect.y0), x1: Math.max(dragged.x1, o.rect.x1), y1: Math.max(dragged.y1, o.rect.y1) };
  const laser = s.guides.length > 0 || s.bars.length > 0 ? laserOf(s.guides, s.bars, s.objects.filter((o) => !o.moving).map((o) => o.rect), dragged, cam) : { guides: [], bars: [] };
  // your extent on the rulers: while something is selected and no vellum is being drawn
  let ruler: MarkRuler | null = null;
  if (s.ruler !== null && selBox !== null && s.marquee === null) {
    const world = framesBox(sel.map((o) => o.frame));
    if (world !== null) ruler = { sel: selBox, world, margin: s.ruler.margin, band: s.ruler.band };
  }
  return { view: s.view, night: s.night, tape, objects, union, marquee, guides: laser.guides, bars: laser.bars, strike: s.strike, ruler };
}
