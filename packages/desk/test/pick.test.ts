// @vitest-environment node
// THE DESK'S PICK (petition I27; host/layer.ts `pick`): the object under a screen point as the desk's own pick resolves it — the
// interaction stack's exact pick (`stack.pickAt`: the body a press's `TouchesExact` is written by — packages/core/test/frame-pick.test.ts)
// through this layer's pick source on the last frame's geometry, answered for an object of the frame: its entity, its type, the canvas it
// lies in and its kind's part under the point. The petition's acceptance 1, as amended in the build: a note → itself and its type; the
// bare mat → null; a note drawn in a LIVE mini mat's inside → the mini mat (the inside is no member of this frame: a click there selects
// the mini mat), and with the mini mat entered, the note — its canvas the mini mat; the hand's object while held → null, and the soft desk
// behind it with it (the desk is inert in hand); before the first frame → null. And beside them: the topmost by sibling order, a named
// part reported, a resize handle no object, the drawer out → null, `degraded` picks and a lost device does not; it never selects, draws
// or wakes. Where a click can say, a click says the same: each pick is checked against what a real press and release there selected.
// Kinds of the test's own, as a plugin's, on the fake device — the desk names no built-in (`desk-never-imports-objects`).
import { BoardRoot, Camera, createCanvasEngine, type Entity, HandleSpec, NO_MODS, selectedEntities, Viewport } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectKind, ObjectRect } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
const inRect = (G: ObjectRect, x: number, y: number): boolean => Math.abs(x - G.cx) <= G.w / 2 && Math.abs(y - G.cy) <= G.h / 2;

/** A sheet — a note's stand-in: its rect as drawn, and in its top-right 12 units a named PART (`corner`). Resizable: selected, it wears core's handles. */
const SHEET: ObjectKind<ObjectRect, object> = {
  name: "pick-sheet", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
  hit: (G, x, y) => (!inRect(G, x, y) ? null : x > G.cx + G.w / 2 - 12 && y < G.cy - G.h / 2 + 12 ? "corner" : "content"),
};
/** A book — an object that opens (`ops.open` picks it up into the hand). */
const BOOK: ObjectKind<ObjectRect, object> = {
  name: "pick-book", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
  hit: (G, x, y) => (inRect(G, x, y) ? "content" : null), open: { extent: (c) => c.rect },
};
/** A mat that holds a desk — a mini mat's stand-in: its face its rect inset 10, a live inside drawn through it. */
const MAT: ObjectKind<ObjectRect, object> = {
  name: "pick-mat", stratum: "sheets", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
  hit: (G, x, y) => (inRect(G, x, y) ? "content" : null),
  face: (G) => ({ x: G.cx - G.w / 2 + 10, y: G.cy - G.h / 2 + 10, width: G.w - 20, height: G.h - 20 }),
  faceLaw: { radius: 0, chips: 64, finishes: [] },
};
const Sheet = defineObject({ type: "pick.sheet", version: 1, props: {}, kind: SHEET, provides: ["pick.matted"], interaction: { resizable: true } });
const Book = defineObject({ type: "pick.book", version: 1, props: {}, kind: BOOK });
const Mat = defineObject({ type: "pick.mat", version: 1, props: {}, kind: MAT, container: { accepts: ["pick.matted"] } });
const OBJECTS = [Sheet, Book, Mat];

/**
 * A desk layer on the fake device, mounted as `createDeskHost` mounts it — the stack's seams in its context, the stack's pick among
 * them (`pickAt`; `{ pickAt: false }` leaves it out) — its reflector registered, the camera at the origin (screen = world), stepped on
 * a frame clock of its own. A frame is drawn once the viewport is written (`view`); the device's errors and its loss at hand.
 */
