import { Camera, CameraZoomStep, createCanvasEngine, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { attachPointerAdapter } from "../src/pointer-adapter";

function rig(zoom = 1) {
  const ce = createCanvasEngine({ settings: { gestures: { wheel: "pan", wheelZoomCurve: "exponential" } } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  ce.world.setResource(Camera, { x: 10, y: 20, zoom, gesturing: false });
  const container = document.createElement("div");
  document.body.append(container);
  container.getBoundingClientRect = () => new DOMRect(50, 20, 800, 600);
  const detach = attachPointerAdapter(createCanvasHost(container), ce.stack.queue);
  let now = 0;
  const step = () => { now += 16; ce.step(now); };
  const wheel = (props: Partial<WheelEvent>, target: EventTarget = container) => {
    const event = new Event("wheel", { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 450, clientY: 320, buttons: 0, deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...props });
    target.dispatchEvent(event);
    step();
    return event;
  };
  const camera = () => {
    const value = ce.world.getResource(Camera);
    if (value === undefined) throw new Error("Camera unset");
    return value;
  };
  const dispose = () => { detach(); ce.dispose(); container.remove(); };
  return { ce, container, step, wheel, camera, dispose };
}

describe("desktop canvas navigation through real DOM input and the camera", () => {
  it("pans both axes at the current scale and has no extra inertia after scrolling stops", () => {
    const r = rig(2);
    try {
      expect(r.wheel({ deltaY: 80 }).defaultPrevented).toBe(true);
      r.wheel({ deltaX: 60 });
      r.wheel({ deltaX: 20, deltaY: -40 });
      expect(r.camera()).toMatchObject({ x: 50, y: 40, zoom: 2 });
      for (let n = 0; n < 30; n++) r.step();
      expect(r.camera()).toMatchObject({ x: 50, y: 40, zoom: 2, gesturing: false });
      expect(r.ce.world.getResource(CameraZoomStep)).toBeUndefined();
    } finally { r.dispose(); }
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { metaKey: true, altKey: true }])("zooms with %o while keeping the pointer's world point fixed", (mods) => {
    const r = rig();
    try {
      const before = r.camera();
      const world = { x: before.x + 400 / before.zoom, y: before.y + 300 / before.zoom };
      const event = r.wheel({ ...mods, deltaY: -80 });
      const after = r.camera();
      expect(event.defaultPrevented).toBe(true);
      expect(after.zoom).toBeGreaterThan(before.zoom);
      expect(after.x + 400 / after.zoom).toBeCloseTo(world.x, 9);
      expect(after.y + 300 / after.zoom).toBeCloseTo(world.y, 9);
      expect(r.ce.world.getResource(CameraZoomStep)).toMatchObject({ from: before.zoom, to: after.zoom });
      r.wheel({ ...mods, deltaY: 80 });
      expect(r.camera().zoom).toBeCloseTo(1, 12);
    } finally { r.dispose(); }
  });

  it("switches pan → pinch → pan without waiting for the previous gesture to end", () => {
    const r = rig();
    try {
      r.wheel({ deltaX: 20, deltaY: 40 });
      expect(r.camera()).toMatchObject({ x: 30, y: 60, zoom: 1 });
      r.wheel({ ctrlKey: true, deltaY: -80 });
      const zoomed = r.camera();
      expect(zoomed.zoom).toBeCloseTo(Math.exp(80 * 0.0016), 12);
      r.wheel({ deltaX: -30, deltaY: 50 });
      expect(r.camera().x).toBeCloseTo(zoomed.x - 30 / zoomed.zoom, 9);
      expect(r.camera().y).toBeCloseTo(zoomed.y + 50 / zoomed.zoom, 9);
      expect(r.camera().zoom).toBe(zoomed.zoom);
    } finally { r.dispose(); }
  });

  it("maps Shift-wheel once and preserves native horizontal and diagonal deltas", () => {
    const r = rig();
    try {
      r.wheel({ shiftKey: true, deltaY: 30 });
      r.wheel({ shiftKey: true, deltaX: 20 });
      r.wheel({ shiftKey: true, deltaX: 10, deltaY: 15 });
      expect(r.camera()).toMatchObject({ x: 70, y: 35, zoom: 1 });
    } finally { r.dispose(); }
  });

  it("normalizes line and page units for both pan and modifier zoom", () => {
    const r = rig();
    try {
      r.wheel({ deltaMode: 1, deltaX: 2, deltaY: 3 });
      r.wheel({ deltaMode: 2, deltaX: 1, deltaY: 1 });
      expect(r.camera()).toMatchObject({ x: 842, y: 668, zoom: 1 });
      r.wheel({ metaKey: true, deltaMode: 1, deltaY: -2 });
      expect(r.camera().zoom).toBeCloseTo(Math.exp(32 * 0.0016), 12);
    } finally { r.dispose(); }
  });

  it("cedes ordinary scrolling to content with room, while Command and pinch stay canvas zoom", () => {
    const r = rig();
    try {
      const scroller = document.createElement("div");
      scroller.setAttribute("data-canvas-interactive", "");
      scroller.style.overflowY = "auto";
      Object.defineProperties(scroller, { scrollHeight: { value: 300 }, clientHeight: { value: 100 } });
      r.container.append(scroller);
      expect(r.wheel({ deltaY: 30 }, scroller).defaultPrevented).toBe(false);
      expect(r.camera()).toMatchObject({ x: 10, y: 20, zoom: 1 });
      expect(r.wheel({ metaKey: true, deltaY: -40 }, scroller).defaultPrevented).toBe(true);
      expect(r.camera().zoom).toBeGreaterThan(1);
      expect(r.wheel({ ctrlKey: true, deltaY: 40 }, scroller).defaultPrevented).toBe(true);
      expect(r.camera().zoom).toBeCloseTo(1, 12);
    } finally { r.dispose(); }
  });
});
