// THE DESK CALENDAR AT WORK — its hand (CALENDAR.md §5; D3t-c): the world half of the calendar's interaction, the whiteboard pen's
// sibling (objects/pen.ts). Once a frame, before the kinds' clocks, it READS the world — each pad's selection (`PadSelection`, the
// user's fact), the entry being written (objects/calendar-writing.ts) and the editor's caret (host/calendar-input.ts) — and hands
// the calendar kind's local what to MARK on each pad this frame (`Pads.mark`: the days selected, the entry, the caret's blink, the
// newest glyph's wipe). It WRITES only as an op would, each out of the frame (a reflector never writes — D-D2c.5): the bar's today
// (`home` bumped) rolls the pad home — its month, ONE transaction, off the undo stack (D-D3t-c.5) — and selects today.

import { Active, Captures, ChildOf, type CommitIntent, defineQuery, Down, DownPart, type Entity, Grab, type GuardedTx, heldEntity, HeldPointer, HeldPress, LocalPointer, Pointer, PointerButtons, PointerPart, PointerScreen, PointerWorld, Position, PrefabId, setWidgetProps, Size, TouchesExact, TransformTween, Watches, type World } from "@ice/core";
import { dayOr, daySlot, monthKeyOf, NotePin, PadSelection, pinNote, PinsNote } from "../calendar/data";
import { CALENDAR, type CalendarLaw } from "../calendar/law";
import { keyOf, monthOfDay } from "../calendar/month";
import { padFrame } from "../calendar/pad";
import { type CalendarGeometry, DRAFT_ID, type PadMarks, type Pads, partAt, sheetPoint } from "../kinds/calendar";
import type { CalendarWriting } from "./calendar-writing";
import { type TypingDocs, writable } from "./typing";

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
  /** Is this entity a sticky note (it may be stuck to a day)? Absent: nothing sticks. */
  readonly isNote?: (e: Entity) => boolean;
  /** The glide into a day's slot, ms (the prototype's 3.2 Hz spring, as a tween). */
  readonly glideMs?: number;
  readonly law?: CalendarLaw;
}

export interface CalendarHand {
  /** Once a frame, before the kinds' clocks: the marks on every pad; the bar's today acted on. */
  follow(now: number): void;
  /** Nothing to follow (D7 #14): no pad on the desk, nothing in hand, no press, no selection, no note carried, no glide owed. */
  idle(): boolean;
  /** Leave the document's commit door (the landing's extender). */
  dispose(): void;
}

