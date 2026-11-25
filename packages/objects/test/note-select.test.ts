// @vitest-environment happy-dom
// THE NOTE'S WORDS SELECTED, LIFTED AND LAID (petition I60 — "write first, then a drag across writing selects"; a copy puts its words
// on the clipboard, a cut is a copy and a delete in ONE step the person can undo, a paste lays words through the note's typing).
// The note's lease says where its writing lies — `indexAt` from the writing's own caret geometry, on its sheet only and never under
// another object; `rangeAt` from its layout: a word of letters, digits and apostrophes, the laid line without its break — keeps the
// editor's selection on the writing as flux (`select`, `selectionOf`; never stored, not drawn yet), lifts plain words and lays a
// paste through its typing. On the real pieces — the desk's editor, the note's body and typing, a real document, a writing
// the note was drawn into once — and the interaction stack fed, for each press, the facts the pointer adapter sends (its
// `defaultPrevented` gate, pinned in dom's own tests: a press the editor claimed lands `surfaceHandled`).
import { Camera, createCanvasEngine, type Entity, NO_MODS, Position, Size, Viewport } from "@ice/core";
import { createDeskEditor, MAT_GRID } from "@ice/desk";
import { type HandMetrics, layoutText, type TextPart, type TextRaster } from "@ice/desk/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoteBody, NOTE_INK, NOTE_PROPS, Note, type PaperDriver } from "../src";
import { InkShelves, uvOf } from "../src/paper/pages";
import { DEFAULT_PAPER_LAW, lampOf, type PaperGeometry, resolvePaper } from "../src/paper/paper";
import { createNoteTyping } from "../src/paper/typing";
import { createWriting, DEFAULT_HAND_LAW, lineRange, type Writing, wordRange } from "../src/paper/writing";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

/** A face every glyph of which is half an em wide (writing.test.ts's), and pages over the real shelves. */
const METRICS: HandMetrics = { ascent: 0.8, descent: 0.2, advance: () => 0.5 };
const TEXT_RASTER: TextRaster = {
  metrics: () => METRICS,
  version: () => 1,
  raster: (_L, _face, box, band) => { const w = Math.max(1, Math.ceil(box.w * band)); const h = Math.max(1, Math.ceil(box.h * band)); return { bytes: new Uint8Array(w * h), w, h }; },
};
const WORDS = "the quick brown fox jumps\ndog's 2nd bone";

