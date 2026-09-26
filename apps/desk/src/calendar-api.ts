// `window.__desk.calendar` — the desk calendar's door for the rigs (D3t-c; the prototype's `__ground.calendar`): write an
// entry as its data child (one undoable transaction — what the pen's session commits), a pad's entries as the print takes them,
// the print as the last frame laid it (where each line landed), the tiles' counters, today pinned for a still, a live sheet
// read back as a fixture holds it. Reads the world and the calendar kind's own state; writes only the transactions an op would.

import { type CanvasEngine, ChildOf, defineQuery, type Entity, guardedTransaction, LocalPointer, Pointer, PointerPart, TouchesExact } from "@ice/core";
import type { CalendarGeometry, DeskLayerHandle, Pads } from "@ice/desk";
import { sheetDayBox, sheetOnScreen } from "@ice/desk";
import { addEvent, CalendarEvent, dayOr, keyOfDay, monthKeyOf, monthOfKey, PadSelection, pinnedNotes } from "@ice/desk/objects";

export interface CalendarApi {
  /** Write an entry on pad `pad` — ONE undoable transaction; its entity id. */
  write(pad: number, start: string, end: string, text: string, ink?: string): number;
  /** An entry's own cell as the document holds it: its pad (the `ChildOf` parent), its text, the hand's seeds as stored (base64, a u32 a UTF-16 unit), its ink; null when gone. */
  inkOf(event: number): { readonly parent: number; readonly text: string; readonly seeds: string; readonly ink: string } | null;
  /** A pad's entries as the print takes them: id, days (keys), text, ink. */
  entries(pad: number): readonly { readonly id: number; readonly start: number; readonly end: number; readonly text: string; readonly ink: string }[];
  /** Month `month` (YYYY-MM)'s print on a pad as the last frame laid it: each line's entry, day and box (sheet units). */
  lines(pad: number, month: string): readonly { readonly entry: number; readonly day: number; readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }; readonly band: boolean }[] | null;
  /** Pin today (a day key) — null gives it back to the clock. */
  pinToday(key: string | null): void;
  /** The print's tiles: resident, still to draw, drawn since the desk began. */
  tiles(): { readonly resident: number; readonly pending: number; readonly drawn: number } | null;
  /** A live sheet read back as a fixture holds it: level `level`'s tiles as base64 RGBA by `tx:ty`, and the empty ones. */
  readSheet(pad: number, month: string, level: number): { readonly tiles: Readonly<Record<string, string>>; readonly empty: readonly string[] } | null;
  /** A pad's selection as the world holds it (the user's fact): the days (keys), the entry, today's asks. */
  selection(pad: number): { readonly anchor: string; readonly focus: string; readonly entry: number; readonly home: number } | null;
  /** What the hand marks on a pad this frame (the kind's local): days, entry, the line written, its caret. */
  marks(pad: number): unknown;
  /** The line being written: its pad, its entry (0 = the draft), the draft's text, the text as it stands; null when none. */
  writing(): { readonly pad: number; readonly entry: number; readonly draft: string | null; readonly text: string; readonly open: boolean; readonly commits: number } | null;
  /** A sheet point (x from its left, y from its head) of a pad on the screen, CSS px, through the eye it was drawn with. */
  screenOf(pad: number, sx: number, sy: number): readonly [number, number] | null;
  /** A day's cell on the month a pad shows (sheet units), or null. */
  dayBox(pad: number, day: string): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  /** What a client point lands on — the pad and its part (day, entry, foot, …) — as a click reads it. */
  partAt(x: number, y: number): { readonly pad: number; readonly part: string; readonly day: string | null; readonly entry: number | null } | null;
  /** A pad's turning (the kind's local): the month laid bare (YYYY-MM), the turn in flight, the corner's lift, a hand's roll pending. */
  roll(pad: number): { readonly shown: string | null; readonly turn: { readonly dir: 1 | -1; readonly p: number; readonly target: 0 | 1; readonly held: boolean; readonly hand: boolean } | null; readonly peek: number; readonly pending: string | null } | null;
  /** The notes stuck to a pad: each pin's note, its day, whether the pad's month shows it (not veiled). */
  pins(pad: number): readonly { readonly pin: number; readonly note: number; readonly day: string; readonly veiled: boolean }[];
  /** The mouse pointer as the interaction stack sees it: what it touches exactly and the part there (a pad's foot, its corner). */
  hover(): { readonly touches: number; readonly part: string } | null;
  /** The editor's state: lent to the calendar, focused, its value. */
  editor(): { readonly lent: boolean; readonly focused: boolean; readonly value: string; readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null };
}

const mouseQ = defineQuery([Pointer, LocalPointer]);
const b64 = (bytes: Uint8Array): string => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };

