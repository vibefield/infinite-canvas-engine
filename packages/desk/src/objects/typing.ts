// TYPING IS A GESTURE (design-015 §6.1; D2c) — the note's typing session, the world half of the ONE
// focused editor (desk/host/editor.ts is its DOM half, as the keymap is the DOM half of `ops.*` —
// design-003 §2: no system-side keyboard logic; a key resolves to a write path).
//
// The CLAIM: `begin(e)` stamps the runtime `Editing` rider on the note — core's fact with ONE writer,
// this module — and `makeDefaultMayDiverge` reads it as a gesture claim, so the note's `ink` cell
// (`{ text, seeds }`) may be written LIVE through the session's guarded live writer. Every keystroke
// (`input(value)`) carries the seeds (`carrySeeds`: the common prefix and suffix keep their hands, the
// inserted run gets fresh ones) and writes the whole cell live: the renderer draws it at once, the
// document does not move. The SESSION ends — blur, Esc, 1 s without input: the editor's call — with
// `commit()`: ONE undoable transaction with the live cell; a session that nets to nothing (the text
// and the hand it found) commits nothing and puts the cell back exactly. So ⌘Z undoes a typing
// session, never a keystroke.
//
// Collaboration is strata's reconcile matrix (006 C5), the claimed-cell rule every gesture has: while
// the live cell differs from the baseline, a remote value for it is DROPPED and banked; the session's
// commit wins over it (committer-wins); a session that nets to nothing reconverges silently and the
// banked remote value applies. Between sessions the cell is not diverging and a remote edit applies.
// A note deleted mid-session takes its uncommitted run with it — the gesture was interrupted; an undo
// of the delete restores the note as last committed.

import { type DocSession, Editing, type Entity, gateVerdict, guardedTransaction, type World } from "@ice/core";
import { encodeSeeds, freshSeed, seedsFor } from "../paper/seeds";
import { carrySeeds } from "../paper/text";
import { NOTE_INK, NOTE_PROPS } from "./note";

/** The document a session writes into — the facade's `engine.docs` (its `current()` session: store + live writer + the gate's verdict). */
export interface TypingDocs {
  current(): Pick<DocSession, "store" | "liveWriter" | "readOnly" | "versionReport"> | undefined;
}

/** What a desk writer holds while it commits: the session's store and live writer. */
export type WritableSession = Pick<DocSession, "store" | "liveWriter">;

/**
 * THE WRITER'S GATE (D7 #1): the session a desk gesture may commit into — none without a document, and none when the
 * version gate's verdict is read-only (a doc a newer build wrote, a pack this build does not compile, a root that does not
 * agree). `readOnly` is the verdict at open; the report is asked again because a peer's pack can move it after. This is
 * the facade's `requireWritable` law at the desk's own write surfaces: strata's store has no read-only mode, and every desk
 * writer commits through it directly (guardedTransaction, setWidgetProps), never through the doc kit's commit sink, so a
 * gate that lived only in the sink never reached them. A refused writer does what "no document" means to it: nothing lands.
 */
export function writable(docs: TypingDocs): WritableSession | undefined {
  const s = docs.current();
  return s === undefined || s.readOnly || gateVerdict(s.versionReport()) !== "ok" ? undefined : s;
}

export interface NoteTypingOptions {
  readonly world: World;
  readonly docs: TypingDocs;
  /** A fresh seed for a glyph just written (`Math.random` unless a test says). */
  readonly fresh?: () => number;
}

export interface NoteTyping {
  /** The note the editor is on — the `Editing` claim — or undefined. */
  editing(): Entity | undefined;
  /** A session is open: the note's ink written live and not yet committed. */
  open(): boolean;
  /** The note's writing as the world holds it now (the live value mid-session). */
  ink(e: Entity): { readonly text: string; readonly seeds: string } | undefined;
  /** Claim `e` for writing (`Editing`); a claim on another note ends first. False for a dead entity or a non-note. */
  begin(e: Entity): boolean;
  /** The platform's value for the claimed note: seeds carried, the cell written LIVE. The inserted run, or null when nothing changed. */
  input(value: string): { readonly from: number; readonly to: number } | null;
  /** End the SESSION: ONE transaction with the live cell, unless it nets to nothing. Whether it committed. The claim stays. */
  commit(): boolean;
  /** End the claim: commit, then lift `Editing`. A dead note has nothing to commit — the claim died with it. */
  end(): void;
}

