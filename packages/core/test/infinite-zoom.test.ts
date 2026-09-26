/**
 * design-015 D2a-core, item 9: CameraLimits [1e-8, 1e8] work end to end.
 *
 * The desk's zoom is infinite (design-015 §9: `ZOOM_MIN 1e-8`, `ZOOM_MAX 1e8`,
 * the prototype's). Through the facade — `settings.zoom`, the desk's wheel,
 * `ops.zoomTo`, `ops.zoomToFit`, a nav flight in and back out — the camera
 * stays finite and INVERTIBLE: the world point under the wheel's anchor holds,
 * screen ∘ world round-trips, and every out-and-back returns where it began.
 * (The kernel's flight path has its own extreme-range pins in
 * kernel/test/nav-flight.test.ts.)
 */
import type { Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { screenToWorld, worldToScreen, type CameraState } from "@ice/kernel";
import {
  Camera,
  CameraLimits,
  NavTransition,
  Viewport,
  createCanvasEngine,
  defineCanvasType,
  defineContainer,
  defineWidget,
  tools,
  widgets,
  type CanvasType,
  type Tool,
} from "../src";

const DESK_LIMITS = { min: 1e-8, max: 1e8 } as const;
const ANCHOR = { x: 640, y: 360 };

function tool(id: string): Tool {
  const t = tools.get(id);
  if (t === undefined) throw new Error(`missing built-in tool ${id}`);
  return t;
}

const CARD =
  widgets.get("iz:card") ?? defineWidget({ type: "iz:card", surface: "dom", component: null, defaultSize: { w: 100, h: 60 } });
const inside = defineCanvasType({ id: "iz:inside", semanticVersion: 1, semantic: { placement: { widgets: [CARD] } } });
const FOLDER = defineContainer({ type: "iz:folder", canvas: inside, component: null, defaultSize: { w: 300, h: 200 }, provides: ["widget"] });
const ROOT: CanvasType = defineCanvasType({ id: "iz:root", semanticVersion: 1, semantic: { placement: { widgets: [CARD, FOLDER] } } });

function rig() {
  const ce = createCanvasEngine({
    widgets: [CARD, FOLDER],
    canvasTypes: [ROOT, inside],
    rootCanvas: ROOT,
    presentationFallback: ROOT,
    tools: [tool("select"), tool("pan")],
    settings: { zoom: DESK_LIMITS, gestures: { wheel: "zoom" } },
  });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1280, h: 720, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  let now = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
  const cam = (): CameraState & { gesturing: boolean } => {
    const c = ce.world.getResource(Camera);
    if (c === undefined) throw new Error("Camera unset");
    return c;
  };
  const wheel = (dy: number): void => {
    ce.stack.queue.enqueue({
      kind: "wheel",
      pointerId: "mouse",
      device: "mouse",
      screenX: ANCHOR.x,
      screenY: ANCHOR.y,
      buttons: 0,
      mods: { shift: false, ctrl: false, alt: false, meta: false, space: false },
      wheel: { dx: 0, dy, pinch: 0 },
    });
    step();
  };
  return { ce, step, cam, wheel };
}

function expectFinite(c: CameraState): void {
  expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.zoom) && c.zoom > 0).toBe(true);
}

/** screen → world → screen is the identity, to a thousandth of a pixel. */
function expectInvertible(c: CameraState): void {
  for (const p of [ANCHOR, { x: 0, y: 0 }, { x: 1280, y: 720 }]) {
    const w = screenToWorld(p.x, p.y, c);
    const s = worldToScreen(w.x, w.y, c);
    expect(Math.abs(s.x - p.x)).toBeLessThan(1e-3);
    expect(Math.abs(s.y - p.y)).toBeLessThan(1e-3);
  }
}

