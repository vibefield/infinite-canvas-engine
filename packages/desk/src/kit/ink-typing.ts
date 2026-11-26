// THE WRITTEN PART'S TYPING (petition I60 — the editing is the desk's own, so a downstream object gets it whole): the DRAFT a kind's
// text part holds while the desk's ONE editor is on one of its objects — the comment pad's shape (a plugin kind's), generalised and
// carried to the INK (kit/ink.ts: the text, each glyph's seed and each glyph's mark, kept as one). The words being typed are a
// DRAFT, told to the kind's render half (`sink.draft`) so it draws them at once while the document does not move; never a live
// write, so the typing needs no claim on the cell (core's `Editing` is the reference kinds' typing's: a plugin's part stamps none,
// and its lease names its object instead — `EditorLease.entity`), and a peer sees the words only when they land. Every platform
// input CARRIES the ink (the words around the edit keep their hands and their marks; the run it wrote is written fresh, a mark's
// field joined only inside it), the edit found by the caret after it where the caret can say (`carryInk`'s `caret`); a word TYPED
// OVER a selection keeps the marks its letters shared for every letter of the run (`InkTyping.moved`); a PASTE lays a piece's words and marks in a fresh hand (`paste` — the fields the kind keeps only); a COPY
// lifts them (`lift`).
//
// The typing ENDS — the editor's 1 s without input, Escape, a blur, another part taking the editor — with `commit()`: ONE
// transaction writing the kind's ink cell (`{ text, seeds, marks }`, one conflict group, so a peer's words never pair with another's
// marks) through the desk's WRITER'S GATE (`writable(docs)`); a draft that NETS TO NOTHING — the text, the hand and the marks as the
// typing found them — commits nothing. So ⌘Z undoes a typing, never a keystroke. A READ-ONLY document is read, never written: no
// typing opens on it, and one gone read-only while a draft is open lands nothing (the draft goes, the cell is as it was).
// Collaboration is the cell's: the commit writes the whole ink it holds (committer-wins, as the note's does), and between drafts a
// peer's ink reaches the editor's field (the lease's `value`).
//
// A typing REGISTERS ITSELF on its world (`inkTypingOn`), so a STATIC binding — a plugin's `menu: inkActs({ … })`, an agent's tool —
// reaches the per-desk typing on an object without being handed it: an act lands an open draft before it marks by index. A typing of
// ANOTHER shape — a live write under core's `Editing` claim, the reference note's — registers through the same door
// (`registerInkTyping`, the five things an act asks of it: `InkTypingDoor`), and shares the typed-over run's step (`carryRun`,
// `keepRun`), so its words keep their marks as this typing's do.

import { type Component, type Entity, guardedTransaction, PrefabId, type WidgetType, type World } from "@ice/core";
import { type TypingDocs, writable } from "../docs";
import type { TextRange } from "./editor";
import { carryInk, decodeMarks, encodeMarks, type InkChange, type InkPiece, type InkValue, inkCells, inkOf, lift as liftInk, mark, paste as pasteInk } from "./ink";
import type { PenHow } from "./pen-clock";
import { freshSeed } from "./seeds";

/** The FIELDS of a glyph's mark (kit/ink.ts) a kind may let its words take: its pen, a highlighter under it, a line through it, one under it. */
export const INK_FIELDS = ["pen", "highlight", "strike", "underline"] as const;
export type InkField = (typeof INK_FIELDS)[number];

/** Glyphs that just ARRIVED in a draft: their range, and how — `typed` at the hand's pace, `arrived` laid whole (a paste) — the pen's clock's own words (`PenHow`). */
export interface InkArrival {
  readonly from: number;
  readonly to: number;
  readonly how: Exclude<PenHow, "shown">;
}

/**
 * What a kind's render half is TOLD (petition I60 — drawing is the kind's): the DRAFT, drawn instead of the cell at once (`undefined`
 * when it closes — committed, dropped or gone: the cell is drawn again), with the glyphs that arrived in it and how (a kind's pen clock
 * writes them so); the CARET while the editor is on one of its objects (`e` undefined: none); and the SELECTION, for the wash
 * (`from` = `to`: a caret; `e` undefined: none).
 */
