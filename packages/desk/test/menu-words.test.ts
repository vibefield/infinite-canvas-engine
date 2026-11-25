// @vitest-environment happy-dom
// THE MENU COMES TO THE WORDS (petition I60 — "the selection bar comes to the words"): until now the selection menu's anchor stepped
// aside while a part was written (`editing`), and carried only the selection's box and its acts. Now, while the ONE editor is lent to
// an object's part, the object is being written (core's `Editing`), its range is not empty and the part can say where the range lies
// (the lease's new `rangeBox`), the anchor carries the WORDS: their box on screen (CSS px, as `box`, the part's world box through the
// camera — so it follows a pan and a zoom), the object, the range, and the object's words acts (`on: "words"`) as slots, each as it
// stands for the range — its choices now with the current one marked (I62), a toggle's `pressed` (I61's state). While a press the
// editor claimed on the writing is down the words are absent (the bar waits for the release). The anchor is published only when
// something in it changed. A slot runs through the engine with the range (`ops.runMenuAction(id, taken?, { range })`). A kind of the test's own — one line laid ten px a
// letter — on the fake device, in a real page (happy-dom): the desk draws its frames and publishes as a host's would.
import { Camera, closeTray, createCanvasEngine, Editing, type Entity, type MenuActionApi, type MenuActionDef, openTray, p, Viewport, type WidgetType, type World } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectDomHost, ObjectKind } from "../src/kinds/world";
import type { DeskEditor, EditorLease } from "../src/kit/editor";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };
/** One line laid ten px a letter from (10, 20), the line 40 tall: the words "one two three four five". */
const TEXT = "one two three four five";

/** What the words' acts were told (their runs) and read (their `state` and `choices`), in order. */
const ran: { readonly id: string; readonly entities: readonly Entity[]; readonly range: MenuActionApi["range"]; readonly choice: string | undefined }[] = [];
const read: string[] = [];
let throwing = false;
const PEN: MenuActionDef = {
  id: "pen", label: "Pen", on: "words", glyph: "pen",
  // the words' pen: "ball" from the fifth letter on — the current one —, none shared before it (a range that starts earlier mixes the two)
  choices: (ctx) => {
    read.push(`choices ${Object.keys(ctx).sort().join(",")}`);
    const ball = (ctx.range?.from ?? 0) >= 4;
    return [{ id: "felt", label: "Felt pen", swatch: "#2b2a33" }, { id: "ball", label: "Ball pen", swatch: "#1f2f5c", current: ball }];
  },
  run: (api, taken) => { ran.push({ id: "pen", entities: [...api.entities], range: api.range, choice: taken?.id }); },
};
const STRIKE: MenuActionDef = {
  id: "strike", label: "Strike", on: "words", keys: "⇧⌘X",
  // on when the range is longer than three letters (every one of them struck, by the fixture's say)
  state: (ctx) => { if (throwing) throw new Error("no state today"); return { pressed: ctx.range !== undefined && ctx.range.to - ctx.range.from > 3 }; },
  run: (api) => { ran.push({ id: "strike", entities: [...api.entities], range: api.range, choice: undefined }); },
};
const SPIN: MenuActionDef = { id: "spin", label: "Spin", run: (api) => { ran.push({ id: "spin", entities: [...api.entities], range: api.range, choice: undefined }); } };

/** The editor the last mount handed the object's DOM half (its text part is made at each mount). */
let handed: DeskEditor | undefined;
/** A kind of the test's own whose pass draws nothing (the frames are what is drawn), and its object — ONE type a file (core's registry is global): two words acts, an objects act, a text part. */
const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
const WORDS_KIND: ObjectKind = { name: "words", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}), hit: () => "content" };
const WORDS_OBJECT: WidgetType = defineObject({
  type: "test.words", version: 1, props: { text: p.string({ default: "" }) }, kind: WORDS_KIND, menu: [PEN, STRIKE, SPIN],
  host: { text: (h: ObjectDomHost) => { handed = h.editor; return [{ part: "test.words" }]; } },
});

