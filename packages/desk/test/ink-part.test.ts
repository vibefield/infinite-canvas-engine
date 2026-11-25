// @vitest-environment happy-dom
// THE WRITTEN PART AND THE INK ACTS (petition I60 — the editing is the desk's own, so a downstream object gets it whole, shows it in
// its menu and hands it to an agent): a kind DECLARES its writing — its geometry, its ink cell, the marks its words take, a sink its
// render half draws from — and the kit gives it the rest. A TEST KIND of the file's own, written in a hand of ten units a letter (no
// jitter) from a 10-unit margin, its lines 24 apart, through the real pieces: `inkTyping` over a real engine's document (the draft,
// its one commit, a read-only document); `inkPart` leasing the real editor (`createDeskEditor` in a happy-dom page: a tap, typing, a
// drag, a word, a line, the clipboard's three flavours, a paste of a piece and of plain words, a cut as one input); the acts run
// through the engine (`ops.runMenuAction`), with and without an open draft and across two desks; and a real desk layer on the fake
// device, whose words' menu carries them.
import { Camera, createCanvasEngine, Editing, type Entity, NO_MODS, p, Position, Viewport, type WidgetType, type World } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TypingDocs } from "../src/docs";
import { createDeskEditor, PIECE_FLAVOUR } from "../src/host/editor";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectDomHost, ObjectKind } from "../src/kinds/world";
import type { TextPart } from "../src/kit/editor";
import { encodeMarks, highlightOf, type InkValue, inkCells, inkOf, lift, mark, penOf, strikeOf, underlineOf } from "../src/kit/ink";
import { INK_ACTS, inkActs, inkCommonHighlighter, inkCommonPen, inkEveryLetter } from "../src/kit/ink-acts";
import { type InkGeometry, inkHtml, type InkPart, type InkPartOptions, inkPart, printable, readPiece } from "../src/kit/ink-part";
import { carryRun, type InkArrival, type InkSink, type InkTypedRun, type InkTypingDoor, inkTyping, inkTypingOn, keepRun, registerInkTyping } from "../src/kit/ink-typing";
import { type HandLaw, type HandMetrics, layoutText, PENS } from "../src/kit/text";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

/** The test's hand: a face of 0.5 em at a 20-unit pen (ten units a letter), no jitter, no wander, a 10-unit margin, lines 24 apart. */
const LAW: HandLaw = { size: 20, lineHeight: 1.2, pad: 10, jitter: { rot: 0, rise: 0, scale: 0, press: [1, 1] }, wander: { amp: 0, period: 9 } };
const METRICS: HandMetrics = { ascent: 0.8, descent: 0.2, advance: () => 0.5 };
/** The sheet's size: its layout's box. */
const W = 400;
const H = 100;

/** The sheets each world has, in the order spawned (the kind's `objectAt` asks them, the last on top). */
const sheetsOf = new Map<World, Entity[]>();
/** The written part each desk layer's mount made (the object's DOM half), by world. */
const made = new Map<World, InkPart>();

// ONE type a file (core's registry is global): the test kind, its object with an ink cell, the desk's ink acts and a written part
const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
const SHEET_KIND: ObjectKind = { name: "ink-sheet", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}), hit: () => "content" };
const SHEET: WidgetType = defineObject({
  type: "test.ink-sheet",
  version: 1,
  props: { text: p.string({ default: "" }), seeds: p.string({ default: "" }), marks: p.string({ default: "" }), pen: p.enum(PENS, { default: "fountain" }), seed: p.number({ default: 7 }) },
  groups: { ink: ["text", "seeds", "marks"] },
  kind: SHEET_KIND,
  menu: inkActs(),
  host: { text: (h: ObjectDomHost) => { const { part } = sheetPart(h); made.set(h.world, part); return [part]; } },
});
const INK = SHEET.groups.find((g) => g.name === "ink")?.component;
if (INK === undefined) throw new Error("the test sheet has no ink cell");

/** What the kind's sink was told, in order. */
interface Told {
  readonly drafts: { readonly text: string | undefined; readonly arrived?: InkArrival }[];
  readonly carets: (number | undefined)[];
  readonly selections: (readonly [number, number] | undefined)[];
}

/**
 * The test kind's written part on a host: its GEOMETRY — the sheet where its object lies (turned a quarter about its top-left when
 * `turned`), its layout laid from the ink the field shows (as a kind's sink would feed its own) — and its sink recorded; fresh seeds
 * counted from 1001.
 */
function sheetPart(host: Pick<ObjectDomHost, "world" | "docs" | "editor" | "object">, more: Partial<InkPartOptions> & { readonly turned?: boolean } = {}) {
  const { turned, ...opts } = more;
  const { world } = host;
  const told: Told = { drafts: [], carets: [], selections: [] };
  const ref: { part?: InkPart } = {};
  const origin = (e: Entity): { readonly x: number; readonly y: number } => world.get(e, Position) ?? { x: 0, y: 0 };
  const toLayout = (e: Entity, wx: number, wy: number): readonly [number, number] | undefined => {
    const o = origin(e);
    const x = wx - o.x;
    const y = wy - o.y;
    return x >= 0 && x <= W && y >= 0 && y <= H ? [x, y] : undefined;
  };
  const geometry: InkGeometry = {
    layout: (e) => { const ink = ref.part?.typing.ink(e); return ink === undefined ? undefined : layoutText(ink.text, { w: W, h: H }, LAW, METRICS, 7, ink.seeds); },
    toLayout,
    toWorld: (e, x, y) => { const o = origin(e); return turned === true ? [o.x + H - y, o.y + x] : [o.x + x, o.y + y]; },
    place: (e) => { const o = origin(e); return { x: o.x, y: o.y, w: W, h: H, fontPx: 20, lineHeight: 24, wrap: true }; },
    objectAt: (wx, wy) => [...(sheetsOf.get(world) ?? [])].reverse().find((e) => world.isAlive(e) && toLayout(e, wx, wy) !== undefined),
  };
  const sink: InkSink = {
    draft: (_e, ink, arrived) => { told.drafts.push({ text: ink?.text, ...(arrived !== undefined ? { arrived } : {}) }); },
    caret: (_e, index) => { told.carets.push(index); },
    selection: (e, from, to) => { told.selections.push(e === undefined ? undefined : [from ?? 0, to ?? 0]); },
  };
  let seed = 1000;
  const part = inkPart(host, { part: "test.sheet", label: "write on the test sheet", geometry, sink, fresh: () => ++seed, ...opts });
  ref.part = part;
  return { part, told, geometry };
}

/** A cell's three strings as the document holds them. */
type Cell = { readonly text: string; readonly seeds: string; readonly marks: string };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  sheetsOf.clear();
  made.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** An engine with a document and the test sheet: its world, a spawn, the cell read. */
function engine() {
  const ce = createCanvasEngine({ widgets: [SHEET] });
  ce.docs.create();
  cleanups.push(() => ce.dispose());
  const { world } = ce;
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const spawn = (text: string, props: Readonly<Record<string, unknown>> = {}, x = 0, y = 0): Entity => {
    const e = ce.ops.spawnWidget(SHEET.type, { x, y, w: W, h: H, props: { text, ...props }, undoable: false });
    world.sync();   // its cells projected into the world (a frame would)
    sheetsOf.set(world, [...(sheetsOf.get(world) ?? []), e]);
    return e;
  };
  const cell = (e: Entity): Cell => world.get(e, INK as NonNullable<typeof INK>) as Cell;
  /** Every prop of `e` as the engine hands an act (`MenuActionApi.props`): its groups' cells, flat. */
  const props = (e: Entity): Readonly<Record<string, unknown>> => Object.assign({}, ...SHEET.groups.map((g) => world.get(e, g.component) ?? {}));
  /** The facade's undo, the world synced after it (a history step is projected at the next sync, as a frame would). */
  const undo = (): boolean => {
    const ok = ce.docs.undo();
    world.sync();
    return ok;
  };
  return { ce, world, spawn, cell, props, undo };
}

