// @vitest-environment happy-dom
// THE HOST'S ITEMS (petition I60 — a words bar's Cut, Copy, Paste and Select all, its More and its right-click rows): `DeskEditor.command`
// does on the lent field what the keys do. A copy or a cut runs the platform's own command first, its event reaching the editor's own
// clipboard handler (the very flavours the keys write); where the platform refuses, the async clipboard takes the words and their HTML,
// and a cut deletes only once they landed. Every copy and cut is KEPT: a bar's paste lays the kept piece in place of the clipboard's
// plain words when they are its words, and lays it alone where the page may read no clipboard. A RIGHT press on the lent part's writing
// keeps the field's focus and range, and nothing else. A lease of the test's own (one line, ten px a letter) over a real engine's world
// (no layer, no device); the platform's clipboard and its `execCommand` stood in for where happy-dom has none.
import { ActiveTool, Camera, createCanvasEngine, defineTool } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskEditor, PIECE_FLAVOUR } from "../src/host/editor";
import type { DeskEditor, EditorLease } from "../src/kit/editor";

const TEXT = "one two three";

/** A select of another id, as a desk preset defines its own (`desk.select`: core's select shape under its own id). */
const A_SELECT = defineTool({ id: "test.editor-command.select", route: { canvasDrag: "marquee" } });

interface Told { readonly calls: string[]; value: string }

/** A lease of the test's own on one line laid ten px a letter from (10, 20): it lifts its words in three flavours and lays a paste through `write`. */
function writingLease(told: Told, editor: () => DeskEditor, more: Partial<EditorLease> = {}): EditorLease {
  return {
    part: "test.command",
    value: () => told.value,
    input(v) { told.calls.push(`input ${v}`); told.value = v; },
    keydown: () => false,
    caret(i) { told.calls.push(`caret ${i}`); },
    selection(from, to) { told.calls.push(`selection ${from} ${to}`); },
    place: () => ({ x: 10, y: 20, w: 150, h: 20, fontPx: 14 }),
    idle() {},
    ended() { told.calls.push("ended"); },
    indexAt(wx, wy) { return wx < 10 || wx > 160 || wy < 20 || wy > 40 ? undefined : Math.min(Math.max(Math.round((wx - 10) / 10), 0), told.value.length); },
    lift(from, to) { const text = told.value.slice(from, to); return { text, html: `<b>${text}</b>`, piece: JSON.stringify({ text, marks: "9:8" }) }; },
    lay(paste, from, to) { told.calls.push(`lay ${JSON.stringify(paste)} ${from} ${to}`); editor().write(paste.text, from, to); return true; },
    ...more,
  };
}

const undo: (() => void)[] = [];
afterEach(() => { for (const u of undo.splice(0).reverse()) u(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The platform's async clipboard, stood in: what it was handed, and how it answers. */
function installClipboard(fake: Partial<Clipboard>): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: fake });
  undo.push(() => { Reflect.deleteProperty(navigator, "clipboard"); });
}
/** The platform's own `execCommand`, stood in (happy-dom has none). */
function installExec(exec: (name: string) => boolean): void {
  Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: exec });
  undo.push(() => { Reflect.deleteProperty(document, "execCommand"); });
}

function rig(more: Partial<EditorLease> = {}) {
  const ce = createCanvasEngine({ widgets: [] });
  const { world } = ce;
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createDeskEditor({ container, world, parts: () => [], wake: () => {} });
  undo.push(() => { editor.dispose(); ce.dispose(); });
  const told: Told = { calls: [], value: TEXT };
  const lease = writingLease(told, () => editor, more);
  const el = editor.element;
  /** A clipboard event on the field, as the platform sends one at the focused textarea. */
  const clip = (type: "copy" | "cut" | "paste", data: DataTransfer): ClipboardEvent => {
    const ev = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    el.dispatchEvent(ev);
    return ev;
  };
  const pointer = (type: string, x: number, o: { button?: number; buttons?: number; type?: string } = {}): PointerEvent => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, button: o.button ?? 0, buttons: o.buttons ?? 1, pointerId: 1, pointerType: o.type ?? "mouse", clientX: x, clientY: 30 });
    container.dispatchEvent(ev);
    return ev;
  };
  const range = (): [number, number] => [el.selectionStart, el.selectionEnd];
  return { ce, world, container, editor, el, told, lease, clip, pointer, range };
}