/** A lease of the test's own on `e`: one line ten px a letter, where its words lie (`indexAt`, `rangeAt`) and where a range of them is (`rangeBox`). */
function wordsLease(world: World, e: Entity, more: Partial<EditorLease> = {}): EditorLease {
  let value = TEXT;
  return {
    part: "test.words",
    label: "write on the test",
    value: () => value,
    input(v) { value = v; },
    keydown: () => false,
    caret() {},
    place: () => ({ x: 10, y: 20, w: 300, h: 40, fontPx: 14, lineHeight: 40 }),
    idle() {},
    ended() { if (world.isAlive(e)) world.removeTag(e, Editing); },
    live: () => world.isAlive(e),
    indexAt(wx, wy) { if (wx < 10 || wx > 310 || wy < 20 || wy > 60) return undefined; return Math.min(Math.max(Math.round((wx - 10) / 10), 0), TEXT.length); },
    rangeAt(i) { let from = i; let to = i; while (from > 0 && TEXT[from - 1] !== " ") from -= 1; while (to < TEXT.length && TEXT[to] !== " ") to += 1; return { from, to }; },
    // the letters' boxes, one line: ten px a letter, 16 tall from y 22
    rangeBox: (from, to) => (to > from ? { x: 10 + from * 10, y: 22, w: (to - from) * 10, h: 16 } : undefined),
    ...more,
  };
}

const mounted: (() => void)[] = [];
afterEach(() => { for (const end of mounted.splice(0).reverse()) end(); document.body.innerHTML = ""; vi.restoreAllMocks(); ran.length = 0; read.length = 0; throwing = false; });

/** A desk layer in the page, on the fake device: its canvas a page canvas whose context is the fake's, the engine stepped by hand. */
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
  handed = undefined;
  const ce = createCanvasEngine({ widgets: [WORDS_OBJECT] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { stack } = ce;
  const handle: DeskLayerHandle = deskLayer({ gpu, theme: themeFrom("light", PALETTE), palette: PALETTE, objects: [WORDS_OBJECT], docs: ce.docs, ambient: "still" })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose, trayPose: stack.trayPose, spatial: stack.index,
  });
  undo.push(ce.engine.registerReflector(handle.reflector));
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  if (handle.status().state !== "ready") throw new Error(`the desk did not boot: ${JSON.stringify(handle.status())}`);
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  /** A frame drawn whatever moved (a host's frame): the anchor recomposed and offered to the subscription. */
  const redraw = (): void => { handle.desk.wake("ink"); step(); };
  const e = ce.ops.spawnWidget("test.words", { x: 0, y: 0, w: 320, h: 80, props: { text: TEXT }, undoable: false });
  step(2);
  const editor = handed as DeskEditor | undefined;
  if (editor === undefined) throw new Error("the object's DOM half was handed no editor");
  /**
   * The editor lent to the object's part, the object being written (core's `Editing`, as a kind's typing claims it — after the lend: a
   * lease handed over ends first, and its `ended` lifts the claim).
   */
  const lend = (lease: EditorLease = wordsLease(ce.world, e), caret = 0): EditorLease => {
    editor.lend(lease, caret);
    if (!ce.world.hasTag(e, Editing)) ce.world.addTag(e, Editing);
    step();
    return lease;
  };
  /** The field's range set as the platform sets it, and its `selectionchange` (happy-dom sends none on `setSelectionRange`). */
  const select = (from: number, to: number): void => { editor.element.setSelectionRange(from, to); document.dispatchEvent(new Event("selectionchange")); step(); };
  let at = 5000;
  /** A pointer event on the container as the platform sends it (client px = world px: the camera is the identity until a row moves it). */
  const pointer = (type: "pointerdown" | "pointermove" | "pointerup", index: number): PointerEvent => {
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, pointerType: "mouse", clientX: 10 + index * 10, clientY: 40 });
    at += 40;
    Object.defineProperty(ev, "timeStamp", { value: at });
    container.dispatchEvent(ev);
    return ev;
  };
  const click = (index: number): void => { container.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 10 + index * 10, clientY: 40, detail: 1 })); };
  const anchor = () => handle.selection.anchor();
  mounted.push(() => { handle.dispose(); ce.dispose(); for (const u of undo.splice(0).reverse()) u(); });
  return { ce, handle, editor, e, step, redraw, lend, select, pointer, click, anchor };
}

