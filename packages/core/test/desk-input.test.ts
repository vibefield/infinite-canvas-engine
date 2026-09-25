/**
 * design-015 D2a-core, items 7–8: the desk's input conventions as settings.
 *
 * - The wheel MODE (`GestureSettings.wheel`): "pan" is today's camera, byte for
 *   byte; "zoom" is the prototype's law — a plain wheel's Δy zooms about the
 *   pointer by `zoom · exp(−Δy · wheelZoomRate)`, Δx moves nothing, a pinch
 *   zooms by the same law, CameraLimits clamps. `WheelZoomStep` records each
 *   frame's wheel zoom, one-tick and change-only, for the systems after
 *   cameraControl (D2b's zoom-through).
 * - The shift route (`ToolRoute.canvasDragShift`): a tool can pan the bare mat
 *   and draw the marquee on shift; space / middle / touch still pan above it,
 *   and every tool that declares none routes shift exactly as before.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { screenToWorld, zoomAtPoint } from "@ice/kernel";
import {
  ActiveTool,
  Camera,
  CameraLimits,
  Drag,
  FrameInfo,
  GESTURE_DEFAULTS,
  GestureSettings,
  RoutedMarquee,
  RoutedPan,
  WheelZoomStep,
  createCanvasEngine,
  createDrawTool,
  defineQuery,
  defineTool,
  tools,
  writeRuntimeResource,
} from "../src";
import { createCameraSystems } from "../src/systems/camera-sim";
import { createTraceRig } from "./trace/rig";

function cameraRig(opts: { wheel?: "pan" | "zoom"; zoom?: number } = {}) {
  const rig = createTraceRig();
  rig.world.setResource(Camera, { x: 0, y: 0, zoom: opts.zoom ?? 1, gesturing: false });
  if (opts.wheel !== undefined) rig.world.setResource(GestureSettings, { ...GESTURE_DEFAULTS, wheel: opts.wheel });
  const cam = createCameraSystems(rig.world);
  rig.engine.addSystems("ctl:behave", cam.cameraControl);
  rig.engine.addSystems("simulate", cam.cameraInertia, cam.tweenSystem);
  return rig;
}

function camera(world: World) {
  const cam = world.getResource(Camera);
  if (cam === undefined) throw new Error("Camera unset");
  return cam;
}

/** The desk's law, computed the way the system computes it (the f32 wheel delta is exact here). */
const deskFactor = (delta: number): number => Math.exp(-delta * GESTURE_DEFAULTS.wheelZoomRate);

describe("the wheel mode — 'pan' is today, byte for byte (design-015 §9)", () => {
  it("defaults to pan at the prototype's rate; a plain wheel scrolls and never zooms; no step is recorded", () => {
    expect(GESTURE_DEFAULTS.wheel).toBe("pan");
    expect(GESTURE_DEFAULTS.wheelZoomRate).toBe(0.0016);
    expect(GestureSettings.fieldByName.get("wheel")?.spec.default).toBe("pan");
    const rig = cameraRig({ zoom: 2 });
    rig.wheel(400, 300, 30, 40);
    rig.step();
    expect(camera(rig.world)).toEqual({ x: 30 / 2, y: 40 / 2, zoom: 2, gesturing: true });
    expect(rig.world.getResource(WheelZoomStep)).toBeUndefined();
  });

  it("a pinch keeps the v2 curve (×2^0.1 for a notch) — and IS recorded as a wheel zoom step", () => {
    const rig = cameraRig();
    rig.wheel(400, 300, 0, 0, -100);
    rig.step();
    expect(camera(rig.world).zoom).toBe(2 ** 0.1);
    expect(rig.world.getResource(WheelZoomStep)).toMatchObject({ ratio: 2 ** 0.1, anchorX: 400, anchorY: 300 });
  });
});