describe("a bar's copy and cut write the clipboard as the keys do (petition I60)", () => {
  it("COPY runs the platform's own command first: its event reaches the editor's handler, so the bar writes the lease's three flavours — the async clipboard never asked", async () => {
    const r = rig();
    r.editor.lend(r.lease, 0);
    r.el.setSelectionRange(4, 7);
    const system = new DataTransfer();
    const asked: string[] = [];
    // the platform's copy and cut, as a browser runs them: their event at the focused field; any other command refused
    installExec((name) => {
      asked.push(name);
      if (name !== "copy" && name !== "cut") return false;
      r.clip(name, system);
      return true;
    });
    const write = vi.fn(async () => {});
    installClipboard({ write, writeText: write });
    expect(await r.editor.command("copy")).toBe(true);
    expect(asked).toEqual(["copy"]);
    expect([system.getData("text/plain"), system.getData("text/html"), system.getData(PIECE_FLAVOUR)]).toEqual(["two", "<b>two</b>", JSON.stringify({ text: "two", marks: "9:8" })]);
    expect(write).not.toHaveBeenCalled();
    expect(r.el.value).toBe(TEXT);
    // a CUT through it: the copy, then the delete in ONE input
    r.el.setSelectionRange(3, 7);
    expect(await r.editor.command("cut")).toBe(true);
    expect(asked).toEqual(["copy", "cut", "delete"]);   // the cut's delete tries the platform's own editing first (`write`), refused here
    expect(system.getData("text/plain")).toBe(" two");
    expect(r.told.calls.filter((c) => c.startsWith("input"))).toEqual(["input one three"]);
  });

  it("where the platform refuses its own command, the ASYNC CLIPBOARD takes the words and their HTML (an item where it takes one, else the words alone); a CUT deletes once they landed — refused, nothing is cut", async () => {
    const r = rig();
    r.editor.lend(r.lease, 0);
    r.el.setSelectionRange(4, 7);
    const items: Record<string, Blob>[] = [];
    vi.stubGlobal("ClipboardItem", class { constructor(readonly data: Record<string, Blob>) { items.push(data); } });
    const written: unknown[] = [];
    let refuse = false;
    installClipboard({
      write: async (got: ClipboardItems) => { if (refuse) throw new Error("no"); written.push(got); },
      writeText: async (text: string) => { if (refuse) throw new Error("no"); written.push(text); },
    });
    expect(await r.editor.command("copy")).toBe(true);   // no execCommand here: the async clipboard
    expect(Object.keys(items[0] ?? {})).toEqual(["text/plain", "text/html"]);
    expect(await Promise.all([items[0]?.["text/plain"]?.text(), items[0]?.["text/html"]?.text()])).toEqual(["two", "<b>two</b>"]);
    vi.stubGlobal("ClipboardItem", undefined);   // a platform with no clipboard item: the words alone
    expect(await r.editor.command("copy")).toBe(true);
    expect(written.at(-1)).toBe("two");
    expect(await r.editor.command("cut")).toBe(true);
    expect(r.el.value).toBe("one  three");
    expect(r.told.calls.filter((c) => c.startsWith("input"))).toEqual(["input one  three"]);
    refuse = true;
    r.el.setSelectionRange(0, 3);
    expect(await r.editor.command("cut")).toBe(false);   // the clipboard refused the words: they stay
    expect(r.el.value).toBe("one  three");
  });

  it("COPY and CUT want words: a caret, nothing lent, or an IME composition running answer false and touch nothing", async () => {
    const r = rig();
    for (const name of ["cut", "copy", "paste", "selectAll"] as const) expect(await r.editor.command(name)).toBe(false);   // nothing lent
    r.editor.lend(r.lease, 2);
    expect(await r.editor.command("copy")).toBe(false);
    expect(await r.editor.command("cut")).toBe(false);
    r.el.setSelectionRange(0, 3);
    r.el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(await r.editor.command("copy")).toBe(false);
    expect(r.el.value).toBe(TEXT);
  });
});