describe("the selection menu's anchor comes to the words (petition I60)", () => {
  it("while the part is written and words are selected the anchor carries them: their box on screen, the object, the range and its WORDS acts as slots — each as it stands for the range; the selection's own acts never among them", async () => {
    const d = await mountDesk();
    d.ce.ops.setSelection([d.e], "replace");
    d.lend();
    expect(d.anchor().words).toBeUndefined();   // a caret: no words selected
    d.select(4, 13);
    expect(d.anchor().words).toEqual({
      box: { x0: 50, y0: 22, x1: 140, y1: 38 },
      entity: d.e, from: 4, to: 13,
      menu: [
        { id: "pen", label: "Pen", glyph: "pen", choices: [{ id: "felt", label: "Felt pen", swatch: "#2b2a33" }, { id: "ball", label: "Ball pen", swatch: "#1f2f5c", current: true }] },
        { id: "strike", label: "Strike", keys: "⇧⌘X", pressed: true },
      ],
    });
    // the selection's acts are the objects' alone: the words acts never there
    expect(d.anchor().menu).toEqual([{ id: "spin", label: "Spin" }]);
    expect(JSON.parse(JSON.stringify(d.anchor().words))).toEqual(d.anchor().words);   // plain data: the ops stay on the type
    // read for the range, through a view that writes nothing
    expect(read.at(-1)).toBe("choices entities,local,props,range,world");
    // a shorter range from the start: the toggle off, no pen shared — said so (`pressed: false`), never left out
    d.select(0, 3);
    expect(d.anchor().words?.menu).toEqual([
      { id: "pen", label: "Pen", glyph: "pen", choices: [{ id: "felt", label: "Felt pen", swatch: "#2b2a33" }, { id: "ball", label: "Ball pen", swatch: "#1f2f5c" }] },
      { id: "strike", label: "Strike", keys: "⇧⌘X", pressed: false },
    ]);
  });

  it("the words are absent for a caret, with no lease, for a lease that cannot say where its range lies, while the object is not being written, and while the drawer is out", async () => {
    const d = await mountDesk();
    const lease = d.lend();
    d.select(4, 7);
    expect(d.anchor().words?.from).toBe(4);
    d.select(5, 5);
    expect(d.anchor().words).toBeUndefined();   // a caret
    d.select(4, 7);
    d.ce.world.removeTag(d.e, Editing);
    expect(d.anchor().words).toBeUndefined();   // lent, but the object is not being written
    d.ce.world.addTag(d.e, Editing);
    openTray(d.ce.world);
    d.step();
    expect(d.anchor().words).toBeUndefined();   // the desk under the drawer is inert
    closeTray(d.ce.world);
    d.step();
    expect(d.anchor().words?.to).toBe(7);
    d.editor.release(lease);
    d.step();
    expect(d.anchor().words).toBeUndefined();   // no lease
    // a lease that cannot say where its words lie (no `rangeBox`): none, whatever is selected
    const { rangeBox: _box, ...blind } = wordsLease(d.ce.world, d.e);
    d.lend(blind);
    d.select(4, 7);
    expect(d.editor.lease()).toBe(blind);
    expect(d.anchor().words).toBeUndefined();
    // …nor one whose `rangeBox` answers nothing for the range
    d.lend(wordsLease(d.ce.world, d.e, { rangeBox: () => undefined }));
    d.select(4, 7);
    expect(d.anchor().words).toBeUndefined();
  });

  it("while a press the editor claimed on the writing is down the words are absent — the bar waits for the release — and back with the range the press made", async () => {
    const d = await mountDesk();
    d.lend();
    d.select(4, 7);
    expect(d.anchor().words?.from).toBe(4);
    const heard: (number | undefined)[] = [];
    const off = d.handle.selection.subscribe(() => { heard.push(d.anchor().words?.to); });
    const down = d.pointer("pointerdown", 14);
    expect(down.defaultPrevented).toBe(true);   // claimed: on the writing
    d.step();
    expect(d.anchor().words).toBeUndefined();
    d.pointer("pointermove", 16);
    d.pointer("pointermove", 18);   // past the slop: the drag selects anew, the words still away
    d.step();
    expect(d.editor.element.selectionStart).toBe(14);
    expect(d.editor.element.selectionEnd).toBe(18);
    expect(d.anchor().words).toBeUndefined();
    d.pointer("pointerup", 18);
    d.step();
    expect(d.anchor().words).toMatchObject({ from: 14, to: 18, box: { x0: 150, y0: 22, x1: 190, y1: 38 } });
    d.click(18);
    d.step();
    expect(d.anchor().words?.to).toBe(18);
    // told twice: away at the press, back at the release
    expect(heard).toEqual([undefined, 18]);
    off();
  });

  it("a press on the words TELLS the menu at once — the editor asks a frame, the words away — and its release tells it again, the words back (a tap the part routes nowhere leaves the range as it was)", async () => {
    const d = await mountDesk();
    d.lend();
    d.select(4, 7);
    const heard: (number | undefined)[] = [];
    const off = d.handle.selection.subscribe(() => { heard.push(d.anchor().words?.to); });
    d.pointer("pointerdown", 5);
    d.step();
    expect(heard).toEqual([undefined]);   // the press asked the frame that told it: no move, no new range, yet the words went
    d.pointer("pointerup", 5);
    d.step();
    expect(heard).toEqual([undefined, 7]);   // …and the release asked the one that brought them back
    d.click(5);   // the part declares no tap: the caret stays where it was, the range with it
    d.step();
    expect(heard).toEqual([undefined, 7]);
    expect(d.anchor().words).toMatchObject({ from: 4, to: 7 });
    off();
  });

  it("the words' box follows a pan and a zoom: the part's world box through the camera, CSS px", async () => {
    const d = await mountDesk();
    d.lend();
    d.select(4, 13);
    expect(d.anchor().words?.box).toEqual({ x0: 50, y0: 22, x1: 140, y1: 38 });
    d.ce.world.setResource(Camera, { x: -100, y: 10, zoom: 2, gesturing: false });
    d.step();
    expect(d.anchor().words?.box).toEqual({ x0: (50 + 100) * 2, y0: (22 - 10) * 2, x1: (140 + 100) * 2, y1: (38 - 10) * 2 });
    d.ce.world.setResource(Camera, { x: 25, y: 0, zoom: 0.5, gesturing: false });
    d.step();
    expect(d.anchor().words?.box).toEqual({ x0: (50 - 25) * 0.5, y0: 22 * 0.5, x1: (140 - 25) * 0.5, y1: 38 * 0.5 });
  });

  it("the anchor is PUBLISHED only when something in it changed: frames that move nothing tell nothing; a new range, a pan and a toggle's new state each tell once", async () => {
    const d = await mountDesk();
    d.lend();
    d.select(4, 7);
    let told = 0;
    const off = d.handle.selection.subscribe(() => { told += 1; });
    for (let i = 0; i < 4; i++) d.redraw();
    expect(told).toBe(0);
    d.select(4, 13);   // a new range — and, past three letters, the toggle on
    expect(told).toBe(1);
    expect(d.anchor().words?.menu[1]?.pressed).toBe(true);
    for (let i = 0; i < 4; i++) d.redraw();
    expect(told).toBe(1);
    d.ce.world.setResource(Camera, { x: 30, y: 0, zoom: 1, gesturing: false });
    d.step();
    expect(told).toBe(2);
    d.redraw();
    expect(told).toBe(2);
    off();
  });

  it("a slot runs through the engine with the range: `ops.runMenuAction(slot.id, taken?, { range })` — the act told the object being written, the words and the pen taken", async () => {
    const d = await mountDesk();
    d.lend();
    d.select(4, 13);
    const w = d.anchor().words;
    if (w === undefined) throw new Error("no words");
    const pen = w.menu[0];
    const range = { entity: w.entity, from: w.from, to: w.to };
    expect(d.ce.ops.runMenuAction(pen?.id ?? "", { id: pen?.choices?.[1]?.id ?? "" }, { range })).toBe(true);
    expect(d.ce.ops.runMenuAction(w.menu[1]?.id ?? "", undefined, { range })).toBe(true);
    expect(ran).toEqual([
      { id: "pen", entities: [d.e], range: { entity: d.e, from: 4, to: 13 }, choice: "ball" },
      { id: "strike", entities: [d.e], range: { entity: d.e, from: 4, to: 13 }, choice: undefined },
    ]);
    // the objects' act is not the words': told the range, it runs nothing
    expect(d.ce.ops.runMenuAction("spin", undefined, { range })).toBe(false);
  });

  it("a toggle's `state` that THROWS is caught where it is read: the act stands as declared — no state — said once, never a fault", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk();
    d.lend();
    throwing = true;
    d.select(4, 13);
    for (let i = 0; i < 3; i++) { d.anchor(); d.redraw(); }
    expect(d.anchor().words?.menu[1]).toEqual({ id: "strike", label: "Strike", keys: "⇧⌘X" });
    const told = said.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("threw in its `state`"));
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('the kind "words"\'s menu act "strike"');
    expect(d.handle.status()).toEqual({ state: "ready" });
  });
});