export interface InkSink {
  draft?(e: Entity, ink: InkValue | undefined, arrived?: InkArrival): void;
  caret?(e: Entity | undefined, index?: number): void;
  selection?(e: Entity | undefined, from?: number, to?: number): void;
}

export interface InkTypingOptions {
  readonly world: World;
  /** The document's doors (docs.ts — `ObjectDomHost.docs`): the writer's gate the commit asks. */
  readonly docs: TypingDocs;
  /** The compiled object whose objects it writes (`ObjectDomHost.object`): its ink cell is found on it by its group's name. */
  readonly object: WidgetType;
  /** The ink cell's group — its `text`, `seeds` and `marks` (`groups: { ink: ["text", "seeds", "marks"] }`); "ink" unless the kind says. */
  readonly ink?: string;
  /** The fields this kind keeps (`INK_FIELDS` by default): a pasted piece's other marks are dropped. */
  readonly marks?: readonly InkField[];
  /** Told the draft as it moves (its `draft` alone — the part tells the rest). */
  readonly sink?: InkSink;
  /** A fresh seed for a glyph just written (`freshSeed`, `Math.random`'s, unless a test says). */
  readonly fresh?: () => number;
}

/**
 * What an act or an agent's tool asks of ANY typing on an object (petition I60 — `registerInkTyping`, `inkTypingOn`): the type and the
 * ink cell's group it writes, the object it is on, whether words are written and not yet landed, the landing, and the words its field
 * shows. `InkTyping` is one; a live write (the note's typing) is another.
 */
export interface InkTypingDoor {
  /** The object type it writes and its ink cell's group: what `inkTypingOn` finds it by. */
  readonly type: string;
  readonly group: string;
  /** The object the typing is on, or undefined. */
  editing(): Entity | undefined;
  /** Words are written and not yet landed (a draft open; a live write still pending). */
  open(): boolean;
  /** Land them: ONE step unless they net to nothing — whether it wrote. The object stays the typing's. */
  commit(): boolean;
  /** The ink the editor's field shows for `e` — undefined for a dead entity or another type's. */
  ink(e: Entity): InkValue | undefined;
}

/** A word being TYPED OVER a selection (`carryRun`): its letters [from, to) and the mark the replaced letters shared. */
export interface InkTypedRun {
  readonly from: number;
  readonly to: number;
  readonly mark: number;
}

/** A kind's written part's TYPING on one desk: one object at a time, its words a DRAFT until the commit lands them in one step. */
export interface InkTyping extends InkTypingDoor {
  /** A DRAFT is open: words written and not yet landed. */
  open(): boolean;
  /** The ink the editor's field shows for `e`: the draft while one is open on it, else its cell's — undefined for a dead entity or another type's. */
  ink(e: Entity): InkValue | undefined;
  /** The ink `e`'s cell holds (never the draft). */
  committed(e: Entity): InkValue | undefined;
  /** Put the typing on `e` (a typing on another object ends first — it commits). False for a dead entity, another type's, or a read-only document. */
  begin(e: Entity): boolean;
  /**
   * The platform's value (an input): the ink carried, the draft told — the edit found by `caret`, the field's caret after it, where
   * it can say (`carryInk`'s). A selection TYPED OVER keeps the marks its letters shared (`splice`'s replacement), and so does every
   * letter typed on at the run's end — "Friday" typed over as "Monday" inside a highlight stays highlighted, not "M" alone — until
   * the caret moves away (`moved`), the draft lands, a paste comes or a mark is made. The arrived range, or null when nothing changed.
   */
  input(value: string, caret?: number): TextRange | null;
  /** The field's range moved to [from, to) (a selection change): a run typed over a selection ends unless the caret stands at its end. */
  moved(from: number, to: number): void;
  /** A PIECE laid over [from, to) of the draft (a paste: its words and the marks the kind keeps, in a fresh hand). The arrived range, or null. */
  paste(piece: InkPiece, from: number, to: number): TextRange | null;
  /** The words [from, to) and their marks (a copy, a cut) — the draft's while one is open; undefined with no object. */
  lift(from: number, to: number): InkPiece | undefined;
  /** Land the DRAFT: ONE transaction unless it nets to nothing — whether it committed. The object stays the typing's. */
  commit(): boolean;
  /** Land the draft and let the object go: commit, then no object. */
  end(): void;
}

