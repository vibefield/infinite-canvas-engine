// @vitest-environment node
// TYPING IS A GESTURE (design-015 §6.1; D2c) — a real engine, a real document, the desk's Note. The
// claim (`Editing`, one writer) is what makes the live write legal; a session's keystrokes write the
// note's `ink` cell LIVE — the renderer's to draw, the document's not yet — and the session's end
// commits them as ONE transaction, text and seeds together, so ONE undo takes the whole session back;
// a session that nets to nothing commits nothing; a remote edit during a session is dropped and the
// session's commit wins (the claimed-cell rule), while one between sessions applies.
import { createCanvasEngine, decodeEnvelope, defineQuery, Editing, encodeEnvelope, type Entity, guardedTransaction, heldEntity, LocalPointer, NO_MODS, Pointer, TouchesExact, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { decodeSeeds, seedsFor } from "../src/paper/seeds";
import { Board, NOTE_INK, Note } from "../src/objects";
import { createNoteTyping, tapNote } from "../src/objects/typing";

function makeDesk() {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  let now = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  const note = (text = ""): Entity => ce.ops.spawnWidget("desk.note", { x: 0, y: 0, props: { seed: 7, text }, undoable: false });
  let next = 5000;
  const typing = createNoteTyping({ world: ce.world, docs: ce.docs, fresh: () => next++ });
  const session = () => { const s = ce.docs.current(); if (s === undefined) throw new Error("no doc"); return s; };
  const doc = (e: Entity) => session().store.getComponent(e, NOTE_INK) as { text: string; seeds: string } | undefined;
  const live = (e: Entity) => ce.world.get(e, NOTE_INK) as { text: string; seeds: string } | undefined;
  const undoSteps = (): number => { let n = 0; const s = session().store; while (s.canUndo() && n < 50) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); return n; };
  return { ce, world: ce.world, step, note, typing, doc, live, undoSteps, session };
}

/** Type as the platform would: the textarea's value after each key. */
const keys = (t: ReturnType<typeof createNoteTyping>, from: string, chars: string): string => {
  let v = from;
  for (const ch of chars) { v += ch; t.input(v); }
  return v;
};

describe("typing · the claim (design-015 §6.1)", () => {
  it("begin stamps `Editing` — the one writer — and the live write is legal only under it", () => {
    const { world, step, note, typing, session } = makeDesk();
    const a = note();
    step();
    expect(() => session().liveWriter.set(a, NOTE_INK, { text: "x", seeds: "" })).toThrow(/gesture claim/);
    expect(typing.begin(a)).toBe(true);
    expect(world.hasTag(a, Editing)).toBe(true);
    expect(typing.editing()).toBe(a);
    expect(() => typing.input("x")).not.toThrow();
    typing.end();
    expect(world.hasTag(a, Editing)).toBe(false);
    expect(typing.editing()).toBeUndefined();
  });

  it("the claim is ONE: beginning on another note ends the first — its session committed, its claim lifted", () => {
    const { world, step, note, typing, doc } = makeDesk();
    const a = note();
    const b = note();
    step();
    typing.begin(a);
    keys(typing, "", "hi");
    typing.begin(b);
    expect(world.hasTag(a, Editing)).toBe(false);
    expect(world.hasTag(b, Editing)).toBe(true);
    expect(doc(a)?.text).toBe("hi");
  });
});

