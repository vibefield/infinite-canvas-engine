// @vitest-environment happy-dom
// THE RANGE AND THE CLIPBOARD through the desk's ONE editor (petition I60 — "write first, then a drag across writing selects"). A lease
// that says where its writing lies (`indexAt`) has the editor CLAIM a primary press on it: its default prevented in the capture phase,
// before the pointer adapter hears it — the adapter's `defaultPrevented` gate then lands the fact `surfaceHandled`, so no carry,
// marquee or pan starts (dom's pointer-claim.test.ts runs that half on the real adapter and stack) — and the focus stays on the
// field. A drag past the slop selects the textarea's own range, a second click takes the word and a third the line, Shift extends;
// a release within the slop is still a TAP. The range is told to the lease with the caret, never stored. A lease that lifts and lays
// takes the field's copy, cut and paste. Here a THIRD-PARTY lease of the test's own — two lines laid ten px a letter — over a real
// engine's world (no layer, no device): the pieces a press runs through.
import { ActiveTool, Camera, closeTray, createCanvasEngine, defineWidget, type Entity, NO_MODS, openTray, widgets } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskEditor } from "../src/host/editor";
import type { DeskEditor, EditorLease, EditorPaste, TextPart, TextTap } from "../src/kit/editor";

// One widget type per FILE (core's registry is global): an object a press may land on over the lease's part.
const CARD =
  widgets.get("select-test:card") ??
  defineWidget({ type: "select-test:card", object: { name: "card" }, stratum: "things", defaultSize: { w: 200, h: 100 }, interaction: { snap: "none" } });

/** Two lines laid ten px a letter from (10, 20), twenty px a line: "one two three" over "four five". */
const TEXT = "one two three\nfour five";
const LINES = [{ start: 0, end: 13 }, { start: 14, end: 23 }] as const;
/** The client point (= the world's: the camera is the identity) of text index `i`, mid-line. */
const at = (i: number): [number, number] => {
  const row = i >= LINES[1].start ? 1 : 0;
  return [10 + (i - LINES[row].start) * 10, 30 + row * 20];
};

interface Told { readonly calls: string[]; value: string | null }

/** A lease that keeps the two lines: where its writing lies (`indexAt`), its words and lines (`rangeAt`) — `mine` the object it writes. */
function writingLease(told: Told, more: Partial<EditorLease> = {}, mine?: Entity): EditorLease {
  return {
    part: "test.writing",
    label: "write on the test",
    value: () => told.value,
    input(v) { told.calls.push(`input ${v}`); told.value = v; },
    keydown: () => false,
    caret(i) { told.calls.push(`caret ${i}`); },
    selection(from, to) { told.calls.push(`selection ${from} ${to}`); },
    place: () => ({ x: 10, y: 20, w: 150, h: 40, fontPx: 14, lineHeight: 20, wrap: true }),
    idle() {},
    ended() { told.calls.push("ended"); },
    indexAt(wx, wy, hit) {
      if (hit !== undefined && hit !== mine) return undefined;   // another object lies over the part: its press
      if (wx < 10 || wx > 160 || wy < 20 || wy > 60) return undefined;
      const line = LINES[wy < 40 ? 0 : 1];
      return line.start + Math.min(Math.max(Math.round((wx - 10) / 10), 0), line.end - line.start);
    },
    rangeAt(i, unit) {
      if (unit === "line") { const line = i >= LINES[1].start ? LINES[1] : LINES[0]; return { from: line.start, to: line.end }; }
      let from = i;
      let to = i;
      while (from > 0 && /\w/.test(TEXT[from - 1] ?? "")) from -= 1;
      while (to < TEXT.length && /\w/.test(TEXT[to] ?? "")) to += 1;
      return { from, to };
    },
    ...more,
  };
}

/** The same lease as the platform knew it before petition I60: none of the new members. */
function plainLease(told: Told): EditorLease {
  const { selection: _s, indexAt: _i, rangeAt: _r, lift: _l, lay: _y, ...rest } = writingLease(told);
  return rest;
}