async function mountDesk(opts: { readonly pickAt?: false } = {}) {
  const { device } = fakeDevice();
  const listeners: ((ev: { readonly error: unknown }) => void)[] = [];
  let lose: (info: { readonly reason: string; readonly message: string }) => void = () => {};
  Object.assign(device, {
    addEventListener: (type: string, fn: (ev: { readonly error: unknown }) => void) => { if (type === "uncapturederror") listeners.push(fn); },
    lost: new Promise((r) => { lose = r; }),
    destroy: () => {},
  });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1200, clientHeight: 800, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const ce = createCanvasEngine({ widgets: OBJECTS });
  ce.docs.create();
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const { stack } = ce;
  const handle: DeskLayerHandle = deskLayer({ gpu, objects: OBJECTS, theme: themeFrom("light", PALETTE), palette: PALETTE })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: stack.framePick, ...(opts.pickAt === false ? {} : { pickAt: stack.pickAt }), navGeometry: stack.navGeometry,
    heldPose: stack.heldPose, trayPose: stack.trayPose, spatial: stack.index, readMarquee: () => stack.marqueeBuffer,
  });
  const unregister = ce.engine.registerReflector(handle.reflector);
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  const ready = async (): Promise<void> => { for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5)); };
  const view = (): void => { ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 }); };
  /** An object of `type` with its top-left at (x, y), in the open frame — or in `parent`'s inside, in its own units. */
  const spawn = (type: string, x: number, y: number, w: number, h: number, parent?: Entity): Entity =>
    ce.ops.spawnWidget(type, { x, y, w, h, undoable: false, ...(parent !== undefined ? { parent } : {}) });
  /** A real primary click at a screen point — a press and a release through the stack's queue — and the frames after it. */
  const click = (x: number, y: number): void => {
    for (const [kind, buttons] of [["down", 1], ["up", 0]] as const) {
      stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
      step();
    }
    step(20);   // past the double-tap window: the next click is a click of its own
  };
  return {
    ce, handle, step, ready, view, spawn, click,
    root: (): Entity | undefined => ce.world.getResource(BoardRoot)?.root,
    selection: (): Entity[] => selectedEntities(ce.world),
    uncaptured: (name: string, message: string): void => { for (const fn of listeners) fn({ error: { message, constructor: { name } } }); },
    lost: (reason: string, message: string): void => lose({ reason, message }),
    dispose: () => { unregister(); handle.dispose(); ce.dispose(); },
  };
}

/** A desk drawn: ready, the viewport written, its first frame stepped. */
async function drawnDesk(opts: { readonly pickAt?: false } = {}) {
  const d = await mountDesk(opts);
  await d.ready();
  d.view();
  d.step();
  return d;
}

