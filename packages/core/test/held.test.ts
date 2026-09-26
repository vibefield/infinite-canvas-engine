// @vitest-environment node
// THE HAND (design-015 §8; D4b): `Held` is the fact and `ops.open`/`ops.putDown` its one writer; the
// double-tap on an OPENABLE object asks to pick it up through the one-tick `HeldIntent` the facade
// applies after the tick (a container's double-tap still enters); while something is held every
// pointer is the held object's — the desk behind is inert (no pick, no selection, no move, no camera:
// each negative with its control), the ⌘-wheel brings the object closer ABOUT THE POINTER by the
// hand's own law, a plain wheel moves it once brought close, in past 0.72× puts it down and MUTES the
// rest of the gesture, a click on the soft desk puts it down, two taps on the object do too, and the
// pointer is mapped into the object's frame through the pose seam. Through the REAL stack.
import { describe, expect, it } from "vitest";
import {
  Camera,
  HOLD_INPUT,
  Held,
  HeldIntent,
  HeldMute,
  HeldPointer,
  HeldView,
  LocalPointer,
  NO_MODS,
  Pointer,
  Position,
  Selected,
  Viewport,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  widgets,
  type Entity,
  type HeldScreenFrame,
  type InputMods,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const BOOK =
  widgets.get("held:book") ??
  defineWidget({ type: "held:book", object: { name: "book" }, openable: true, defaultSize: { w: 200, h: 140 } });
const NOTE =
  widgets.get("held:note") ??
  defineWidget({ type: "held:note", object: { name: "note" }, defaultSize: { w: 100, h: 100 } });
const FOLDER =
  widgets.get("held:folder") ??
  defineWidget({ type: "held:folder", defaultSize: { w: 200, h: 150 }, container: { accepts: ["widget"] } });

const VP = { w: 800, h: 600, dpr: 1 };
const META: InputMods = { ...NO_MODS, meta: true };
const pointerQ = defineQuery([Pointer, LocalPointer]);

function rig() {
  const ce = createCanvasEngine({ widgets: [BOOK, NOTE, FOLDER], settings: { gestures: { wheel: "zoom" } } });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  const book = ce.ops.spawnWidget("held:book", { x: 100, y: 100, undoable: false });    // centre (200, 170)
  const note = ce.ops.spawnWidget("held:note", { x: 500, y: 100, undoable: false });    // centre (550, 150)
  const folder = ce.ops.spawnWidget("held:folder", { x: 300, y: 400, undoable: false }); // centre (400, 475)
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods: InputMods = NO_MODS): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods });
  };
  const wheel = (x: number, y: number, w: { dx?: number; dy?: number; pinch?: number }, mods: InputMods = NO_MODS): void => {
    ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods, wheel: { dx: w.dx ?? 0, dy: w.dy ?? 0, pinch: w.pinch ?? 0 } });
    step();
  };
  /** One instant tap: down on one tick, up on the next. */
  const tap = (x: number, y: number): void => { mouse("move", x, y, 0); step(); mouse("down", x, y, 1); step(); mouse("up", x, y, 0); step(); };
  const drag = (from: readonly [number, number], to: readonly [number, number], mods: InputMods = NO_MODS): void => {
    mouse("move", from[0], from[1], 0, mods); step();
    mouse("down", from[0], from[1], 1, mods); step();
    for (let i = 1; i <= 6; i++) { mouse("move", from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6, 1, mods); step(); }
    mouse("up", to[0], to[1], 0, mods); step(2);
  };
  /** A pose source the renderer would publish: the book at its reading pose — centred, 300 × 200 on screen at 1.5 px per unit, AS DRAWN (its extent and scale follow the held zoom, its centre the pan). */
  let settled = true;
  const FRAME: HeldScreenFrame = { cx: 400, cy: 300, hx: 150, hy: 100, s: 1.5, settled: true };
  ce.stack.heldPose.current = {
    frame: (e) => {
      if (e !== book) return undefined;
      const v = ce.world.get(book, HeldView) ?? { zoom: 1, panX: 0, panY: 0 };
      return { cx: FRAME.cx + v.panX, cy: FRAME.cy + v.panY, hx: FRAME.hx * v.zoom, hy: FRAME.hy * v.zoom, s: FRAME.s * v.zoom, settled };
    },
  };
  const cam = () => { const c = ce.world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 }; return { x: c.x, y: c.y, zoom: c.zoom }; };
  const held = () => ce.world.hasTag(book, Held);
  const view = () => ce.world.get(book, HeldView);
  const pointer = (): Entity | undefined => ce.world.firstOf(pointerQ);
  return { ce, world: ce.world, step, mouse, wheel, tap, drag, cam, held, view, pointer, book, note, folder, FRAME, setSettled: (s: boolean) => { settled = s; }, clock: () => now };
}

