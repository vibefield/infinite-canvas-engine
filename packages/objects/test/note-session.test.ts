// @vitest-environment happy-dom
// THE TYPING SESSION'S LIFETIME through the desk's ONE editor (K8a — the editor the desk's, the note's half its BODY): rig:two-tab's
// "A's keystrokes are live in A … while the session is open" read the session CLOSED on K8a's tip, 2 runs of 4. The session was not
// the cause — the row read it last of four round trips, one of them a background tab's read that stalled ~1 s, so the read landed
// after the legitimate idle commit — and the rig reads it in the text's frame now. This pins what the row relies on, on the
// real pieces (the desk's editor, the note's body, its typing, a real document) and fake timers: a session is open until 1 s after
// the LAST input, however many came before it, and it ends by the idle commit, Escape or a blur — a frame's follow, a key the lease
// does not take, a caret move and a second tap on the same note leave it open.
import { Active, createCanvasEngine, type Entity } from "@ice/core";
import { createDeskEditor } from "@ice/desk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextPart } from "@ice/desk/kit";
import { createNoteBody, NOTE_BODY, NOTE_INK, NOTE_PROPS, Note, type PaperDriver } from "../src";
import { createNoteTyping } from "../src/paper/typing";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

/** A desk's editor and a note's body over a real engine and document: no layer, no device — the three pieces a session runs through. */
function rig() {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  const { world } = ce;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const typing = createNoteTyping({ world, docs: ce.docs, ink: NOTE_INK, props: NOTE_PROPS });
  const driver: PaperDriver = { typing, writing: () => undefined, isNote: (e) => world.get(e, NOTE_INK) !== undefined, body: undefined, follow: () => {}, idle: () => true };
  const parts: TextPart[] = [];   // as the layer fills them: after the editor, before the first tap
  const editor = createDeskEditor({ container, world, parts: () => parts, wake: () => {} });
  const body = createNoteBody({ editor, world, driver, geometryOf: () => undefined });
  if (body === undefined) throw new Error("no body");
  parts.push(body);
  const note = ce.ops.spawnWidget("desk.note", { x: 0, y: 0, props: { seed: 7, text: "" }, undoable: false }) as Entity;
  ce.step(16);   // projected: its cells in the world, its membership (`Active`) derived
  const el = editor.element;
  return {
    world, typing, editor, body, note, el,
    /** The platform's field after a key, then its `input` event. */
    type(value: string) { el.value = value; el.setSelectionRange(value.length, value.length); el.dispatchEvent(new Event("input", { bubbles: true })); },
    key(k: string) { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); },
    doc: () => (ce.docs.current()?.store.getComponent(note, NOTE_INK) as { text: string } | undefined)?.text,
    dispose: () => { editor.dispose(); ce.dispose(); },
  };
}

describe("a typing session lives until 1 s after the last key, and ends only by the idle commit, Escape or a blur (K8a)", () => {
  it("each input re-arms the idle: open at 999 ms after the LAST key, committed at 1 s — the editor stays on the note", () => {
    const r = rig();
    expect(r.body.focus(r.note)).toBe(true);
    r.type("h");   // t 0: the session opens
    expect(r.typing.open()).toBe(true);
    vi.advanceTimersByTime(900);
    r.type("he");   // t 900: 900 ms after the first key, the idle begins again
    vi.advanceTimersByTime(999);   // t 1899: 1899 ms after the first key, 999 after the last
    expect(r.typing.open()).toBe(true);
    expect(r.doc()).toBe("");   // nothing committed while it is open
    vi.advanceTimersByTime(1);   // t 1900: 1 s after the last key
    expect(r.typing.open()).toBe(false);
    expect(r.doc()).toBe("he");   // ONE commit, the idle's
    expect(r.editor.lease()?.part).toBe(NOTE_BODY);   // the idle ends the SESSION, never the lease: the focus stays
    expect(document.activeElement).toBe(r.el);
    r.dispose();
  });

  it("a frame's follow, a key the lease does not take, a caret move and a second tap on the same note leave it open; Escape and a blur end it", async () => {
    const r = rig();
    expect(r.world.hasTag(r.note, Active)).toBe(true);   // the precondition of a follow that keeps the lease: the note is live
    r.body.focus(r.note);
    r.type("a");
    r.editor.follow();   // a frame (the loop woken by the key)
    await Promise.resolve();   // a lease the follow let go ends on a microtask
    r.key("ArrowLeft");
    r.el.setSelectionRange(0, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(r.body.focus(r.note, 0)).toBe(true);   // a tap on the note already being written
    expect(r.typing.open()).toBe(true);
    expect(r.doc()).toBe("");
    r.key("Escape");   // the lease lets the note go: the session commits
    expect(r.typing.open()).toBe(false);
    expect(r.doc()).toBe("a");
    expect(r.editor.lease()).toBeUndefined();
    // the next session, ended by a blur (a press anywhere else)
    r.body.focus(r.note);
    r.type("ab");
    expect(r.typing.open()).toBe(true);
    r.el.blur();
    expect(r.typing.open()).toBe(false);
    expect(r.doc()).toBe("ab");
    expect(r.editor.lease()).toBeUndefined();
    vi.advanceTimersByTime(5000);   // no idle left armed behind an ended lease
    expect(r.doc()).toBe("ab");
    r.dispose();
  });

  it("the editor's DISPOSE ends its lease: a session still open commits — a desk unmounted mid-typing (a remount on a new generation, petition I25) loses no keystroke and leaves no claim behind", () => {
    const r = rig();
    r.body.focus(r.note);
    r.type("mid");
    expect(r.typing.open()).toBe(true);
    expect(r.doc()).toBe("");
    r.editor.dispose();   // the layer's dispose: the generation ends with the session open
    expect(r.typing.open()).toBe(false);
    expect(r.typing.editing()).toBeUndefined();   // the claim lifted with it
    expect(r.doc()).toBe("mid");   // ONE commit — the session's
    vi.advanceTimersByTime(5000);   // no idle left armed behind the editor
    expect(r.doc()).toBe("mid");
    r.dispose();
  });
});
