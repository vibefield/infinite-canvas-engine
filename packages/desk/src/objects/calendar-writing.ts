// WRITING ON THE CALENDAR IS A GESTURE (CALENDAR.md §5; design-015 §6.1; D3t-c) — an entry's text through the note's text stack:
// the ONE editor (host/editor.ts, lent to the calendar), typing as a gesture (objects/typing.ts's law, on an event's cell). The
// world half, as typing.ts is the note's:
//
// - an EXISTING entry: `beginEntry` stamps the runtime `Editing` claim on its EVENT entity — core's `makeDefaultMayDiverge` reads it
//   as a gesture claim — so its cell (`desk.event` — the days, the text, the hand's seeds, the ink: ONE cell, text and seeds one
//   conflict group by construction, D-D3t-c.1) is written LIVE through the guarded live writer on every keystroke, the seeds
//   carried (`carrySeeds`); the SESSION's end (`commit` — the editor's: ⏎, blur, 1 s without input) is ONE undoable transaction,
//   unless it nets to nothing (the text and the hand as the session found them: no transaction, the cell put back exactly); an entry
//   written down to nothing is taken off the pad in that one transaction;
// - a NEW line is a DRAFT (D-D3t-c.4): the calendar's own state (the kind's local prints it), never an empty entity in the document
//   — its session's end SPAWNS it, text and seeds and days and ink, as ONE transaction (`addEvent`), and the writing goes on on the
//   entity it became; a draft that nets to nothing spawns nothing.
//
// `cancel` (the editor's Esc — "esc takes it back", CALENDAR.md §5) puts the session back: a draft gone, an entry's cell as the
// session found it, no transaction. ⌘Z undoes a SESSION, never a keystroke. Collaboration is strata's claimed-cell rule, as a note's.

import { type DocSession, Editing, type Entity, guardedTransaction, type World } from "@ice/core";
import { addEvent, CalendarEvent, type EventRow } from "../calendar/data";
import { keyOf } from "../calendar/month";
import type { PadDraft, Pads } from "../kinds/calendar";
import { decodeSeeds, encodeSeeds, freshSeed } from "../kit/seeds";
import { carrySeeds } from "../kit/text";
import { type TypingDocs, writable } from "../docs";

export interface CalendarWritingOptions {
  readonly world: World;
  readonly docs: TypingDocs;
  /** The calendar kind's state on this desk (the draft is printed through it). */
  readonly pads: () => Pads | undefined;
  /** A fresh seed for a glyph just written (`Math.random` unless a test says). */
  readonly fresh?: () => number;
}

/** What is being written: its pad, and the entry (an event entity) or the draft (a new line not yet in the document). */
export interface WritingTarget {
  readonly pad: Entity;
  readonly entry: Entity | null;
  readonly draft: PadDraft | null;
}

export interface CalendarWriting {
  current(): WritingTarget | null;
  /** A NEW line on days `start` … `end` of `pad`, in `ink` — a draft until its session ends. False for a dead pad. */
  beginNew(pad: Entity, start: number, end: number, ink: string): boolean;
  /** Write into an existing entry (the `Editing` claim on it). False for a dead entry or one not of `pad`. */
  beginEntry(pad: Entity, entry: Entity): boolean;
  /** The platform's value (a line: a newline is a space): the draft's text, or the entry's cell written LIVE; the inserted run, or null. */
  input(value: string): { readonly from: number; readonly to: number } | null;
  /** The text as it stands (the draft's, or the entry's live cell). */
  text(): string;
  /** A session is open: text written and not yet committed. */
  open(): boolean;
  /** End the SESSION — ONE transaction (the draft spawned, the cell committed, an emptied entry removed) or none; the writing stays on. */
  commit(): boolean;
  /** Take the session back — a draft gone, an entry's cell as found — and end the writing. */
  cancel(): void;
  /** End the writing: commit, then lift the claim. */
  end(): void;
  /** Transactions committed since creation (a rig's witness). */
  commits(): number;
}

type Cell = { readonly start: string; readonly end: string; readonly text: string; readonly seeds: string; readonly ink: string };

const cellOf = (row: EventRow | undefined): Cell | undefined => (row === undefined ? undefined : { start: row.start ?? "", end: row.end ?? "", text: row.text ?? "", seeds: row.seeds ?? "", ink: row.ink ?? "felt" });
/** A line of writing: no newlines (a paste's become spaces). */
const oneLine = (v: string): string => v.replace(/\r?\n/g, " ");