describe("ops.open / ops.putDown — the one writer of Held (design-015 §8)", () => {
  it("open picks an openable up (Held + HeldView at the reading size, selected); putDown lets go and keeps the selection", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    expect(r.held()).toBe(true);
    expect(r.view()).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(r.world.hasTag(r.book, Selected)).toBe(true);
    r.ce.ops.open(r.book);   // the same object again: nothing to do
    r.ce.ops.putDown();
    expect(r.held()).toBe(false);
    expect(r.world.has(r.book, HeldView)).toBe(false);
    expect(r.world.hasTag(r.book, Selected)).toBe(true);   // "it stays selected, so ↩ opens it again"
    r.ce.ops.putDown();   // nothing held: a no-op
    expect(r.held()).toBe(false);
  });

  it("refuses a kind without an opening, a container, and a second object while one is held", () => {
    const r = rig();
    expect(() => r.ce.ops.open(r.note)).toThrow(/kind opens/);
    expect(() => r.ce.ops.open(r.folder)).toThrow(/kind opens/);
    r.ce.ops.open(r.book);
    const book2 = r.ce.ops.spawnWidget("held:book", { x: 600, y: 400, undoable: false });
    r.world.sync();
    r.step(3);
    expect(() => r.ce.ops.open(book2)).toThrow(/another object is in hand/);
    expect(r.held()).toBe(true);
    expect(r.world.hasTag(book2, Held)).toBe(false);
  });

  it("a nav cut lets go of the hand (the chrome belongs to the desk you are on)", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    r.ce.ops.enterContainer(r.folder);
    expect(r.held()).toBe(false);
    expect(r.world.has(r.book, HeldView)).toBe(false);
  });
});

describe("the double-tap router (design-015 §8 · §9)", () => {
  it("the first tap selects; the second on an OPENABLE object asks to open (HeldIntent), applied after the tick", () => {
    const r = rig();
    r.tap(200, 170);
    expect(r.world.hasTag(r.book, Selected)).toBe(true);
    expect(r.held()).toBe(false);
    r.tap(200, 170);
    expect(r.world.getResource(HeldIntent)).toMatchObject({ kind: "open", target: r.book, epoch: 1 });
    expect(r.held()).toBe(true);
    expect(r.ce.nav.depth()).toBe(0);   // never entered
  });

  it("a container's double-tap still enters; a plain object's does nothing", () => {
    const r = rig();
    r.tap(400, 475);
    r.tap(400, 475);
    expect(r.ce.nav.depth()).toBe(1);
    expect(r.world.getResource(HeldIntent)).toBeUndefined();
    r.ce.ops.exitContainer({ transition: "none" });
    r.step(3);
    r.tap(550, 150);
    r.tap(550, 150);
    expect(r.world.getResource(HeldIntent)).toBeUndefined();
    expect(r.world.hasTag(r.note, Held)).toBe(false);
  });
});

describe("the desk behind is inert while something is held", () => {
  it("a tap on another object selects nothing; a drag on it moves nothing; the camera never hears the wheel or a pan — each with its control", () => {
    const r = rig();
    // the controls: the same gestures with nothing held do their work
    r.tap(550, 150);
    expect(r.world.hasTag(r.note, Selected)).toBe(true);
    const cam0 = r.cam();
    r.wheel(600, 300, { dy: -100 });
    expect(r.cam().zoom).not.toBe(cam0.zoom);
    r.ce.ops.zoomTo(1, { x: 0, y: 0 });
    r.ce.ops.panTo(0, 0);
    r.step(2);
    // in hand
    r.ce.ops.open(r.book);
    r.step();
    const before = r.cam();
    // a tap on another object selects nothing — it is a click on the soft desk, which puts the book down (its one meaning)
    r.tap(550, 150);
    expect(r.world.hasTag(r.note, Selected)).toBe(false);
    expect(r.world.hasTag(r.book, Selected)).toBe(true);
    expect(r.held()).toBe(false);
    r.ce.ops.open(r.book);
    r.step();
    r.drag([550, 150], [650, 250]);   // a drag from another object: nothing moves, and moved is not a click
    expect(r.world.get(r.note, Position)).toEqual({ x: 500, y: 100 });
    expect(r.held()).toBe(true);
    r.wheel(600, 300, { dy: -100 });   // a plain wheel at the reading size: nothing (not the camera)
    r.wheel(600, 300, { pinch: 0 });
    r.drag([700, 500], [600, 450]);   // a drag on the soft desk at the reading size: not a pan (and moved: not a click)
    expect(r.cam()).toEqual(before);
    expect(r.held()).toBe(true);
    r.ce.ops.putDown();
    r.step(2);
    // released: the desk hears again (the drag's dead zone eats its first step, so "moved", not a number)
    r.drag([550, 150], [650, 250]);
    expect(r.world.get(r.note, Position)?.x ?? 0).toBeGreaterThan(560);
  });
});

