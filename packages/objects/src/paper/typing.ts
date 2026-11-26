// TYPING IS A GESTURE (design-015 §6.1; D2c) — the note's typing session, the world half of the ONE
// focused editor (desk/host/editor.ts is its DOM half, as the keymap is the DOM half of `ops.*` —
// design-003 §2: no system-side keyboard logic; a key resolves to a write path).
//
// The CLAIM: `begin(e)` stamps the runtime `Editing` rider on the note — core's fact with ONE writer,
// this module — and `makeDefaultMayDiverge` reads it as a gesture claim, so the note's `ink` cell
// (`{ text, seeds, marks }`) may be written LIVE through the document's guarded live writer. Every keystroke
// (`input(value, caret)`) CARRIES THE INK (petition I60 — kit/ink.ts `carryInk`: the common prefix and suffix
// keep their hands and their marks, the inserted run gets fresh seeds and joins a mark only where both its
// neighbours carry it; the platform's caret after the edit says where a letter typed beside its twin went) and
// writes the whole cell live: the renderer draws it at once, the document does not move. A word TYPED OVER a
// selection keeps the marks its letters shared for every letter of it, not the first alone, until the caret
// leaves its end (`moved`). A PASTE lays a piece's words and marks in a fresh hand (`paste`); a COPY lifts them
// (`lift`). The TYPING ends — blur, Esc, 1 s without input: the editor's call — with
// `commit()`: ONE undoable transaction with the live cell; a typing that nets to nothing (the text,
// the hand and the marks it found) commits nothing and puts the cell back exactly. So ⌘Z undoes a typing
// session, never a keystroke.
//
// Collaboration is strata's reconcile matrix (006 C5), the claimed-cell rule every gesture has: while
// the live cell differs from the baseline, a remote value for it is DROPPED and banked; the session's
// commit wins over it (committer-wins); a session that nets to nothing reconverges silently and the
// banked remote value applies. Between sessions the cell is not diverging and a remote edit applies.
// A note deleted mid-session takes its uncommitted run with it — the gesture was interrupted; an undo
// of the delete restores the note as last committed.
//
// A typing REGISTERS ITSELF on its world (the kit's `registerInkTyping` — a live write is a typing of another shape), so the note's
// STATIC words acts (object.ts — the kit's `inkActs`, through `inkTypingOn`) land a live typing's words in their own step before they
// mark by the field's indices, and read the words the field shows. The typed-over run is the kit's (`carryRun`, `keepRun`), shared
// with every written part's draft.

import { type Component, Editing, type Entity, guardedTransaction, PrefabId, type World } from "@ice/core";
import { tapHit, type TypingDocs, writable } from "@ice/desk";
import { carryRun, encodeMarks, encodeSeeds, freshSeed, type InkPiece, type InkTypedRun, type InkValue, inkOf, keepRun, lift as liftInk, paste as pasteInk, registerInkTyping, seedsFor, type TextRange } from "@ice/desk/kit";

// The document's doors live in docs.ts (D-D7-A.3: no kind in them, so the host holds them without naming one); the drivers
// keep reaching them here.
export { type TypingDocs, writable, type WritableSession } from "@ice/desk";

/**
 * THE TAP'S NOTE (D7 #4): the note a tap by the local pointer `pid` writes into — the interaction stack's exact hit for that
 * pointer — or none. NONE while any object is in hand: a tap in hand is the hand's (a put-down, a held tool), and the pointer's
 * hit is frozen at the pick-up anyway (l1-pick skips `HandledByWidget` pointers, which the hold stamps every tick), so it would
 * name whatever the pointer touched then — the note hovered before ⏎ opened the board. `found` says whether the pointer is
 * known at all (a touch that has lifted is gone: the caller may ask the drawn notes instead).
 */
export function tapNote(world: World, pid: string, isNote: (e: Entity) => boolean): { readonly found: boolean; readonly note: Entity | undefined } {
  // the desk's generic tap (K8a — `tapHit`, the stack's exact hit, none in hand): a note when it hit one
  const t = tapHit(world, pid);
  return { found: t.found, note: t.hit !== undefined && isNote(t.hit) ? t.hit : undefined };
}

export interface NoteTypingOptions {
  readonly world: World;
  readonly docs: TypingDocs;
  /** The note's cells: its writing (`{ text, seeds, marks }`, live-written and committed whole) and its other props (the seed). The object hands its own (D-D7-A.3). */
  readonly ink: Component<{ text: string; seeds: string; marks: string }>;
  readonly props: Component<{ seed?: number }>;
  /** A fresh seed for a glyph just written (`Math.random` unless a test says). */
  readonly fresh?: () => number;
  /** The ink cell's group name on the object ("ink" — what the words acts land by, the kit's `inkActs({ ink })`). */
  readonly group?: string;
}