/** The facade's document doors, the version gate held read-only while `ro.on`. */
function gated(docs: TypingDocs, ro: { on: boolean }): TypingDocs {
  return {
    current: () => {
      const s = docs.current();
      return s === undefined ? undefined : { store: s.store, liveWriter: s.liveWriter, readOnly: ro.on || s.readOnly, versionReport: () => s.versionReport() };
    },
  };
}

/** A clipboard as the platform hands one to a clipboard event. */
function board(flavours: Readonly<Record<string, string>> = {}): DataTransfer {
  const d = new DataTransfer();
  for (const [type, data] of Object.entries(flavours)) d.setData(type, data);
  return d;
}

/** The engine, the ONE editor in a page (no layer, no device) and the test kind's written part leasing it. */
function rig(opts: { readonly idleMs?: number; readonly part?: Partial<InkPartOptions> & { readonly turned?: boolean } } = {}) {
  const en = engine();
  const { ce, world } = en;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const parts: TextPart[] = [];
  const editor = createDeskEditor({ container, world, parts: () => parts, wake: () => {}, idleMs: opts.idleMs ?? 60_000 });
  cleanups.push(() => editor.dispose());
  const { part, told, geometry } = sheetPart({ world, docs: ce.docs, editor, object: SHEET }, opts.part);
  parts.push(part);
  const el = editor.element;
  /** Text index `i`'s place on `e`'s writing (client px = world: the camera is the identity): its caret's x, mid-line. */
  const at = (e: Entity, i: number): [number, number] => {
    const L = geometry.layout(e);
    const o = world.get(e, Position) ?? { x: 0, y: 0 };
    if (L === undefined) throw new Error("no layout");
    return [o.x + (L.positions[2 * i] as number), o.y + (L.positions[2 * i + 1] as number) - 6];
  };
  let clock = 1000;
  const pointer = (type: string, x: number, y: number, o: { at?: number; type?: string; id?: number; button?: number; buttons?: number; detail?: number } = {}): PointerEvent => {
    const ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, button: o.button ?? (type === "pointermove" ? -1 : 0), buttons: o.buttons ?? (type === "pointerup" ? 0 : 1),
      pointerId: o.id ?? 1, pointerType: o.type ?? "mouse", clientX: x, clientY: y, detail: o.detail ?? 0,
    });
    Object.defineProperty(ev, "timeStamp", { value: o.at ?? clock });
    container.dispatchEvent(ev);
    return ev;
  };
  const click = (x: number, y: number, detail = 1): void => { container.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, detail })); };
  /** A press at text index `i` of `e`, its release there and its click, as Chrome sends them (`detail` the click's count). */
  const tapAt = (e: Entity, i: number, o: { at?: number; detail?: number; type?: string; id?: number } = {}): void => {
    const [x, y] = at(e, i);
    const press = { ...(o.at !== undefined ? { at: o.at } : {}), ...(o.type !== undefined ? { type: o.type } : {}), ...(o.id !== undefined ? { id: o.id } : {}) };
    pointer("pointerdown", x, y, press);
    pointer("pointerup", x, y, press);
    click(x, y, o.detail ?? 1);
    clock += 1000;
  };
  /** A clipboard event on the field, as the platform sends one at the focused textarea. */
  const clip = (type: "copy" | "cut" | "paste", data: DataTransfer): ClipboardEvent => {
    const ev = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data });
    el.dispatchEvent(ev);
    return ev;
  };
  /** The platform types: the field's new value and its caret, then its input event. */
  const type = (value: string, caret = value.length): void => {
    el.value = value;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  };
  const range = (): [number, number, string] => [el.selectionStart, el.selectionEnd, el.selectionDirection];
  return { ...en, container, editor, el, part, told, geometry, at, pointer, click, tapAt, clip, type, range };
}