const made: (() => void)[] = [];
afterEach(() => { for (const end of made.splice(0)) end(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

function rig(parts: TextPart[] = []) {
  const ce = createCanvasEngine({ widgets: [CARD] });
  ce.docs.create();
  const { world } = ce;
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createDeskEditor({ container, world, parts: () => parts, wake: () => {} });
  made.push(() => { editor.dispose(); ce.dispose(); });
  const el = editor.element;
  let clock = 1000;
  /** A pointer event on the container, as the platform sends it: `at` its own time (the editor counts clicks by it). */
  const pointer = (type: string, x: number, y: number, o: { at?: number; shift?: boolean; meta?: boolean; type?: string; detail?: number; buttons?: number } = {}): PointerEvent => {
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: o.buttons ?? (type === "pointerup" ? 0 : 1),
      pointerId: 1, pointerType: o.type ?? "mouse", clientX: x, clientY: y, shiftKey: o.shift ?? false, metaKey: o.meta ?? false, detail: o.detail ?? 0,
    });
    Object.defineProperty(ev, "timeStamp", { value: o.at ?? clock });
    container.dispatchEvent(ev);
    return ev;
  };
  const click = (x: number, y: number, o: { detail?: number; shift?: boolean } = {}): MouseEvent => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, detail: o.detail ?? 1, shiftKey: o.shift ?? false });
    container.dispatchEvent(ev);
    return ev;
  };
  /**
   * A press at text index `i`, its release there and the click that follows, as Chrome sends them: `at` the press's time, `detail` the
   * CLICK's count (the platform's, by the OS's interval) — a pointerdown's own `detail` is 0 there. The press's own event.
   */
  const tapAt = (i: number, o: { at?: number; shift?: boolean; detail?: number } = {}): PointerEvent => {
    const [x, y] = at(i);
    const press = { ...(o.at !== undefined ? { at: o.at } : {}), ...(o.shift !== undefined ? { shift: o.shift } : {}) };
    const down = pointer("pointerdown", x, y, press);
    pointer("pointerup", x, y, press);
    click(x, y, { ...(o.detail !== undefined ? { detail: o.detail } : {}), ...(o.shift !== undefined ? { shift: o.shift } : {}) });
    return down;
  };
  /** A clipboard event on the field, as the platform sends one at the focused textarea. */
  const clip = (type: "copy" | "cut" | "paste", data: DataTransfer): ClipboardEvent => {
    const ev = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    el.dispatchEvent(ev);
    return ev;
  };
  /** The field's range, as [start, end, direction]. */
  const range = (): [number, number, string] => [el.selectionStart, el.selectionEnd, el.selectionDirection];
  const tick = (ms: number): void => { clock += ms; };
  return { ce, world, container, editor, el, pointer, click, tapAt, clip, range, tick };
}

