// @vitest-environment node
// A SECONDARY BUTTON NEVER ACTS (petition I28): a secondary (right) or middle press is a POINT for the interaction stack, never a
// GESTURE. The pointer's point, its exact pick and the part under it move with the press — what a host's right-click reads
// (`handle.pick`, I27) — but no recognizer spawns: nothing selects, no part is worked, nothing is held long, nothing drags, no
// transaction commits, nothing enters and nothing opens; a primary click afterward works as before. The middle button keeps the
// one thing it did by device convention — the pan of the bare canvas (design-003 §4.4) — and nothing else; touch, a pen's tip and
// its eraser end, and a synthetic down that names no button are primary as ever. Through the REAL stack: picking, the recognizers,
// the behaviours, the camera, the facade's enter and open.
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Active,
  Any,
  Camera,
  ClaimedBy,
  Drag,
  type Entity,
  type FramePickSource,
  GESTURE_DEFAULTS,
  Grab,
  HOLD_INPUT,
  Held,
  HeldIntent,
  HeldPress,
  HeldView,
  type InputEvent,
  LocalPointer,
  LongPress,
  Movable,
  NO_MODS,
  NavIntent,
  PartTap,
  Pinch,
  Pointer,
  PointerPart,
  PointerScreen,
  Position,
  Selectable,
  Selected,
  Size,
  Tap,
  TouchesExact,
  Viewport,
  WidgetEquipped,
  createCanvasEngine,
  createEngine,
  createRecordingCommitSink,
  defineQuery,
  defineWidget,
  installInteractionStack,
  widgets,
} from "../src";

const RIGHT = 2;
const MIDDLE = 4;
const CLOSE_R = 13;   // the close control's radius at the card's top-right corner

const recognizerQ = defineQuery([Any(Tap, LongPress, Drag, Pinch)]);
const mouseQ = defineQuery([Pointer, LocalPointer]);