describe("the typing: a draft, landed in one step (`inkTyping`)", () => {
  it("every input carries the ink into a DRAFT — the cell does not move, the sink is told the draft and how its glyphs came; the commit lands ONE undoable step writing the text, the seeds and the marks together", () => {
    const { world, ce, spawn, cell, undo } = engine();
    const marks = encodeMarks(mark(inkOf({ text: "one two" }, 7), 4, 7, { highlight: "yellow" }).marks);
    const e = spawn("one two", { marks });
    const drafts: { readonly text: string | undefined; readonly arrived?: InkArrival }[] = [];
    let seed = 1000;
    const t = inkTyping({ world, docs: ce.docs, object: SHEET, sink: { draft: (_e, ink, arrived) => { drafts.push({ text: ink?.text, ...(arrived !== undefined ? { arrived } : {}) }); } }, fresh: () => ++seed });
    expect(t.begin(e)).toBe(true);
    expect([t.editing(), t.open()]).toEqual([e, false]);
    expect(t.input("one twxo")).toEqual({ from: 6, to: 7 });   // a letter typed inside the highlight
    expect(cell(e)).toMatchObject({ text: "one two", seeds: "", marks });   // the document did not move
    const d = t.ink(e) as InkValue;
    expect(d.text).toBe("one twxo");
    expect(d.marks.map(highlightOf)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);   // the typed letter joined the highlight it fell in
    expect(d.seeds[6]).toBe(1001);   // a fresh hand…
    expect([...d.seeds.slice(0, 6), d.seeds[7]]).toEqual(inkOf({ text: "one two" }, 7).seeds);   // …and every other glyph its own
    expect(t.committed(e)?.text).toBe("one two");
    expect(drafts).toEqual([{ text: "one twxo", arrived: { from: 6, to: 7, how: "typed" } }]);
    t.input("one twxo!");
    const landed = t.ink(e) as InkValue;
    expect(t.commit()).toBe(true);
    expect(t.open()).toBe(false);
    expect(t.editing()).toBe(e);   // the object stays the typing's
    expect(cell(e)).toEqual(inkCells(landed));   // the three, together
    expect(drafts.at(-1)).toEqual({ text: undefined });
    // ONE step: an undo brings the words and their marks back as they were, and nothing is left to undo
    expect(undo()).toBe(true);
    expect(cell(e)).toMatchObject({ text: "one two", seeds: "", marks });
    expect(undo()).toBe(false);
  });

  it("a draft that NETS TO NOTHING lands nothing — the words, the hand and the marks as found, the marks compared as the cell reads them (runs stored longer than they need): no step, the cell's bytes untouched", () => {
    const { world, ce, spawn, cell, undo } = engine();
    const e = spawn("one two", { marks: "4:0,3:8,5:0" });   // the last run reaches past the words: read, it is cut
    const drafts: (string | undefined)[] = [];
    const t = inkTyping({ world, docs: ce.docs, object: SHEET, sink: { draft: (_e, ink) => { drafts.push(ink?.text); } } });
    t.begin(e);
    t.input("one twxo");
    t.input("one two");   // the typed letter taken back: every glyph its own hand and its own mark again
    expect(t.open()).toBe(true);
    expect(t.commit()).toBe(false);
    expect(cell(e)).toEqual({ text: "one two", seeds: "", marks: "4:0,3:8,5:0" });
    expect(undo()).toBe(false);
    expect(drafts).toEqual(["one twxo", "one two", undefined]);
  });

  it("the edit is found by the CARET after it where the caret can say: a cut of \"two \" from \"one two three\" takes those letters and their marks (the prefix alone would keep two's \"t\" and leave its underline on \"three\"), a letter typed before an equal one is the new one; with no caret, or one that ends no edit, the common prefix and suffix", () => {
    const { world, ce, spawn } = engine();
    const under = encodeMarks(mark(inkOf({ text: "one two three" }, 7), 4, 7, { underline: true }).marks);
    const e = spawn("one two three", { marks: under });
    const f = spawn("aa");
    let seed = 1000;
    const t = inkTyping({ world, docs: ce.docs, object: SHEET, fresh: () => ++seed });
    t.begin(e);
    expect(t.input("one three", 4)).toEqual({ from: 4, to: 4 });
    expect((t.ink(e) as InkValue).marks.map(underlineOf)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect((t.ink(e) as InkValue).seeds).toEqual([...inkOf({ text: "one two three" }, 7).seeds.slice(0, 4), ...inkOf({ text: "one two three" }, 7).seeds.slice(8)]);
    t.end();
    t.begin(f);
    const was = inkOf({ text: "aa" }, 7).seeds;
    expect(t.input("aaa", 1)).toEqual({ from: 0, to: 1 });   // typed at the start: the first "a" is the new one
    expect((t.ink(f) as InkValue).seeds).toEqual([1001, ...was]);
    expect(t.input("aaaa")).toEqual({ from: 3, to: 4 });   // no caret: the common prefix and suffix
    expect(t.input("aaaab", 2)).toEqual({ from: 4, to: 5 });   // a caret that ends no edit (the words after it are not the old end): the same
  });

  it("a READ-ONLY document is read, never written: no typing opens on it; one gone read-only while a draft is open lands nothing — the draft goes, the cell as it was, the sink told", () => {
    const { world, ce, spawn, cell, undo } = engine();
    const e = spawn("one two");
    const ro = { on: true };
    const drafts: (string | undefined)[] = [];
    const t = inkTyping({ world, docs: gated(ce.docs, ro), object: SHEET, sink: { draft: (_e, ink) => { drafts.push(ink?.text); } } });
    expect(t.begin(e)).toBe(false);
    expect(t.editing()).toBeUndefined();
    expect(t.committed(e)?.text).toBe("one two");   // read
    ro.on = false;
    expect(t.begin(e)).toBe(true);
    t.input("one two three");
    ro.on = true;   // the gate's verdict moved under the open draft (a peer's pack)
    expect(t.commit()).toBe(false);
    expect(cell(e).text).toBe("one two");
    expect(t.open()).toBe(false);
    expect(drafts).toEqual(["one two three", undefined]);
    expect(undo()).toBe(false);
  });

  it("a PASTE lays a piece on the draft — its words in a fresh hand, the marks the kind keeps (one that keeps the highlight alone drops a pasted pen and strike); a LIFT takes words and marks, never the seeds; a cell the type does not hold is told by name at once", () => {
    const { ce, world, spawn } = engine();
    const e = spawn("one two");
    let seed = 1000;
    const t = inkTyping({ world, docs: ce.docs, object: SHEET, marks: ["highlight"], fresh: () => ++seed });
    t.begin(e);
    const red: InkValue = mark(mark(mark(inkOf({ text: "RED" }, 0), 0, 3, { pen: "red" }), 0, 3, { highlight: "pink" }), 0, 3, { strike: true });
    expect(t.paste(lift(red, 0, 3), 0, 3)).toEqual({ from: 0, to: 3 });
    const d = t.ink(e) as InkValue;
    expect(d.text).toBe("RED two");
    expect(d.seeds.slice(0, 3)).toEqual([1001, 1002, 1003]);   // written again in a fresh hand
    expect(d.marks.slice(0, 3).map((m) => [penOf(m), highlightOf(m), strikeOf(m)])).toEqual([[0, 3, 0], [0, 3, 0], [0, 3, 0]]);   // pink, the third
    expect(t.lift(0, 3)).toEqual({ text: "RED", marks: encodeMarks(d.marks.slice(0, 3)) });
    expect(t.paste({ text: "", marks: "" }, 2, 2)).toBeNull();   // no words over a caret: nothing moves
    expect(() => inkTyping({ world, docs: ce.docs, object: SHEET, ink: "props" })).toThrow('ice: inkTyping("test.ink-sheet") — its ink cell is the group "props", holding text, seeds and marks (`groups: { props: ["text", "seeds", "marks"] }`): the group lacks text, seeds, marks.');
    expect(() => inkTyping({ world, docs: ce.docs, object: SHEET, ink: "body" })).toThrow(/the group "body".*it declares no such group/);
  });
});

describe("the written part's lease, end to end through the one editor (`inkPart`)", () => {
  it("a tap lends the editor to the object the stack hit — the lease names it, its words the cell's, the caret where the tap fell; typing is the draft (the field the truth), told to the sink; 1 s without input lands it as ONE step; Escape lets it go; a touch, its pointer gone, finds the sheet by the kind's word", async () => {
    const r = rig({ idleMs: 5 });
    const e = r.spawn("one two three");
    r.world.sync();
    // the stack knows the mouse over the sheet: its exact hit is the sheet
    const [x, y] = r.at(e, 4);
    r.ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods: NO_MODS });
    for (let i = 0; i < 3; i++) r.ce.step(2000 + 16 * i);
    r.tapAt(e, 4);
    const lease = r.editor.lease();
    expect([lease?.entity, lease?.part, r.el.getAttribute("aria-label")]).toEqual([e, "test.sheet", "write on the test sheet"]);
    expect(r.el.value).toBe("one two three");
    expect(r.range()).toEqual([4, 4, "none"]);
    expect(r.part.editing()).toBe(e);
    // the platform types: the draft moves, the document does not, the field is the truth
    r.type("one XYtwo three", 6);
    expect(lease?.value()).toBeNull();
    expect(r.cell(e).text).toBe("one two three");
    expect(r.told.drafts.at(-1)).toEqual({ text: "one XYtwo three", arrived: { from: 4, to: 6, how: "typed" } });
    expect([r.told.carets.at(-1), r.told.selections.at(-1)]).toEqual([6, [6, 6]]);
    await new Promise((done) => setTimeout(done, 40));   // the idle: no input for its while
    expect(r.cell(e).text).toBe("one XYtwo three");
    expect(r.told.drafts.at(-1)).toEqual({ text: undefined });
    expect(lease?.value()).toBe("one XYtwo three");
    expect(r.undo()).toBe(true);
    expect(r.cell(e).text).toBe("one two three");
    expect(r.undo()).toBe(false);
    // Escape lets it go: the sink's caret and selection lifted
    r.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(r.editor.lease()).toBeUndefined();
    expect(r.part.editing()).toBeUndefined();
    expect([r.told.carets.at(-1), r.told.selections.at(-1)]).toEqual([undefined, undefined]);
    // a touch's tap: its pointer gone by the click, the stack knows it not — the kind's `objectAt` finds the sheet
    r.tapAt(e, 2, { type: "touch", id: 7 });
    expect(r.editor.lease()?.entity).toBe(e);
    expect(r.range()).toEqual([2, 2, "none"]);
  });

  it("a drag across the writing selects (the editor's claim): the field's range from the press to the pointer, told to the sink; a second click takes the WORD (`wordAt`), a third the laid LINE (`lineAt`, its break with it); `indexAt` answers on the part alone and never under another object's hit", () => {
    const r = rig();
    const e = r.spawn("one two three\nfour five");
    const other = r.spawn("", {}, 0, 200);
    expect(r.part.focus(e, 0)).toBe(true);
    const down = r.pointer("pointerdown", ...r.at(e, 4));
    expect(down.defaultPrevented).toBe(true);
    r.pointer("pointermove", ...r.at(e, 8));
    expect(r.range()).toEqual([4, 8, "forward"]);
    expect(r.told.selections.at(-1)).toEqual([4, 8]);
    r.pointer("pointerup", ...r.at(e, 8));
    r.click(...r.at(e, 8));
    expect(r.range()).toEqual([4, 8, "forward"]);   // a drag that selected is no tap
    r.tapAt(e, 15, { at: 5000 });
    r.tapAt(e, 15, { at: 5150, detail: 2 });
    expect(r.range()).toEqual([14, 18, "forward"]);   // "four"
    r.tapAt(e, 5, { at: 9000 });
    r.tapAt(e, 5, { at: 9150, detail: 2 });
    r.tapAt(e, 5, { at: 9300, detail: 3 });
    expect(r.range()).toEqual([0, 14, "forward"]);   // "one two three\n": the laid line, its break with it
    const lease = r.editor.lease();
    const [x, y] = r.at(e, 4);
    expect([lease?.indexAt?.(x + 2, y), lease?.indexAt?.(x + 2, y, e), lease?.indexAt?.(x + 2, y, other), lease?.indexAt?.(x + 600, y)]).toEqual([4, 4, undefined, undefined]);
  });

  it("the lease hands the field's caret to the carry: a letter typed beside its twin inside a highlight lands where it was typed, and is highlighted (the common prefix alone would put it after the twin, at the highlight's edge)", () => {
    const r = rig();
    const e = r.spawn("too x", { marks: encodeMarks(mark(inkOf({ text: "too x" }, 7), 0, 3, { highlight: "yellow" }).marks) });
    r.part.focus(e, 2);
    r.type("tooo x", 3);
    const d = r.part.typing.ink(e) as InkValue;
    expect(d.marks.map(highlightOf)).toEqual([1, 1, 1, 1, 0, 0]);
    expect(d.seeds[2]).toBe(1001);   // the new "o" is the one typed, before the old last one
    expect(r.told.drafts.at(-1)?.arrived).toEqual({ from: 2, to: 3, how: "typed" });
  });

  it("a word TYPED OVER a selection keeps the marks its letters shared for every letter of the run: \"Friday\" selected inside a highlight and typed over as \"Monday\" stays highlighted; a letter taken back and typed again keeps it; once the caret moves away the run is over", () => {
    const r = rig();
    const e = r.spawn("on Friday next", { marks: encodeMarks(mark(inkOf({ text: "on Friday next" }, 7), 0, 9, { highlight: "yellow" }).marks) });
    r.part.focus(e, 0);
    r.el.setSelectionRange(3, 9);
    const hl = (): number[] => (r.part.typing.ink(e) as InkValue).marks.map(highlightOf);
    let word = "";
    for (const ch of "Monday") {
      word += ch;
      r.type(`on ${word} next`, 3 + word.length);
      if (word === "Mo") document.dispatchEvent(new Event("selectionchange"));   // the platform says the caret moved — to the run's end: it goes on
    }
    expect(hl()).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
    r.type("on Monda next", 8);   // a letter taken back…
    r.type("on Monday next", 9);   // …and typed again
    expect(hl().slice(3, 9)).toEqual([1, 1, 1, 1, 1, 1]);
    // the caret leaves and comes back: the run is over, a letter typed at the word's end joins its neighbours as ever
    r.el.setSelectionRange(1, 1);
    document.dispatchEvent(new Event("selectionchange"));
    r.el.setSelectionRange(9, 9);
    document.dispatchEvent(new Event("selectionchange"));
    r.type("on Mondays next", 10);
    expect(hl().slice(3, 10)).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(r.cell(e).text).toBe("on Friday next");   // all of it a draft
  });

  it("COPY writes the three flavours — the words, their `text/html` styled by the marks, and the piece `{ text, marks }` as JSON under the private flavour — the draft's while one is open; a copy writes nothing", () => {
    const r = rig();
    const marks = encodeMarks(mark(mark(inkOf({ text: "one two three" }, 7), 4, 7, { highlight: "yellow" }), 8, 13, { strike: true }).marks);
    const e = r.spawn("one two three", { marks });
    r.part.focus(e, 0);
    r.el.setSelectionRange(4, 13);
    const data = board();
    expect(r.clip("copy", data).defaultPrevented).toBe(true);
    expect(data.getData("text/plain")).toBe("two three");
    expect(data.getData("text/html")).toBe('<span style="white-space:pre-wrap"><mark>two</mark> <s>three</s></span>');
    expect(JSON.parse(data.getData(PIECE_FLAVOUR))).toEqual(lift(inkOf({ text: "one two three", marks }, 7), 4, 13));
    // a draft open: its words and marks (the letter typed after the strike joins nothing)
    r.type("one two threes");
    r.el.setSelectionRange(8, 14);
    const drafted = board();
    r.clip("copy", drafted);
    expect([drafted.getData("text/plain"), drafted.getData("text/html")]).toEqual(["threes", '<span style="white-space:pre-wrap"><s>three</s>s</span>']);
    expect(r.cell(e)).toMatchObject({ text: "one two three", marks });
  });

  it("`inkHtml`: each run of one mark in its tags, never across a break; a colour only where the host's palette answers one for the swatch's role (a line in a named pen takes that pen's) — the words escaped, a break a <br>, a colour that is not one dropped", () => {
    const ink = mark(mark(mark(inkOf({ text: "a<b\nred & x" }, 0), 0, 3, { highlight: "pink" }), 4, 7, { pen: "red" }), 10, 11, { underline: "ball" });
    const piece = lift(ink, 0, ink.text.length);
    expect(inkHtml(piece)).toBe('<span style="white-space:pre-wrap"><mark>a&lt;b</mark><br>red &amp; <u>x</u></span>');
    const palette: Readonly<Record<string, string>> = { "highlight.pink": "#ffc0cb", "pen.red": "rgb(200, 30, 30)", "pen.ball": "oklch(0.4 0.1 250)" };
    expect(inkHtml(piece, (role) => palette[role])).toBe('<span style="white-space:pre-wrap"><mark style="background-color:#ffc0cb">a&lt;b</mark><br><span style="color:rgb(200, 30, 30)">red</span> &amp; <u style="text-decoration-color:oklch(0.4 0.1 250)">x</u></span>');
    expect(inkHtml(piece, (role) => (role === "pen.red" ? 'red;background:url("x")' : undefined))).toBe(inkHtml(piece));
  });

  it("PASTE of a piece lays its words and marks over the selection in a fresh hand — the draft and the field one, in one move; plain words land in the sheet's own pen, the fields around them joined (a typed letter takes the pen it falls in); refused characters lay nothing and the platform's paste stands down", () => {
    const r = rig();
    const marks = encodeMarks(mark(mark(inkOf({ text: "one two three" }, 7), 4, 7, { pen: "red" }), 4, 7, { highlight: "yellow" }).marks);
    const e = r.spawn("one two three", { marks });
    r.part.focus(e, 0);
    r.el.setSelectionRange(0, 3);
    const piece = lift(mark(inkOf({ text: "BIG" }, 0), 0, 3, { underline: true }), 0, 3);
    expect(r.clip("paste", board({ "text/plain": "BIG", [PIECE_FLAVOUR]: JSON.stringify(piece) })).defaultPrevented).toBe(true);
    expect(r.el.value).toBe("BIG two three");
    let d = r.part.typing.ink(e) as InkValue;
    expect(d.text).toBe("BIG two three");
    expect(d.marks.slice(0, 3).map(underlineOf)).toEqual([1, 1, 1]);
    expect(d.seeds.slice(0, 3)).toEqual([1001, 1002, 1003]);
    expect(r.told.drafts.filter((x) => x.text !== undefined)).toEqual([{ text: "BIG two three", arrived: { from: 0, to: 3, how: "arrived" } }]);   // the field's own input moved nothing more
    expect(r.range()).toEqual([3, 3, "none"]);
    // plain words inside the red, highlighted "two": the highlight joined, the pen the sheet's own
    r.el.setSelectionRange(5, 5);
    expect(r.clip("paste", board({ "text/plain": "ZZ" })).defaultPrevented).toBe(true);
    d = r.part.typing.ink(e) as InkValue;
    expect(d.text).toBe("BIG tZZwo three");
    expect(d.marks.slice(4, 9).map((m) => [penOf(m), highlightOf(m)])).toEqual([[4, 1], [0, 1], [0, 1], [4, 1], [4, 1]]);
    r.type("BIG tZZwqo three", 9);   // typed between two red letters: red
    expect(penOf((r.part.typing.ink(e) as InkValue).marks[8] as number)).toBe(4);
    // a kind that lays no "Z": a paste of them lays nothing, and the platform's own paste stands down
    const z = rig({ part: { keep: (ch) => ch !== "Z" } });
    const ez = z.spawn("abc");
    z.part.focus(ez, 1);
    expect(z.clip("paste", board({ "text/plain": "ZZZ" })).defaultPrevented).toBe(true);
    expect([z.el.value, z.part.typing.open()]).toEqual(["abc", false]);
    expect(z.clip("paste", board({ "text/plain": "aZb" })).defaultPrevented).toBe(true);
    expect(z.el.value).toBe("aabbc");
  });

  it("CUT is ONE input: the three flavours to the clipboard and the words out of the draft — landed, one undo brings them back with their marks", () => {
    const r = rig();
    const marks = encodeMarks(mark(inkOf({ text: "one two three" }, 7), 4, 7, { underline: true }).marks);
    const e = r.spawn("one two three", { marks });
    r.part.focus(e, 0);
    r.el.setSelectionRange(4, 8);
    const data = board();
    expect(r.clip("cut", data).defaultPrevented).toBe(true);
    expect([data.getData("text/plain"), data.getData("text/html")]).toEqual(["two ", '<span style="white-space:pre-wrap"><u>two</u> </span>']);
    expect(JSON.parse(data.getData(PIECE_FLAVOUR))).toEqual({ text: "two ", marks: encodeMarks([512, 512, 512]) });
    expect(r.el.value).toBe("one three");
    expect(r.told.drafts.filter((x) => x.text !== undefined)).toEqual([{ text: "one three", arrived: { from: 4, to: 4, how: "typed" } }]);
    r.editor.blur();   // the lease ends: the draft lands
    expect(r.cell(e)).toMatchObject({ text: "one three", marks: "" });
    expect(r.undo()).toBe(true);
    expect(r.cell(e)).toMatchObject({ text: "one two three", marks });
    expect(r.undo()).toBe(false);
  });

  it("where a range lies (`rangeBox`): the wash's rects (`spansOf`) through the kind's map, the box of their corners — a turned sheet's turned; a caret has none", () => {
    const r = rig();
    const e = r.spawn("one two three");
    r.part.focus(e, 0);
    expect(r.editor.lease()?.rangeBox?.(4, 7)).toEqual({ x: 50, y: 10, w: 30, h: 20 });   // x 10 + 10 a letter, the caret's height about the baseline at 26
    expect(r.editor.lease()?.rangeBox?.(5, 5)).toBeUndefined();
    const q = rig({ part: { turned: true } });
    const eq = q.spawn("one two three");
    q.part.focus(eq, 0);
    expect(q.editor.lease()?.rangeBox?.(4, 7)).toEqual({ x: 70, y: 50, w: 20, h: 30 });
  });
});