describe("the editor claims a press on the writing it holds, and the drag selects (petition I60)", () => {
  it("a primary press on the lent part is CLAIMED — its default prevented, the focus kept; past the slop the drag sets the field's range from the press's index to the pointer's, its direction the drag's, the lease told the range with the caret; the pointer is captured; the release is no tap", () => {
    const told: Told = { calls: [], value: TEXT };
    const taps: TextTap[] = [];
    const lease = writingLease(told);
    const r = rig([{ part: "test.writing", tap: (t) => { taps.push(t); return { lease }; } }]);
    r.editor.lend(lease, 0);
    told.calls.length = 0;
    const [x0, y0] = at(4);
    const down = r.pointer("pointerdown", x0, y0);
    expect(down.defaultPrevented).toBe(true);   // the adapter, hearing it next, lands it surfaceHandled: no carry, marquee or pan
    expect(document.activeElement).toBe(r.el);
    r.pointer("pointermove", x0 + 6, y0);   // within the slop: nothing selected yet
    expect(r.range()).toEqual([0, 0, "none"]);
    expect(r.container.hasPointerCapture(1)).toBe(false);
    r.pointer("pointermove", ...at(8));
    expect(r.range()).toEqual([4, 8, "forward"]);
    expect(r.container.hasPointerCapture(1)).toBe(true);   // a drag that leaves the container still selects
    r.pointer("pointermove", ...at(1));   // back past the anchor
    expect(r.range()).toEqual([1, 4, "backward"]);
    r.pointer("pointermove", 400, 30);   // off the part, to its right: held to the part's edge — the line's end
    expect(r.range()).toEqual([4, 13, "forward"]);
    expect(told.calls).toEqual(["caret 4", "selection 4 8", "caret 1", "selection 1 4", "caret 4", "selection 4 13"]);
    r.pointer("pointerup", 400, 30);
    expect(r.container.hasPointerCapture(1)).toBe(false);
    r.click(400, 30);
    expect(taps).toEqual([]);   // a drag that selected is no tap: the range stands
    expect(r.range()).toEqual([4, 13, "forward"]);
    expect(r.editor.lease()).toBe(lease);
  });

  it("a release within the slop is still a TAP: the click goes to the parts and the caret goes where the tap put it, as before", () => {
    const told: Told = { calls: [], value: TEXT };
    const taps: TextTap[] = [];
    const lease = writingLease(told);
    const r = rig([{ part: "test.writing", tap: (t) => { taps.push(t); return { lease, caret: lease.indexAt?.(t.wx, t.wy) ?? 0 }; } }]);
    r.editor.lend(lease, 0);
    const [x, y] = at(6);
    expect(r.pointer("pointerdown", x, y).defaultPrevented).toBe(true);
    r.pointer("pointermove", x + 4, y);
    r.pointer("pointerup", x + 4, y);
    r.click(x + 4, y);
    expect(taps).toEqual([{ wx: x + 4, wy: y, found: false, hit: undefined }]);
    expect(r.range()).toEqual([6, 6, "none"]);
    expect(told.calls.slice(-2)).toEqual(["caret 6", "selection 6 6"]);
  });

  it("a second click takes the WORD and a third the LINE (`rangeAt`); a drag after the second extends by words; a second click the editor's own window missed but the platform counted (its click's `detail`) takes its word at the release", () => {
    const told: Told = { calls: [], value: TEXT };
    const lease = writingLease(told);
    const r = rig([{ part: "test.writing", tap: (t) => ({ lease, caret: lease.indexAt?.(t.wx, t.wy) ?? 0 }) }]);
    r.editor.lend(lease, 0);
    r.tapAt(5, { at: 1000 });
    expect(r.range()).toEqual([5, 5, "none"]);   // the first click: a tap
    r.tapAt(5, { at: 1150, detail: 2 });
    expect(r.range()).toEqual([4, 7, "forward"]);   // "two"
    r.tapAt(5, { at: 1300, detail: 3 });
    expect(r.range()).toEqual([0, 13, "forward"]);   // "one two three"
    // a double press dragged: by words, from the word it took
    r.tapAt(15, { at: 5000 });
    const [x, y] = at(15);
    r.pointer("pointerdown", x, y, { at: 5100 });
    expect(r.range()).toEqual([14, 18, "forward"]);   // "four"
    r.pointer("pointermove", ...at(21), { at: 5150 });
    expect(r.range()).toEqual([14, 23, "forward"]);   // through "five"
    r.pointer("pointermove", ...at(1), { at: 5200 });
    expect(r.range()).toEqual([0, 18, "backward"]);   // back over "one": anchored at the end of "four"
    r.pointer("pointerup", ...at(1), { at: 5250 });
    r.click(...at(1), { detail: 2 });
    expect(r.range()).toEqual([0, 18, "backward"]);
    // slow: 500 ms apart is past the desk's multi-tap window, but the platform's own count (by the OS's interval) says two
    r.tapAt(9, { at: 9000 });
    expect(r.range()).toEqual([9, 9, "none"]);
    r.tapAt(9, { at: 9500, detail: 2 });
    expect(r.range()).toEqual([8, 13, "forward"]);   // "three"
    // a platform whose pointerdown carries the count itself takes the word at the press
    r.pointer("pointerdown", ...at(1), { at: 20000, detail: 2 });
    expect(r.range()).toEqual([0, 3, "forward"]);   // "one"
    r.pointer("pointerup", ...at(1), { at: 20050 });
    r.click(...at(1), { detail: 2 });
    expect(r.range()).toEqual([0, 3, "forward"]);
  });

  it("Shift+press extends from the selection's anchor — a drag after it goes on extending — and a Shift click is no tap", () => {
    const told: Told = { calls: [], value: TEXT };
    const taps: TextTap[] = [];
    const lease = writingLease(told);
    const r = rig([{ part: "test.writing", tap: (t) => { taps.push(t); return { lease, caret: lease.indexAt?.(t.wx, t.wy) ?? 0 }; } }]);
    r.editor.lend(lease, 4);
    expect(r.tapAt(10, { at: 1000, shift: true }).defaultPrevented).toBe(true);
    expect(r.range()).toEqual([4, 10, "forward"]);
    r.pointer("pointerdown", ...at(1), { at: 3000, shift: true });   // the anchor holds: back past it
    expect(r.range()).toEqual([1, 4, "backward"]);
    r.pointer("pointermove", ...at(16), { at: 3050 });
    expect(r.range()).toEqual([4, 16, "forward"]);
    r.pointer("pointerup", ...at(16), { at: 3100 });
    r.click(...at(16), { shift: true });
    expect(taps).toEqual([]);
    expect(r.range()).toEqual([4, 16, "forward"]);
  });
});