export function createCalendarWriting(opts: CalendarWritingOptions): CalendarWriting {
  const { world, docs } = opts;
  const fresh = opts.fresh ?? freshSeed;
  let target: { pad: Entity; entry: Entity | null; draft: PadDraft | null } | null = null;
  /** The entry's cell as the session found it (before its first live write). */
  let start: Cell | undefined;
  let open = false;
  let commits = 0;

  const alive = (e: Entity | null | undefined): e is Entity => e !== null && e !== undefined && world.isAlive(e);
  const read = (e: Entity): Cell | undefined => cellOf(world.get(e, CalendarEvent) as EventRow | undefined);
  const live = (session: Pick<DocSession, "store" | "liveWriter"> | undefined, e: Entity, c: Cell): void => {
    if (session !== undefined) session.liveWriter.set(e, CalendarEvent, { ...c });
    else world.edit(e).set(CalendarEvent, { ...c });
  };
  const setDraft = (d: PadDraft | null): void => { if (target !== null) { target.draft = d; opts.pads()?.draft(target.pad, d); } };
  const lift = (e: Entity | null): void => { if (alive(e) && world.hasTag(e, Editing)) world.removeTag(e, Editing); };

  const commit = (): boolean => {
    const t = target;
    if (t === null || !open) return false;
    open = false;
    const session = writable(docs);
    if (t.draft !== null) {
      // a NEW line: spawned now, whole — or nothing, if nothing was written
      const d = t.draft;
      if (d.text.trim().length === 0 || session === undefined || !alive(t.pad)) { setDraft(null); return false; }
      let made: Entity | undefined;
      try {
        guardedTransaction(session.store, world, (tx) => { made = addEvent(tx, t.pad, { start: keyOf(d.start), end: keyOf(d.end), text: d.text, seeds: encodeSeeds(d.seeds), ink: d.ink }); });
      } catch { made = undefined; }
      setDraft(null);
      if (made === undefined || !world.isAlive(made)) { t.entry = null; return false; }
      commits += 1;
      // the writing goes on, on the entry it became
      t.entry = made;
      world.addTag(made, Editing);
      start = undefined;
      return true;
    }
    const e = t.entry;
    const from = start;
    start = undefined;
    if (!alive(e) || session === undefined) return false;
    const cur = read(e);
    if (cur === undefined) return false;
    // NETS TO NOTHING — the text and the hand as the session found them: no transaction, the cell put back exactly
    if (from !== undefined && from.text === cur.text && from.seeds === cur.seeds) return false;
    if (from !== undefined && from.text === cur.text) { live(session, e, from); return false; }
    try {
      guardedTransaction(session.store, world, (tx) => {
        // an entry written down to nothing leaves the pad (the prototype's `commit`: "kept if anything was written, gone if not")
        if (cur.text.trim().length === 0) tx.destroy(e);
        else tx.edit(e).set(CalendarEvent, { ...cur });
      });
    } catch { return false; }
    commits += 1;
    return true;
  };

  const end = (): void => {
    const t = target;
    commit();
    target = null;
    open = false;
    start = undefined;
    if (t !== null) { lift(t.entry); if (t.draft !== null) opts.pads()?.draft(t.pad, null); }
  };

  return {
    current: () => (target === null ? null : { pad: target.pad, entry: alive(target.entry) ? target.entry : null, draft: target.draft }),
    beginNew(pad, s, e, ink) {
      if (target !== null) end();
      if (!alive(pad)) return false;
      if (docs.current() !== undefined && writable(docs) === undefined) return false;   // a read-only document: no line begins on it
      target = { pad, entry: null, draft: null };
      setDraft({ start: Math.min(s, e), end: Math.max(s, e), text: "", seeds: [], ink });
      open = false;
      start = undefined;
      return true;
    },
    beginEntry(pad, entry) {
      if (target !== null && target.entry === entry) return true;
      if (target !== null) end();
      if (!alive(pad) || !alive(entry) || read(entry) === undefined) return false;
      if (docs.current() !== undefined && writable(docs) === undefined) return false;   // a read-only document: its lines are read, not written
      world.addTag(entry, Editing);
      target = { pad, entry, draft: null };
      open = false;
      start = undefined;
      return true;
    },
    input(value) {
      const t = target;
      if (t === null) return null;
      const v = oneLine(value);
      if (t.draft !== null) {
        const d = t.draft;
        if (d.text === v) return null;
        const carried = carrySeeds(d.text, d.seeds, v, fresh);
        setDraft({ ...d, text: v, seeds: carried.seeds });
        open = true;
        return { from: carried.from, to: carried.to };
      }
      const e = t.entry;
      if (!alive(e)) return null;
      const cur = read(e);
      if (cur === undefined || cur.text === v) return null;
      const carried = carrySeeds(cur.text, decodeSeeds(cur.seeds), v, fresh);
      if (!open) start = cur;
      live(docs.current(), e, { ...cur, text: v, seeds: encodeSeeds(carried.seeds) });
      open = true;
      return { from: carried.from, to: carried.to };
    },
    text() {
      const t = target;
      if (t === null) return "";
      if (t.draft !== null) return t.draft.text;
      return alive(t.entry) ? (read(t.entry)?.text ?? "") : "";
    },
    open: () => open,
    commit,
    cancel() {
      const t = target;
      if (t === null) return;
      if (t.draft !== null) setDraft(null);
      else if (alive(t.entry) && open && start !== undefined) live(docs.current(), t.entry, start);   // back as the session found it: it reconverges, no transaction
      open = false;
      start = undefined;
      lift(t.entry);
      target = null;
    },
    end,
    commits: () => commits,
  };
}