function rig(words = WORDS) {
  const ce = createCanvasEngine({ widgets: [Note] });
  ce.docs.create();
  const { world } = ce;
  world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });   // screen = world = client
  const container = document.createElement("div");
  document.body.appendChild(container);
  const typing = createNoteTyping({ world, docs: ce.docs, ink: NOTE_INK, props: NOTE_PROPS });
  const shelves = new InkShelves(2048, 2);
  const writing: Writing = createWriting({ pages: () => ({ alloc: (w, h) => shelves.alloc(w, h), free: (r) => shelves.free(r), write: (r) => uvOf(r.x, r.y, r.w, r.h, 2048, 2048), reset: () => shelves.reset() }), text: TEXT_RASTER });
  const driver: PaperDriver = { typing, writing: () => writing, isNote: (e) => world.get(e, NOTE_INK) !== undefined, body: undefined, follow: () => {}, idle: () => true };
  const note = ce.ops.spawnWidget("desk.note", { x: 100, y: 100, props: { seed: 7, text: words }, undoable: false }) as Entity;
  world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(2);
  const pos = world.get(note, Position) ?? { x: 0, y: 0 };
  const size = world.get(note, Size) ?? { w: 0, h: 0 };
  const rect = { cx: pos.x + size.w / 2, cy: pos.y + size.h / 2, w: size.w, h: size.h };
  // the note's geometry as the paper kind draws it, unturned — the body places the field by it, the writing hits by it
  const G: PaperGeometry = resolvePaper({ ...rect, angle: 0 }, { held: 0, ring: 0, fade: 1 }, DEFAULT_PAPER_LAW, lampOf(MAT_GRID.plane));
  const parts: TextPart[] = [];
  const editor = createDeskEditor({ container, world, parts: () => parts, wake: () => {} });
  const body = createNoteBody({ editor, world, driver, geometryOf: () => G });
  if (body === undefined) throw new Error("no body");
  parts.push(body);
  // the note drawn ONCE: its layout and its geometry in the writing
  writing.tick(16);
  writing.draw(note, { text: words, seeds: "", seed: 7 }, rect, { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 1 }, G);
  const L = writing.layoutOf(note);
  if (L === undefined) throw new Error("no layout");
  /** The client point over text index `i`: before its glyph, mid-height on its line (writing.test.ts's). */
  const pt = (i: number): [number, number] => [pos.x + (L.positions[2 * i] as number) + 1, pos.y + (L.positions[2 * i + 1] as number) - L.ascent * 0.4];
  let clock = 5000;
  /**
   * A pointer event on the container as the platform sends it — and, after the halves heard it, the fact the pointer adapter makes
   * of it fed to the stack and stepped: a down whose default was prevented (claimed) lands `surfaceHandled`.
   */
  const pointer = (type: "pointerdown" | "pointermove" | "pointerup", [x, y]: [number, number], o: { at?: number; feed?: boolean } = {}): PointerEvent => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y });
    clock += 40;
    Object.defineProperty(ev, "timeStamp", { value: o.at ?? clock });
    container.dispatchEvent(ev);
    if (o.feed !== false) {
      const kind = type === "pointerdown" ? "down" : type === "pointerup" ? "up" : "move";
      ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: ev.buttons, mods: NO_MODS, ...(kind === "down" && ev.defaultPrevented ? { surfaceHandled: true as const } : {}) });
      step();
    }
    return ev;
  };
  const click = ([x, y]: [number, number], detail = 1): void => { container.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, detail })); };
  /** A click at text index `i` (Chrome's: the pointerdown's own `detail` 0, the click's the count). */
  const clickAt = (i: number, o: { at?: number; detail?: number } = {}): void => {
    pointer("pointerdown", pt(i), { ...(o.at !== undefined ? { at: o.at } : {}), feed: false });
    pointer("pointerup", pt(i), { feed: false });
    click(pt(i), o.detail ?? 1);
  };
  const el = editor.element;
  const range = (): [number, number] => [el.selectionStart, el.selectionEnd];
  const key = (k: string): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
  const clip = (type: "copy" | "cut" | "paste", data: DataTransfer): ClipboardEvent => {
    const ev = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    el.dispatchEvent(ev);
    return ev;
  };
  const doc = (): string | undefined => (ce.docs.current()?.store.getComponent(note, NOTE_INK) as { text: string } | undefined)?.text;
  return { ce, world, typing, writing, editor, body, note, el, L, pt, pointer, click, clickAt, range, key, clip, doc, step, dispose: () => { editor.dispose(); ce.dispose(); } };
}