/** The stack with a recording sink, screen == world, and one card as the frame tier sees one — a `close` PART at its top-right corner. */
function stackRig() {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const source: FramePickSource = {
    pad: () => 0,
    hit(e, wx, wy) {
      const p = world.get(e, Position);
      const s = world.get(e, Size);
      if (p === undefined || s === undefined) return "outside";
      if (Math.hypot(wx - (p.x + s.w), wy - p.y) <= CLOSE_R) return "close";
      return wx >= p.x && wx <= p.x + s.w && wy >= p.y && wy <= p.y + s.h ? "content" : "outside";
    },
  };
  stack.framePick.current = source;
  // the card spans (100, 100)–(300, 220); its close control sits on the corner (300, 100)
  const card = world.spawn({
    components: [[Position, { x: 100, y: 100 }], [Size, { w: 200, h: 120 }]],
    tags: [Selectable, Movable, WidgetEquipped, Active],
  });
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; engine.step(now); } };
  step();
  const send = (kind: InputEvent["kind"], x: number, y: number, buttons: number, id = "mouse", device: InputEvent["device"] = "mouse"): void => {
    stack.queue.enqueue({ kind, pointerId: id, device, screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  /** A press at (x, y) with `buttons`, held `holdTicks`, released where it went down. */
  const click = (x: number, y: number, buttons: number, holdTicks = 1): void => {
    send("move", x, y, 0); step();
    send("down", x, y, buttons); step(holdTicks);
    send("up", x, y, 0); step(2);
  };
  /** A press at `from`, six moves to `to` with the button held, released at `to`. */
  const drag = (from: readonly [number, number], to: readonly [number, number], buttons: number): void => {
    send("move", from[0], from[1], 0); step();
    send("down", from[0], from[1], buttons); step();
    for (let i = 1; i <= 6; i++) { send("move", from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6, buttons); step(); }
    send("up", to[0], to[1], 0); step(2);
  };
  const recognizers = (): number => { let n = 0; world.query(recognizerQ).each((b) => { for (const _ of b) n += 1; }); return n; };
  const mouse = (): Entity => { const p = world.firstOf(mouseQ); if (p === undefined) throw new Error("no pointer yet"); return p; };
  const selected = (): boolean => world.hasTag(card, Selected);
  const cam = () => { const c = world.getResource(Camera); return { x: c?.x ?? 0, y: c?.y ?? 0, zoom: c?.zoom ?? 1 }; };
  return { world, engine, stack, sink, card, step, send, click, drag, recognizers, mouse, selected, cam };
}

describe("a secondary press is a point (petition I28)", () => {
  it("pressed and released over an object — held past the long press — selects nothing and spawns nothing; its point and pick are the pointer's", () => {
    const r = stackRig();
    r.send("move", 150, 150, 0); r.step();
    r.send("down", 150, 150, RIGHT); r.step();
    // the press is a POINT: the pointer is there, its exact pick and part read the object under it — and no recognizer exists
    expect(r.world.read(r.mouse(), PointerScreen)).toEqual({ x: 150, y: 150 });
    expect(r.world.getRelation(r.mouse(), TouchesExact)).toBe(r.card);
    expect(r.world.get(r.mouse(), PointerPart)?.part).toBe("");
    expect(r.stack.pickAt(150, 150)).toEqual({ entity: r.card, part: "" });
    expect(r.recognizers()).toBe(0);
    r.step(Math.ceil(GESTURE_DEFAULTS.longPressMs / 16) + 2);   // held past the long press
    expect(r.recognizers()).toBe(0);
    r.send("up", 150, 150, 0); r.step(2);
    expect(r.selected()).toBe(false);
    expect(r.sink.intents).toHaveLength(0);
    expect(r.world.getRelation(r.mouse(), ClaimedBy)).toBeUndefined();
  });

  it("on a PART it works nothing: no `PartTap` — a primary click there does (the control)", () => {
    const r = stackRig();
    r.send("move", 299, 101, 0); r.step();
    r.send("down", 299, 101, RIGHT); r.step();
    expect(r.world.get(r.mouse(), PointerPart)?.part).toBe("close");   // the part under the point, read as ever
    r.send("up", 299, 101, 0); r.step(2);
    expect(r.world.getResource(PartTap)).toBeUndefined();
    expect(r.selected()).toBe(false);
    r.click(299, 101, 1);
    expect(r.world.getResource(PartTap)).toMatchObject({ seq: 1, target: r.card, part: "close" });
  });

  it("pressed, moved and released over an object moves nothing and commits nothing; the pointer and its pick follow; a primary click and drag afterward work as before", () => {
    const r = stackRig();
    r.send("move", 150, 150, 0); r.step();
    r.send("down", 150, 150, RIGHT); r.step();
    for (let i = 1; i <= 6; i++) { r.send("move", 150 + 50 * i, 150 + 25 * i, RIGHT); r.step(); }
    // off the card now: the pointer is at the move's point, and its exact pick with it (the bare canvas)
    expect(r.world.read(r.mouse(), PointerScreen)).toEqual({ x: 450, y: 300 });
    expect(r.world.getRelation(r.mouse(), TouchesExact)).toBe(r.stack.canvasSurface);
    expect(r.stack.pickAt(450, 300)).toBeUndefined();
    expect(r.recognizers()).toBe(0);
    r.send("up", 450, 300, 0); r.step(2);
    expect(r.world.read(r.card, Position)).toEqual({ x: 100, y: 100 });
    expect(r.world.has(r.card, Grab)).toBe(false);
    expect(r.selected()).toBe(false);
    expect(r.sink.intents).toHaveLength(0);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    // the primary button, afterward: the click selects, the drag moves — by its travel from the dead zone's exit, the first move
    // (166.7, 160) — and commits ONE transaction
    r.click(150, 150, 1);
    expect(r.selected()).toBe(true);
    r.drag([150, 150], [250, 210], 1);
    const moved = r.world.read(r.card, Position);
    expect(moved.x).toBeCloseTo(100 + (250 - (150 + 100 / 6)), 3);
    expect(moved.y).toBeCloseTo(100 + (210 - 160), 3);
    expect(r.sink.intents).toHaveLength(1);
  });

  it("on the bare canvas it clears no selection and pans nothing", () => {
    const r = stackRig();
    r.click(150, 150, 1);
    expect(r.selected()).toBe(true);
    r.click(500, 400, RIGHT);
    expect(r.selected()).toBe(true);   // before I28 the canvas tap cleared it
    r.drag([500, 400], [560, 430], RIGHT);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(r.selected()).toBe(true);
    expect(r.sink.intents).toHaveLength(0);
    r.click(500, 400, 1);   // the control: a primary click on the canvas clears it
    expect(r.selected()).toBe(false);
  });
});

describe("a middle press is a point — but for the pan where it pans (petition I28; design-003 §4.4)", () => {
  it("over an object it selects nothing, moves nothing, commits nothing and spawns nothing — a primary click afterward selects", () => {
    const r = stackRig();
    r.send("move", 150, 150, 0); r.step();
    r.send("down", 150, 150, MIDDLE); r.step();
    expect(r.world.getRelation(r.mouse(), TouchesExact)).toBe(r.card);
    expect(r.recognizers()).toBe(0);   // no tap, no hold — and no drag: over an object a middle drag does not pan
    r.send("up", 150, 150, 0); r.step(2);
    expect(r.selected()).toBe(false);
    r.drag([150, 150], [250, 210], MIDDLE);
    expect(r.world.read(r.card, Position)).toEqual({ x: 100, y: 100 });
    expect(r.world.has(r.card, Grab)).toBe(false);
    expect(r.selected()).toBe(false);
    expect(r.sink.intents).toHaveLength(0);
    expect(r.cam()).toEqual({ x: 0, y: 0, zoom: 1 });
    r.click(150, 150, 1);
    expect(r.selected()).toBe(true);
  });

  it("on the bare canvas it still pans — its one recognizer the drag — and neither its click nor its drag clears the selection", () => {
    const r = stackRig();
    r.click(150, 150, 1);
    expect(r.selected()).toBe(true);
    r.send("move", 500, 400, 0); r.step();
    r.send("down", 500, 400, MIDDLE); r.step();
    expect(r.recognizers()).toBe(1);
    r.send("up", 500, 400, 0); r.step(2);
    expect(r.selected()).toBe(true);   // before I28 its tap on the canvas cleared it
    r.drag([500, 400], [560, 430], MIDDLE);
    // the drag pan: grab-the-canvas, from the dead zone's exit (10 px of the 60) — the camera travels against the pointer
    expect(r.cam().x).toBeLessThan(-30);
    expect(r.cam().y).toBeLessThan(-15);
    expect(r.selected()).toBe(true);
    expect(r.sink.intents).toHaveLength(0);
  });
});

describe("the primary press, as before", () => {
  it("a touch, a pen's tip, a pen's eraser end and a synthetic down that names no button each select", () => {
    const r = stackRig();
    const presses: readonly [string, InputEvent["device"], number][] = [["touch:1", "touch", 1], ["pen", "pen", 1], ["pen", "pen", 32], ["mouse", "mouse", 0]];
    for (const [id, device, buttons] of presses) {
      // no hover first: a touch has none (a touch pointer idle-up for a frame is destroyed — pointerLifecycle)
      r.send("down", 150, 150, buttons, id, device); r.step();
      r.send("up", 150, 150, 0, id, device); r.step(2);
      expect(r.selected(), `${id} buttons ${buttons}`).toBe(true);
      r.click(500, 400, 1);   // the canvas clears it for the next
      expect(r.selected()).toBe(false);
      r.step(30);   // past the multi-tap window
    }
  });
});

// One widget type per FILE (global registry; no test reset).
const FOLDER =
  widgets.get("i28:folder") ??
  defineWidget({ type: "i28:folder", defaultSize: { w: 200, h: 200 }, container: { accepts: ["widget"] } });
const BOOK =
  widgets.get("i28:book") ??
  defineWidget({ type: "i28:book", object: { name: "book" }, openable: true, defaultSize: { w: 200, h: 140 } });

/** The facade: its enter (a container's double-tap, D2b) and its open (an openable's double-tap, D4b) are applied after the tick. */
function deskRig() {
  const ce = createCanvasEngine({ widgets: [FOLDER, BOOK] });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const folder = ce.ops.spawnWidget("i28:folder", { x: 300, y: 200, undoable: false });   // centre (400, 300)
  const book = ce.ops.spawnWidget("i28:book", { x: 50, y: 50, undoable: false });         // centre (150, 120)
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);
  const send = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const tap = (x: number, y: number, buttons: number): void => { send("move", x, y, 0); step(); send("down", x, y, buttons); step(); send("up", x, y, 0); step(); };
  const drag = (from: readonly [number, number], to: readonly [number, number], buttons: number): void => {
    send("move", from[0], from[1], 0); step();
    send("down", from[0], from[1], buttons); step();
    for (let i = 1; i <= 6; i++) { send("move", from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6, buttons); step(); }
    send("up", to[0], to[1], 0); step(2);
  };
  const epochs = () => ({ nav: ce.world.getResource(NavIntent)?.epoch ?? 0, held: ce.world.getResource(HeldIntent)?.epoch ?? 0 });
  return { ce, world: ce.world, step, send, tap, drag, epochs, folder, book };
}

describe("a secondary or middle double-click enters nothing and opens nothing (petition I28)", () => {
  it.each([["secondary", RIGHT], ["middle", MIDDLE]])("the %s button: no enter, no pick-up, no selection — the primary double-click does both (the control)", (_name, buttons) => {
    const r = deskRig();
    const before = r.epochs();
    r.tap(400, 300, buttons);
    r.tap(400, 300, buttons);
    r.tap(150, 120, buttons);
    r.tap(150, 120, buttons);
    expect(r.epochs()).toEqual(before);
    expect(r.ce.nav.depth()).toBe(0);
    expect(r.world.hasTag(r.book, Held)).toBe(false);
    expect(r.world.hasTag(r.folder, Selected)).toBe(false);
    expect(r.world.hasTag(r.book, Selected)).toBe(false);
    r.step(30);   // past the multi-tap window
    r.tap(150, 120, 1);
    r.tap(150, 120, 1);
    expect(r.world.hasTag(r.book, Held)).toBe(true);
    r.ce.ops.putDown();
    r.step(30);
    r.tap(400, 300, 1);
    r.tap(400, 300, 1);
    expect(r.ce.nav.depth()).toBe(1);
  });
});

/** The book in the hand at its reading pose, as the renderer would publish it (held.test.ts's): centred, 300 × 200 on screen at 1.5 px a unit, following the held zoom and pan. */
function handRig() {
  const r = deskRig();
  const FRAME = { cx: 400, cy: 300, hx: 150, hy: 100, s: 1.5 };
  r.ce.stack.heldPose.current = {
    frame: (e) => {
      if (e !== r.book) return undefined;
      const v = r.world.get(r.book, HeldView) ?? { zoom: 1, panX: 0, panY: 0 };
      return { cx: FRAME.cx + v.panX, cy: FRAME.cy + v.panY, hx: FRAME.hx * v.zoom, hy: FRAME.hy * v.zoom, s: FRAME.s * v.zoom, settled: true };
    },
  };
  r.ce.ops.open(r.book);
  r.step();
  const held = (): boolean => r.world.hasTag(r.book, Held);
  const view = () => r.world.get(r.book, HeldView);
  const pressKept = (): boolean => { const p = r.world.firstOf(mouseQ); return p !== undefined && r.world.has(p, HeldPress); };
  /** ⌘-wheel at the frame's centre: brought close about it, no pan. */
  const closer = (): void => {
    r.ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: 400, screenY: 300, buttons: 0, mods: { ...NO_MODS, meta: true }, wheel: { dx: 0, dy: -50, pinch: 0 } });
    r.step();
  };
  return { ...r, held, view, pressKept, closer };
}

