// @vitest-environment node
// THE TRAY (design-017 §2, §4; K3): `Tray` is the pegboard drawer's fact — one runtime entity per view, ensured at install and after a
// reset — and its ops and `trayInput` its only writers. Closed, the drawer takes no pointer (design-018 §5 — the lip's handle, its
// hover and its press retired: the bottom centre is the desk's); open, the desk is INERT (no pick, no selection, no move, no camera — each negative with its control), the wheel over the
// drawer scrolls it (⌘-wheel and pinch swallowed), past an end into the band that lets go when the wheel is quiet, a drag on the board
// scrolls it, a click on the dimmed desk closes it, a press on DOM chrome stays the chrome's. Opening cancels a gesture in flight and is
// refused with an object in hand. Through the REAL stack; the pose seam is what the renderer would publish.
import { describe, expect, it } from "vitest";
import {
  Camera,
  CanvasSurface,
  closeTray,
  createCanvasEngine,
  defineWidget,
  GestureActive,
  LocalPointer,
  NO_MODS,
  openTray,
  Pointer,
  PointerPart,
  Position,
  scrollBy,
  scrollTray,
  Selected,
  Targets,
  toggleTray,
  TouchesExact,
  Tray,
  TRAY_INPUT,
  trayEntity,
  trayOpen,
  Viewport,
  defineQuery,
  widgets,
  type Entity,
  type InputMods,
  type TrayScreenFrame,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const NOTE = widgets.get("tray:note") ?? defineWidget({ type: "tray:note", object: { name: "note" }, defaultSize: { w: 100, h: 100 } });
const BOOK = widgets.get("tray:book") ?? defineWidget({ type: "tray:book", object: { name: "book" }, openable: true, defaultSize: { w: 200, h: 140 } });

const VP = { w: 800, h: 600, dpr: 1 };
const META: InputMods = { ...NO_MODS, meta: true };
const activeQ = defineQuery([GestureActive]);

function rig() {
  const ce = createCanvasEngine({ widgets: [NOTE, BOOK], settings: { gestures: { wheel: "zoom" } } });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  const note = ce.ops.spawnWidget("tray:note", { x: 100, y: 100, undoable: false });   // centre (150, 150) — above the drawer
  const low = ce.ops.spawnWidget("tray:note", { x: 350, y: 450, undoable: false });    // centre (400, 500) — under the drawer
  const book = ce.ops.spawnWidget("tray:book", { x: 500, y: 60, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, extra: { surfaceHandled?: true } = {}): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS, ...extra });
  };
  const wheel = (x: number, y: number, w: { dx?: number; dy?: number; pinch?: number }, mods: InputMods = NO_MODS): void => {
    ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods, wheel: { dx: w.dx ?? 0, dy: w.dy ?? 0, pinch: w.pinch ?? 0 } });
    step();
  };
  const tap = (x: number, y: number): void => { mouse("move", x, y, 0); step(); mouse("down", x, y, 1); step(); mouse("up", x, y, 0); step(); };
  const drag = (from: readonly [number, number], to: readonly [number, number], steps = 6): void => {
    mouse("move", from[0], from[1], 0); step();
    mouse("down", from[0], from[1], 1); step();
    for (let i = 1; i <= steps; i++) { mouse("move", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, 1); step(); }
    mouse("up", to[0], to[1], 0); step(2);
  };
  // what the renderer would publish: the drawer 720 × 252 open (its top at 348), its 12 px lip closed; a scroll range of 600
  const max = 600;
  const shown = (): number => { const e = trayEntity(ce.world); return e === undefined ? 0 : ce.world.read(e, Tray).scroll; };
  const frame = (): TrayScreenFrame => (trayOpen(ce.world) ? { x: 40, y: 348, w: 720, h: 252, p: 1, max, pitch: 40, scroll: shown() } : { x: 40, y: 588, w: 720, h: 252, p: 0, max, pitch: 40, scroll: shown() });
  ce.stack.trayPose.current = { frame };
  const tray = () => { const e = trayEntity(ce.world); if (e === undefined) throw new Error("no tray"); return ce.world.read(e, Tray); };
  const cam = () => { const c = ce.world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 }; return { x: c.x, y: c.y, zoom: c.zoom }; };
  const pos = (e: number) => ce.world.read(e as never, Position);
  return { ce, world: ce.world, step, mouse, wheel, tap, drag, tray, cam, pos, note, low, book, max, clock: () => now };
}