describe("the note says where its writing lies, and a drag across it selects (petition I60)", () => {
  it("`indexAt` answers on the sheet — the stack's own hit for it, or none known — and nothing off the sheet or under another object", () => {
    const r = rig();
    try {
      expect(r.body.focus(r.note, 0)).toBe(true);
      const lease = r.editor.lease();
      const [x, y] = r.pt(4);
      expect(lease?.indexAt?.(x, y)).toBe(4);
      expect(lease?.indexAt?.(x, y, r.note)).toBe(4);
      expect(lease?.indexAt?.(x, y, 9999 as Entity)).toBeUndefined();   // another object lies over the sheet here: its press
      expect(lease?.indexAt?.(50, 50)).toBeUndefined();   // off the sheet
      expect(r.writing.indexAt(r.note, 50, 50)).toBeUndefined();
      expect(r.writing.indexAt(r.note, x, y)).toBe(4);
    } finally { r.dispose(); }
  });

  it("a press on the lent note's words is claimed and its drag selects them — the field's range, told to the writing (`selectionOf`) — while the stack, fed the facts the adapter sends, leaves the note where it lay; let go, the same drag carries it (control)", () => {
    const r = rig();
    try {
      r.body.focus(r.note, 0);
      r.pointer("pointermove", r.pt(4));   // the mouse over the note: the stack's exact hit is the note
      const down = r.pointer("pointerdown", r.pt(4));
      expect(down.defaultPrevented).toBe(true);
      for (const i of [5, 6, 7, 8, 9]) r.pointer("pointermove", r.pt(i));
      r.pointer("pointerup", r.pt(9));
      r.click(r.pt(9));
      expect(r.range()).toEqual([4, 9]);
      expect(r.el.value.slice(4, 9)).toBe("quick");
      expect(r.writing.selectionOf()).toEqual({ entity: r.note, from: 4, to: 9 });
      expect(r.world.get(r.note, Position)).toEqual({ x: 100, y: 100 });
      // the lease let go (Escape): the selection lifts with it, and the note is no longer being written — the same drag is the stack's
      r.key("Escape");
      expect(r.editor.lease()).toBeUndefined();
      expect(r.writing.selectionOf()).toBeUndefined();
      const [x, y] = r.pt(4);
      r.pointer("pointermove", [x, y]);
      expect(r.pointer("pointerdown", [x, y]).defaultPrevented).toBe(false);
      for (let i = 1; i <= 6; i++) r.pointer("pointermove", [x + 20 * i, y + 10 * i]);
      r.pointer("pointerup", [x + 120, y + 60]);
      r.step(3);
      const p = r.world.get(r.note, Position);
      expect(p?.x).toBeGreaterThan(150);   // carried with the drag
      expect(p?.y).toBeGreaterThan(120);
    } finally { r.dispose(); }
  });

  it("a second click takes the WORD — letters, digits and apostrophes — and a third the LAID line, without the break that ends it", () => {
    const r = rig();
    try {
      r.body.focus(r.note, 0);
      r.clickAt(28, { at: 1000 });
      r.clickAt(28, { at: 1100, detail: 2 });
      expect(r.range()).toEqual([26, 31]);   // "dog's"
      r.clickAt(33, { at: 3000 });
      r.clickAt(33, { at: 3100, detail: 2 });
      expect(r.range()).toEqual([32, 35]);   // "2nd"
      r.clickAt(33, { at: 3200, detail: 3 });
      const laid = r.L.lines.find((l) => l.start <= 33 && 33 < l.end);
      expect(laid).toBeDefined();
      expect(r.range()).toEqual([laid?.start, laid?.end]);   // the last line: no break after it
      r.clickAt(22, { at: 6000 });
      r.clickAt(22, { at: 6100, detail: 2 });
      r.clickAt(22, { at: 6200, detail: 3 });
      const jumps = r.L.lines.find((l) => l.start <= 22 && 22 < l.end);
      expect(WORDS[(jumps?.end ?? 0) - 1]).toBe("\n");
      expect(r.range()).toEqual([jumps?.start, (jumps?.end ?? 0) - 1]);   // "jumps", its break left out
      expect(r.L.lines.length).toBeGreaterThan(2);   // live: the sheet wraps its words, so a laid line is not the text's line
    } finally { r.dispose(); }
  });

  it("the word and the line by themselves: apostrophes and digits join a word, a caret just after one takes it, a gap takes one character and a break none; a laid line leaves its break out", () => {
    expect(wordRange("don't stop", 2)).toEqual({ from: 0, to: 5 });
    expect(wordRange("don’t stop", 5)).toEqual({ from: 0, to: 5 });   // a typographer's apostrophe; the caret right after the word
    expect(wordRange("v2 x", 1)).toEqual({ from: 0, to: 2 });
    expect(wordRange("a  b", 2)).toEqual({ from: 2, to: 3 });
    expect(wordRange("ab\n\ncd", 3)).toEqual({ from: 3, to: 3 });
    expect(wordRange("", 0)).toEqual({ from: 0, to: 0 });
    const L = layoutText("ab\ncd", { w: 200, h: 200 }, DEFAULT_HAND_LAW, METRICS, 7);
    expect(lineRange(L, "ab\ncd", 1)).toEqual({ from: 0, to: 2 });
    expect(lineRange(L, "ab\ncd", 3)).toEqual({ from: 3, to: 5 });
    expect(lineRange(L, "ab\ncd", 5)).toEqual({ from: 3, to: 5 });
  });

  it("the writing keeps the editor's selection as FLUX: told in order, lifted with `undefined`, forgotten with its note", () => {
    const r = rig();
    try {
      r.writing.select(r.note, 9, 4);
      expect(r.writing.selectionOf()).toEqual({ entity: r.note, from: 4, to: 9 });
      r.writing.select(undefined);
      expect(r.writing.selectionOf()).toBeUndefined();
      r.writing.select(r.note, 2, 3);
      r.writing.forget(r.note);
      expect(r.writing.selectionOf()).toBeUndefined();
    } finally { r.dispose(); }
  });
});

