// THE DESK CALENDAR AT WORK — its hand (CALENDAR.md §5; D3t-c): the world half of the calendar's interaction, the whiteboard pen's
// sibling (objects/pen.ts). Once a frame, before the kinds' clocks, it READS the world — each pad's selection (`PadSelection`, the
// user's fact), the entry being written (objects/calendar-writing.ts) and the editor's caret (host/calendar-input.ts) — and hands
// the calendar kind's local what to MARK on each pad this frame (`Pads.mark`: the days selected, the entry, the caret's blink, the
// newest glyph's wipe). It WRITES only as an op would, each out of the frame (a reflector never writes — D-D2c.5): the bar's today
// (`home` bumped) rolls the pad home — its month, ONE transaction, off the undo stack (D-D3t-c.5) — and selects today.

import { Captures, defineQuery, Down, DownPart, type Entity, heldEntity, HeldPointer, HeldPress, LocalPointer, Pointer, PointerButtons, PointerPart, PointerScreen, PointerWorld, setWidgetProps, TouchesExact, Watches, type World } from "@ice/core";
import { dayOr, monthKeyOf, PadSelection } from "../calendar/data";
import { CALENDAR, type CalendarLaw } from "../calendar/law";
import { keyOf, monthOfDay } from "../calendar/month";
import { padFrame } from "../calendar/pad";
import { type CalendarGeometry, DRAFT_ID, type PadMarks, type Pads, partAt, sheetPoint } from "../kinds/calendar";
import type { CalendarWriting } from "./calendar-writing";
import type { TypingDocs } from "./typing";

export interface CalendarHandOptions {
  readonly world: World;
  readonly docs: TypingDocs;
  readonly pads: () => Pads | undefined;
  readonly writing: CalendarWriting;
  /** The editor's caret on the line being written — its index and when its blink restarted (the hand's clock) — and the newest glyph's wipe. */
  readonly caret: () => { readonly index: number; readonly t0: number; readonly wipe: { readonly index: number; readonly t0: number } | null } | null;
  /** The caret's blink, ms (530). */
  readonly blinkMs?: number;
  /** The newest glyph's wipe, ms (the hand's 110). */
  readonly wipeMs?: number;
  /** Where a transaction runs: out of the frame (a microtask) unless a test says. */
  readonly defer?: (fn: () => void) => void;
  /** The builder's word on a pad — its geometry as drawn, the hand's frame, the held pose (the roll by hand reads them; absent: no hands). */
  readonly geometryOf?: (e: Entity) => unknown;
  readonly hand?: () => { readonly entity: Entity; readonly landing: boolean; readonly frame: { readonly cx: number; readonly cy: number; readonly s: number } } | undefined;
  readonly heldToWorld?: (e: Entity, x: number, y: number) => readonly [number, number] | undefined;
  readonly isPad?: (e: Entity) => boolean;
  readonly law?: CalendarLaw;
}

export interface CalendarHand {
  /** Once a frame, before the kinds' clocks: the marks on every pad; the bar's today acted on. */
  follow(now: number): void;
}

const selectionsQ = defineQuery([PadSelection]);
/** Core's recognizers that began on a PART (their capture and their down) — a press on a pad's roll at rest. */
const partPressQ = defineQuery([Down, DownPart]);
const pointersQ = defineQuery([Pointer, LocalPointer, PointerScreen]);
/** The parts a hand rolls a month by. */
const ROLL_PARTS = new Set(["foot", "corner", "roll", "moving"]);
type RollPart = "foot" | "corner" | "roll" | "moving";
/** A press moved this far (CSS px) is a drag: its release decides by the third or the flick, never as a click. */
const MOVED_PX = 4;