export function calendarApi(engine: CanvasEngine, handle: DeskLayerHandle): CalendarApi {
  const { world } = engine;
  const pads = (): Pads | undefined => handle.local("calendar") as Pads | undefined;
  const monthOf = (key: string): number => { const m = monthOfKey(key); if (m === undefined) throw new Error(`desk: "${key}" is not a month (YYYY-MM)`); return m; };
  return {
    write(pad, start, end, text, ink) {
      const session = engine.docs.current();
      if (session === undefined) throw new Error("desk: no document");
      let e: Entity | undefined;
      guardedTransaction(session.store, world, (tx) => { e = addEvent(tx, pad as Entity, { start, end, text, ...(ink !== undefined ? { ink } : {}) }); });
      return (e ?? 0) as number;
    },
    inkOf(event) {
      const c = world.isAlive(event as Entity) ? world.get(event as Entity, CalendarEvent) : undefined;
      if (c === undefined) return null;
      return { parent: (world.getRelation(event as Entity, ChildOf) ?? 0) as number, text: c.text ?? "", seeds: c.seeds ?? "", ink: c.ink ?? "" };
    },
    entries: (pad) => (pads()?.entries(pad as Entity) ?? []).map((e) => ({ id: e.id, start: e.start, end: e.end, text: e.text, ink: e.ink })),
    lines(pad, month) {
      const p = pads()?.printOf(pad as Entity, monthOf(month));
      if (p === undefined) return null;
      return p.lines.map((l) => ({ entry: l.event.id, day: l.day, box: { x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h }, band: l.band }));
    },
    pinToday(key) { pads()?.pinToday(key); handle.desk.wake("pin"); },
    tiles: () => pads()?.tiles() ?? null,
    selection(pad) {
      const s = world.isAlive(pad as Entity) ? world.get(pad as Entity, PadSelection) : undefined;
      return s === undefined ? null : { anchor: s.anchor ?? "", focus: s.focus ?? "", entry: s.entry as number, home: s.home ?? 0 };
    },
    marks: (pad) => pads()?.marksOf(pad as Entity) ?? null,
    writing() {
      const c = handle.calendar();
      const w = c?.writing.current();
      if (c === undefined || w === undefined || w === null) return null;
      return { pad: w.pad as number, entry: (w.entry ?? 0) as number, draft: w.draft?.text ?? null, text: c.writing.text(), open: c.writing.open(), commits: c.writing.commits() };
    },
    screenOf(pad, sx, sy) { const G = handle.geometryOf(pad as Entity) as CalendarGeometry | undefined; return G === undefined ? null : sheetOnScreen(G, sx, sy); },
    dayBox(pad, day) {
      const G = handle.geometryOf(pad as Entity) as CalendarGeometry | undefined;
      const n = dayOr(day);
      if (G === undefined || n === undefined) return null;
      const b = sheetDayBox(G, n);
      return b === null ? null : { x: b.x, y: b.y, w: b.w, h: b.h };
    },
    partAt(x, y) {
      const r = handle.calendar()?.input.partAtClient(x, y) ?? null;
      if (r === null) return null;
      return { pad: r.pad as number, part: r.part.part, day: r.part.day !== undefined ? keyOfDay(r.part.day) : null, entry: r.part.line?.event.id ?? null };
    },
    roll(pad) {
      const r = pads()?.rollOf(pad as Entity);
      if (r === undefined) return null;
      return { shown: r.shown === null ? null : monthKeyOf(r.shown), turn: r.turn === null ? null : { ...r.turn }, peek: r.peek, pending: r.pending === null ? null : monthKeyOf(r.pending) };
    },
    pins: (pad) => pinnedNotes(world, pad as Entity).map((p) => ({ pin: p.pin as number, note: p.note as number, day: p.day, veiled: handle.builder.veiled(p.note) })),
    hover() {
      let out: { touches: number; part: string } | null = null;
      world.query(mouseQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (world.read(p, Pointer).device !== "mouse") continue;
          out = { touches: (world.getRelation(p, TouchesExact) ?? 0) as number, part: world.get(p, PointerPart)?.part ?? "" };
        }
      });
      return out;
    },
    editor() {
      const ed = handle.editor();
      const el = ed?.element;
      if (el === undefined || ed === undefined) return { lent: false, focused: false, value: "", rect: null };
      const rc = el.hidden ? null : el.getBoundingClientRect();
      return { lent: ed.lease() !== undefined, focused: document.activeElement === el, value: el.value, rect: rc === null ? null : { x: rc.x, y: rc.y, w: rc.width, h: rc.height } };
    },
    readSheet(pad, month, level) {
      const r = pads()?.readSheet(pad as Entity, monthOf(month), level);
      if (r === undefined) return null;
      const tiles: Record<string, string> = {};
      for (const [k, v] of r.tiles) tiles[k] = b64(v);
      return { tiles, empty: [...r.empty] };
    },
  };
}