describe("the Tray fact (design-017 §2)", () => {
  it("is one runtime entity per view, closed at install, and there again — closed — after the document resets", () => {
    const r = rig();
    const e = trayEntity(r.world);
    expect(e).toBeDefined();
    expect(r.tray()).toMatchObject({ open: false, scroll: 0, stretch: 0 });
    openTray(r.world);
    const s = r.ce.docs.current();
    s?.close();
    const again = trayEntity(r.world);
    expect(again).toBeDefined();
    expect(trayOpen(r.world)).toBe(false);
  });

  it("opens and closes through its ops; toggles; the scroll door takes any value", () => {
    const r = rig();
    expect(toggleTray(r.world)).toBe(true);
    expect(trayOpen(r.world)).toBe(true);
    expect(toggleTray(r.world)).toBe(false);
    scrollTray(r.world, 40e6 + 17);
    expect(r.tray().scroll).toBe(40e6 + 17);
    closeTray(r.world);
    expect(r.tray().open).toBe(false);
  });

  it("opening cancels a gesture in flight (the note flies back where it was) — and is refused with an object in hand", () => {
    const r = rig();
    const before = { ...r.pos(r.note) };
    r.mouse("move", 150, 150, 0); r.step();
    r.mouse("down", 150, 150, 1); r.step();
    for (let i = 1; i <= 4; i++) { r.mouse("move", 150 + i * 20, 150, 1); r.step(); }
    expect(r.world.firstOf(activeQ)).toBeDefined();   // control: a drag is live
    expect(openTray(r.world)).toBe(true);
    r.step(3);
    expect(r.world.firstOf(activeQ)).toBeUndefined();
    r.mouse("up", 230, 150, 0); r.step(2);
    expect(r.pos(r.note)).toEqual(before);
    closeTray(r.world);
    r.ce.ops.open(r.book);
    expect(openTray(r.world)).toBe(false);
    expect(trayOpen(r.world)).toBe(false);
  });
});

describe("closed — the drawer takes no pointer (design-018 §5)", () => {
  it("a press at the bottom centre, where the lip's handle was — on the strip the pose still draws — is the desk's: the desk's cursor, a click leaves the drawer shut, a drag up opens nothing, a press-drag is a desk gesture", () => {
    const r = rig();
    const gesture = (x: number, y: number, dx: number, dy: number): boolean => {
      let live = false;
      r.mouse("move", x, y, 0); r.step();
      r.mouse("down", x, y, 1); r.step();
      for (let i = 1; i <= 8; i++) { r.mouse("move", x + i * dx, y + i * dy, 1); r.step(); if (r.world.firstOf(activeQ) !== undefined) live = true; }
      r.mouse("up", x + 8 * dx, y + 8 * dy, 0); r.step(2);
      return live;
    };
    r.mouse("move", 400, 590, 0); r.step();
    expect(r.ce.stack.readCursor()).toBe("default");   // not a thing to pull: the desk's
    r.tap(400, 594);
    expect(trayOpen(r.world)).toBe(false);
    expect(gesture(380, 594, 0, -5)).toBe(true);       // a drag up from the centre: the desk's gesture, and no drawer
    expect(trayOpen(r.world)).toBe(false);
    expect(gesture(350, 594, 15, 0)).toBe(true);       // …and sideways
    expect(trayOpen(r.world)).toBe(false);
  });
});