export function createCalendarHand(opts: CalendarHandOptions): CalendarHand {
  const { world, docs } = opts;
  const law = opts.law ?? CALENDAR;
  const F = padFrame(law);
  /** The hands on a pad's roll, by pointer: the pad, where the press began (CSS px). */
  const hands = new Map<Entity, { readonly pad: Entity; readonly x0: number; readonly y0: number }>();
  /** The pads whose corner the pointer lifted last frame. */
  let peeked = new Set<Entity>();
  const G = (e: Entity): CalendarGeometry | undefined => opts.geometryOf?.(e) as CalendarGeometry | undefined;
  /** A pointer's desk point: at rest the world's; in hand through the pose the renderer drew (as core maps `HeldPointer`). */
  const deskOf = (p: Entity, pad: Entity): readonly [number, number] | undefined => {
    if (heldEntity(world) === pad) {
      const hp = world.get(p, HeldPointer);
      return hp === undefined ? undefined : opts.heldToWorld?.(pad, hp.x, hp.y);
    }
    const w = world.get(p, PointerWorld);
    return w === undefined ? undefined : [w.x, w.y];
  };
  /** The presses on a pad's roll this frame, by pointer: at rest core's recognizers on a roll part; in hand the pen's press, its part where it began. */
  const pressesNow = (): Map<Entity, { pad: Entity; part: RollPart; x: number; y: number }> => {
    const out = new Map<Entity, { pad: Entity; part: RollPart; x: number; y: number }>();
    world.query(partPressQ).each((b) => {
      for (const r of b) {
        const rec = b.entity(r);
        const part = world.read(rec, DownPart).part ?? "";
        const pad = world.getRelation(rec, Captures);
        const p = world.getRelations(rec, Watches)[0];
        if (!ROLL_PARTS.has(part) || pad === undefined || p === undefined || opts.isPad?.(pad) !== true) continue;
        if (((world.get(p, PointerButtons)?.buttons ?? 0) & 1) === 0 || out.has(p)) continue;
        const d = world.read(rec, Down);
        out.set(p, { pad, part: part as RollPart, x: d.x, y: d.y });
      }
    });
    const held = heldEntity(world);
    if (held !== undefined && opts.isPad?.(held) === true) {
      world.query(pointersQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          const pr = world.get(p, HeldPress);
          if (pr === undefined || pr.kind !== "tool" || ((world.get(p, PointerButtons)?.buttons ?? 0) & 1) === 0 || out.has(p)) continue;
          const known = hands.get(p);
          if (known !== undefined) { out.set(p, { pad: held, part: "moving", x: known.x0, y: known.y0 }); continue; }
          // where the press BEGAN (its screen point, through the hand's frame): a roll part starts a roll; the days are the DOM half's
          const h = opts.hand?.();
          const g = G(held);
          if (h === undefined || h.entity !== held || g === undefined) continue;
          const at = opts.heldToWorld?.(held, (pr.x - h.frame.cx) / h.frame.s, (pr.y - h.frame.cy) / h.frame.s);
          const part = at === undefined ? null : partAt(g, at[0], at[1], [], law);
          if (part !== null && ROLL_PARTS.has(part.part)) out.set(p, { pad: held, part: part.part as RollPart, x: pr.x, y: pr.y });
        }
      });
    }
    return out;
  };
  /** The hands on the pads' rolls: a press takes the sheet, the finger drags it, the release lets it decide. */
  const rollByHand = (pads: Pads, now: number): void => {
    const presses = pressesNow();
    for (const [p, pr] of presses) {
      const g = G(pr.pad);
      const at = deskOf(p, pr.pad);
      if (g === undefined || at === undefined) continue;
      const { sx, sy } = sheetPoint(g, at[0], at[1], law);
      const s = sy - F.T;
      const screen = world.get(p, PointerScreen);
      const moved = screen !== undefined && Math.hypot(screen.x - pr.x, screen.y - pr.y) > MOVED_PX;
      if (!hands.has(p)) {
        if (pads.grab(pr.pad, pr.part, sx, s, now)) hands.set(p, { pad: pr.pad, x0: pr.x, y0: pr.y });
        continue;
      }
      pads.dragTo(pr.pad, s, now, moved);
    }
    for (const [p, h] of [...hands]) if (!presses.has(p)) { pads.letGo(h.pad, now); hands.delete(p); }
  };
  /** The corner lifts under a pointer near the foot or the corner (not pressed): at rest the pick's part, in hand the pad's own. */
  const peekUnder = (pads: Pads): void => {
    const now = new Set<Entity>();
    const held = heldEntity(world);
    world.query(pointersQ).each((b) => {
      for (const r of b) {
        const p = b.entity(r);
        // (pressed or not: a pressed hand on the foot is a turn, and a turn lets the corner down itself)
        if (world.read(p, Pointer).device !== "mouse") continue;
        if (held !== undefined) {
          if (opts.isPad?.(held) !== true) continue;
          const at = deskOf(p, held);
          const g = G(held);
          const part = at === undefined || g === undefined ? null : partAt(g, at[0], at[1], [], law);
          if (part !== null && (part.part === "foot" || part.part === "corner")) now.add(held);
          continue;
        }
        const pad = world.getRelation(p, TouchesExact);
        const part = world.get(p, PointerPart)?.part ?? "";
        if (pad !== undefined && opts.isPad?.(pad) === true && (part === "foot" || part === "corner")) now.add(pad);
      }
    });
    for (const pad of now) pads.peek(pad, true);
    for (const pad of peeked) if (!now.has(pad)) pads.peek(pad, false);
    peeked = now;
  };
  /** A hand's finished roll: the document's month follows it — ONE transaction, off the undo stack; refused, the pad rolls back. */
  const commitRolls = (pads: Pads): void => {
    for (const { e, month } of pads.rolled()) {
      defer(() => {
        const session = docs.current();
        let ok = false;
        if (session !== undefined && world.isAlive(e)) {
          try { setWidgetProps(session.store, world, e, { month: monthKeyOf(month) }, { undoable: false }); ok = true; } catch { ok = false; }
        }
        if (!ok) pads.unroll(e);
      });
    }
  };
  const defer = opts.defer ?? ((fn: () => void) => queueMicrotask(fn));
  const blinkMs = opts.blinkMs ?? 530;
  const wipeMs = opts.wipeMs ?? 110;
  /** The pads marked last frame (a pad whose selection went is given back its bare sheet). */
  let marked = new Set<Entity>();
  /** Each pad's `home` as last seen: a bump is the bar's today. */
  const homes = new Map<Entity, number>();

  /** Roll a pad home and select today: its month (one transaction, off the undo stack) and its days. */
  const goHome = (pad: Entity): void => {
    const pads = opts.pads();
    if (pads === undefined) return;
    const today = pads.today();
    const key = keyOf(today);
    const month = monthKeyOf(monthOfDay(today));
    defer(() => {
      if (!world.isAlive(pad)) return;
      const cur = world.get(pad, PadSelection);
      if (cur !== undefined) world.edit(pad).set(PadSelection, { ...cur, anchor: key, focus: key, entry: 0 as Entity });
      const session = docs.current();
      if (session === undefined) return;
      try { setWidgetProps(session.store, world, pad, { month }, { undoable: false }); } catch { /* a read-only document keeps its month */ }
    });
  };

  return {
    follow(now) {
      const pads = opts.pads();
      if (pads === undefined) return;
      if (opts.isPad !== undefined) { rollByHand(pads, now); peekUnder(pads); }
      commitRolls(pads);
      const next = new Set<Entity>();
      const w = opts.writing.current();
      world.query(selectionsQ).each((b) => {
        for (const r of b) {
          const pad = b.entity(r);
          const sel = world.read(pad, PadSelection);
          const seen = homes.get(pad);
          if (sel.home !== (seen ?? 0)) goHome(pad);
          homes.set(pad, sel.home);
          const a = dayOr(sel.anchor ?? "");
          const f = dayOr(sel.focus ?? "");
          const entry = sel.entry as number;
          const marks: { -readonly [K in keyof PadMarks]: PadMarks[K] } = {};
          if (a !== undefined && f !== undefined) marks.days = [Math.min(a, f), Math.max(a, f)];
          if (entry !== 0 && world.isAlive(sel.entry)) marks.entry = entry;
          pads.mark(pad, Object.keys(marks).length > 0 ? marks : undefined);
          next.add(pad);
        }
      });
      // the line being written: its caret (the blink on the hand's clock), its newest glyph's wipe
      if (w !== null) {
        const id = w.draft !== null ? DRAFT_ID : ((w.entry as number | null) ?? DRAFT_ID);
        const c = opts.caret();
        const base = pads.marksOf(w.pad) ?? {};
        const on = c === null ? true : Math.floor(Math.max(0, now - c.t0) / blinkMs) % 2 === 0;
        const wipe = c?.wipe !== null && c?.wipe !== undefined && now - c.wipe.t0 < wipeMs ? { entry: id, index: c.wipe.index, t: Math.max(0, (now - c.wipe.t0) / wipeMs) } : undefined;
        const { days: _days, ...rest } = base;
        pads.mark(w.pad, { ...rest, entry: id, writing: { entry: id, index: c?.index ?? w.draft?.text.length ?? 0, on }, ...(wipe !== undefined ? { wipe } : {}) });
        next.add(w.pad);
      }
      for (const pad of marked) if (!next.has(pad)) pads.mark(pad, undefined);
      marked = next;
      for (const pad of [...homes.keys()]) if (!world.isAlive(pad) || !world.has(pad, PadSelection)) homes.delete(pad);
    },
  };
}