describe("what is not claimed behaves exactly as before (petition I60)", () => {
  it("a lease that declares none of the new members: its press is not prevented (the adapter lands it as the canvas's — a drag on the part carries it), its drag selects nothing, its click is a tap", () => {
    const told: Told = { calls: [], value: TEXT };
    const lease = plainLease(told);
    const taps: TextTap[] = [];
    const r = rig([{ part: "test.writing", tap: (t) => { taps.push(t); return { lease, caret: 2 }; } }]);
    r.editor.lend(lease, 0);
    const [x, y] = at(4);
    expect(r.pointer("pointerdown", x, y).defaultPrevented).toBe(false);
    r.pointer("pointermove", ...at(9));
    expect(r.range()).toEqual([0, 0, "none"]);
    expect(r.container.hasPointerCapture(1)).toBe(false);
    r.pointer("pointerup", ...at(9));
    r.tapAt(4);
    expect(taps.length).toBe(1);
    expect(r.range()).toEqual([2, 2, "none"]);
    expect(told.calls).not.toContain("selection 2 2");   // nothing it does not declare is called
  });

  it("the claim stands down for a press off the part, a touch, ⌘/ctrl/⌥, another tool, the drawer out, and an object the stack hit over the part — and takes the press where the stack's hit is the lease's own object (control)", () => {
    const told: Told = { calls: [], value: TEXT };
    const r = rig();
    const card = r.ce.ops.spawnWidget(CARD.type, { x: 0, y: 0, w: 200, h: 100, undoable: false });
    r.world.sync();
    const lease = writingLease(told, {}, card);
    const other = writingLease(told, {}, undefined);
    r.editor.lend(lease, 0);
    const [x, y] = at(4);
    const pressed = (o: { type?: string; meta?: boolean } = {}): boolean => {
      const ev = r.pointer("pointerdown", x, y, o);
      r.pointer("pointerup", x, y, o);
      return ev.defaultPrevented;
    };
    expect(r.pointer("pointerdown", 400, 300).defaultPrevented).toBe(false);   // off the part
    r.pointer("pointerup", 400, 300);
    expect(pressed({ type: "touch" })).toBe(false);   // touch: a tap only (handles are not designed)
    expect(pressed({ meta: true })).toBe(false);
    r.world.setResource(ActiveTool, { id: "pan" });
    expect(pressed()).toBe(false);   // a press under another tool is that tool's
    r.world.setResource(ActiveTool, { id: "select" });
    openTray(r.world);
    expect(pressed()).toBe(false);   // the drawer out: the desk is inert
    closeTray(r.world);
    // the stack knows the mouse over the card that lies over the part: its exact hit is the card
    r.ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods: NO_MODS });
    for (let i = 0; i < 3; i++) r.ce.step(2000 + 16 * i);
    r.editor.lend(other, 0);   // a lease whose object is not the card
    expect(pressed()).toBe(false);
    r.editor.lend(lease, 0);   // the card's own lease: its writing, its press
    expect(pressed()).toBe(true);
  });
});

