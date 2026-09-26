// The desk's MARKS from the world (design-015 §7, stratum 5; D4a) — the builder's chrome half. FACTS are
// the world's, read and never written: `Selected`, `Locked`, `Grab`, `Resizable` (the builder caches
// them per entity), a room's other people (D5a: core's presence projections — each remote `CursorVisual`
// at its peer's cursor, `Follows` → the peer's `PresenceInfo`; each peer's `SelectionSummary` keys, resolved
// to this desk's objects through the host's key resolver), core's snap chrome (`GuideLine { axis, at }` · `SpacingBar`, pooled runtime entities
// the snap system keeps), the marquee's out-of-ECS preview (`MarqueeBuffer`, handed in by the host), the
// mouse pointer's screen point, the gestures (`Camera.gesturing`, an active `Drag`). FLUX is here, per
// entity and for the desk, stepped by the frame's dt and snapped at its ends (B7's trap): each object's
// lock-on (180 ms, eased on `--vf-ease-lift` by the layout) and presence (in and out over 120 ms); several's
// union (220 ms) and presence (120 ms); the vellum's fold onto the union (240 ms, island ease) when the
// marquee lets go; the laser's strike (160 ms) on a NEW alignment; the tape pressed (240 ms, the second
// strip 60 ms later) and lifted (160 ms); and the tape's GIVE — a drag that meets a taped object shivers
// it 2.2 px for 360 ms and settles (*Marks on the Mat*: "a taped object refuses a drag with a 2 px give";
// D2a-core already refuses the move itself): core's move meets the tape here, and a kind that carries itself
// (the print, D3w) tells the collector of the drag it refused (`refused`). `assembleMarks` (marks/assemble.ts)
// turns it all into the frame's marks — the oracle's stills run through the same rule. Nothing here writes
// the world.

import {
  Camera,
  Captures,
  CursorVisual,
  defineQuery,
  Follows,
  Local,
  Not,
  Position,
  PresenceInfo,
  PresencePeer,
  SelectionSummary,
  Drag,
  Editing,
  GestureActive,
  GuideLine,
  LocalPointer,
  Locked,
  type MarqueeBuffer,
  Pointer,
  PointerScreen,
  RoutedMove,
  Selected,
  SpacingBar,
  type Entity,
  type World,
} from "@ice/core";
import { assembleMarks, type MarkedObject, type MarkedPeer } from "../marks/assemble";
import { laserKey, type WorldBar, type WorldGuide } from "../marks/laser";
import { type MarkBox, type MarkFrame, type MarksInput, selectionBox } from "../marks/layout";
import { cssColor, MARKS, type RGBA } from "../theme";

/** One object as the builder hands it to the marks: its drawn frame and rect (world), the facts it cached. */
export interface MarkRow {
  readonly entity: Entity;
  readonly frame: MarkFrame;
  /** ICE's rect: Position (top-left) + Size, world units. */
  readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly selected: boolean;
  readonly locked: boolean;
  readonly grabbed: boolean;
  readonly resizable: boolean;
}

/** What the selection menu is placed from (the desk handle publishes it): the marks' box around the selection ON SCREEN, CSS px. */
export interface SelectionAnchor {
  /** The brackets' box (6 out) for one object, the union's (10 out) for several — null when nothing is selected. */
  readonly box: MarkBox | null;
  readonly count: number;
  /** Every selected object is taped (the menu offers "Lift the tape"). */
  readonly locked: boolean;
  /** A gesture is on (a drag, a vellum, a pan, a pinch): the menu steps aside. */
  readonly gesturing: boolean;
  /** A note is being written (core's `Editing` — the one focused editor, D2c): the menu steps aside as for a gesture; the brackets stay. */
  readonly editing: boolean;
  /** The view it was placed in, CSS px, and whether the rulers are printed (the menu flips below their band). */
  readonly view: { readonly width: number; readonly height: number };
  readonly rulers: { readonly margin: number; readonly band: number } | null;
}

export interface MarksFrameInput {
  readonly rows: readonly MarkRow[];
  readonly cam: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly view: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly dt: number;
  readonly night: boolean;
  readonly rulers: { readonly margin: number; readonly band: number } | null;
}

export interface MarksCollector {
  /** PULL what the marks read outside the builder's journal — the snap's chrome, the vellum, a drag meeting tape, the gestures; true when any changed (a wake). */
  changed(): boolean;
  /** This frame's marks: the clocks stepped by `dt`, the state assembled. */
  frame(input: MarksFrameInput): MarksInput;
  /** A clock still moves: the next frame paints too. */
  live(): boolean;
  /** The tape's give on an entity this frame, CSS px along x (0 at rest) — the builder shifts the object by it. */
  giveOf(e: Entity): number;
  /**
   * A drag refused on `e` outside core's move — a print's own carry (D3w: a print is not core-movable, so no core drag of
   * it ever meets the tape here): a taped `e` gives, as a core drag meeting tape makes it give. The next `changed()` wakes.
   */
  refused(e: Entity): void;
  /** The selection menu's anchor, as of the last frame. */
  anchor(): SelectionAnchor;
  dispose(): void;
}