describe("the note's copy, cut and paste (petition I60)", () => {
  const board = (flavours: Record<string, string> = {}): DataTransfer => {
    const d = new DataTransfer();
    for (const [type, data] of Object.entries(flavours)) d.setData(type, data);
    return d;
  };

  it("COPY lifts the selected words as plain text alone (the marks come later); CUT takes them off in ONE input of the note's typing — ONE commit when its writing ends, ONE undo brings them back", () => {
    const r = rig();
    try {
      r.body.focus(r.note, 0);
      r.el.setSelectionRange(4, 10);
      const copied = board();
      expect(r.clip("copy", copied).defaultPrevented).toBe(true);
      expect([...copied.types]).toEqual(["text/plain"]);
      expect(copied.getData("text/plain")).toBe("quick ");
      const cut = board();
      expect(r.clip("cut", cut).defaultPrevented).toBe(true);
      expect(cut.getData("text/plain")).toBe("quick ");
      expect(r.el.value).toBe("the brown fox jumps\ndog's 2nd bone");
      expect(r.typing.open()).toBe(true);   // one live write, not yet committed
      expect(r.doc()).toBe(WORDS);   // nothing committed while it is open
      r.key("Escape");   // the writing ends: ONE transaction
      expect(r.doc()).toBe("the brown fox jumps\ndog's 2nd bone");
      expect(r.ce.docs.undo()).toBe(true);
      expect(r.doc()).toBe(WORDS);   // ONE step
    } finally { r.dispose(); }
  });

  it("PASTE lays the clipboard's words over the selection through the note's typing — its line breaks the field's own — ONE commit, ONE undo; with nothing selected it inserts at the caret", () => {
    const r = rig();
    try {
      r.body.focus(r.note, 4);
      expect(r.clip("paste", board({ "text/plain": "big\r\nred " })).defaultPrevented).toBe(true);
      expect(r.el.value).toBe("the big\nred quick brown fox jumps\ndog's 2nd bone");
      expect(r.range()).toEqual([12, 12]);
      expect(r.typing.open()).toBe(true);
      r.el.setSelectionRange(0, 3);
      r.clip("paste", board({ "text/plain": "a" }));
      expect(r.el.value).toBe("a big\nred quick brown fox jumps\ndog's 2nd bone");
      // a piece with no plain words beside it: nothing the note can lay yet — the platform's paste stands, the selection kept
      r.el.setSelectionRange(0, 1);
      expect(r.clip("paste", board({ "application/x-ice-ink+json": "{}" })).defaultPrevented).toBe(false);
      expect(r.el.value).toBe("a big\nred quick brown fox jumps\ndog's 2nd bone");
      r.key("Escape");
      expect(r.doc()).toBe("a big\nred quick brown fox jumps\ndog's 2nd bone");
      expect(r.ce.docs.undo()).toBe(true);
      expect(r.doc()).toBe(WORDS);   // both pastes were one stretch of typing: one step
    } finally { r.dispose(); }
  });
});
