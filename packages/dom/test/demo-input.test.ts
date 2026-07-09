/**
 * Demo pan/zoom adapter (M3 demo scaffold): synthesized pointer drags and wheel
 * events move the Camera resource correctly, with zoomAtPoint anchor invariance.
 */
import { Camera, createWorld, type World } from "@ice/core";
import { screenToWorld } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { attachDemoPanZoom } from "../src/demo-input";
import { createCanvasHost } from "../src/host";

const RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };

function setup(camera: { x: number; y: number; zoom: number }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = () => ({ ...RECT, toJSON: () => ({}) }) as DOMRect;
  const host = createCanvasHost(container);
  const world = createWorld();
  world.setResource(Camera, { ...camera, gesturing: false });
  const detach = attachDemoPanZoom(host, world);
  return { container, world, detach };
}

function readCamera(world: World) {
  const cam = world.getResource(Camera);
  if (cam === undefined) throw new Error("Camera resource unexpectedly unset");
  return cam;
}

function fire(target: EventTarget, type: string, props: Record<string, number>): void {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(ev, props);
  target.dispatchEvent(ev);
}

describe("attachDemoPanZoom", () => {
  it("pans the camera by the cursor delta in world units", () => {
    const { container, world, detach } = setup({ x: 0, y: 0, zoom: 2 });
    fire(container, "pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
    fire(container, "pointermove", { clientX: 110, clientY: 120, pointerId: 1 });

    const cam = readCamera(world);
    // dx=10, dy=20 at zoom 2 → world delta (5, 10); camera moves opposite the drag.
    expect(cam.x).toBeCloseTo(-5, 6);
    expect(cam.y).toBeCloseTo(-10, 6);
    detach();
  });

  it("ignores pointermove when no drag is in progress", () => {
    const { container, world, detach } = setup({ x: 0, y: 0, zoom: 1 });
    fire(container, "pointermove", { clientX: 50, clientY: 50, pointerId: 1 });
    const cam = readCamera(world);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    detach();
  });

  it("wheel-zooms about the cursor: the world point under it stays fixed", () => {
    const { container, world, detach } = setup({ x: 0, y: 0, zoom: 1 });
    const cx = 400;
    const cy = 300;
    const before = screenToWorld(cx, cy, readCamera(world));

    fire(container, "wheel", { clientX: cx, clientY: cy, deltaY: -100 }); // negative → zoom in

    const cam = readCamera(world);
    expect(cam.zoom).toBeGreaterThan(1);
    const after = screenToWorld(cx, cy, cam);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    detach();
  });

  it("clamps zoom to the CAMERA_DEFAULTS range", () => {
    const { container, world, detach } = setup({ x: 0, y: 0, zoom: 5 });
    // A large zoom-in past the max must clamp at 5 (CAMERA_DEFAULTS.maxZoom).
    fire(container, "wheel", { clientX: 0, clientY: 0, deltaY: -100000 });
    expect(readCamera(world).zoom).toBeCloseTo(5, 6);
    detach();
  });
});