describe("the ink acts (`inkActs`): one step each, through the typing when one is open", () => {
  it("the acts a kind's marks make — Pen ▾ (the desk's pens, each swatch the host's colour for `pen.<name>`), Highlight ▾ (the highlighters and None), Strike, Underline, Clear — every one on the words; marks that leave some out leave their acts out, none makes none; the type took them (core's checks)", () => {
    const acts = inkActs();
    // read with no words (no range): the lists alone, none current
    const bare = { world: undefined as unknown as World, entities: [], props: () => ({}), local: undefined };
    const COLOUR: Readonly<Record<string, string>> = { "pen.felt": "#2b2a33", "pen.ball": "#1f2f5c", "pen.fountain": "#14213d", "pen.red": "#b3261e", "highlight.yellow": "#fff3a0", "highlight.green": "#c8f0c0", "highlight.pink": "#ffc9de", "highlight.blue": "#bfe0ff", "highlight.orange": "#ffd8a8" };
    const coloured = inkActs({ colour: (role) => COLOUR[role] });
    expect(acts.map((a) => [a.id, a.label, a.on, a.glyph])).toEqual([
      ["ink.pen", "Pen", "words", "pen"],
      ["ink.highlight", "Highlight", "words", expect.objectContaining({ path: expect.any(String) })],
      ["ink.strike", "Strike", "words", expect.objectContaining({ path: expect.any(String) })],
      ["ink.underline", "Underline", "words", expect.objectContaining({ path: expect.any(String) })],
      ["ink.clear", "Clear", "words", "eraser"],
    ]);
    // with no colour from the host, no swatch: the label alone
    expect(acts[0]?.choices?.(bare)).toEqual([{ id: "felt", label: "Felt pen" }, { id: "ball", label: "Ball pen" }, { id: "fountain", label: "Fountain pen" }, { id: "red", label: "Red pen" }]);
    expect(acts[1]?.choices?.(bare)).toEqual([...["yellow", "green", "pink", "blue", "orange"].map((n) => ({ id: n, label: `${n.charAt(0).toUpperCase()}${n.slice(1)}` })), { id: "none", label: "None" }]);
    // the host's colour for each role (a CSS colour, I62's swatch); None has none
    expect(coloured[0]?.choices?.(bare)?.map((c) => c.swatch)).toEqual(["#2b2a33", "#1f2f5c", "#14213d", "#b3261e"]);
    expect(coloured[1]?.choices?.(bare)?.map((c) => c.swatch)).toEqual(["#fff3a0", "#c8f0c0", "#ffc9de", "#bfe0ff", "#ffd8a8", undefined]);
    expect([typeof acts[2]?.state, acts[2]?.choices, typeof acts[3]?.state, acts[4]?.state, acts[4]?.choices]).toEqual(["function", undefined, "function", undefined, undefined]);
    expect(inkActs({ marks: ["highlight", "strike"] }).map((a) => a.id)).toEqual(["ink.highlight", "ink.strike", "ink.clear"]);
    expect(inkActs({ marks: [] })).toEqual([]);
    expect(inkActs({ glyphs: { strike: "check" } })[2]?.glyph).toBe("check");
    expect(SHEET.menu.map((a) => a.id)).toEqual(Object.values(INK_ACTS));
  });

  it("with no typing on the object (an agent's act on stored props) each act is ONE undoable step on the stored cell: a pen by name — the sheet's own clears it —, a highlighter — None lifts it —, strike and underline as toggles, clear; an act that would move nothing writes nothing", () => {
    const { ce, spawn, cell, undo } = engine();
    const e = spawn("one two three");   // its own pen: fountain (the prop's default)
    const range = { entity: e, from: 4, to: 7 };
    const of = (read: (m: number) => number): number[] => inkOf(cell(e), 7).marks.slice(4, 7).map(read);
    expect(ce.ops.runMenuAction(INK_ACTS.pen, { id: "fountain" }, { range })).toBe(true);   // the sheet's own on unmarked words: nothing moves
    expect(undo()).toBe(false);
    expect(ce.ops.runMenuAction(INK_ACTS.pen, { id: "red" }, { range })).toBe(true);
    expect(of(penOf)).toEqual([4, 4, 4]);
    expect(ce.ops.runMenuAction(INK_ACTS.pen, { id: "fountain" }, { range })).toBe(true);   // the sheet's own pen: the pen field cleared
    expect(cell(e).marks).toBe("");
    expect(ce.ops.runMenuAction(INK_ACTS.highlight, { id: "green" }, { range })).toBe(true);
    expect(of(highlightOf)).toEqual([2, 2, 2]);   // green, the second
    expect(ce.ops.runMenuAction(INK_ACTS.highlight, { id: "none" }, { range })).toBe(true);
    expect(cell(e).marks).toBe("");
    expect(ce.ops.runMenuAction(INK_ACTS.strike, undefined, { range })).toBe(true);
    expect(of(strikeOf)).toEqual([1, 1, 1]);
    expect(ce.ops.runMenuAction(INK_ACTS.strike, undefined, { range })).toBe(true);   // pressed again: lifted
    expect(cell(e).marks).toBe("");
    expect(ce.ops.runMenuAction(INK_ACTS.underline, undefined, { range })).toBe(true);
    expect(of(underlineOf)).toEqual([1, 1, 1]);
    expect(ce.ops.runMenuAction(INK_ACTS.highlight, undefined, { range })).toBe(true);   // a key's press, no choice: the first highlighter
    expect(of(highlightOf)).toEqual([1, 1, 1]);
    expect(ce.ops.runMenuAction(INK_ACTS.clear, undefined, { range })).toBe(true);
    expect(cell(e)).toMatchObject({ text: "one two three", seeds: "", marks: "" });
    let undos = 0;
    while (undo()) undos += 1;
    expect(undos).toBe(9);   // nine acts that moved something, a step each
    expect(ce.ops.runMenuAction(INK_ACTS.strike)).toBe(false);   // a words act told no words runs nothing
  });

  it("`state` and `choices` read the words told — a toggle pressed when every selected LETTER carries it (a space is not one), the current choice the letters' common pen (the sheet's own named by its pen) or highlighter, `none` when none — the draft's while one is open, and they write nothing", () => {
    const { ce, world, spawn, cell, props } = engine();
    const base = inkOf({ text: "one two three" }, 7);
    const e = spawn("one two three", { marks: encodeMarks(mark(mark(mark(mark(base, 4, 7, { strike: true }), 8, 13, { strike: true }), 8, 13, { pen: "red" }), 0, 3, { highlight: "yellow" }).marks) });
    const ctx = (from: number, to: number) => ({ world, entities: [e], props, local: undefined, range: { entity: e, from, to } });
    const [pen, highlight, strike, underline] = SHEET.menu;
    /** The choice an act marks current for the words (I62's `current`), or undefined: none. */
    const current = (act: typeof pen, c: ReturnType<typeof ctx>): string | undefined => act?.choices?.(c)?.find((x) => x.current === true)?.id;
    expect([strike?.state?.(ctx(4, 13))?.pressed, strike?.state?.(ctx(3, 13))?.pressed, strike?.state?.(ctx(0, 13))?.pressed, underline?.state?.(ctx(4, 13))?.pressed]).toEqual([true, true, false, false]);
    expect([current(pen, ctx(4, 7)), current(pen, ctx(8, 13)), current(pen, ctx(4, 13))]).toEqual(["fountain", "red", undefined]);
    expect([current(highlight, ctx(0, 3)), current(highlight, ctx(4, 13)), current(highlight, ctx(0, 7))]).toEqual(["yellow", "none", undefined]);
    // a draft open on the object: its words, by its indices ("XX" typed before the highlighted "one")
    const t = inkTyping({ world, docs: ce.docs, object: SHEET });
    t.begin(e);
    t.input("XXone two three");
    expect([current(highlight, ctx(0, 2)), current(highlight, ctx(2, 5))]).toEqual(["none", "yellow"]);
    expect([t.open(), cell(e).text]).toEqual([true, "one two three"]);   // read, nothing written
  });

  it("what the acts read of the words is plain functions of an ink and a range: the letters' common pen (the sheet's own named by the pen given), their common highlighter (`none` when none), and whether every letter carries a field — a space or a break is no letter, a range of spaces alone its units", () => {
    let ink = inkOf({ text: "one two three" }, 7);
    ink = mark(mark(mark(mark(ink, 4, 7, { strike: true }), 8, 13, { strike: true }), 8, 13, { pen: "red" }), 0, 3, { highlight: "green" });
    expect([inkCommonPen(ink, 4, 7, "fountain"), inkCommonPen(ink, 4, 7), inkCommonPen(ink, 8, 13), inkCommonPen(ink, 4, 13, "fountain")]).toEqual(["fountain", undefined, "red", undefined]);
    expect([inkCommonHighlighter(ink, 0, 3), inkCommonHighlighter(ink, 4, 13), inkCommonHighlighter(ink, 0, 7), inkCommonHighlighter(ink, 5, 5)]).toEqual(["green", "none", undefined, undefined]);
    expect([inkEveryLetter(ink, 3, 13, "strike"), inkEveryLetter(ink, 0, 13, "strike"), inkEveryLetter(ink, 4, 13, "underline"), inkEveryLetter(ink, 7, 8, "strike"), inkEveryLetter(ink, 5, 5, "strike")]).toEqual([true, false, false, false, false]);
  });

  it("an act on an object with an OPEN DRAFT lands the draft first — its own step — then marks the words it is told, the draft's indices; the editor stays on it", () => {
    const r = rig();
    const e = r.spawn("one two three");
    r.part.focus(e, 0);
    r.type("XX one two three", 3);
    expect(r.cell(e).text).toBe("one two three");
    expect(r.ce.ops.runMenuAction(INK_ACTS.strike, undefined, { range: { entity: e, from: 7, to: 10 } })).toBe(true);   // "two", in the draft
    expect(r.part.typing.open()).toBe(false);
    expect(r.cell(e).text).toBe("XX one two three");
    expect(inkOf(r.cell(e), 7).marks.map(strikeOf)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect([r.editor.lease()?.entity, r.editor.lease()?.value()]).toEqual([e, "XX one two three"]);
    expect(r.undo()).toBe(true);   // the strike…
    expect(r.cell(e)).toMatchObject({ text: "XX one two three", marks: "" });
    expect(r.undo()).toBe(true);   // …then the typing
    expect(r.cell(e).text).toBe("one two three");
    expect(r.undo()).toBe(false);
  });

  it("the acts find the typing through the kit's registry, by WORLD: two desks, the same object number on each, a draft open on the second — an act on the first marks the first's stored words and leaves the second's draft open; on the second it lands that draft first", () => {
    const a = rig();
    const b = rig();
    const ea = a.spawn("one two three");
    const eb = b.spawn("one two three");
    expect(ea).toBe(eb);   // the same number on each desk
    b.part.focus(eb, 0);
    b.type("one two threeX");
    expect([inkTypingOn(b.world, eb), inkTypingOn(a.world, ea)]).toEqual([b.part.typing, undefined]);
    expect(a.ce.ops.runMenuAction(INK_ACTS.underline, undefined, { range: { entity: ea, from: 0, to: 3 } })).toBe(true);
    expect(inkOf(a.cell(ea), 7).marks.slice(0, 4).map(underlineOf)).toEqual([1, 1, 1, 0]);
    expect(b.part.typing.open()).toBe(true);
    expect(b.cell(eb)).toMatchObject({ text: "one two three", marks: "" });
    expect(b.ce.ops.runMenuAction(INK_ACTS.underline, undefined, { range: { entity: eb, from: 8, to: 14 } })).toBe(true);
    expect(b.part.typing.open()).toBe(false);
    expect(b.cell(eb).text).toBe("one two threeX");
    expect(inkOf(b.cell(eb), 7).marks.slice(7, 14).map(underlineOf)).toEqual([0, 1, 1, 1, 1, 1, 1]);
  });
});

describe("what a typing of another shape shares (a live write — the note's): the run, the piece, the registry", () => {
  it("`carryRun` is the typing's step, pure: a selection typed over begins a RUN holding the mark its letters shared, each letter typed at its end takes that mark, a letter taken back shortens it, any other edit ends it; `keepRun` ends it unless the caret stands at its end; the run handed in is never changed", () => {
    const fresh = (() => { let n = 500; return () => ++n; })();
    const found = mark(inkOf({ text: "on Friday soon" }, 7), 3, 9, { highlight: "pink" });
    const pink = found.marks[3] ?? 0;
    expect(highlightOf(pink)).not.toBe(0);
    const a = carryRun(found, "on M soon", fresh, 4);   // "Friday" typed over by "M"
    expect([a.from, a.to, a.run]).toEqual([3, 4, { from: 3, to: 4, mark: pink }]);
    const held: InkTypedRun | undefined = a.run;
    const b = carryRun(a.ink, "on Mo soon", fresh, 5, held);   // typed on at its end
    expect([b.from, b.to, b.run, b.ink.marks[4]]).toEqual([4, 5, { from: 3, to: 5, mark: pink }, pink]);
    expect(held).toEqual({ from: 3, to: 4, mark: pink });   // never changed
    const c = carryRun(b.ink, "on M soon", fresh, 4, b.run);   // a letter taken back
    expect(c.run).toEqual({ from: 3, to: 4, mark: pink });
    const d = carryRun(c.ink, "on Mo soon", fresh, 5, c.run);   // typed again: the mark kept
    expect([d.run?.to, d.ink.marks[4]]).toEqual([5, pink]);
    expect(carryRun(d.ink, "Xon Mo soon", fresh, 1, d.run).run).toBeUndefined();   // typed elsewhere: over
    expect(carryRun(d.ink, d.ink.text, fresh, 5, d.run)).toMatchObject({ ink: d.ink, run: d.run });   // nothing changed: the run stands
    expect([keepRun(d.run, 5, 5), keepRun(d.run, 4, 4), keepRun(d.run, 3, 5), keepRun(undefined, 5, 5)]).toEqual([d.run, undefined, undefined, undefined]);
  });

  it("`readPiece` reads the private flavour as a stranger's — `{ text, marks }` with words, else nothing — and `printable` is the paste's default keep: every character but a control one, a break kept", () => {
    expect(readPiece(JSON.stringify({ text: "two", marks: "1k3" }))).toEqual({ text: "two", marks: "1k3" });
    expect(readPiece(JSON.stringify({ text: "two", marks: 5 }))).toEqual({ text: "two", marks: "" });
    expect([readPiece(undefined), readPiece(""), readPiece("{"), readPiece("null"), readPiece("[1]"), readPiece(JSON.stringify({ text: "" })), readPiece(JSON.stringify({ text: 3 }))]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    const chars = ["a", "\u00e9", "\n", " ", "\t", "\r", String.fromCharCode(0), String.fromCharCode(127), String.fromCharCode(133), String.fromCharCode(160)];
    expect(chars.map(printable)).toEqual([true, true, true, true, false, false, false, false, false, true]);
  });

  it("a typing that is NOT an `InkTyping` registers on the world by its cell (`registerInkTyping`): `inkTypingOn` finds it, the acts read its words and land it first, its own step before the marks; a second door on the cell replaces it, a stale unregister leaves the newer, the last unregister leaves none", () => {
    const { ce, world, spawn, cell, props } = engine();
    const e = spawn("one two three");
    const ctx = (from: number, to: number) => ({ world, entities: [e], props, local: undefined, range: { entity: e, from, to } });
    const strike = SHEET.menu.find((d) => d.id === INK_ACTS.strike);
    const shown = mark(inkOf({ text: "one two three" }, 7), 4, 7, { strike: true });   // the words its field shows
    const order: string[] = [];
    let pending = true;
    const door: InkTypingDoor = {
      type: SHEET.type,
      group: "ink",
      editing: () => e,
      open: () => pending,
      commit: () => { order.push(`commit:${cell(e).marks}`); const was = pending; pending = false; return was; },
      ink: (x) => (x === e ? shown : undefined),
    };
    const off = registerInkTyping(world, INK as NonNullable<typeof INK>, door);
    expect(inkTypingOn(world, e)).toBe(door);
    expect(inkTypingOn(world, e, "words")).toBeUndefined();   // another group's
    expect(strike?.state?.(ctx(4, 7))?.pressed).toBe(true);   // its words, not the cell's
    expect(ce.ops.runMenuAction(INK_ACTS.strike, undefined, { range: { entity: e, from: 0, to: 3 } })).toBe(true);
    expect(order).toEqual(["commit:"]);   // landed first, the cell's marks untouched then
    expect([pending, inkOf(cell(e), 7).marks.slice(0, 4).map(strikeOf)]).toEqual([false, [1, 1, 1, 0]]);
    const other: InkTypingDoor = { ...door, open: () => false, commit: () => { order.push("other"); return false; } };
    const off2 = registerInkTyping(world, INK as NonNullable<typeof INK>, other);
    expect(inkTypingOn(world, e)).toBe(other);
    off();   // stale: the newer stands
    expect(inkTypingOn(world, e)).toBe(other);
    expect(ce.ops.runMenuAction(INK_ACTS.underline, undefined, { range: { entity: e, from: 0, to: 3 } })).toBe(true);
    expect(order).toEqual(["commit:"]);   // nothing open: nothing landed
    off2();
    expect(inkTypingOn(world, e)).toBeUndefined();
    expect(strike?.state?.(ctx(4, 7))?.pressed).toBe(false);   // the cell's words again
    const t = inkTyping({ world, docs: ce.docs, object: SHEET });   // the kit's own registers through the same door
    t.begin(e);
    expect(inkTypingOn(world, e)).toBe(t);
  });
});

describe("the host's bar and the words' menu carry the ink", () => {
  it("a bar's COPY runs the platform's own command — the three flavours, as the keys write them — and its PASTE, where the clipboard's words are the copy's, lays the piece: the marks come back on the words laid", async () => {
    const r = rig();
    const marks = encodeMarks(mark(inkOf({ text: "one two three" }, 7), 4, 7, { highlight: "pink" }).marks);
    const e = r.spawn("one two three", { marks });
    r.part.focus(e, 0);
    r.el.setSelectionRange(4, 7);
    // the platform's own copy, as a browser does it: its event at the focused field, a clipboard of its own
    const system = board();
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: (name: string) => { r.clip(name as "copy", system); return true; } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => system.getData("text/plain") } });
    cleanups.push(() => { Reflect.deleteProperty(document, "execCommand"); Reflect.deleteProperty(navigator, "clipboard"); });
    expect(await r.editor.command("copy")).toBe(true);
    expect([system.getData("text/plain"), system.getData("text/html")]).toEqual(["two", '<span style="white-space:pre-wrap"><mark>two</mark></span>']);
    r.el.setSelectionRange(13, 13);
    expect(await r.editor.command("paste")).toBe(true);
    const d = r.part.typing.ink(e) as InkValue;
    expect(d.text).toBe("one two threetwo");
    expect(d.marks.slice(13).map(highlightOf)).toEqual([3, 3, 3]);   // the piece the copy kept: its pink came back
  });

  it("the words' menu of a desk carries the ink acts as the anchor shows them for the words selected — the sheet's own pen current, no highlighter, the toggles off — and a slot's run marks them, the toggle pressed after", async () => {
    const d = await mountDesk();
    const e = d.spawn("one two three");
    d.step(2);
    const part = made.get(d.ce.world);
    if (part === undefined) throw new Error("the desk made no written part");
    expect(part.focus(e, 0)).toBe(true);
    d.step();
    d.select(4, 7);
    const w = d.anchor().words;
    if (w === undefined) throw new Error("no words");
    expect([w.entity, w.from, w.to, w.box]).toEqual([e, 4, 7, { x0: 50, y0: 10, x1: 80, y1: 30 }]);
    expect(w.menu.map((m) => [m.id, m.choices?.find((c) => c.current === true)?.id, m.pressed])).toEqual([["ink.pen", "fountain", undefined], ["ink.highlight", "none", undefined], ["ink.strike", undefined, false], ["ink.underline", undefined, false], ["ink.clear", undefined, undefined]]);
    expect(d.ce.ops.runMenuAction(INK_ACTS.strike, undefined, { range: { entity: w.entity, from: w.from, to: w.to } })).toBe(true);
    d.step();
    expect(d.anchor().words?.menu.find((m) => m.id === INK_ACTS.strike)?.pressed).toBe(true);
  });
});

