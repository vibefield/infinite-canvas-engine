// The desk calendar's DATA (design-015 §5.1, D-D5; D3w) — what is written on a pad and what is stuck to it are
// ENTITIES, durable children of the pad (`ChildOf`, never members of the desk's paint order):
//
// - an EVENT `desk.event { start, end, text, seeds, ink }` — a line on a day, or a band across a run of days: its
//   first and last day as ISO day keys (YYYY-MM-DD, legible to an agent — the prototype held day numbers), its
//   writing and its hand's seeds (the note's encoding, D-D2c.2: base64 LE u32 per UTF-16 unit), and its ink by name
//   (a pen for a line, a highlighter for a band — the prototype's `CalEvent.ink`; the colours are the host's);
// - a PIN `desk.pin { day }` — a note stuck to a day: a child of the pad with a durable relation `desk.pins` to the
//   note (a reified edge, the wire's precedent: strata's relations carry no data, and the day is the pin's).
//
// Both are READ-ONLY in this slice: the pad's print (the tiles, a Canvas 2D raster of its events) and the hand
// that writes, sticks and unsticks are D3t's; here the model, its transactions for a test or an agent, and where
// a pinned note lies (`daySlot` — the lab's `slotOf`).

import { ChildOf, defineComponent, definePrefab, defineRelation, type Entity, field, type GuardedTx, init } from "@ice/core";
import { CALENDAR, type CalendarLaw } from "./law";
import { dayOfKey, keyOf, monthGrid, monthOfDay } from "./month";
import { padFrame } from "./pad";
import { noteSlot, sheetOf } from "./sheet";

/** A pad's event: a line on a day or a band across days (`start` … `end`, inclusive ISO day keys). */
export const CalendarEvent = defineComponent("desk.event", {
  start: field("string", { default: "" }),
  end: field("string", { default: "" }),
  text: field("string", { default: "" }),
  seeds: field("string", { default: "" }),
  ink: field("string", { default: "felt" }),
});
export const EVENT_TYPE = "desk.event";
export const EventPrefab = definePrefab(EVENT_TYPE, {
  store: "durable",
  version: 1,
  components: [init(CalendarEvent, { start: "", end: "", text: "", seeds: "", ink: "felt" })],
  relations: [ChildOf],
});

/** A note stuck to a day of a pad: the pin's day (ISO key); its note by the `PinsNote` edge. */
export const NotePin = defineComponent("desk.pin", { day: field("string", { default: "" }) });
/** pin → the note it holds (a reified edge: the day is the pin's cell). */
export const PinsNote = defineRelation("desk.pins", { arity: "one" });
export const PIN_TYPE = "desk.pin";
export const PinPrefab = definePrefab(PIN_TYPE, {
  store: "durable",
  version: 1,
  components: [init(NotePin, { day: "" })],
  relations: [ChildOf, PinsNote],
});

/** An event as an author states one. */
export interface EventSpec {
  readonly start: string;
  readonly end?: string;
  readonly text?: string;
  readonly seeds?: string;
  readonly ink?: string;
}

/** Write an event on a pad — one entity, the pad's newest child — inside the caller's transaction. */
export function addEvent(tx: GuardedTx, pad: Entity, s: EventSpec): Entity {
  const e = tx.spawnPrefab(EventPrefab, [init(CalendarEvent, { start: s.start, end: s.end ?? s.start, text: s.text ?? "", seeds: s.seeds ?? "", ink: s.ink ?? "felt" })]);
  tx.setRelation(e, ChildOf, pad);
  return e;
}

/** Stick a note to a day of a pad — the pin a child of the pad, its edge to the note — inside the caller's transaction. */
export function pinNote(tx: GuardedTx, pad: Entity, note: Entity, day: string): Entity {
  const e = tx.spawnPrefab(PinPrefab, [init(NotePin, { day })]);
  tx.setRelation(e, ChildOf, pad);
  tx.setRelation(e, PinsNote, note);
  return e;
}

/** A month key (YYYY-MM) as the law's month index; undefined when it is not one. */
export function monthOfKey(key: string): number | undefined {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m === null) return undefined;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? Number(m[1]) * 12 + (month - 1) : undefined;
}

/**
 * Where a note stuck to `day` lies on a pad centred at (cx, cy) — its day's slot on the month that day is in (the
 * lab's `slotOf`; the oracle's `pinnedAt`), world units. Throws for a day off its month's sheet.
 */
export function daySlot(cx: number, cy: number, day: string, weekStart: 0 | 1 = 1, law: CalendarLaw = CALENDAR): { readonly x: number; readonly y: number } {
  const F = padFrame(law);
  const n = dayOfKey(day);
  if (!Number.isFinite(n) || keyOf(n) !== day) throw new Error(`desk/calendar: "${day}" is not a day (YYYY-MM-DD)`);
  const L = sheetOf(monthGrid(monthOfDay(n), weekStart), law);
  const k = n - L.grid.first;
  if (k < 0 || k >= L.rows * 7) throw new Error(`desk/calendar: ${day} is not on its month's sheet`);
  const s = noteSlot(L, Math.floor(k / 7), k % 7, law);
  return { x: cx - F.W / 2 + s.x, y: cy - F.H / 2 + s.y };
}