describe("typing · the session is ONE transaction", () => {
  it("keystrokes write the cell LIVE (the document untouched, no undo step); the commit writes text AND seeds once; ONE ⌘Z takes it all back", () => {
    const { step, note, typing, doc, live, undoSteps, session } = makeDesk();
    const a = note("buy milk");
    step();
    const before = undoSteps();
    typing.begin(a);
    keys(typing, "buy milk", "!!!");
    expect(live(a)?.text).toBe("buy milk!!!");
    expect(doc(a)?.text).toBe("buy milk");
    expect(undoSteps()).toBe(before);
    expect(typing.open()).toBe(true);
    expect(typing.commit()).toBe(true);
    expect(typing.open()).toBe(false);
    step();
    expect(doc(a)?.text).toBe("buy milk!!!");
    // the seeds went with the text in the same cell: the untouched run keeps the note's own hand, the typed run is fresh
    const seeds = decodeSeeds(doc(a)?.seeds ?? "");
    expect(seeds.slice(0, 8)).toEqual(seedsFor("buy milk", "", 7));
    expect(seeds.slice(8)).toEqual([5000, 5001, 5002]);
    expect(undoSteps()).toBe(before + 1);
    // ONE undo restores the whole session — text and seeds
    session().store.undo();
    step();
    expect(live(a)).toEqual({ text: "buy milk", seeds: "" });
    session().store.redo();
    step();
    expect(live(a)?.text).toBe("buy milk!!!");
  });

  it("a session that nets to nothing commits nothing (no undo step); a commit with no open session is a no-op", () => {
    const { step, note, typing, doc, undoSteps } = makeDesk();
    const a = note("hi");
    step();
    const before = undoSteps();
    typing.begin(a);
    typing.input("hix");
    typing.input("hi");
    expect(typing.commit()).toBe(false);
    expect(typing.commit()).toBe(false);
    typing.end();
    step();
    expect(doc(a)?.text).toBe("hi");
    expect(undoSteps()).toBe(before);
  });

  it("two sessions on one focus are two undo steps; the second carries the first one's seeds on", () => {
    const { step, note, typing, doc, undoSteps, session } = makeDesk();
    const a = note();
    step();
    const before = undoSteps();
    typing.begin(a);
    keys(typing, "", "ab");
    typing.commit();   // 1 s without input
    step();
    keys(typing, "ab", "c");
    typing.end();      // Esc
    step();
    expect(doc(a)?.text).toBe("abc");
    expect(decodeSeeds(doc(a)?.seeds ?? "")).toEqual([5000, 5001, 5002]);
    expect(undoSteps()).toBe(before + 2);
    session().store.undo();
    step();
    expect(doc(a)?.text).toBe("ab");
  });

  it("a note deleted mid-session: the claim dies with it, nothing is committed, and the undo of the delete brings it back as last committed", () => {
    const { ce, world, step, note, typing } = makeDesk();
    const a = note("kept");
    step();
    typing.begin(a);
    keys(typing, "kept", " and lost");
    ce.ops.setSelection([a], "replace");
    ce.ops.deleteSelection();
    step();
    expect(world.isAlive(a)).toBe(false);
    expect(typing.editing()).toBeUndefined();
    expect(typing.commit()).toBe(false);
    expect(() => typing.end()).not.toThrow();
    ce.docs.undo();
    step();
    const notes: string[] = [];
    world.query(defineQuery([NOTE_INK])).each((b) => { for (const r of b) notes.push((world.get(b.entity(r), NOTE_INK) as { text: string }).text); });
    expect(notes).toEqual(["kept"]);
  });
});

describe("typing · the claimed-cell rule across peers (strata 006 C5)", () => {
  /** A second peer on A's document: B opens A's envelope; its entity for A's note by key. */
  function pair(text: string) {
    const A = makeDesk();
    const a = A.note(text);
    A.step();
    const B = makeDesk();
    B.ce.docs.open(A.session().exportEnvelope());
    B.step();
    const key = A.session().store.keyOf(a);
    const b = key === undefined ? undefined : B.session().store.resolve(key);
    if (b === undefined) throw new Error("B has no twin of A's note");
    const sync = (from: typeof A, to: typeof A) => { to.session().applyRemote(from.session().exportSnapshot()); to.step(); };
    const edit = (P: typeof A, e: Entity, t: string) => { guardedTransaction(P.session().store, P.world, (tx) => { tx.edit(e).set(NOTE_INK, { text: t, seeds: "" }); }); P.step(); };
    return { A, B, a, b, sync, edit };
  }

  it("a remote edit DURING a session is dropped from the live cell and the session's commit wins — both peers converge on it", () => {
    const { A, B, a, b, sync, edit } = pair("base");
    A.typing.begin(a);
    keys(A.typing, "base", "-A");
    edit(B, b, "base-B");
    sync(B, A);
    expect(A.live(a)?.text).toBe("base-A");   // held off: the gesture owns the cell
    A.typing.end();
    A.step();
    expect(A.doc(a)?.text).toBe("base-A");
    sync(A, B);
    expect(B.live(b)?.text).toBe("base-A");
  });

  it("a session that nets to nothing yields: the remote edit it held off applies", () => {
    const { A, B, a, b, sync, edit } = pair("base");
    A.typing.begin(a);
    A.typing.input("basex");
    edit(B, b, "base-B");
    sync(B, A);
    expect(A.live(a)?.text).toBe("basex");
    A.typing.input("base");
    expect(A.typing.commit()).toBe(false);
    A.step();
    expect(A.live(a)?.text).toBe("base-B");
    A.typing.end();
  });

  it("a remote edit BETWEEN sessions (the editor on the note, no key yet) applies, and the next key writes from it", () => {
    const { A, B, a, b, sync, edit } = pair("base");
    A.typing.begin(a);
    edit(B, b, "base-B");
    sync(B, A);
    expect(A.live(a)?.text).toBe("base-B");
    keys(A.typing, "base-B", "!");
    A.typing.end();
    A.step();
    expect(A.doc(a)?.text).toBe("base-B!");
  });
});