/** Every typing on a world, by the cell it writes — one made again on the same cell (the desk remounted) replaces the last. */
const TYPINGS = new WeakMap<World, Map<Component, InkTypingDoor>>();

/** The cell's three fields (kit/ink.ts — `ink: ["text", "seeds", "marks"]`). */
const CELL_FIELDS = ["text", "seeds", "marks"] as const;

/** The change that lifts one field over a range (a paste's marks the kind does not keep). */
const LIFT: Readonly<Record<InkField, InkChange>> = { pen: { pen: null }, highlight: { highlight: null }, strike: { strike: false }, underline: { underline: false } };

/** The same ink: the same words in the same hand with the same marks (the marks as the cell reads them). */
const same = (a: InkValue, b: InkValue): boolean => a.text === b.text && a.seeds.length === b.seeds.length && a.seeds.every((v, i) => v === b.seeds[i]) && encodeMarks(a.marks) === encodeMarks(b.marks);

/** An index held to a text `n` long. */
const clampIndex = (i: number, n: number): number => (i >= n ? n : i > 0 ? Math.floor(i) : 0);

/**
 * ONE INPUT'S STEP with the typed-over run (petition I60 — pure; `InkTyping.input`'s, and a live typing's): the platform's `value`
 * carried onto `ink` (`carryInk`, the edit found by `caret`, the field's caret after it), and the run it leaves. A selection typed over
 * BEGINS a run holding the mark its letters shared (`splice`'s replacement); a letter typed at the run's END takes that mark, not the
 * join of its neighbours (a break none) — "Friday" typed over as "Monday" inside a highlight stays highlighted, not "M" alone; a letter
 * of it taken back shortens it; any other edit ends it. The run handed in is never changed. Nothing changed (`value` the ink's words):
 * the ink and the run as handed, an empty range at the caret.
 */
export function carryRun(ink: InkValue, value: string, fresh: () => number, caret?: number, run?: InkTypedRun): { readonly ink: InkValue; readonly from: number; readonly to: number; readonly run: InkTypedRun | undefined } {
  if (ink.text === value) {
    const at = clampIndex(caret ?? value.length, value.length);
    return { ink, from: at, to: at, run };
  }
  const carried = carryInk(ink, value, fresh, caret);
  const { from, to } = carried;
  const removed = ink.text.length - (value.length - (to - from));
  const next = carried.ink;
  if (removed > 0 && to > from) return { ink: next, from, to, run: { from, to, mark: next.marks[from] ?? 0 } };   // a selection typed over: the run begins
  if (run !== undefined && removed === 0 && to > from && from === run.to) {
    // typed on at the run's end: the arrivals take the run's mark
    const marks = next.marks.slice();
    for (let i = from; i < to; i++) marks[i] = value.charCodeAt(i) === 10 ? 0 : run.mark;
    return { ink: { text: next.text, seeds: next.seeds, marks }, from, to, run: { from: run.from, to, mark: run.mark } };
  }
  if (run !== undefined && to === from && removed > 0 && from >= run.from && from + removed === run.to) return { ink: next, from, to, run: { from: run.from, to: from, mark: run.mark } };   // a letter of it taken back
  return { ink: next, from, to, run: undefined };
}

/** The typed-over run after the field's range moved to [from, to) (a selection change): kept while the caret stands at its end, else over (undefined). */
export function keepRun(run: InkTypedRun | undefined, from: number, to: number): InkTypedRun | undefined {
  return run !== undefined && from === to && from === run.to ? run : undefined;
}

/**
 * THE TYPING a kind's text part holds (module doc): the draft, its carry, its paste and lift, its ONE commit. Its ink cell is the
 * object's group named `ink` ("ink"), which must hold `text`, `seeds` and `marks` — checked at once, so a kind that names it wrong is
 * told at its first mount — and the sheet's own seed (the hand of a glyph with no stored seed) is the object's `seed` prop, 0 when it
 * declares none. It registers itself on its world (`inkTypingOn`).
 */