describe("the hand takes the primary press too (petition I28; design-015 §8)", () => {
  it("a secondary click on the soft desk puts nothing down, nor a secondary double-click on the object, nor a middle click at the reading size — no press is kept; a primary click on the soft desk does (the control)", () => {
    const r = handRig();
    expect(r.held()).toBe(true);
    for (const [x, y] of [[700, 550], [400, 300]] as const) {
      r.send("move", x, y, 0); r.step();
      r.send("down", x, y, RIGHT); r.step();
      expect(r.pressKept()).toBe(false);
      r.send("up", x, y, 0); r.step(2);
    }
    r.tap(400, 300, RIGHT);
    expect(r.held()).toBe(true);
    r.tap(700, 550, MIDDLE);   // at the reading size a middle press has nothing to pan
    expect(r.held()).toBe(true);
    expect(r.world.getResource(HeldIntent)).toBeUndefined();
    r.tap(700, 550, 1);
    expect(r.held()).toBe(false);
    expect(r.world.getResource(HeldIntent)).toMatchObject({ kind: "putDown" });
  });

  it("brought close, a middle drag still moves the object under the eye; a secondary drag on the soft desk moves nothing", () => {
    const r = handRig();
    r.closer();
    const zoom = r.view()?.zoom ?? 1;
    expect(zoom).toBeCloseTo(Math.exp(50 * HOLD_INPUT.wheelRate), 9);
    expect(r.view()).toMatchObject({ panX: 0, panY: 0 });
    r.drag([700, 550], [640, 520], RIGHT);   // before I28 a drag on the soft desk, brought close, moved it
    expect(r.view()).toEqual({ zoom, panX: 0, panY: 0 });
    expect(r.held()).toBe(true);
    r.drag([700, 550], [640, 520], MIDDLE);
    expect(r.view()?.panX).toBeCloseTo(-60, 9);
    expect(r.view()?.panY).toBeCloseTo(-30, 9);
    expect(r.held()).toBe(true);
  });
});