describe("the marks' keys: ⇧⌘X strike, ⌘U underline, ⇧⌘H highlight — the part's, on the words selected", () => {
  /** A key pressed in the lent field, as the platform sends it there. */
  const press = (el: HTMLTextAreaElement, key: string, o: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...o });
    el.dispatchEvent(ev);
    return ev;
  };
  const strikes = (c: Cell): number[] => inkOf(c, 7).marks.map(strikeOf);
  const underlines = (c: Cell): number[] => inkOf(c, 7).marks.map(underlineOf);

  it("the acts declare their keys for a host's tip — Strike ⇧⌘X, Underline ⌘U, Highlight ⇧⌘H, Pen and Clear none — and the words' menu slots carry them", () => {
    expect(SHEET.menu.map((a) => [a.id, a.keys])).toEqual([["ink.pen", undefined], ["ink.highlight", "⇧⌘H"], ["ink.strike", "⇧⌘X"], ["ink.underline", "⌘U"], ["ink.clear", undefined]]);
  });

  it("with words selected ⇧⌘X strikes them and ⌘U underlines them — the act run on the field's range, ONE undo step each, the key the part's (its default prevented); pressed again it lifts; Ctrl in place of ⌘ does the same; a draft open lands first", () => {
    const r = rig();
    const e = r.spawn("one two three");
    r.part.focus(e, 0);
    r.el.setSelectionRange(4, 7);
    expect(press(r.el, "X", { shiftKey: true, metaKey: true }).defaultPrevented).toBe(true);
    expect(strikes(r.cell(e))).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect(press(r.el, "u", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(underlines(r.cell(e))).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect(press(r.el, "x", { shiftKey: true, ctrlKey: true }).defaultPrevented).toBe(true);   // pressed again: lifted
    expect(strikes(r.cell(e)).every((m) => m === 0)).toBe(true);
    expect(r.undo()).toBe(true);   // the lift…
    expect(strikes(r.cell(e))[5]).toBe(1);
    expect(r.undo()).toBe(true);   // …the underline…
    expect(underlines(r.cell(e))[5]).toBe(0);
    expect(r.undo()).toBe(true);   // …the strike
    expect(r.cell(e).marks).toBe("");
    // a draft open: landed first, its own step, then the words marked by the draft's indices
    r.type("XX one two three", 3);
    r.el.setSelectionRange(7, 10);
    expect(press(r.el, "U", { metaKey: true }).defaultPrevented).toBe(true);
    expect([r.part.typing.open(), r.cell(e).text, underlines(r.cell(e)).slice(6, 11)]).toEqual([false, "XX one two three", [0, 1, 1, 1, 0]]);
  });

  it("⇧⌘H highlights in the highlighter last chosen on this desk — yellow at first — and lifts it where every letter carries one; another desk starts at yellow", () => {
    const r = rig();
    const e = r.spawn("one two three four");
    r.part.focus(e, 0);
    const hl = (): number[] => inkOf(r.cell(e), 7).marks.map(highlightOf);
    r.el.setSelectionRange(0, 3);
    expect(press(r.el, "H", { shiftKey: true, metaKey: true }).defaultPrevented).toBe(true);
    expect(hl().slice(0, 4)).toEqual([1, 1, 1, 0]);   // yellow
    expect(r.ce.ops.runMenuAction(INK_ACTS.highlight, { id: "blue" }, { range: { entity: e, from: 4, to: 7 } })).toBe(true);
    r.el.setSelectionRange(8, 13);
    press(r.el, "H", { shiftKey: true, metaKey: true });
    expect(hl().slice(8, 13)).toEqual([4, 4, 4, 4, 4]);   // blue, the last chosen
    r.el.setSelectionRange(0, 3);
    press(r.el, "H", { shiftKey: true, metaKey: true });
    expect(hl().slice(0, 3)).toEqual([0, 0, 0]);   // every letter had one: lifted
    const o = rig();
    const f = o.spawn("one two");
    o.part.focus(f, 0);
    o.el.setSelectionRange(0, 3);
    press(o.el, "h", { shiftKey: true, ctrlKey: true });
    expect(inkOf(o.cell(f), 7).marks.slice(0, 3).map(highlightOf)).toEqual([1, 1, 1]);   // another desk: yellow
  });

  it("no key without words selected, nor for a mark the kind does not keep, nor a chord that is not one of the three: the platform's own ⌘U and ⌘X stand, nothing written", () => {
    const r = rig({ part: { marks: ["highlight", "underline"] } });
    const e = r.spawn("one two three");
    r.part.focus(e, 0);
    r.el.setSelectionRange(5, 5);   // a caret
    expect([press(r.el, "u", { metaKey: true }).defaultPrevented, press(r.el, "X", { shiftKey: true, metaKey: true }).defaultPrevented, press(r.el, "H", { shiftKey: true, metaKey: true }).defaultPrevented]).toEqual([false, false, false]);
    r.el.setSelectionRange(4, 7);
    expect(press(r.el, "X", { shiftKey: true, metaKey: true }).defaultPrevented).toBe(false);   // no strike kept
    expect([press(r.el, "x", { metaKey: true }).defaultPrevented, press(r.el, "u", { metaKey: true, shiftKey: true }).defaultPrevented, press(r.el, "u", { metaKey: true, altKey: true }).defaultPrevented, press(r.el, "u").defaultPrevented]).toEqual([false, false, false, false]);   // ⌘X (cut), ⇧⌘U, ⌥⌘U, a typed u
    expect(r.cell(e).marks).toBe("");
    expect(press(r.el, "u", { metaKey: true }).defaultPrevented).toBe(true);   // the underline it keeps
    expect(underlines(r.cell(e))[5]).toBe(1);
  });
});