describe("the wheel mode — 'zoom' is the desk's law (design-015 §9, D-D11)", () => {
  it("a plain wheel's Δy zooms about the pointer by exp(−Δy·0.0016); the anchor's world point holds", () => {
    const rig = cameraRig({ wheel: "zoom" });
    const before = camera(rig.world);
    const anchorWorld = screenToWorld(400, 300, before);
    rig.wheel(400, 300, 0, -100);
    rig.step();
    const after = camera(rig.world);
    expect(after.zoom).toBe(deskFactor(-100));
    const expected = zoomAtPoint(before, 400, 300, deskFactor(-100));
    expect(after.x).toBe(expected.x);
    expect(after.y).toBe(expected.y);
    const held = screenToWorld(400, 300, after);
    expect(held.x).toBeCloseTo(anchorWorld.x, 9);
    expect(held.y).toBeCloseTo(anchorWorld.y, 9);
    // out again: +Δy zooms out by the same law
    rig.wheel(400, 300, 0, 100);
    rig.step();
    expect(camera(rig.world).zoom).toBeCloseTo(1, 12);
  });

  it("Δx is not the camera's: a sideways wheel moves nothing, and a diagonal one only zooms", () => {
    const rig = cameraRig({ wheel: "zoom" });
    rig.wheel(400, 300, 80, 0);
    rig.step();
    const c = camera(rig.world);
    expect({ x: c.x, y: c.y, zoom: c.zoom }).toEqual({ x: 0, y: 0, zoom: 1 });
    rig.wheel(400, 300, 80, 50);
    rig.step();
    const after = camera(rig.world);
    const expected = zoomAtPoint({ x: 0, y: 0, zoom: 1 }, 400, 300, deskFactor(50));
    expect({ x: after.x, y: after.y, zoom: after.zoom }).toEqual(expected);
  });

  it("a pinch zooms by the same law, not the v2 curve", () => {
    const rig = cameraRig({ wheel: "zoom" });
    rig.wheel(400, 300, 0, 0, -2);
    rig.step();
    expect(camera(rig.world).zoom).toBe(deskFactor(-2));
    expect(camera(rig.world).zoom).not.toBe(2 ** 0.02);
  });

  it("CameraLimits clamps it as ever — and a clamped wheel is no step", () => {
    const rig = cameraRig({ wheel: "zoom" });
    rig.world.setResource(CameraLimits, { minZoom: 0.5, maxZoom: 2 });
    for (let i = 0; i < 8; i++) {
      rig.wheel(400, 300, 0, -200);
      rig.step();
    }
    expect(camera(rig.world).zoom).toBe(2);
    expect(rig.world.getResource(WheelZoomStep)?.ratio).toBe(1); // pinned at the limit: no zoom this frame
  });
});

describe("WheelZoomStep — this frame's wheel zoom, one-tick and change-only (design-015 §9)", () => {
  it("records ratio, anchor and tick on the zoom frame, resets once after, and writes nothing while idle", () => {
    const rig = cameraRig({ wheel: "zoom" });
    rig.world.resourceStamp(WheelZoomStep); // arm the per-write stamps
    rig.wheel(420, 310, 0, -100);
    rig.step();
    const tick = rig.world.getResource(FrameInfo)?.tick;
    expect(rig.world.getResource(WheelZoomStep)).toEqual({ ratio: deskFactor(-100), anchorX: 420, anchorY: 310, tick });
    const s1 = rig.world.resourceStamp(WheelZoomStep);
    rig.step(); // no wheel this frame: the one reset
    expect(rig.world.getResource(WheelZoomStep)?.ratio).toBe(1);
    const s2 = rig.world.resourceStamp(WheelZoomStep);
    expect(s2).not.toBe(s1); // the reset was a write (the stamp is a shared counter: equality is the witness)
    rig.step(5); // idle: nothing written, the reset was the only one
    expect(rig.world.resourceStamp(WheelZoomStep)).toBe(s2);
    // zooming OUT reads < 1
    rig.wheel(420, 310, 0, 100);
    rig.step();
    expect(rig.world.getResource(WheelZoomStep)?.ratio).toBeLessThan(1);
  });
});