export interface NoteTyping {
  /** The note the editor is on — the `Editing` claim — or undefined. */
  editing(): Entity | undefined;
  /** A session is open: the note's ink written live and not yet committed. */
  open(): boolean;
  /** The note's writing as the world holds it now (the live value while it is typed) — the cell's three strings. */
  ink(e: Entity): { readonly text: string; readonly seeds: string; readonly marks: string } | undefined;
  /** The same as an ink (kit/ink.ts — each glyph's seed, the note's own where none is stored, and its mark). */
  value(e: Entity): InkValue | undefined;
  /** Claim `e` for writing (`Editing`); a claim on another note ends first. False for a dead entity or a non-note. */
  begin(e: Entity): boolean;
  /**
   * The platform's value for the claimed note: the ink carried (`carryInk` — the edit found by `caret`, the field's caret after it,
   * where it can say), the cell written LIVE. A selection TYPED OVER keeps the marks its letters shared, and so does every letter typed
   * on at its end, until the caret leaves it (`moved`), a paste comes or the typing lands. The inserted run, or null when nothing changed.
   */
  input(value: string, caret?: number): TextRange | null;
  /** The field's range moved to [from, to) (a selection change): a word typed over a selection ends unless the caret stands at its end. */
  moved(from: number, to: number): void;
  /** A PIECE laid over [from, to) (a paste — kit/ink.ts `paste`: its words and marks in a fresh hand), the cell written live. The arrived range, or null. */
  paste(piece: InkPiece, from: number, to: number): TextRange | null;
  /** The words [from, to) of the claimed note and their marks (a copy, a cut), as the world holds them; undefined with no note. */
  lift(from: number, to: number): InkPiece | undefined;
  /** End the SESSION: ONE transaction with the live cell, unless it nets to nothing. Whether it committed. The claim stays. */
  commit(): boolean;
  /** End the claim: commit, then lift `Editing`. A dead note has nothing to commit — the claim died with it. */
  end(): void;
}

type Ink = { readonly text: string; readonly seeds: string; readonly marks: string };

