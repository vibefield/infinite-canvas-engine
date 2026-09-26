// @vitest-environment node
// THE WHEEL OF A HOLDING PRESS (D3t-a — systems/press-wheel.ts) and THE LIFTED PICK (l1-pick's frame tier): while a press
// holds a `wheelTurns` widget the wheel on that pointer is the widget's — the camera never hears it — and its deltas add up
// in `PressWheel` (gone with the press); a plain widget's press, or no press, leaves the wheel to the camera. And what a
// frame source draws LIFTED (a print in the air) is asked first wherever it is drawn: a pointer over it hits it far from its
// fact rect, and its fact rect no longer does.
import { describe, expect, it } from "vitest";
import {
  Camera,
  LocalPointer,
  NO_MODS,
  Pointer,
  PressWheel,
  TouchesExact,
  Viewport,
  WheelTurns,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  widgets,
  type Entity,
} from "../src";

// one widget type per FILE (global registry; no test reset)
const PRINT = widgets.get("pw:print") ?? defineWidget({ type: "pw:print", object: { name: "print" }, defaultSize: { w: 200, h: 140 }, interaction: { movable: false, wheelTurns: true } });
const CARD = widgets.get("pw:card") ?? defineWidget({ type: "pw:card", object: { name: "card" }, defaultSize: { w: 200, h: 140 }, interaction: { movable: false } });
const pointerQ = defineQuery([Pointer, LocalPointer]);

function rig() {
  const ce = createCanvasEngine({ widgets: [PRINT, CARD], settings: { gestures: { wheel: "zoom" } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const print = ce.ops.spawnWidget("pw:print", { x: 100, y: 100, undoable: false });   // centre (200, 170)
  const card = ce.ops.spawnWidget("pw:card", { x: 400, y: 100, undoable: false });     // centre (500, 170)
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(3);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const wheel = (x: number, y: number, dy: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS, wheel: { dx: 0, dy, pinch: 0 } });
    step();
  };
  const zoom = () => ce.world.getResource(Camera)?.zoom ?? 1;
  const pointer = () => ce.world.firstOf(pointerQ) as Entity;
  return { ce, world: ce.world, step, mouse, wheel, zoom, pointer, print, card };
}

describe("the wheel of a holding press (systems/press-wheel.ts)", () => {
  it("a press holding a wheelTurns widget takes its pointer's wheel: summed in PressWheel, the camera never zooms; gone with the press", () => {
    const r = rig();
    expect(r.world.hasTag(r.print, WheelTurns)).toBe(true);
    r.mouse("move", 200, 170, 0); r.step();
    r.mouse("down", 200, 170, 1); r.step();
    r.wheel(200, 170, 40, 1);
    r.wheel(200, 170, -15, 1);
    expect(r.zoom()).toBe(1);
    expect(r.world.get(r.pointer(), PressWheel)).toEqual({ dx: 0, dy: 25 });
    r.mouse("up", 200, 170, 0); r.step(2);
    expect(r.world.has(r.pointer(), PressWheel)).toBe(false);
    r.wheel(200, 170, 40, 0);   // no press: the camera's again
    expect(r.zoom()).not.toBe(1);
  });

  it("a press on a widget that does not turn leaves the wheel to the camera (the control)", () => {
    const r = rig();
    r.mouse("move", 500, 170, 0); r.step();
    r.mouse("down", 500, 170, 1); r.step();
    r.wheel(500, 170, 40, 1);
    expect(r.zoom()).not.toBe(1);
    expect(r.world.has(r.pointer(), PressWheel)).toBe(false);
  });
});

describe("the lifted pick (l1-pick's frame tier)", () => {
  it("what the source draws lifted is asked first, wherever it is drawn; its fact rect answers outside and falls through", () => {
    const r = rig();
    // the print is DRAWN at (620, 420) — far from its facts at (100…300, 100…240) — the card where it lies
    let lifted: Entity[] = [r.print];
    r.ce.stack.framePick.current = {
      pad: () => 0,
      hit: (e, wx, wy) => (e === r.print ? (Math.hypot(wx - 620, wy - 420) < 60 ? "content" : "outside") : "content"),
      lifted: () => lifted,
    };
    r.mouse("move", 620, 420, 0); r.step();
    expect(r.world.getRelation(r.pointer(), TouchesExact)).toBe(r.print);
    r.mouse("move", 200, 170, 0); r.step();
    expect(r.world.getRelation(r.pointer(), TouchesExact)).not.toBe(r.print);   // its old rect: outside there
    lifted = [];
    r.mouse("move", 621, 420, 0); r.step();
    expect(r.world.getRelation(r.pointer(), TouchesExact)).not.toBe(r.print);   // the control: not listed, not asked there
  });
});