const selectionsQ = defineQuery([PadSelection]);
/** The objects being carried (core's move rider). */
const grabbedQ = defineQuery([Grab, Position, Size]);
/** The frame's objects (the pads a note may be dropped on). */
const framedQ = defineQuery([PrefabId, Position, Size, Active]);
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
  // ---- the notes stuck to days
  const glideMs = opts.glideMs ?? 320;
  /** The pin holding a note: the pin, its pad, its day (a note is stuck to one day at most). */
  const pinOf = (note: Entity): { readonly pin: Entity; readonly pad: Entity; readonly day: string } | undefined => {
    for (const pin of world.getReverse(note, PinsNote)) {
      const pad = world.getRelation(pin, ChildOf);
      const v = world.get(pin, NotePin);
      if (pad !== undefined && v !== undefined) return { pin, pad, day: v.day ?? "" };
    }
    return undefined;
  };
  /** The pad and the day a note's centre is over — a day of the month laid bare, on a pad at rest (the prototype's `dropTarget`). */
  const dropTarget = (note: Entity): { readonly pad: Entity; readonly day: number } | undefined => {
    const p = world.get(note, Position);
    const z = world.get(note, Size);
    if (p === undefined || z === undefined) return undefined;
    return dropTargetAt(note, p.x + z.w / 2, p.y + z.h / 2);
  };
  /** The pad and the day a point (a note's centre) is over — a day of the month laid bare, on a pad at rest. */
  const dropTargetAt = (note: Entity, cx: number, cy: number): { readonly pad: Entity; readonly day: number } | undefined => {
    let best: { pad: Entity; day: number } | undefined;
    world.query(framedQ).each((b) => {
      for (const r of b) {
        const pad = b.entity(r);
        if (pad === note || opts.isPad?.(pad) !== true || world.has(pad, Grab)) continue;
        const g = G(pad);
        if (g === undefined || g.turning) continue;
        const part = partAt(g, cx, cy, [], law);
        if (part === null || part.day === undefined || monthOfDay(part.day) !== g.shown) continue;
        best = { pad, day: part.day };
      }
    });
    return best;
  };
  /** The notes carried by themselves this frame (not riding their carried pad) and the day each would stick to, shown on its pad. */
  const dropMarks = (): Map<Entity, number> => {
    const drops = new Map<Entity, number>();
    if (opts.isNote === undefined) return drops;
    world.query(grabbedQ).each((b) => {
      for (const r of b) {
        const note = b.entity(r);
        if (!opts.isNote?.(note)) continue;
        const held = pinOf(note);
        if (held !== undefined && world.has(held.pad, Grab)) continue;   // riding its carried pad: it goes where the pad goes
        const t = dropTarget(note);
        if (t !== undefined) drops.set(t.pad, t.day);
      }
    });
    return drops;
  };
  /** The glides owed after a landing: the note drawn from where it was let go while the document already holds its slot. */
  const glides: { readonly note: Entity; readonly from: { readonly x: number; readonly y: number }; readonly to: { readonly x: number; readonly y: number } }[] = [];
  /**
   * THE LANDING (D7 #2): core's move intent for a note, inside ITS transaction (the facade's `extendCommits`) — let go over a day
   * of a month laid bare, the note is STUCK: its old pin (if any) destroyed, its pin on the day, the note at the day's slot; let go
   * over no day (or consumed into a container), UNSTUCK: its pin destroyed. Nothing is written while the note is carried: Esc
   * restores the note and commits nothing, so the pin outlives a cancelled carry; and the whole drop — the move, the pins, the
   * slot — is ONE undo step. A note riding its carried pad is the pad's move to carry (core's riders), not this hand's.
   */
  const landing = (intent: CommitIntent, tx: GuardedTx): void => {
    if (opts.isNote === undefined || (intent.kind !== "move" && intent.kind !== "consume")) return;
    for (const w of intent.writes) {
      if (w.component !== Position || !opts.isNote(w.entity) || !world.isAlive(w.entity)) continue;
      const note = w.entity;
      const held = pinOf(note);
      if (held !== undefined && world.has(held.pad, Grab)) continue;
      const at = w.value as { readonly x: number; readonly y: number };
      const z = world.get(note, Size);
      const t = intent.kind === "move" && z !== undefined ? dropTargetAt(note, at.x + z.w / 2, at.y + z.h / 2) : undefined;
      if (t === undefined) {
        if (held !== undefined && world.isAlive(held.pin)) tx.destroy(held.pin);
        continue;
      }
      const day = keyOf(t.day);
      if (held !== undefined && held.pad === t.pad && held.day === day) continue;   // let go on its own day: nothing to do
      const pp = world.get(t.pad, Position);
      const pz = world.get(t.pad, Size);
      if (pp === undefined || pz === undefined || z === undefined) continue;
      const weekStart = (((G(t.pad)?.weekStart) ?? 1) === 0 ? 0 : 1) as 0 | 1;
      let slot: { x: number; y: number };
      try { slot = daySlot(pp.x + pz.w / 2, pp.y + pz.h / 2, day, weekStart, law); } catch { continue; }
      const to = { x: slot.x - z.w / 2, y: slot.y - z.h / 2 };
      if (held !== undefined && world.isAlive(held.pin)) tx.destroy(held.pin);
      pinNote(tx, t.pad, note, day);
      tx.edit(note).set(Position, to);
      if (glideMs > 0 && (at.x !== to.x || at.y !== to.y)) glides.push({ note, from: { x: at.x, y: at.y }, to });
    }
    if (glides.length > 0) defer(glide);
  };
  /** After the landing's transaction: the note is drawn from where it was let go, a tween being its claim (ops.arrange's way). */
  const glide = (): void => {
    const session = writable(docs);
    for (const g of glides.splice(0)) {
      if (session === undefined || !world.isAlive(g.note)) continue;
      world.addComponent(g.note, TransformTween, { toX: g.to.x, toY: g.to.y, durationMs: glideMs, elapsedMs: 0 });
      session.liveWriter.set(g.note, Position, g.from);
    }
  };
  const leaveDoor = docs.extendCommits?.(landing);

  /**
   * A hand's finished roll: the document's month follows it — ONE transaction, off the undo stack; refused, the pad rolls back
   * to the document's month. The pad's hold on the month (`pending`) is NOT released here on a landed commit (D7 #3, corrected by
   * gate:landing): the kinds' `tick` runs before the draw path refreshes the roll's `durable`, so a release at the commit left one
   * frame in which the target fell back to the OLD month and a turn back began (the part under the tape read `moving`). The
   * release is the roll's own (calendar/turn.ts): the document SPEAKS — its month moves, to the hand's or, a race lost, to a
   * peer's — and the hold ends; a landed month moves it at the next sync, a lost race moves it at least once either way.
   */
  const commitRolls = (pads: Pads): void => {
    for (const { e, month } of pads.rolled()) {
      defer(() => {
        const session = writable(docs);
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
      const session = writable(docs);
      if (session === undefined) return;
      try { setWidgetProps(session.store, world, pad, { month }, { undoable: false }); } catch { /* refused (the prop's schema, the guard): the month stays */ }
    });
  };

  return {
    follow(now) {
      const pads = opts.pads();
      if (pads === undefined) return;
      if (opts.isPad !== undefined) { rollByHand(pads, now); peekUnder(pads); }
      commitRolls(pads);
      const drops = dropMarks();
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
          const drop = drops.get(pad);
          if (drop !== undefined) { marks.drop = drop; drops.delete(pad); }
          pads.mark(pad, Object.keys(marks).length > 0 ? marks : undefined);
          next.add(pad);
        }
      });
      // a note carried over a pad with no selection: the day it would stick to
      for (const [pad, day] of drops) { pads.mark(pad, { drop: day }); next.add(pad); }
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
    idle() {
      if (heldEntity(world) !== undefined || hands.size > 0 || peeked.size > 0 || marked.size > 0 || homes.size > 0 || glides.length > 0) return false;
      if (opts.pads()?.busy() === true) return false;
      if (world.firstOf(selectionsQ) !== undefined || world.firstOf(grabbedQ) !== undefined) return false;
      let pressed = false;
      world.query(pointersQ).each((b) => { for (const r of b) if (((world.get(b.entity(r), PointerButtons)?.buttons ?? 0) & 1) !== 0) pressed = true; });
      return !pressed;
    },
    dispose() {
      leaveDoor?.();
      glides.length = 0;
    },
  };
}