type Ink = { readonly text: string; readonly seeds: string };

/** The same hand: glyph for glyph the same seed, stored or implied (`seedsFor`). */
function sameHand(a: Ink, b: Ink, noteSeed: number): boolean {
  const x = seedsFor(a.text, a.seeds, noteSeed);
  const y = seedsFor(b.text, b.seeds, noteSeed);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function createNoteTyping(opts: NoteTypingOptions): NoteTyping {
  const { world, docs } = opts;
  const fresh = opts.fresh ?? freshSeed;
  let editing: Entity | undefined;
  let open = false;
  /** The cell as the session found it (before its first live write) — what "nets to nothing" means. */
  let start: Ink | undefined;

  const alive = (e: Entity | undefined): e is Entity => e !== undefined && world.isAlive(e);
  const inkOf = (e: Entity): Ink | undefined => world.get(e, NOTE_INK) as Ink | undefined;
  const seedOf = (e: Entity): number => (world.get(e, NOTE_PROPS) as { seed?: number } | undefined)?.seed ?? 0;
  /** The live write — through the guarded live writer, legal only under the claim (`Editing`: core's makeDefaultMayDiverge). */
  const write = (session: WritableSession | undefined, e: Entity, ink: Ink): void => {
    if (session !== undefined) session.liveWriter.set(e, NOTE_INK, { text: ink.text, seeds: ink.seeds });
    else world.edit(e).set(NOTE_INK, { text: ink.text, seeds: ink.seeds });   // no document: the runtime is all there is
  };

  const commit = (): boolean => {
    const e = editing;
    if (!open) return false;
    open = false;
    if (!alive(e)) return false;
    const doc = docs.current();
    const session = writable(docs);
    const live = inkOf(e);
    const from = start;
    start = undefined;
    if (doc === undefined || live === undefined) return false;
    // the document went read-only mid-session (the gate's verdict moved under a peer's pack): nothing lands, the cell goes back as found
    if (session === undefined) {
      if (from !== undefined) write(doc, e, from);
      return false;
    }
    // NETS TO NOTHING — the same text in the same hand as the session found it: no transaction. The cell is put back
    // EXACTLY as found (an implicit hand made explicit by the carry is the same hand, but not the same bytes), so the
    // runtime reconverges to its baseline and a remote value strata banked meanwhile applies at the next drain. Compared
    // with the START, never the doc: the doc may already hold that remote value.
    if (from !== undefined && from.text === live.text && sameHand(from, live, seedOf(e))) {
      if (from.seeds !== live.seeds) write(session, e, from);
      return false;
    }
    guardedTransaction(session.store, world, (tx) => { tx.edit(e).set(NOTE_INK, { text: live.text, seeds: live.seeds }); });
    return true;
  };

  const end = (): void => {
    const e = editing;
    commit();
    editing = undefined;
    open = false;
    if (alive(e) && world.hasTag(e, Editing)) world.removeTag(e, Editing);
  };

  return {
    editing: () => (alive(editing) ? editing : undefined),
    open: () => open,
    ink: (e) => (alive(e) ? inkOf(e) : undefined),
    begin(e) {
      if (editing === e && alive(e)) return true;
      if (editing !== undefined) end();
      if (!alive(e) || inkOf(e) === undefined) return false;
      if (docs.current() !== undefined && writable(docs) === undefined) return false;   // a read-only document: no session opens on it (no document at all: the runtime's)
      world.addTag(e, Editing);
      editing = e;
      open = false;
      start = undefined;
      return true;
    },
    input(value) {
      const e = editing;
      if (!alive(e)) return null;
      const cur = inkOf(e);
      if (cur === undefined || cur.text === value) return null;
      const carried = carrySeeds(cur.text, seedsFor(cur.text, cur.seeds, seedOf(e)), value, fresh);
      if (!open) start = { text: cur.text, seeds: cur.seeds };
      write(docs.current(), e, { text: value, seeds: encodeSeeds(carried.seeds) });
      open = true;
      return { from: carried.from, to: carried.to };
    },
    commit,
    end,
  };
}