export function inkTyping(opts: InkTypingOptions): InkTyping {
  const { world, docs, object } = opts;
  const group = opts.ink ?? "ink";
  const g = object.groups.find((q) => q.name === group);
  const lacks = CELL_FIELDS.filter((f) => g === undefined || !(f in g.fields));
  if (g === undefined || lacks.length > 0) {
    throw new Error(`ice: inkTyping("${object.type}") — its ink cell is the group "${group}", holding text, seeds and marks (\`groups: { ${group}: ["text", "seeds", "marks"] }\`): ${g === undefined ? "it declares no such group" : `the group lacks ${lacks.join(", ")}`}.`);
  }
  const cell = g.component;
  const seedGroup = object.propToGroup.seed;
  const seedCell = seedGroup === undefined ? undefined : object.groups.find((q) => q.name === seedGroup)?.component;
  const keeps = new Set<InkField>(opts.marks ?? INK_FIELDS);
  const fresh = opts.fresh ?? freshSeed;
  let editing: Entity | undefined;
  /** The ink as the typing found it (before its draft opened) — what "nets to nothing" means. */
  let start: InkValue | undefined;
  let draft: InkValue | undefined;
  /** A word being typed over a selection (`carryRun`'s), carried on to each letter typed at its end. */
  let run: InkTypedRun | undefined;

  /** Is `e` an object of this type, alive? */
  const ours = (e: Entity | undefined): e is Entity => e !== undefined && world.isAlive(e) && world.get(e, PrefabId)?.id === object.type;
  const seedOf = (e: Entity): number => {
    const v = seedCell === undefined ? undefined : (world.get(e, seedCell) as { seed?: unknown } | undefined)?.seed;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  /** The ink `e`'s cell holds, read as the kit reads a cell (tolerant: a cell written before the marks reads unmarked). */
  const cellInk = (e: Entity): InkValue | undefined => {
    const v = world.get(e, cell) as { text?: unknown; seeds?: unknown; marks?: unknown } | undefined;
    if (v === undefined) return undefined;
    return inkOf({ text: typeof v.text === "string" ? v.text : "", seeds: typeof v.seeds === "string" ? v.seeds : "", marks: typeof v.marks === "string" ? v.marks : "" }, seedOf(e));
  };
  /** A piece as this kind keeps it: the fields it does not keep lifted from every glyph. */
  const kept = (piece: InkPiece): InkPiece => {
    const text = typeof piece.text === "string" ? piece.text : "";
    const marks = typeof piece.marks === "string" ? piece.marks : "";
    if (INK_FIELDS.every((f) => keeps.has(f))) return { text, marks };
    let ink: InkValue = { text, seeds: [], marks: decodeMarks(marks, text) };
    for (const f of INK_FIELDS) if (!keeps.has(f)) ink = mark(ink, 0, text.length, LIFT[f]);
    return { text, marks: encodeMarks(ink.marks) };
  };
  /** The draft moved to `next` (its first move opens it, the ink as found kept): the sink told. */
  const move = (e: Entity, next: InkValue, arrived: InkArrival): TextRange => {
    if (draft === undefined) start = cellInk(e);
    draft = next;
    opts.sink?.draft?.(e, next, arrived);
    return { from: arrived.from, to: arrived.to };
  };

  const commit = (): boolean => {
    run = undefined;
    const e = editing;
    const d = draft;
    const found = start;
    draft = undefined;
    start = undefined;
    if (d === undefined || e === undefined) return false;
    const told = (): void => { opts.sink?.draft?.(e, undefined); };
    // the object was deleted while its draft was open: the draft goes with it (an undo of the delete restores it as last committed)
    if (!world.isAlive(e)) { told(); return false; }
    // NETS TO NOTHING — the words, the hand and the marks as the typing found them: no transaction. Compared with the START, never
    // the cell: the cell may already hold a peer's value, which the draft never took
    if (found !== undefined && same(found, d)) { told(); return false; }
    const value = { ...((world.get(e, cell) as Record<string, unknown> | undefined) ?? {}), ...inkCells(d) };
    if (docs.current() === undefined) {
      world.edit(e).set(cell, value);   // no document at all: the runtime is all there is (a bare desk)
      told();
      return true;
    }
    // THE WRITER'S GATE: a document gone read-only while the draft was open takes nothing — the draft goes, the cell is as it was
    const into = writable(docs);
    if (into === undefined) { told(); return false; }
    guardedTransaction(into.store, world, (tx) => { tx.edit(e).set(cell, value); });
    told();
    return true;
  };
  const end = (): void => {
    commit();
    editing = undefined;
  };

  const typing: InkTyping = {
    type: object.type,
    group,
    editing: () => (ours(editing) ? editing : undefined),
    open: () => draft !== undefined,
    ink: (e) => (e === editing && draft !== undefined ? draft : ours(e) ? cellInk(e) : undefined),
    committed: (e) => (ours(e) ? cellInk(e) : undefined),
    begin(e) {
      if (editing === e && ours(e)) return true;
      if (editing !== undefined) end();
      if (!ours(e) || world.get(e, cell) === undefined) return false;
      if (docs.current() !== undefined && writable(docs) === undefined) return false;   // a read-only document: read, never written
      editing = e;
      draft = undefined;
      start = undefined;
      return true;
    },
    input(value, caret) {
      const e = editing;
      if (!ours(e) || typeof value !== "string") return null;
      const cur = draft ?? cellInk(e);
      if (cur === undefined || cur.text === value) return null;
      const step = carryRun(cur, value, fresh, caret, run);
      run = step.run;
      return move(e, step.ink, { from: step.from, to: step.to, how: "typed" });
    },
    moved(from, to) {
      run = keepRun(run, from, to);
    },
    paste(piece, from, to) {
      const e = editing;
      run = undefined;
      if (!ours(e)) return null;
      const cur = draft ?? cellInk(e);
      if (cur === undefined) return null;
      const p = kept(piece);
      const next = pasteInk(cur, from, to, p, fresh);
      if (same(next, cur)) return null;   // nothing moved (no words over a caret)
      const at = clampIndex(Math.min(from, to), cur.text.length);
      return move(e, next, { from: at, to: at + p.text.length, how: "arrived" });
    },
    lift(from, to) {
      const e = editing;
      if (!ours(e)) return undefined;
      const cur = draft ?? cellInk(e);
      return cur === undefined ? undefined : liftInk(cur, from, to);
    },
    commit,
    end,
  };
  registerInkTyping(world, cell, typing);
  return typing;
}

/**
 * REGISTER a typing on its world by the ink cell it writes (petition I60): what `inkTypingOn` finds, so the acts and an agent's tools
 * read its words and land it before they edit by index. `inkTyping` registers through it; a typing of another shape (a live write)
 * registers its door the same way. One door a cell on a world: a later one replaces it. The answer unregisters — a no-op once another
 * door has replaced this one.
 */
export function registerInkTyping(world: World, cell: Component, door: InkTypingDoor): () => void {
  let all = TYPINGS.get(world);
  if (all === undefined) {
    all = new Map();
    TYPINGS.set(world, all);
  }
  const into = all;
  into.set(cell, door);
  return () => {
    if (into.get(cell) === door) into.delete(cell);
  };
}

/**
 * The TYPING ON an object (petition I60): the typing of `e`'s type writing its ink cell (the group `ink`, "ink" by default) that is
 * on `e` now — undefined when none is (no part on that desk, the editor elsewhere). A static binding reaches the per-desk typing so:
 * a menu act (`inkActs`) or an agent's tool lands an open draft (`commit`) before it edits by index, and reads the words the field shows.
 */
export function inkTypingOn(world: World, e: Entity, ink = "ink"): InkTypingDoor | undefined {
  const all = TYPINGS.get(world);
  if (all === undefined || !world.isAlive(e)) return undefined;
  const type = world.get(e, PrefabId)?.id;
  for (const t of all.values()) if (t.type === type && t.group === ink && t.editing() === e) return t;
  return undefined;
}