describe("the held wheel (desk.js heldZoomAt / heldPanBy)", () => {
  it("⌘-wheel brings the object closer about the pointer — the point under it stays; at the reading size and under, centred", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    r.step();
    r.wheel(500, 300, { dy: -50 }, META);
    const z1 = Math.exp(50 * HOLD_INPUT.wheelRate);
    const v1 = r.view();
    expect(v1?.zoom).toBeCloseTo(z1, 9);
    // pan' = pan + (p − C)(1 − r): C = (400, 300), p = (500, 300)
    expect(v1?.panX).toBeCloseTo(100 * (1 - z1), 9);
    expect(v1?.panY).toBeCloseTo(0, 9);
    // back out to the reading size: the pan snaps home
    r.wheel(500, 300, { dy: 50 }, META);
    expect(r.view()).toEqual({ zoom: 1, panX: 0, panY: 0 });
    // the ceiling: never past 3×
    for (let i = 0; i < 6; i++) r.wheel(400, 300, { dy: -60 }, META);
    expect(r.view()?.zoom).toBe(HOLD_INPUT.zoomMax);
    expect(r.held()).toBe(true);
  });

  it("brought close, a plain wheel moves the object under the eye, clamped to half its extent; a pinch is a ⌘-wheel", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    r.step();
    r.wheel(400, 300, { pinch: -30 });   // a pinch zooms by the same law, about the centre: no pan
    const z = Math.exp(30 * HOLD_INPUT.wheelRate);
    expect(r.view()).toMatchObject({ panX: 0, panY: 0 });
    expect(r.view()?.zoom).toBeCloseTo(z, 9);
    r.wheel(400, 300, { dx: 10, dy: 20 });
    expect(r.view()?.panX).toBeCloseTo(-10, 9);
    expect(r.view()?.panY).toBeCloseTo(-20, 9);
    // the clamp: half the held extent at this zoom — hx 150 (at zoom 1) · z
    r.wheel(400, 300, { dx: -10000 });
    expect(r.view()?.panX).toBeCloseTo(150 * z, 6);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("the wheel waits for the pickup to settle", () => {
    const r = rig();
    r.setSettled(false);
    r.ce.ops.open(r.book);
    r.step();
    r.wheel(500, 300, { dy: -50 }, META);
    expect(r.view()).toEqual({ zoom: 1, panX: 0, panY: 0 });
    r.setSettled(true);
    r.wheel(500, 300, { dy: -50 }, META);
    expect(r.view()?.zoom).toBeGreaterThan(1);
  });

  it("in past 0.72× puts the object down and MUTES the rest of that gesture — the camera never zooms on its tail", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    r.step();
    r.wheel(400, 300, { dy: 40 }, META);   // exp(−0.42) = 0.657 < 0.72
    expect(r.held()).toBe(false);
    expect(r.world.getResource(HeldIntent)).toMatchObject({ kind: "putDown" });
    const mute = r.world.getResource(HeldMute);
    expect(mute?.until).toBeGreaterThan(r.clock());
    // the gesture's tail: swallowed, each event pushing the mute on — the desk's camera stands
    for (let i = 0; i < 5; i++) r.wheel(400, 300, { dy: 40 }, META);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(r.world.getResource(HeldMute)?.until).toBeGreaterThanOrEqual(mute?.until ?? 0);   // never shortened by the tail
    // past the mute the wheel is the desk's again (the control)
    r.step(40);
    r.wheel(400, 300, { dy: 40 });
    expect(r.cam().zoom).not.toBe(1);
  });
});

describe("the ways back by pointer, and the pointer in the object's frame", () => {
  it("a click on the soft desk puts it down; a click on the object does not; two instant taps on the object do", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    r.step();
    r.tap(400, 300);   // inside the held frame
    expect(r.held()).toBe(true);
    r.tap(700, 550);   // the soft desk
    expect(r.held()).toBe(false);
    expect(r.world.getResource(HeldIntent)).toMatchObject({ kind: "putDown" });
    r.ce.ops.open(r.book);
    r.step();
    r.tap(400, 300);
    r.tap(400, 300);
    expect(r.held()).toBe(false);
  });

  it("the pointer is mapped through the pose the renderer drew: the object's units, centred, and an inside verdict", () => {
    const r = rig();
    r.ce.ops.open(r.book);
    r.mouse("move", 430, 320, 0);
    r.step();
    const p = r.pointer();
    expect(p).toBeDefined();
    const hp = r.world.get(p as Entity, HeldPointer);
    expect(hp?.x).toBeCloseTo(20, 9);
    expect(hp?.y).toBeCloseTo(20 / 1.5, 9);
    expect(hp?.inside).toBe(true);
    r.mouse("move", 700, 550, 0);
    r.step();
    expect(r.world.get(p as Entity, HeldPointer)?.inside).toBe(false);
    r.ce.ops.putDown();
    r.step();
    expect(r.world.has(p as Entity, HeldPointer)).toBe(false);   // the hand let go: the pointer's held facts leave
  });
});
