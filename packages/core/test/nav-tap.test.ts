// @vitest-environment node
// The ENTER GESTURE (design-015 §9; D2b): a double-tap on a container flies into it, a
// double-tap on the bare frame flies back out — through the REAL stack (picking, the tap
// recognizer, the select behaviour, `navTap`) and the facade's post-tick applier. The first tap
// selects at once (the prototype's click: no multi-tap window is waited); the second, on the same
// target within `multiTapWindowMs` and `multiTapSlopPx`, is the gesture. A second tap past the
// window, or too far, is a fresh first tap.
import { describe, expect, it } from "vitest";
import {
  Camera,
  GESTURE_DEFAULTS,
  NO_MODS,
  NavIntent,
  NavTransition,
  Selected,
  Viewport,
  createCanvasEngine,
  defineWidget,
  widgets,
} from "../src";

// One widget type per FILE (global registry; no test reset).
const FOLDER =
  widgets.get("navtap:folder") ??
  defineWidget({ type: "navtap:folder", defaultSize: { w: 200, h: 200 }, container: { accepts: ["widget"] } });
const BOX =
  widgets.get("navtap:box") ??
  defineWidget({ type: "navtap:box", defaultSize: { w: 100, h: 100 }, provides: ["widget"] });

const VP = { w: 800, h: 600, dpr: 1 };

function rig() {
  const ce = createCanvasEngine({ widgets: [FOLDER, BOX] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  const folder = ce.ops.spawnWidget("navtap:folder", { x: 300, y: 200, w: 200, h: 200, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(2);
  const inner = ce.ops.spawnWidget("navtap:box", { x: 10, y: 10, w: 50, h: 50, parent: folder, undoable: false });
  ce.world.sync();
  step(5);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  /** One instant tap: down on one tick, up on the next. */
  const tap = (x: number, y: number): void => { mouse("move", x, y, 0); step(); mouse("down", x, y, 1); step(); mouse("up", x, y, 0); step(); };
  const depth = () => ce.nav.depth();
  const flight = () => ce.world.getResource(NavTransition);
  return { ce, world: ce.world, step, tap, depth, flight, folder, inner };
}

describe("the double-tap (design-015 §9, D-D2b.1)", () => {
  it("the first tap SELECTS at once; the second, in the window, flies into the container", () => {
    const r = rig();
    r.tap(400, 300);
    // instant: selected on the tap's own release tick, no window waited
    expect(r.world.hasTag(r.folder, Selected)).toBe(true);
    expect(r.depth()).toBe(0);
    r.tap(400, 300);
    expect(r.depth()).toBe(1);
    const t = r.flight();
    expect(t?.active).toBe(true);
    expect(t?.kind).toBe("enter");
    // the request rode the one-tick fact and was applied after the tick
    expect(r.world.getResource(NavIntent)).toMatchObject({ kind: "enter", target: r.folder, source: "tap", transition: "zoom", epoch: 1 });
    // the selection was cleared by the switch
    expect(r.world.hasTag(r.folder, Selected)).toBe(false);
  });

  it("a double-tap on the bare frame flies back out; at the root it asks nothing", () => {
    const r = rig();
    r.tap(400, 300);
    r.tap(400, 300);
    expect(r.depth()).toBe(1);
    // land the flight, then double-tap the bare frame (the inner box lies at the origin; (700, 500) is bare)
    let n = 0;
    while (r.flight()?.active && n < 600) { r.step(); n += 1; }
    r.tap(700, 500);
    expect(r.depth()).toBe(1);
    r.tap(700, 500);
    expect(r.depth()).toBe(0);
    expect(r.flight()?.kind).toBe("exit");
    // at the root a bare double-tap is two deselects and nothing more
    n = 0;
    while (r.flight()?.active && n < 600) { r.step(); n += 1; }
    const epoch = r.world.getResource(NavIntent)?.epoch;
    r.tap(700, 500);
    r.tap(700, 500);
    expect(r.depth()).toBe(0);
    expect(r.world.getResource(NavIntent)?.epoch).toBe(epoch);
  });

  it("a second tap past the window, or past the slop, is a fresh first tap", () => {
    const r = rig();
    const wait = (): void => r.step(Math.ceil(GESTURE_DEFAULTS.multiTapWindowMs / 16) + 2);
    r.tap(400, 300);
    wait();
    r.tap(400, 300);   // past the window: a fresh first tap, not the gesture
    expect(r.depth()).toBe(0);
    wait();
    // within the window but 50 px away (slop 20): a fresh first tap too
    r.tap(400, 300);
    r.tap(450, 300);
    expect(r.depth()).toBe(0);
    // and the memo is that last tap: a tap back at (450, 300) pairs with it
    r.tap(450, 300);
    expect(r.depth()).toBe(1);
  });
});