describe("the field's copy, cut and paste through a lease that lifts and lays (petition I60)", () => {
  /** A clipboard as the platform hands one to a clipboard event. */
  const board = (flavours: Record<string, string> = {}): DataTransfer => {
    const d = new DataTransfer();
    for (const [type, data] of Object.entries(flavours)) d.setData(type, data);
    return d;
  };
  const PIECE = "application/x-ice-ink+json";

  it("COPY writes the flavours — `text/plain` always, `text/html` and the kind's piece when the lease gives them — and prevents the platform's own; nothing selected, a lease that lifts nothing, or none that lifts: the platform's own copy, untouched", () => {
    const told: Told = { calls: [], value: TEXT };
    const lifted: [number, number][] = [];
    let give: "all" | "text" | "none" = "all";
    const lease = writingLease(told, {
      lift(from, to) {
        lifted.push([from, to]);
        const text = TEXT.slice(from, to);
        return give === "none" ? undefined : give === "text" ? { text } : { text, html: `<span>${text}</span>`, piece: JSON.stringify({ text, marks: "" }) };
      },
    });
    const r = rig();
    r.editor.lend(lease, 0);
    r.el.setSelectionRange(4, 7);
    const all = board();
    expect(r.clip("copy", all).defaultPrevented).toBe(true);
    expect([all.getData("text/plain"), all.getData("text/html"), all.getData(PIECE)]).toEqual(["two", "<span>two</span>", JSON.stringify({ text: "two", marks: "" })]);
    give = "text";
    const plain = board();
    expect(r.clip("copy", plain).defaultPrevented).toBe(true);
    expect([...plain.types]).toEqual(["text/plain"]);
    give = "none";
    expect(r.clip("copy", board()).defaultPrevented).toBe(false);
    r.el.setSelectionRange(5, 5);
    expect(r.clip("copy", board()).defaultPrevented).toBe(false);   // a caret: nothing to copy
    expect(lifted).toEqual([[4, 7], [4, 7], [4, 7]]);
    r.editor.lend(plainLease(told), 0);
    r.el.setSelectionRange(4, 7);
    const untouched = board();
    expect(r.clip("copy", untouched).defaultPrevented).toBe(false);
    expect([...untouched.types]).toEqual([]);
    expect(r.el.value).toBe(TEXT);
  });

  it("CUT is the copy and the delete in ONE input — through the path an input takes, so the lease's typing records it as one step — the caret where the words were", () => {
    const told: Told = { calls: [], value: TEXT };
    const lease = writingLease(told, { lift: (from, to) => ({ text: TEXT.slice(from, to) }) });
    const r = rig();
    r.editor.lend(lease, 0);
    r.el.setSelectionRange(4, 8);
    told.calls.length = 0;
    const data = board();
    expect(r.clip("cut", data).defaultPrevented).toBe(true);
    expect(data.getData("text/plain")).toBe("two ");
    expect(r.el.value).toBe("one three\nfour five");
    expect(told.calls.filter((c) => c.startsWith("input"))).toEqual(["input one three\nfour five"]);
    expect(r.range()).toEqual([4, 4, "none"]);
    expect(told.calls.at(-1)).toBe("selection 4 4");
  });

  it("PASTE hands the lease the clipboard's piece when it holds one, else its plain words, over the selection; a lay that takes it prevents the platform's paste (the lease writes through `write`, one input), one that declines leaves it; nothing to lay (a picture only) or no `lay`: the platform's own", () => {
    const told: Told = { calls: [], value: TEXT };
    const laid: (EditorPaste & { from: number; to: number })[] = [];
    let take = true;
    let editor: DeskEditor | undefined;
    const lease = writingLease(told, {
      lay(paste, from, to) {
        laid.push({ ...paste, from, to });
        if (!take) return false;
        editor?.write(paste.text, from, to);
        return true;
      },
    });
    const r = rig();
    editor = r.editor;
    r.editor.lend(lease, 0);
    r.el.setSelectionRange(4, 7);
    told.calls.length = 0;
    const piece = JSON.stringify({ text: "TWO", marks: "" });
    expect(r.clip("paste", board({ "text/plain": "TWO", [PIECE]: piece })).defaultPrevented).toBe(true);
    expect(laid[0]).toEqual({ text: "TWO", piece, from: 4, to: 7 });
    expect(r.el.value).toBe("one TWO three\nfour five");
    expect(told.calls.filter((c) => c.startsWith("input"))).toEqual(["input one TWO three\nfour five"]);
    expect(r.range()).toEqual([7, 7, "none"]);
    expect(r.clip("paste", board({ "text/plain": "!" })).defaultPrevented).toBe(true);
    expect(laid[1]).toEqual({ text: "!", from: 7, to: 7 });   // no piece on the clipboard: none handed
    take = false;
    expect(r.clip("paste", board({ "text/plain": "x" })).defaultPrevented).toBe(false);
    expect(r.clip("paste", board({ "image/png": "…" })).defaultPrevented).toBe(false);
    expect(laid.length).toBe(3);   // the picture was nobody's to lay
    r.editor.lend(plainLease(told), 0);
    expect(r.clip("paste", board({ "text/plain": "y" })).defaultPrevented).toBe(false);
  });

  it("`write` goes through the platform's own editing where it answers — `delete` for a cut, `insertText` for words, on the focused field, so its history keeps the step — and the lease hears the platform's own input once; refused, the value is set and the input path run by hand", () => {
    const told: Told = { calls: [], value: TEXT };
    const lease = writingLease(told, { lift: (from, to) => ({ text: TEXT.slice(from, to) }) });
    const r = rig();
    r.editor.lend(lease, 0);
    const asked: string[] = [];
    let answers = true;
    // the platform's editing as a browser does it: the field's selection replaced, then its own `input`
    const exec = (command: string, _ui?: boolean, value?: string): boolean => {
      asked.push(`${command}${value === undefined ? "" : ` ${value}`}`);
      if (!answers) return false;
      const words = command === "delete" ? "" : (value ?? "");
      const a = r.el.selectionStart;
      r.el.value = r.el.value.slice(0, a) + words + r.el.value.slice(r.el.selectionEnd);
      r.el.setSelectionRange(a + words.length, a + words.length);
      r.el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: command === "delete" ? "deleteContentBackward" : "insertText", data: words }));
      return true;
    };
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true, writable: true });
    try {
      r.el.setSelectionRange(0, 4);
      told.calls.length = 0;
      expect(r.clip("cut", board()).defaultPrevented).toBe(true);
      expect(asked).toEqual(["delete"]);
      expect(r.el.value).toBe("two three\nfour five");
      r.editor.write("a ", 0, 0);
      expect(asked).toEqual(["delete", "insertText a "]);
      expect(r.el.value).toBe("a two three\nfour five");
      expect(told.calls.filter((c) => c.startsWith("input"))).toEqual(["input two three\nfour five", "input a two three\nfour five"]);
      answers = false;
      r.editor.write("b", 0, 1);
      expect(r.el.value).toBe("b two three\nfour five");
      expect(told.calls.filter((c) => c.startsWith("input")).at(-1)).toBe("input b two three\nfour five");
      expect(r.range()).toEqual([1, 1, "none"]);
    } finally {
      Reflect.deleteProperty(document, "execCommand");
    }
  });
});