describe("a bar's paste and select all (petition I60)", () => {
  it("PASTE lays the system clipboard's words through the lease's `lay`; the KEPT piece in their place when they are its words (its marks come back); the kept piece alone where the page may read no clipboard; nothing kept and nothing read: false", async () => {
    const r = rig();
    r.editor.lend(r.lease, 0);
    let clipboard: string | Error = "TWO";
    installClipboard({ readText: async () => { if (clipboard instanceof Error) throw clipboard; return clipboard; }, writeText: async () => {} });
    r.el.setSelectionRange(4, 7);
    expect(await r.editor.command("paste")).toBe(true);
    expect(r.told.calls.filter((c) => c.startsWith("lay")).at(-1)).toBe('lay {"text":"TWO"} 4 7');
    expect(r.el.value).toBe("one TWO three");
    // a copy is kept: the clipboard's words are its, so its piece is laid
    r.el.setSelectionRange(0, 3);
    await r.editor.command("copy");
    clipboard = "one";
    r.el.setSelectionRange(13, 13);
    expect(await r.editor.command("paste")).toBe(true);
    expect(r.told.calls.filter((c) => c.startsWith("lay")).at(-1)).toBe(`lay ${JSON.stringify({ text: "one", piece: JSON.stringify({ text: "one", marks: "9:8" }) })} 13 13`);
    // the read refused: the kept piece itself
    clipboard = new Error("not allowed");
    r.el.setSelectionRange(0, 0);
    expect(await r.editor.command("paste")).toBe(true);
    expect(r.el.value).toBe("oneone TWO threeone");
    // a fresh desk: a platform with no clipboard to read, and nothing kept
    const bare = rig();
    installClipboard({});
    bare.editor.lend(bare.lease, 0);
    expect(await bare.editor.command("paste")).toBe(false);
  });

  it("PASTE told the HOST'S WORDS (`command(\"paste\", { text })` — a shell that reads the clipboard its own way) reads NO clipboard: the words laid plain; the kept piece in their place only when they are exactly its words (its marks come back); line ends as the field's; no words, nothing", async () => {
    const r = rig();
    r.editor.lend(r.lease, 0);
    const readText = vi.fn(async () => "never");
    const read = vi.fn(async () => [] as ClipboardItems);
    installClipboard({ readText, read, writeText: async () => {} });
    const lays = (): string | undefined => r.told.calls.filter((c) => c.startsWith("lay")).at(-1);
    r.el.setSelectionRange(4, 7);
    expect(await r.editor.command("paste", { text: "TWO" })).toBe(true);
    expect([lays(), r.el.value]).toEqual(['lay {"text":"TWO"} 4 7', "one TWO three"]);
    r.el.setSelectionRange(0, 3);
    expect(await r.editor.command("copy")).toBe(true);   // kept: "one" and its piece
    r.el.setSelectionRange(13, 13);
    expect(await r.editor.command("paste", { text: "one" })).toBe(true);
    expect(lays()).toBe(`lay ${JSON.stringify({ text: "one", piece: JSON.stringify({ text: "one", marks: "9:8" }) })} 13 13`);
    r.el.setSelectionRange(16, 16);
    expect(await r.editor.command("paste", { text: "one " })).toBe(true);   // not exactly its words: plain
    expect(lays()).toBe('lay {"text":"one "} 16 16');
    r.el.setSelectionRange(0, 0);
    expect(await r.editor.command("paste", { text: "a\r\nb" })).toBe(true);
    expect(lays()).toBe('lay {"text":"a\\nb"} 0 0');
    expect(await r.editor.command("paste", { text: "" })).toBe(false);
    expect([readText.mock.calls.length, read.mock.calls.length]).toEqual([0, 0]);
    expect(await r.editor.command("paste")).toBe(true);   // the no-argument form reads the clipboard, as ever
    expect(readText.mock.calls.length).toBe(1);
  });

  it("a lease that lays nothing has the words written as the platform's paste would write them — line ends as the field's", async () => {
    const r = rig();
    const { lay: _lay, ...plain } = r.lease;
    r.editor.lend(plain, 0);
    installClipboard({ readText: async () => "a\r\nb" });
    r.el.setSelectionRange(3, 3);
    expect(await r.editor.command("paste")).toBe(true);
    expect(r.el.value).toBe("onea\nb two three");
    expect(r.told.calls.filter((c) => c.startsWith("input"))).toEqual(["input onea\nb two three"]);
  });

  it("SELECT ALL selects the lent part's every word, told to the lease", async () => {
    const r = rig();
    r.editor.lend(r.lease, 4);
    r.told.calls.length = 0;
    expect(await r.editor.command("selectAll")).toBe(true);
    expect(r.range()).toEqual([0, TEXT.length]);
    expect(r.told.calls).toEqual(["caret 0", `selection 0 ${TEXT.length}`]);
    expect(document.activeElement).toBe(r.el);
  });
});