describe("CameraLimits [1e-8, 1e8] end to end (design-015 §9)", () => {
  it("settings.zoom seeds the desk's limits; the default engine keeps [0.1, 5]", () => {
    const { ce } = rig();
    expect(ce.world.getResource(CameraLimits)).toEqual({ minZoom: 1e-8, maxZoom: 1e8 });
    const plain = createCanvasEngine();
    expect(plain.world.getResource(CameraLimits)).toEqual({ minZoom: 0.1, maxZoom: 5 });
    ce.dispose();
    plain.dispose();
  });

  it("the desk's wheel zooms to 1e7 and to 1e-7 and back: finite, invertible, the anchor's world point held, home again", () => {
    const { ce, cam, wheel } = rig();
    const home = cam();
    const anchorWorld = screenToWorld(ANCHOR.x, ANCHOR.y, home);
    // 101 notches of Δy = ∓100 → exp(±16.16) ≈ 1.04e7 / 9.6e-8
    for (const [dy, target] of [
      [-100, 1e7],
      [100, 1e-7],
    ] as const) {
      for (let i = 0; i < 101; i++) wheel(dy);
      const far = cam();
      expectFinite(far);
      expect(far.zoom / target).toBeGreaterThan(0.9);
      expect(far.zoom / target).toBeLessThan(1.1);
      expectInvertible(far);
      const held = screenToWorld(ANCHOR.x, ANCHOR.y, far);
      expect(Math.abs(held.x - anchorWorld.x) * far.zoom).toBeLessThan(1e-3); // in screen px
      expect(Math.abs(held.y - anchorWorld.y) * far.zoom).toBeLessThan(1e-3);
      for (let i = 0; i < 101; i++) wheel(-dy);
      const back = cam();
      expectFinite(back);
      expect(back.zoom).toBeCloseTo(1, 9);
      expect(back.x).toBeCloseTo(home.x, 6);
      expect(back.y).toBeCloseTo(home.y, 6);
    }
    ce.dispose();
  });

  it("ops.zoomTo reaches 1e-7 and 1e7 exactly, clamps past the limits, and returns home", () => {
    const { ce, cam } = rig();
    for (const z of [1e-7, 1e7]) {
      ce.ops.zoomTo(z, ANCHOR);
      expect(cam().zoom).toBe(z);
      expectFinite(cam());
      expectInvertible(cam());
      ce.ops.zoomTo(1, ANCHOR);
      expect(cam().zoom).toBe(1);
      expect(cam().x).toBeCloseTo(0, 6);
      expect(cam().y).toBeCloseTo(0, 6);
    }
    ce.ops.zoomTo(1e12, ANCHOR);
    expect(cam().zoom).toBe(1e8);
    ce.ops.zoomTo(1e-12, ANCHOR);
    expect(cam().zoom).toBe(1e-8);
    expectFinite(cam());
    ce.dispose();
  });

  it("ops.zoomToFit frames a 1e10-wide spread and a 1e-5-wide speck inside the limits, finite", () => {
    const { ce, cam, step } = rig();
    const far = ce.ops.spawnWidget(CARD.type, { x: 5e9, y: 0, undoable: false });
    const near = ce.ops.spawnWidget(CARD.type, { x: -5e9, y: 0, undoable: false });
    ce.world.sync();
    step(3);
    ce.ops.zoomToFit([far, near]);
    expectFinite(cam());
    expect(cam().zoom).toBeGreaterThanOrEqual(1e-8);
    expect(cam().zoom).toBeLessThan(1e-6);
    const speck = ce.ops.spawnWidget(CARD.type, { x: 7, y: 7, w: 1e-5, h: 1e-5, undoable: false });
    ce.world.sync();
    step(2);
    ce.ops.zoomToFit([speck]);
    expectFinite(cam());
    expect(cam().zoom).toBeLessThanOrEqual(1e8);
    expectInvertible(cam());
    ce.dispose();
  });

  it("a nav flight in and back out at zoom 1e-6 stays finite every frame and lands where it left", () => {
    const { ce, cam, step } = rig();
    const folder: Entity = ce.ops.spawnWidget(FOLDER.type, { x: 0, y: 0, undoable: false });
    ce.world.sync();
    step(3);
    ce.ops.zoomTo(1e-6, { x: 0, y: 0 });
    step(2);
    const before = cam();
    const fly = (): number => {
      let frames = 0;
      while (ce.world.getResource(NavTransition)?.active === true && frames < 600) {
        step();
        expectFinite(cam());
        frames += 1;
      }
      return frames;
    };
    ce.ops.enterContainer(folder);
    expectFinite(cam());
    const inFrames = fly();
    expect(inFrames).toBeGreaterThan(0); // it flew
    expect(inFrames).toBeLessThan(600); // and settled
    ce.ops.exitContainer();
    const outFrames = fly();
    expect(outFrames).toBeGreaterThan(0);
    expect(outFrames).toBeLessThan(600);
    const after = cam();
    // the exit lands EXACTLY on the stored root camera — every column of NavCamera is f64
    // since D2b (design-015 §9: the zoom-through's exit must land on the camera the desk was
    // dressed for, and a flight's arrival lives in f64), so the return is the number itself.
    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expectInvertible(after);
    ce.dispose();
  });
});