describe("the editor's dispose (petition I60)", () => {
  it("removes every listener it added — the press, its moves, its release and cancel, the compatibility mousedown, the click, the field's keys, input, IME, blur and clipboard, the document's selection — and a press after it claims nothing", () => {
    const ce = createCanvasEngine({ widgets: [CARD] });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const container = document.createElement("div");
    document.body.appendChild(container);
    // every listener the editor adds and removes, on each of its three targets: the container, the field (made inside), the document
    type Entry = readonly [string, string, unknown, boolean];
    const added: Entry[] = [];
    const gone: Entry[] = [];
    const capture = (o: unknown): boolean => (typeof o === "boolean" ? o : (o as { capture?: boolean } | undefined)?.capture === true);
    const watch = (who: string, t: EventTarget): void => {
      const add = t.addEventListener.bind(t);
      const remove = t.removeEventListener.bind(t);
      Object.defineProperty(t, "addEventListener", { configurable: true, value: (type: string, fn: EventListener, o?: unknown) => { added.push([who, type, fn, capture(o)]); add(type, fn, o as AddEventListenerOptions); } });
      Object.defineProperty(t, "removeEventListener", { configurable: true, value: (type: string, fn: EventListener, o?: unknown) => { gone.push([who, type, fn, capture(o)]); remove(type, fn, o as EventListenerOptions); } });
    };
    const make = document.createElement.bind(document);
    watch("container", container);
    watch("document", document);
    Object.defineProperty(document, "createElement", { configurable: true, value: (tag: string) => { const e = make(tag); if (tag === "textarea") watch("field", e); return e; } });
    try {
      const editor = createDeskEditor({ container, world: ce.world, parts: () => [], wake: () => {} });
      editor.lend(writingLease({ calls: [], value: TEXT }), 0);
      editor.dispose();
    } finally {
      for (const name of ["addEventListener", "removeEventListener", "createElement"]) Reflect.deleteProperty(document, name);
    }
    expect(added.map(([, type]) => type).sort()).toEqual(["blur", "click", "compositionend", "compositionstart", "compositionupdate", "copy", "cut", "input", "keydown", "mousedown", "paste", "pointercancel", "pointerdown", "pointermove", "pointerup", "selectionchange"]);
    for (const [who, type, fn, cap] of added) expect(gone.some(([w, t, f, c]) => w === who && t === type && f === fn && c === cap), `${who} ${type} (capture ${cap})`).toBe(true);
    const ev = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, isPrimary: true, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 50, clientY: 30 });
    container.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    ce.dispose();
  });
});
