/**
 * Plane-transform reflector (M3 exit gate, design-002 §5): O(1) pan — exactly
 * one transform write per moving frame, zero on a static camera.
 */
import { Camera, createEngine, createWorld } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createPlaneTransformReflector } from "../src/reflectors/plane-transform";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  const reflector = createPlaneTransformReflector(host);
  engine.registerReflector(reflector);
  return { world, engine, host, reflector };
}

describe("plane-transform reflector", () => {
  it("writes exactly one transform per distinct camera value; static frames write nothing", () => {
    const { world, engine, host, reflector } = setup();

    const moves = 5;
    for (let i = 1; i <= moves; i++) {
      world.setResource(Camera, { x: i, y: 0, zoom: 1, gesturing: false });
      engine.step(i);
    }
    expect(reflector.transformWrites()).toBe(moves);
    // Last camera (x=5, y=0, zoom=1): tx=-5, ty=0, scale=1 (kernel planeCssTransform).
    expect(host.contentPlane.style.transform).toBe("translate(-5px, 0px) scale(1)");

    const staticFrames = 4;
    for (let j = 0; j < staticFrames; j++) engine.step(moves + 1 + j);
    expect(reflector.transformWrites()).toBe(moves); // no additional writes on a still camera
  });

  it("applies zoom into the scale factor and negated pan into the translate", () => {
    const { world, engine, host, reflector } = setup();
    world.setResource(Camera, { x: 100, y: 50, zoom: 2, gesturing: false });
    engine.step(0);
    // tx = -x*zoom = -200, ty = -y*zoom = -100, scale = zoom = 2.
    expect(host.contentPlane.style.transform).toBe("translate(-200px, -100px) scale(2)");
    expect(reflector.transformWrites()).toBe(1);
  });

  it("skips (no write) while the camera resource is unset", () => {
    const { engine, reflector } = setup();
    engine.step(0); // first-paint flush runs, but Camera is undefined → early return
    expect(reflector.transformWrites()).toBe(0);
  });
});
