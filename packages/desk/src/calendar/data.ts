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
// D3t-c writes both: the pen's sessions spawn and edit events (objects/calendar-writing.ts), the hand sticks and unsticks
// notes (objects/calendar-hand.ts); here the model, its transactions for a test or an agent, where a pinned note lies
// (`daySlot` — the lab's `slotOf`), an event as the print takes it (`calEventOf`) and the user's selection on a pad
// (`PadSelection`, runtime). The pin's edge is DEPENDENT: a pin dies with its note.

import { ChildOf, defineComponent, definePrefab, defineRelation, type Entity, field, type GuardedTx, init, type World } from "@ice/core";
import { decodeSeeds } from "../kit/seeds";
import type { CalEvent } from "./events";
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
/**
 * pin → the note it holds (a reified edge: the day is the pin's cell). DEPENDENT (D3t-c — core's `defineRelation({ dependent })`):
 * the pin dies with its note in the same transaction (a stuck note deleted leaves no pin behind; one ⌘Z brings both back).
 */
export const PinsNote = defineRelation("desk.pins", { arity: "one", dependent: true });

/** The notes stuck to a pad, with their days (its pins' edges) — what rides with it, what goes with its months. */
export function pinnedNotes(world: World, pad: Entity): { readonly pin: Entity; readonly note: Entity; readonly day: string }[] {
  if (!world.isAlive(pad)) return [];
  const out: { pin: Entity; note: Entity; day: string }[] = [];
  for (const k of world.getReverse(pad, ChildOf)) {
    const p = world.get(k, NotePin);
    if (p === undefined) continue;
    const note = world.getRelation(k, PinsNote);
    if (note !== undefined && world.isAlive(note)) out.push({ pin: k, note, day: p.day ?? "" });
  }
  return out;
}
export const PIN_TYPE = "desk.pin";
export const PinPrefab = definePrefab(PIN_TYPE, {
  store: "durable",
  version: 1,
  components: [init(NotePin, { day: "" })],
  relations: [ChildOf, PinsNote],
});

/**
 * Runtime, on a pad: the USER's selection on it (D3t-c) — a run of days (`anchor` … `focus`, day keys; "" none) or one entry
 * (`entry`, an event child; 0 none) — and `home`, bumped by the held bar's today (the hand then rolls home and selects today).
 * The user's fact, as `Selected` is: never in the document, a peer's selection its own. Its writers: the calendar's hand
 * (objects/calendar-hand.ts, host/calendar-input.ts) and the today tool's bump.
 */
export const PadSelection = defineComponent("desk.padSelection", {
  anchor: field("string", { default: "" }),
  focus: field("string", { default: "" }),
  entry: field("eid", { default: 0 as Entity }),
  home: field("u32", { default: 0 }),
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

/** A month index as its key ("2026-09"). */
export function monthKeyOf(m: number): string {
  const y = Math.floor(m / 12);
  return `${y}-${String(m - y * 12 + 1).padStart(2, "0")}`;
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

/** An event's cell as a reader takes it (a tolerant reader: a string field strata hands back as null reads as its default). */
export interface EventRow {
  readonly start: string | null;
  readonly end: string | null;
  readonly text: string | null;
  readonly seeds: string | null;
  readonly ink: string | null;
}

/** A day key's day number, or undefined when it is not one (YYYY-MM-DD, a real day). */
export function dayOr(key: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined;
  const n = dayOfKey(key);
  return keyOf(n) === key ? n : undefined;
}

/** A string's 32-bit FNV-1a, as a number (an entry's own seed, its content's key). */
function fnv32(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h | 0;
}

/**
 * An event entity as the PRINT takes it (calendar/events.ts `CalEvent`, the prototype's): its days as day numbers, its text and
 * its hand's seeds decoded, and two numbers the prototype kept on the event and the world does not (D-D3t-c.2): its own `seed`
 * — the band's wobble, the hand of a glyph with no stored seed — made from what the entry IS (its days and its ink, so it holds
 * still while the entry is written), identical on every peer; and its `rev`, a hash of its whole cell (a cell edited redraws
 * the tiles over it). Null for a cell whose days are not days.
 */
export function calEventOf(entity: Entity, row: EventRow): CalEvent | null {
  const startKey = row.start ?? "";
  const start = dayOr(startKey);
  const end = dayOr(row.end === null || row.end === "" ? startKey : row.end);
  if (start === undefined || end === undefined) return null;
  const text = row.text ?? "";
  const ink = row.ink ?? "felt";
  const stored = row.seeds ?? "";
  return {
    id: entity as number, start: Math.min(start, end), end: Math.max(start, end), text, seeds: decodeSeeds(stored),
    seed: fnv32(`${startKey}|${row.end ?? ""}|${ink}`), ink, rev: fnv32(`${text}\u0000${stored}\u0000${ink}\u0000${startKey}\u0000${row.end ?? ""}`) >>> 0,
  };
}