interface Clocks { lockT: number; lockA: number; selected: boolean; tapeT: number; tapeA: number; locked: boolean; give: number }

const guidesQ = defineQuery([GuideLine]);
const barsQ = defineQuery([SpacingBar]);
const dragsQ = defineQuery([Drag, GestureActive]);
const movesQ = defineQuery([Drag, GestureActive, RoutedMove]);
const pointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);
const selectedQ = defineQuery([Selected]);
const editingQ = defineQuery([Editing]);
const handsQ = defineQuery([CursorVisual, Position]);
const peersQ = defineQuery([PresencePeer, PresenceInfo, SelectionSummary, Not(Local)]);
/** A peer's colour as a hand's ink — a colour no one can parse is the hand table's presence grey (a tolerant reader: a peer's bad byte never throws here). */
const inkOf = (css: string): RGBA => { try { return cssColor(css); } catch { return cssColor(MARKS.hand.fallback); } };
/** A summary's key list (a JSON array, ≤ 32) — unreadable, none. */
const keysOf = (json: string): string[] => { try { const k: unknown = JSON.parse(json); return Array.isArray(k) ? k.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

const NO_ANCHOR: SelectionAnchor = { box: null, count: 0, locked: false, gesturing: false, editing: false, view: { width: 0, height: 0 }, rulers: null };
const step = (x: number, to: number, dt: number, ms: number): number => (to > x ? Math.min(to, x + (dt * 1000) / ms) : Math.max(to, x - (dt * 1000) / ms));

export function createMarksCollector(world: World, opts: { readonly marquee?: () => MarqueeBuffer | undefined; readonly resolveKey?: (key: string) => Entity | undefined } = {}): MarksCollector {
  const C = MARKS.clocks;
  const clocks = new Map<Entity, Clocks>();
  let unionT = 1;
  let unionA = 0;
  let several = false;
  let fold: { rect: MarkBox; t: number } | null = null;
  let strike = 0;
  let key = "";
  let lastMarquee: MarkBox | null = null;   // the vellum's last rect on screen (what a fold starts from)
  let snapshot = "";
  let live = false;
  let anchor: SelectionAnchor = NO_ANCHOR;
  const seenDrags = new Set<Entity>();
  let mouse: Entity | undefined;

  const pointerScreen = (): { x: number; y: number } | null => {
    if (mouse === undefined || !world.isAlive(mouse)) {
      mouse = undefined;
      world.query(pointersQ).each((b) => { for (const r of b) { const p = b.entity(r); if (world.read(p, Pointer).device === "mouse") mouse = p; } });
    }
    const s = mouse === undefined ? undefined : world.get(mouse, PointerScreen);
    return s === undefined ? null : { x: s.x, y: s.y };
  };
  const readGuides = (): { guides: WorldGuide[]; bars: WorldBar[] } => {
    const guides: WorldGuide[] = [];
    const bars: WorldBar[] = [];
    world.query(guidesQ).each((b) => { for (const r of b) { const g = world.read(b.entity(r), GuideLine); guides.push({ axis: g.axis, at: g.at }); } });
    world.query(barsQ).each((b) => { for (const r of b) { const s = world.read(b.entity(r), SpacingBar); bars.push({ axis: s.axis, from: s.from, to: s.to, perp: s.perp, gap: s.gap }); } });
    return { guides, bars };
  };
  /** A room's other people this frame: each remote hand (its cursor, world) under its peer's name and colour, and what each holds selected among `rows`. */
  const readPeers = (rows: readonly MarkRow[]): MarkedPeer[] => {
    const byPeer = new Map<Entity, { hand: { x: number; y: number } | null; name: string; ink: RGBA; selected: MarkFrame[] }>();
    const entry = (peer: Entity): { hand: { x: number; y: number } | null; name: string; ink: RGBA; selected: MarkFrame[] } | undefined => {
      let p = byPeer.get(peer);
      if (p !== undefined) return p;
      const info = world.get(peer, PresenceInfo);
      if (info === undefined) return undefined;
      p = { hand: null, name: info.name ?? "", ink: inkOf(info.color ?? ""), selected: [] };
      byPeer.set(peer, p);
      return p;
    };
    world.query(handsQ).each((b) => {
      for (const r of b) {
        const c = b.entity(r);
        if (world.read(c, CursorVisual).kind !== "remote") continue;
        const peer = world.getRelation(c, Follows);
        const p = peer === undefined || !world.isAlive(peer) ? undefined : entry(peer);
        if (p === undefined) continue;
        const at = world.read(c, Position);
        p.hand = { x: at.x, y: at.y };
      }
    });
    const resolve = opts.resolveKey;
    if (resolve !== undefined) {
      const frames = new Map(rows.map((row) => [row.entity, row.frame]));
      world.query(peersQ).each((b) => {
        for (const r of b) {
          const peer = b.entity(r);
          const p = entry(peer);
          if (p === undefined) continue;
          for (const k of keysOf(world.read(peer, SelectionSummary).keys ?? "[]")) { const e = resolve(k); const f = e === undefined ? undefined : frames.get(e); if (f !== undefined) p.selected.push(f); }
        }
      });
    }
    return [...byPeer.values()];
  };
  /** What a room's other people show, as a string — a hand that moves, a name, a colour, a selection: a wake. */
  const peersKey = (): string => {
    let k = "";
    world.query(handsQ).each((b) => { for (const r of b) { const c = b.entity(r); if (world.read(c, CursorVisual).kind !== "remote") continue; const at = world.read(c, Position); const peer = world.getRelation(c, Follows); const i = peer === undefined ? undefined : world.get(peer, PresenceInfo); k += `h${c}:${at.x},${at.y},${i?.name},${i?.color};`; } });
    world.query(peersQ).each((b) => { for (const r of b) { const e = b.entity(r); k += `p${e}:${world.read(e, SelectionSummary).keys};`; } });
    return k;
  };
  const clockOf = (e: Entity): Clocks => {
    let c = clocks.get(e);
    if (c === undefined) { c = { lockT: 0, lockA: 0, selected: false, tapeT: 0, tapeA: 0, locked: false, give: -1 }; clocks.set(e, c); }
    return c;
  };
  /** A taped object met by a drag gives: its clock from 0. */
  const give = (e: Entity): void => { if (!world.hasTag(e, Locked)) return; clockOf(e).give = 0; live = true; };
  /** A refusal a host told of since the last `changed()` (a print's carry). */
  let told = false;
  /** A drag that meets tape: every taped object it would carry — the one it grabbed, and the selection it grabbed into — gives. */
  const meetTape = (rec: Entity): void => {
    const grabbed = world.getRelation(rec, Captures);
    if (grabbed === undefined || !world.isAlive(grabbed)) return;
    if (world.hasTag(grabbed, Selected)) {
      world.query(selectedQ).each((b) => { for (const r of b) give(b.entity(r)); });
    } else give(grabbed);
  };

  return {
    changed() {
      const { guides, bars } = readGuides();
      const m = opts.marquee?.();
      const rect = m?.rect ?? null;
      const cam = world.getResource(Camera);
      let drags = 0;
      world.query(dragsQ).each((b) => { drags += b.count; });
      let editing = 0;
      world.query(editingQ).each((b) => { editing += b.count; });
      // a drag that has just started meets the tape it would carry
      const now = new Set<Entity>();
      world.query(movesQ).each((b) => { for (const r of b) now.add(b.entity(r)); });
      let met = false;
      for (const rec of now) if (!seenDrags.has(rec)) { meetTape(rec); met = true; }
      seenDrags.clear();
      for (const rec of now) seenDrags.add(rec);
      const p = rect === null ? null : pointerScreen();
      const next = `${laserKey(guides, bars)}|${rect === null ? "" : `${rect.x},${rect.y},${rect.w},${rect.h},${m?.hits.length ?? 0},${p?.x ?? ""},${p?.y ?? ""}`}|${drags}|${cam?.gesturing === true ? 1 : 0}|${editing}|${peersKey()}`;
      const any = next !== snapshot || met || told;
      told = false;
      snapshot = next;
      return any;
    },
    frame(input) {
      const { cam, dt } = input;
      const z = cam.zoom;
      live = false;
      // the snap's facts, and a NEW alignment's strike
      const { guides, bars } = readGuides();
      const k = laserKey(guides, bars);
      if (k !== key) { if (guides.length + bars.length > 0) strike = 1; key = k; }
      if (strike > 0) { strike = step(strike, 0, dt, C.strike); live ||= strike > 0; }
      // the vellum: its world rect while drawn; when it lets go, the fold begins from where it was on screen
      const m = opts.marquee?.();
      const q = m?.rect ?? null;
      const marquee = q === null ? null : { rect: { x0: q.x, y0: q.y, x1: q.x + q.w, y1: q.y + q.h }, pointer: pointerScreen() };
      if (q !== null) { lastMarquee = { x0: (q.x - cam.x) * z, y0: (q.y - cam.y) * z, x1: (q.x + q.w - cam.x) * z, y1: (q.y + q.h - cam.y) * z }; fold = null; }
      else if (lastMarquee !== null) { fold = { rect: lastMarquee, t: 0 }; lastMarquee = null; }
      else if (fold !== null) { fold.t = step(fold.t, 1, dt, C.fold); if (fold.t >= 1) fold = null; }
      live ||= fold !== null;
      // each object's clocks: the lock-on and its presence, the tape's press and lift, the give
      const seen = new Set<Entity>();
      const objects: MarkedObject[] = [];
      let count = 0;
      let allTaped = true;
      for (const row of input.rows) {
        seen.add(row.entity);
        const c = clockOf(row.entity);
        if (row.selected && !c.selected) c.lockT = 0;
        c.selected = row.selected;
        if (row.selected) { c.lockT = step(c.lockT, 1, dt, C.lockOn); c.lockA = step(c.lockA, 1, dt, C.leave); }
        else c.lockA = step(c.lockA, 0, dt, C.leave);
        if (row.locked && !c.locked) c.tapeT = 0;
        c.locked = row.locked;
        const pressEnd = (C.tapePress + C.tapeStagger) / 1000;
        if (row.locked) { c.tapeT = Math.min(c.tapeT + dt, pressEnd); c.tapeA = 1; }
        else c.tapeA = step(c.tapeA, 0, dt, C.tapeLift);
        // the give ends: one more frame, so the object is drawn at rest (its geometry was resolved with this frame's give)
        if (c.give >= 0) { c.give += dt; if (c.give >= C.give / 1000) { c.give = -1; live = true; } }
        live ||= (row.selected && (c.lockT < 1 || c.lockA < 1)) || (!row.selected && c.lockA > 0) || (row.locked && c.tapeT < pressEnd) || (!row.locked && c.tapeA > 0) || c.give >= 0;
        if (row.selected) { count += 1; allTaped &&= row.locked; }
        const press = (row.locked ? [c.tapeT * 1000 / C.tapePress, (c.tapeT * 1000 - C.tapeStagger) / C.tapePress] : [1, 1]) as [number, number];
        objects.push({
          frame: row.frame, rect: row.rect, selected: row.selected, locked: row.locked, moving: row.grabbed, resizable: row.resizable,
          lock: { t: c.lockT, a: c.lockA }, tape: { press: [Math.min(1, Math.max(0, press[0])), Math.min(1, Math.max(0, press[1]))], a: c.tapeA },
        });
      }
      for (const e of clocks.keys()) if (!seen.has(e)) clocks.delete(e);
      // several's union: its lock-on from the moment there are several, its presence in and out
      if (count > 1 && !several) unionT = 0;
      several = count > 1;
      unionT = step(unionT, 1, dt, C.union);
      unionA = step(unionA, several ? 1 : 0, dt, C.unionFade);
      live ||= (several && unionT < 1) || (several ? unionA < 1 : unionA > 0);
      const marks = assembleMarks({ view: input.view, cam, night: input.night, objects, union: { t: unionT, a: unionA }, marquee, fold, guides, bars, strike, ruler: input.rulers, peers: readPeers(input.rows) });
      // the menu's anchor: the marks' box around the selection as drawn
      let drags = 0;
      world.query(dragsQ).each((b) => { drags += b.count; });
      const frames = objects.filter((o) => o.selected).map((o) => ({ ...o.frame, cx: (o.frame.cx - cam.x) * z, cy: (o.frame.cy - cam.y) * z, hx: o.frame.hx * z, hy: o.frame.hy * z, r: o.frame.r * z }));
      anchor = {
        box: selectionBox(frames), count, locked: count > 0 && allTaped,
        gesturing: drags > 0 || marquee !== null || world.getResource(Camera)?.gesturing === true,
        editing: world.firstOf(editingQ) !== undefined,
        view: { width: input.view.width, height: input.view.height }, rulers: input.rulers,
      };
      return marks;
    },
    live: () => live,
    giveOf(e) {
      const c = clocks.get(e);
      if (c === undefined || c.give < 0) return 0;
      const t = c.give;
      return Math.sin(t * MARKS.give.rate) * MARKS.give.px * (1 - (t * 1000) / C.give);
    },
    refused(e) {
      if (!world.isAlive(e) || !world.hasTag(e, Locked)) return;
      give(e);
      told = true;
    },
    anchor: () => anchor,
    dispose() { clocks.clear(); seenDrags.clear(); },
  };
}