describe("the anchor's `editing` for a lent part (no `Editing` claim)", () => {
  it("true while the one editor is lent to a part whose lease names an object of the selection — no `Editing` stamped; the lease gone, false; lent to an object NOT of the selection, as before; core's claim reads as ever", async () => {
    const d = await mountDesk();
    const a = d.spawn("one two three");
    const b = d.spawn("four five");
    d.step(2);
    const part = made.get(d.ce.world);
    if (part === undefined) throw new Error("the desk made no written part");
    d.ce.ops.setSelection([a], "replace");
    d.step();
    expect(d.anchor().editing).toBe(false);
    expect(part.focus(a, 0)).toBe(true);
    d.step();
    expect([d.anchor().editing, d.ce.world.hasTag(a, Editing), d.editor.lease()?.entity]).toEqual([true, false, a]);
    const lent = d.editor.lease();
    if (lent === undefined) throw new Error("no lease");
    d.editor.release(lent);
    d.step();
    expect([d.editor.lease(), d.anchor().editing]).toEqual([undefined, false]);
    expect(part.focus(b, 0)).toBe(true);   // lent to b; the selection is a alone
    d.step();
    expect([d.editor.lease()?.entity, d.anchor().editing]).toEqual([b, false]);
    d.ce.ops.setSelection([a, b], "replace");
    d.step();
    expect(d.anchor().editing).toBe(true);   // b is of the selection now
    const again = d.editor.lease();
    if (again !== undefined) d.editor.release(again);
    d.ce.world.addTag(a, Editing);   // a note's claim, no lease
    d.step();
    expect([d.editor.lease(), d.anchor().editing]).toEqual([undefined, true]);
  });
});

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