describe("a right press on the writing keeps the field for a host's right-click rows (petition I60)", () => {
  it("a RIGHT press on the lent part's writing has its default prevented — the focus and the range survive it, its compatibility mousedown's too — and nothing else: no range, no capture; off the writing, under another tool, a touch, or a lease that says not where its writing lies: the platform's own", () => {
    const r = rig();
    r.editor.lend(r.lease, 0);
    r.el.setSelectionRange(4, 7);
    r.told.calls.length = 0;
    const down = r.pointer("pointerdown", 55, { button: 2, buttons: 2 });
    expect(down.defaultPrevented).toBe(true);
    const mouse = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    r.container.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(true);
    r.pointer("pointermove", 120, { button: -1, buttons: 2 });
    r.pointer("pointerup", 120, { button: 2, buttons: 0 });
    expect(r.range()).toEqual([4, 7]);   // the range stands: a right press selects nothing
    expect(r.container.hasPointerCapture(1)).toBe(false);
    expect(document.activeElement).toBe(r.el);
    expect(r.editor.lease()).toBe(r.lease);
    expect(r.told.calls).toEqual([]);
    expect(r.pointer("pointerdown", 400, { button: 2, buttons: 2 }).defaultPrevented).toBe(false);   // off the writing
    expect(r.pointer("pointerdown", 55, { button: 2, buttons: 2, type: "touch" }).defaultPrevented).toBe(false);
    r.world.setResource(ActiveTool, { id: "pan" });
    expect(r.pointer("pointerdown", 55, { button: 2, buttons: 2 }).defaultPrevented).toBe(false);
    r.world.setResource(ActiveTool, { id: A_SELECT.id });
    expect(r.pointer("pointerdown", 55, { button: 2, buttons: 2 }).defaultPrevented).toBe(true);   // a select of another id (the desk's `desk.select`): kept
    r.world.setResource(ActiveTool, { id: "select" });
    const { indexAt: _where, ...blind } = r.lease;
    r.editor.lend(blind, 0);
    expect(r.pointer("pointerdown", 55, { button: 2, buttons: 2 }).defaultPrevented).toBe(false);
    const later = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    r.container.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);   // a press not kept: its mousedown is the platform's
  });
});