describe("the desk's pick (petition I27)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("a note: its entity and type, the canvas it lies in (the board root), its part — and a click there selects it; the bare mat: null, and a click there selects nothing", async () => {
    const d = await drawnDesk();
    try {
      const note = d.spawn(Sheet.type, 100, 100, 200, 150);
      d.step(3);
      expect(d.root()).toBeDefined();
      expect(d.handle.pick({ x: 200, y: 175 })).toEqual({ entity: note, type: "pick.sheet", canvas: d.root(), part: "" });
      expect(d.handle.pick({ x: 600, y: 600 })).toBeNull();
      d.click(200, 175);
      expect(d.selection()).toEqual([note]);
      d.click(600, 600);
      expect(d.selection()).toEqual([]);
      // a named PART is the kind's: reported, and a click there works the part and selects nothing
      expect(d.handle.pick({ x: 295, y: 105 })).toEqual({ entity: note, type: "pick.sheet", canvas: d.root(), part: "corner" });
      d.click(295, 105);
      expect(d.selection()).toEqual([]);
    } finally { d.dispose(); }
  });

  it("where two overlap, the topmost by sibling order — reordered, the other; a click there selects the same", async () => {
    const d = await drawnDesk();
    try {
      const under = d.spawn(Sheet.type, 100, 100, 200, 150);
      const over = d.spawn(Sheet.type, 200, 150, 200, 150);
      d.step(3);
      expect(d.handle.pick({ x: 250, y: 200 })?.entity).toBe(over);
      expect(d.handle.pick({ x: 150, y: 125 })?.entity).toBe(under);
      d.click(250, 200);
      expect(d.selection()).toEqual([over]);
      d.ce.ops.reorder([under], "top");
      d.step(3);
      expect(d.handle.pick({ x: 250, y: 200 })?.entity).toBe(under);
      d.click(250, 200);
      expect(d.selection()).toEqual([under]);
    } finally { d.dispose(); }
  });

  it("a note drawn in a LIVE mini mat's inside: the mini mat — the inside is no member of this frame, and a click there selects the mini mat; entered, the note, its canvas the mini mat", async () => {
    const d = await drawnDesk();
    try {
      const mat = d.spawn(Mat.type, 100, 100, 600, 400);
      d.step(2);
      const note = d.spawn(Sheet.type, 0, 0, 200, 150, mat);   // in the inside's own units
      d.step(4);
      const face = d.handle.navFace(mat);
      expect(face?.presence).toBe(1);                // the live inside, whole —
      expect(d.handle.builder.shows(note)).toBe(true);   // — the note drawn in it
      const M = face?.affine ?? { s: Number.NaN, ox: 0, oy: 0 };
      const drawn = { x: M.ox + M.s * 100, y: M.oy + M.s * 75 };   // the note's centre as the face draws it (screen = world here)
      expect(d.handle.pick(drawn)).toEqual({ entity: mat, type: "pick.mat", canvas: d.root(), part: "" });
      d.click(drawn.x, drawn.y);
      expect(d.selection()).toEqual([mat]);
      // entered (the nav op a double-click asks for): the mini mat's desk is the view, the note one of its objects
      d.ce.ops.enterContainer(mat, { transition: "none" });
      d.step(4);
      const cam = d.ce.world.getResource(Camera) ?? { x: Number.NaN, y: 0, zoom: 1 };
      const at = { x: (100 - cam.x) * cam.zoom, y: (75 - cam.y) * cam.zoom };
      expect(d.handle.pick(at)).toEqual({ entity: note, type: "pick.sheet", canvas: mat, part: "" });
      d.click(at.x, at.y);
      expect(d.selection()).toEqual([note]);
    } finally { d.dispose(); }
  });

  it("the hand's object while held: null — though the stack's pick finds it where it is drawn — and the soft desk behind it too (inert in hand); put down, it picks again", async () => {
    const d = await drawnDesk();
    try {
      const book = d.spawn(Book.type, 400, 300, 200, 150);
      const other = d.spawn(Sheet.type, 20, 700, 60, 40);
      d.step(3);
      d.ce.ops.open(book);
      d.step(60);
      const hand = d.handle.hand();
      expect(hand?.entity).toBe(book);
      const on = { x: hand?.frame.cx ?? Number.NaN, y: hand?.frame.cy ?? Number.NaN };
      expect(d.ce.stack.pickAt(on.x, on.y)?.entity).toBe(book);   // the frame tier answers the hand's object where it is drawn…
      expect(d.handle.pick(on)).toBeNull();                         // …the desk's pick, in hand: nothing
      expect(d.ce.stack.pickAt(50, 720)?.entity).toBe(other);       // the soft desk, uncovered by the hand…
      expect(d.handle.pick({ x: 50, y: 720 })).toBeNull();          // …inert while it holds
      d.ce.ops.putDown();
      d.step(120);
      expect(d.handle.hand()).toBeUndefined();
      expect(d.handle.pick({ x: 500, y: 375 })?.entity).toBe(book);
      expect(d.handle.pick({ x: 50, y: 720 })?.entity).toBe(other);
    } finally { d.dispose(); }
  });

  it("before the first frame: null — pending, then ready with no frame drawn, though the stack's pick already answers the box there", async () => {
    const d = await mountDesk();
    try {
      const note = d.spawn(Sheet.type, 100, 100, 200, 150);
      expect(d.handle.status().state).toBe("pending");
      expect(d.handle.pick({ x: 200, y: 175 })).toBeNull();
      await d.ready();
      d.step(2);   // no viewport written: the engine steps, the index holds the note, no frame is drawn
      expect(d.handle.status().state).toBe("ready");
      expect(d.handle.lastInputs()).toBeNull();
      expect(d.ce.stack.pickAt(200, 175)?.entity).toBe(note);   // the box tier stands: the source has no geometry yet (B9)
      expect(d.handle.pick({ x: 200, y: 175 })).toBeNull();
      d.view();
      d.step();
      expect(d.handle.pick({ x: 200, y: 175 })?.entity).toBe(note);
    } finally { d.dispose(); }
  });

  it("a resize handle is no object: null there — the note's corner under it — while the note itself picks", async () => {
    const d = await drawnDesk();
    try {
      const note = d.spawn(Sheet.type, 100, 100, 200, 150);
      d.step(2);
      d.ce.ops.setSelection([note]);
      d.step(3);   // core's handles spawn at the derive flush; the next tick indexes them
      const touched = d.ce.stack.pickAt(101, 101)?.entity;
      expect(touched !== undefined && d.ce.world.has(touched, HandleSpec)).toBe(true);
      expect(d.handle.pick({ x: 101, y: 101 })).toBeNull();
      expect(d.handle.pick({ x: 200, y: 175 })?.entity).toBe(note);
    } finally { d.dispose(); }
  });

  it("the pegboard drawer out: null everywhere (the desk inert); shut, the note again", async () => {
    const d = await drawnDesk();
    try {
      const note = d.spawn(Sheet.type, 100, 100, 200, 150);
      d.step(3);
      expect(d.handle.tray.open()).toBe(true);
      d.step();
      expect(d.handle.pick({ x: 200, y: 175 })).toBeNull();
      d.handle.tray.close();
      d.step();
      expect(d.handle.pick({ x: 200, y: 175 })?.entity).toBe(note);
    } finally { d.dispose(); }
  });

  it("`degraded` picks — the desk still draws and a click still selects; the device lost, null", async () => {
    const d = await drawnDesk();
    try {
      const note = d.spawn(Sheet.type, 100, 100, 200, 150);
      d.step(3);
      d.uncaptured("GPUValidationError", "a frame lost");
      expect(d.handle.status().state).toBe("degraded");
      expect(d.handle.pick({ x: 200, y: 175 })?.entity).toBe(note);
      const said = vi.spyOn(console, "error").mockImplementation(() => {});
      d.lost("unknown", "the device went away");
      for (let i = 0; i < 20 && d.handle.status().state !== "failed"; i++) await new Promise((r) => setTimeout(r, 1));
      expect(said).toHaveBeenCalledWith("[ice] desk: the device was lost", expect.any(Error));
      expect(d.handle.status().state).toBe("failed");
      expect(d.handle.lastInputs()).not.toBeNull();   // the last frame's inputs stand — the desk that drew them does not
      expect(d.handle.pick({ x: 200, y: 175 })).toBeNull();
    } finally { d.dispose(); }
  });

  it("reads, never writes: no selection, no redraw, no wake — and a host with no stack pick in its context answers null; a malformed point throws", async () => {
    const d = await drawnDesk();
    const bare = await drawnDesk({ pickAt: false });
    try {
      const note = d.spawn(Sheet.type, 100, 100, 200, 150);
      d.step(3);
      const before = { selection: d.selection(), redraws: d.handle.redraws(), frames: d.handle.perf().frames, wakes: { ...d.ce.engine.frame.sleepStats().wakes } };
      expect(d.handle.pick({ x: 200, y: 175 })?.entity).toBe(note);
      expect(d.handle.pick({ x: 600, y: 600 })).toBeNull();
      expect({ selection: d.selection(), redraws: d.handle.redraws(), frames: d.handle.perf().frames, wakes: d.ce.engine.frame.sleepStats().wakes }).toEqual(before);
      bare.spawn(Sheet.type, 100, 100, 200, 150);
      bare.step(3);
      expect(bare.handle.pick({ x: 200, y: 175 })).toBeNull();
      expect(() => d.handle.pick({ x: Number.NaN, y: 0 })).toThrow(/pick — the point is/);
      expect(() => d.handle.pick(undefined as unknown as { x: number; y: number })).toThrow(/pick — the point is undefined/);
    } finally { d.dispose(); bare.dispose(); }
  });
});