/** The same hand: glyph for glyph the same seed, stored or implied (`seedsFor`). */
function sameHand(a: Omit<Ink, "marks">, b: Omit<Ink, "marks">, noteSeed: number): boolean {
  const x = seedsFor(a.text, a.seeds, noteSeed);
  const y = seedsFor(b.text, b.seeds, noteSeed);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function createNoteTyping(opts: NoteTypingOptions): NoteTyping {
  const { world, docs, ink: NOTE_INK, props: NOTE_PROPS } = opts;
  const fresh = opts.fresh ?? freshSeed;
  let editing: Entity | undefined;
  let open = false;
  /** The cell as the session found it (before its first live write) — what "nets to nothing" means. */
  let start: Ink | undefined;
  /** A word being typed over a selection (the kit's `carryRun`), while the caret stays at its end. */
  let run: InkTypedRun | undefined;

  const alive = (e: Entity | undefined): e is Entity => e !== undefined && world.isAlive(e);
  /** The cell as the world holds it, read tolerantly (a cell stored before the marks reads `marks` ""). */
  const cellOf = (e: Entity): Ink | undefined => {
    const v = world.get(e, NOTE_INK) as { text?: unknown; seeds?: unknown; marks?: unknown } | undefined;
    if (v === undefined) return undefined;
    return { text: typeof v.text === "string" ? v.text : "", seeds: typeof v.seeds === "string" ? v.seeds : "", marks: typeof v.marks === "string" ? v.marks : "" };
  };
  const seedOf = (e: Entity): number => (world.get(e, NOTE_PROPS) as { seed?: number } | undefined)?.seed ?? 0;
  const inkValueOf = (e: Entity): InkValue | undefined => { const c = cellOf(e); return c === undefined ? undefined : inkOf(c, seedOf(e)); };
  /** The live write — through the guarded live writer, legal only under the claim (`Editing`: core's makeDefaultMayDiverge). */
  const write = (into: ReturnType<typeof writable>, e: Entity, ink: Ink): void => {
    const cell = { text: ink.text, seeds: ink.seeds, marks: ink.marks };
    if (into !== undefined) into.liveWriter.set(e, NOTE_INK, cell);
    else world.edit(e).set(NOTE_INK, cell);   // no document: the runtime is all there is
  };
  /** The claimed note's cell moved to `next`, LIVE (its first move opens the typing, the cell as found kept). */
  const move = (e: Entity, cur: Ink, next: InkValue): void => {
    if (!open) start = cur;
    write(docs.current(), e, { text: next.text, seeds: encodeSeeds(next.seeds), marks: encodeMarks(next.marks) });
    open = true;
  };

  const commit = (): boolean => {
    const e = editing;
    run = undefined;
    if (!open) return false;
    open = false;
    if (!alive(e)) return false;
    const doc = docs.current();
    const into = writable(docs);
    const live = cellOf(e);
    const from = start;
    start = undefined;
    if (doc === undefined || live === undefined) return false;
    // the document went read-only mid-session (the gate's verdict moved under a peer's pack): nothing lands, the cell goes back as found
    if (into === undefined) {
      if (from !== undefined) write(doc, e, from);
      return false;
    }
    // NETS TO NOTHING — the same text in the same hand with the same marks as the typing found it: no transaction. The cell is put
    // back EXACTLY as found (an implicit hand made explicit by the carry is the same hand, but not the same bytes; a stranger's marks
    // read the same but are not written the same), so the runtime reconverges to its baseline and a remote value strata banked
    // meanwhile applies at the next drain. Compared with the START, never the doc: the doc may already hold that remote value.
    const sameMarks = (a: Ink, b: Ink): boolean => encodeMarks(inkOf(a, 0).marks) === encodeMarks(inkOf(b, 0).marks);
    if (from !== undefined && from.text === live.text && sameHand(from, live, seedOf(e)) && sameMarks(from, live)) {
      if (from.seeds !== live.seeds || from.marks !== live.marks) write(into, e, from);
      return false;
    }
    guardedTransaction(into.store, world, (tx) => { tx.edit(e).set(NOTE_INK, { text: live.text, seeds: live.seeds, marks: live.marks }); });
    return true;
  };

  const end = (): void => {
    const e = editing;
    commit();
    editing = undefined;
    open = false;
    if (alive(e) && world.hasTag(e, Editing)) world.removeTag(e, Editing);
  };

  const typing: NoteTyping = {
    editing: () => (alive(editing) ? editing : undefined),
    open: () => open,
    ink: (e) => (alive(e) ? cellOf(e) : undefined),
    value: (e) => (alive(e) ? inkValueOf(e) : undefined),
    begin(e) {
      if (editing === e && alive(e)) return true;
      if (editing !== undefined) end();
      if (!alive(e) || cellOf(e) === undefined) return false;
      if (docs.current() !== undefined && writable(docs) === undefined) return false;   // a read-only document: no session opens on it (no document at all: the runtime's)
      world.addTag(e, Editing);
      editing = e;
      open = false;
      start = undefined;
      run = undefined;
      return true;
    },
    input(value, caret) {
      const e = editing;
      if (!alive(e) || typeof value !== "string") return null;
      const cur = cellOf(e);
      if (cur === undefined || cur.text === value) return null;
      const carried = carryRun(inkOf(cur, seedOf(e)), value, fresh, caret, run);
      run = carried.run;
      move(e, cur, carried.ink);
      return { from: carried.from, to: carried.to };
    },
    moved(from, to) { run = keepRun(run, from, to); },
    paste(piece, from, to) {
      const e = editing;
      run = undefined;
      if (!alive(e)) return null;
      const cur = cellOf(e);
      if (cur === undefined) return null;
      const ink = inkOf(cur, seedOf(e));
      const next = pasteInk(ink, from, to, piece, fresh);
      if (next.text === ink.text && encodeMarks(next.marks) === encodeMarks(ink.marks) && next.seeds.every((v, i) => v === ink.seeds[i])) return null;   // nothing moved
      // the arrived range: what the piece laid between the words kept before and after it
      const n = ink.text.length;
      const a = Math.max(0, Math.min(from, to, n));
      const b = Math.min(n, Math.max(from, to, a));
      move(e, cur, next);
      return { from: a, to: a + next.text.length - (n - (b - a)) };
    },
    lift(from, to) {
      const e = editing;
      if (!alive(e)) return undefined;
      const ink = inkValueOf(e);
      return ink === undefined ? undefined : liftInk(ink, from, to);
    },
    commit,
    end,
  };
  // its door for the acts and an agent's tools (`inkTypingOn`): the type of the note it is on, the cell's group, the live write's landing
  registerInkTyping(world, NOTE_INK, {
    get type() { const e = typing.editing(); return e === undefined ? "" : (world.get(e, PrefabId)?.id ?? ""); },
    group: opts.group ?? "ink",
    editing: () => typing.editing(),
    open: () => typing.open(),
    commit: () => typing.commit(),
    ink: (e) => typing.value(e),
  });
  return typing;
}