describe("the facade wires the wheel through settings.gestures (design-015 §9)", () => {
  it("createCanvasEngine({ settings: { gestures: { wheel, wheelZoomRate } } }) seeds GestureSettings, and a wheel zooms", () => {
    const ce = createCanvasEngine({ settings: { gestures: { wheel: "zoom", wheelZoomRate: 0.002 } } });
    expect(ce.world.getResource(GestureSettings)).toMatchObject({ wheel: "zoom", wheelZoomRate: 0.002 });
    ce.stack.queue.enqueue({
      kind: "wheel",
      pointerId: "mouse",
      device: "mouse",
      screenX: 100,
      screenY: 100,
      buttons: 0,
      mods: { shift: false, ctrl: false, alt: false, meta: false, space: false },
      wheel: { dx: 0, dy: -50, pinch: 0 },
    });
    ce.step(16);
    expect(ce.world.getResource(Camera)?.zoom).toBe(Math.exp(50 * 0.002));
    // the default engine pans
    const plain = createCanvasEngine();
    expect(plain.world.getResource(GestureSettings)?.wheel).toBe("pan");
    ce.dispose();
    plain.dispose();
  });
});

describe("ToolRoute.canvasDragShift — pan the mat, marquee on shift (design-015 §9, D-D11)", () => {
  const DESK = tools.get("d2a:desk-select") ?? defineTool({ id: "d2a:desk-select", route: { canvasDrag: "pan", canvasDragShift: "marquee" } });
  const dragQ = defineQuery([Drag]);

  it("compiles to the tool's own canvas route when omitted — every built-in routes shift as before", () => {
    expect(DESK.route).toMatchObject({ canvasDrag: "pan", canvasDragShift: "marquee" });
    expect(tools.get("select")?.route.canvasDragShift).toBe("marquee");
    expect(tools.get("pan")?.route.canvasDragShift).toBe("pan");
    expect(tools.get("connect")?.route.canvasDragShift).toBe("pan");
    const draw = tools.get("draw:d2a-shape") ?? createDrawTool("d2a-shape");
    expect(draw.route.canvasDragShift).toBe("draw");
    expect(tools.resolve("d2a:unknown").route.canvasDragShift).toBe("marquee");
  });

  /** Drag on the bare canvas and report the route the recognizer latched. */
  function routeOf(toolId: string, how: { shift?: boolean; space?: boolean; button?: number; pointerId?: string } = {}): string {
    const rig = cameraRig();
    writeRuntimeResource(rig.world, ActiveTool, { id: toolId });
    const id = how.pointerId ?? "mouse";
    const mods = { shift: how.shift === true };
    if (how.space === true) {
      rig.key({ space: true });
      rig.step();
    }
    rig.down(id, 300, 300, { button: how.button ?? 1, mods });
    rig.step();
    rig.move(id, 340, 300, { mods });
    rig.step();
    let route = "none";
    rig.world.query(dragQ).each((b) => {
      for (const r of b) {
        const e: Entity = b.entity(r);
        if (rig.world.hasTag(e, RoutedPan)) route = "pan";
        else if (rig.world.hasTag(e, RoutedMarquee)) route = "marquee";
      }
    });
    return route;
  }

  it("the desk tool: a plain drag pans the mat, a shift drag draws the marquee", () => {
    expect(routeOf(DESK.id)).toBe("pan");
    expect(routeOf(DESK.id, { shift: true })).toBe("marquee");
  });

  it("space / middle / touch still pan above the tool — with or without shift", () => {
    expect(routeOf(DESK.id, { shift: true, space: true })).toBe("pan");
    expect(routeOf(DESK.id, { shift: true, button: 4 })).toBe("pan");
    expect(routeOf(DESK.id, { shift: true, pointerId: "touch:1" })).toBe("pan");
  });

  it("default routes are unchanged: select marquees with or without shift; pan pans with or without shift", () => {
    expect(routeOf("select")).toBe("marquee");
    expect(routeOf("select", { shift: true })).toBe("marquee");
    expect(routeOf("pan")).toBe("pan");
    expect(routeOf("pan", { shift: true })).toBe("pan");
  });
});