describe("open — the desk is inert, the drawer scrolls (design-017 §4)", () => {
  it("a press-drag on a note moves nothing and selects nothing (control: closed, the same drag moves it)", () => {
    const r = rig();
    openTray(r.world); r.step();
    const before = { ...r.pos(r.note) };
    r.drag([150, 150], [250, 200]);
    expect(r.pos(r.note)).toEqual(before);
    expect(r.world.hasTag(r.note, Selected)).toBe(false);
    expect(trayOpen(r.world)).toBe(true);   // moved: not a click, the drawer stays
    closeTray(r.world); r.step();
    r.drag([150, 150], [250, 200]);
    expect(r.pos(r.note)).not.toEqual(before);
  });

  it("a click on the dimmed desk closes the drawer (and selects nothing under it); a press on DOM chrome there stays the chrome's", () => {
    const r = rig();
    openTray(r.world); r.step();
    r.mouse("move", 150, 150, 0); r.step();
    r.mouse("down", 150, 150, 1, { surfaceHandled: true }); r.step();
    r.mouse("up", 150, 150, 0); r.step();
    expect(trayOpen(r.world)).toBe(true);
    r.tap(150, 150);
    expect(trayOpen(r.world)).toBe(false);
    expect(r.world.hasTag(r.note, Selected)).toBe(false);
  });

  it("a click on the drawer itself leaves it open and never reaches the note under it", () => {
    const r = rig();
    openTray(r.world); r.step();
    r.tap(400, 500);
    expect(trayOpen(r.world)).toBe(true);
    expect(r.world.hasTag(r.low, Selected)).toBe(false);
  });

  it("the PICK is inert too (K9 law #1): while the drawer is out the mouse touches the bare canvas — over the note under the drawer and over the note on the dimmed desk alike, no part named — a note hovered as the drawer opens is let go without a move, and the hit comes back the tick the drawer shuts (control)", () => {
    const r = rig();
    const mouseQ = defineQuery([Pointer, LocalPointer]);
    const mouse = (): Entity => { let e: Entity | undefined; r.world.query(mouseQ).each((b) => { for (const row of b) e = b.entity(row); }); if (e === undefined) throw new Error("no mouse pointer"); return e; };
    const canvas = r.world.firstOf(defineQuery([CanvasSurface]));
    expect(canvas).toBeDefined();
    // the drawer shut, the note above it is hovered: its exact hit and its target
    r.mouse("move", 150, 150, 0); r.step();
    expect(r.world.getRelation(mouse(), TouchesExact)).toBe(r.note);
    expect(r.world.getRelation(mouse(), Targets)).toBe(r.note);
    // opened by the key (the op), the pointer STILL: the pick runs on the flip alone and the note is let go — the hit is the canvas
    openTray(r.world); r.step();
    expect(r.world.getRelation(mouse(), TouchesExact)).toBe(canvas);
    expect(r.world.getRelation(mouse(), Targets)).toBe(canvas);
    expect(r.world.get(mouse(), PointerPart)?.part ?? "").toBe("");
    // a move onto the note UNDER the drawer (its centre), and back onto the one on the dimmed desk: the canvas both times, every tick
    r.mouse("move", 400, 500, 0); r.step(3);
    expect(r.world.getRelation(mouse(), TouchesExact)).toBe(canvas);
    expect(r.world.getRelation(mouse(), Targets)).toBe(canvas);
    r.mouse("move", 150, 150, 0); r.step(3);
    expect(r.world.getRelation(mouse(), TouchesExact)).toBe(canvas);
    expect(r.world.hasTag(r.note, Selected)).toBe(false);
    // control: shut again, the pointer still — the pick runs on the flip and the note is the hit again at once
    closeTray(r.world); r.step();
    expect(r.world.getRelation(mouse(), TouchesExact)).toBe(r.note);
    expect(r.world.getRelation(mouse(), Targets)).toBe(r.note);
  });

  it("the wheel over the drawer scrolls it and never moves the camera; ⌘-wheel and a pinch there, and any wheel on the dimmed desk, do nothing (control: closed, the wheel zooms)", () => {
    const r = rig();
    const c0 = r.cam();
    r.wheel(400, 500, { dy: 30 });
    expect(r.cam()).not.toEqual(c0);   // control: the desk's wheel
    r.ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    r.step(2);
    openTray(r.world); r.step();
    const c1 = r.cam();
    r.wheel(400, 500, { dy: 30 });
    r.wheel(400, 500, { dy: 12 });
    expect(r.tray().scroll).toBe(42);
    r.wheel(400, 500, { dy: 40 }, META);
    r.wheel(400, 500, { pinch: 20 });
    r.wheel(150, 150, { dy: 50 });
    expect(r.tray().scroll).toBe(42);
    r.step(3);
    expect(r.cam()).toEqual(c1);
  });

  it("past an end the rest is the band; a reversal unwinds it first; it lets go once the wheel is quiet — and as the drawer closes", () => {
    const r = rig();
    openTray(r.world); r.step();
    r.wheel(400, 500, { dy: r.max - 10 });
    r.wheel(400, 500, { dy: 50 });
    expect(r.tray().scroll).toBe(r.max);
    expect(r.tray().stretch).toBe(40);
    r.wheel(400, 500, { dy: -30 });
    expect(r.tray().scroll).toBe(r.max);
    expect(r.tray().stretch).toBe(10);
    r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 1);
    expect(r.tray().stretch).toBe(0);
    r.wheel(400, 500, { dy: -r.max - 25 });
    expect(r.tray().scroll).toBe(0);
    expect(r.tray().stretch).toBe(-25);
    closeTray(r.world);
    expect(r.tray().stretch).toBe(0);
  });

  it("shut mid-flick, the rest of its momentum stays the tray's until the wheel goes quiet — the desk never zooms (K9 S7); quiet, the wheel is the desk's again", () => {
    const r = rig();
    openTray(r.world); r.step();
    const c0 = r.cam();
    let dy = 40;
    for (let i = 0; i < 24; i++) {
      if (i === 6) closeTray(r.world);   // Esc's way, the momentum still arriving — a frame apart, decaying as the OS sends it
      r.wheel(400, 500, { dy: Math.max(1, Math.round(dy)) });
      dy *= 0.9;
    }
    expect(trayOpen(r.world)).toBe(false);
    r.step(3);
    expect(r.cam()).toEqual(c0);
    // …a stream the DIMMED desk swallowed (never over the drawer) running on as a click there shuts the drawer: the same
    r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 1);
    openTray(r.world); r.step();
    for (let i = 0; i < 4; i++) r.wheel(150, 150, { dy: 20 });
    r.tap(150, 150);
    expect(trayOpen(r.world)).toBe(false);
    for (let i = 0; i < 6; i++) r.wheel(150, 150, { dy: 20 });
    r.step(3);
    expect(r.cam()).toEqual(c0);
    // quiet `letGoMs`: the latch lets go, and the wheel zooms the desk (control)
    r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 1);
    r.wheel(400, 500, { dy: 30 });
    r.step(2);
    expect(r.cam()).not.toEqual(c0);
  });

  it("past an end, a FADING tail — each delta smaller than the last — lets the band go after three and spends the rest (K9 S11); a steady push holds it until the wheel is quiet", () => {
    const r = rig();
    openTray(r.world); r.step();
    scrollTray(r.world, r.max - 30); r.step();
    const pulls: number[] = [];
    let dy = 40;
    for (let i = 0; i < 12; i++) { r.wheel(400, 500, { dy: Math.round(dy) }); pulls.push(r.tray().stretch); dy *= 0.9; }
    // 40 fills the scroll's last 30 and pulls 10; 36 and 32, each smaller, pull on; 29 — the third smaller — lets it go
    expect(pulls.slice(0, 4)).toEqual([10, 46, 78, 0]);
    expect(pulls.slice(4).every((s) => s === 0)).toBe(true);   // the rest of the tail is spent: the band stays home
    expect(r.tray().scroll).toBe(r.max);
    r.wheel(400, 500, { dy: -20 });                             // a reversal ends the spent tail: it scrolls back
    expect(r.tray().scroll).toBe(r.max - 20);
    // control: a steady push past the end (equal deltas, a hand holding it there) keeps the band until the wheel is quiet
    r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 1);
    scrollTray(r.world, r.max); r.step();
    for (let i = 0; i < 6; i++) r.wheel(400, 500, { dy: 20 });
    expect(r.tray().stretch).toBe(120);
    r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 1);
    expect(r.tray().stretch).toBe(0);
  });

  it("a drag on the board scrolls it by the pointer's travel, into the band past an end, which lets go after the release", () => {
    const r = rig();
    openTray(r.world); r.step();
    r.drag([400, 560], [400, 460]);
    expect(r.tray().scroll).toBe(100);
    r.mouse("move", 400, 400, 0); r.step();
    r.mouse("down", 400, 400, 1); r.step();
    r.mouse("move", 400, 560, 1); r.step();   // back up past the top: 100 − 160
    expect(r.tray().scroll).toBe(0);
    expect(r.tray().stretch).toBe(-60);
    r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 2);
    expect(r.tray().stretch).toBe(-60);   // the finger still holds it
    r.mouse("up", 400, 560, 0); r.step(Math.ceil(TRAY_INPUT.letGoMs / 16) + 2);
    expect(r.tray().stretch).toBe(0);
  });
});

describe("scrollBy — the band's arithmetic", () => {
  it("fills the scroll to its ends, puts the rest in the band, and unwinds the band before moving the scroll back", () => {
    expect(scrollBy(0, 0, 30, 100)).toEqual({ scroll: 30, stretch: 0 });
    expect(scrollBy(90, 0, 30, 100)).toEqual({ scroll: 100, stretch: 20 });
    expect(scrollBy(100, 20, -5, 100)).toEqual({ scroll: 100, stretch: 15 });
    expect(scrollBy(100, 20, -50, 100)).toEqual({ scroll: 70, stretch: 0 });
    expect(scrollBy(0, 0, -30, 100)).toEqual({ scroll: 0, stretch: -30 });
    expect(scrollBy(0, -30, 50, 100)).toEqual({ scroll: 20, stretch: 0 });
    expect(scrollBy(0, 0, 25, 0)).toEqual({ scroll: 0, stretch: 25 });
  });
});