/** A desk layer in the page on the fake device (E7's mount): its canvas a page canvas whose context is the fake's, the engine stepped by hand. */
async function mountDesk() {
  const undo: (() => void)[] = [installGpuFlags()];
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true });
  undo.push(() => { Reflect.deleteProperty(navigator, "gpu"); });
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const make = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string, o?: ElementCreationOptions) => {
    const el = make(tag, o);
    if (tag === "canvas") Object.defineProperty(el, "getContext", { value: () => context });
    return el;
  }) as typeof document.createElement);
  undo.push(() => spy.mockRestore());
  const ce = createCanvasEngine({ widgets: [SHEET] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { stack } = ce;
  const handle: DeskLayerHandle = deskLayer({ gpu, theme: themeFrom("light", PALETTE), palette: PALETTE, objects: [SHEET], docs: ce.docs, ambient: "still" })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose, trayPose: stack.trayPose, spatial: stack.index,
  });
  undo.push(ce.engine.registerReflector(handle.reflector));
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((done) => setTimeout(done, 5));
  if (handle.status().state !== "ready") throw new Error(`the desk did not boot: ${JSON.stringify(handle.status())}`);
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  const editor = handle.editor();
  const spawn = (text: string): Entity => ce.ops.spawnWidget(SHEET.type, { x: 0, y: 0, w: W, h: H, props: { text }, undoable: false });
  /** The field's range set as the platform sets it, and its `selectionchange` (happy-dom sends none on `setSelectionRange`). */
  const select = (from: number, to: number): void => { editor.element.setSelectionRange(from, to); document.dispatchEvent(new Event("selectionchange")); step(); };
  const anchor = () => handle.selection.anchor();
  cleanups.push(() => { handle.dispose(); ce.dispose(); for (const u of undo.splice(0).reverse()) u(); });
  return { ce, handle, editor, step, spawn, select, anchor };
}