describe("typing · the writer's gate (D7 #1) — a read-only document is not written", () => {
  /** The facade's session as `TypingDocs.current()` carries it, the gate's verdict swapped in — a doc a newer build wrote reads so. */
  const gated = (ce: ReturnType<typeof makeDesk>["ce"], readOnly: () => boolean) => ({
    current: () => { const s = ce.docs.current(); return s === undefined ? undefined : { store: s.store, liveWriter: s.liveWriter, readOnly: readOnly(), versionReport: s.versionReport }; },
  });

  it("a read-only session: begin refuses — no claim, no live write; the note's ink stays the document's", () => {
    const { ce, world, step, note, live, doc } = makeDesk();
    const a = note("base");
    step();
    const typing = createNoteTyping({ world, docs: gated(ce, () => true) });
    expect(typing.begin(a)).toBe(false);
    expect(world.hasTag(a, Editing)).toBe(false);
    expect(typing.editing()).toBeUndefined();
    expect(typing.input("base!")).toBeNull();
    expect(live(a)?.text).toBe("base");
    expect(doc(a)?.text).toBe("base");
  });

  it("the verdict moves mid-session (a peer's pack): the end commits nothing — no undo step — and the cell goes back as found", () => {
    const { ce, world, step, note, live, doc, undoSteps } = makeDesk();
    const a = note("base");
    step();
    let readOnly = false;
    const typing = createNoteTyping({ world, docs: gated(ce, () => readOnly) });
    expect(typing.begin(a)).toBe(true);
    keys(typing, "base", "!!");
    expect(live(a)?.text).toBe("base!!");
    readOnly = true;
    const before = undoSteps();
    expect(typing.commit()).toBe(false);
    expect(doc(a)?.text).toBe("base");
    expect(live(a)?.text).toBe("base");
    expect(undoSteps()).toBe(before);
    typing.end();
    expect(world.hasTag(a, Editing)).toBe(false);
  });

  it("through the facade: a document the version gate opens READ-ONLY (its root does not agree with its envelope's) — the desk's typing sees that verdict", () => {
    const { step, note, session } = makeDesk();
    note("base");
    step();
    // the in-document markers are the gate's authority (a header's engineSchema is re-read from them); the root mirror is the header's
    const { header, payload } = decodeEnvelope(session().exportEnvelope());
    const newer = createCanvasEngine({ widgets: [Note] });
    const opened = newer.docs.open(encodeEnvelope({ ...header, rootCanvas: { id: "gate:not-the-stored-root", semanticVersion: 1 } }, payload));
    expect(opened.ok).toBe(true);
    expect(newer.docs.current()?.readOnly).toBe(true);
    newer.world.sync();
    const a = newer.world.firstOf(defineQuery([NOTE_INK])) as Entity | undefined;
    if (a === undefined) throw new Error("the note did not open");
    const typing = createNoteTyping({ world: newer.world, docs: newer.docs });
    expect(typing.begin(a)).toBe(false);
    expect(newer.world.hasTag(a, Editing)).toBe(false);
    expect((newer.world.get(a, NOTE_INK) as { text: string }).text).toBe("base");
  });
});

describe("typing · the tap's note (D7 #4) — no tap writes while an object is in hand", () => {
  it("a note hovered, ⏎ takes the board in hand, the pointer's exact hit freezes on the note: the tap names NO note in hand, and the note again once the hand is empty", () => {
    const ce = createCanvasEngine({ widgets: [Note, Board] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
    let now = 0;
    const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
    const note = ce.ops.spawnWidget("desk.note", { x: 0, y: 0, props: { seed: 7, text: "hi" }, undoable: false });
    const board = ce.ops.spawnWidget("desk.board", { x: 600, y: 100, undoable: false });
    step();
    const isNote = (e: Entity): boolean => e === note;
    // the mouse over the note: the stack's exact hit is the note
    ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: 50, screenY: 50, buttons: 0, mods: NO_MODS });
    step(2);
    const p = ce.world.firstOf(defineQuery([Pointer, LocalPointer])) as Entity;
    expect(ce.world.getRelation(p, TouchesExact)).toBe(note);
    expect(tapNote(ce.world, "mouse", isNote)).toEqual({ found: true, note });
    // the board taken in hand (⏎ on the selection): the pointer is the hand's and its hit stays frozen on the note
    ce.ops.setSelection([board], "replace");
    ce.ops.open(board);
    step(3);
    expect(heldEntity(ce.world)).toBe(board);
    expect(ce.world.getRelation(p, TouchesExact)).toBe(note);   // the stale hit the defect read
    expect(tapNote(ce.world, "mouse", isNote)).toEqual({ found: true, note: undefined });
    // put down: once the hand is empty the tap is the desk's again
    ce.ops.putDown();
    for (let i = 0; i < 200 && heldEntity(ce.world) !== undefined; i++) step();
    expect(heldEntity(ce.world)).toBeUndefined();
    step(2);
    expect(tapNote(ce.world, "mouse", isNote)).toEqual({ found: true, note });
    expect(tapNote(ce.world, "touch:9", isNote)).toEqual({ found: false, note: undefined });   // a pointer the stack does not know
  });
});
