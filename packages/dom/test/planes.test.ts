/**
 * The lifted plane (design-004 §1, P3 — M6): a second camera-transformed div
 * stacked above the content plane, both driven by the one plane-transform.
 */
import { Camera, createEngine, createWorld } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createPlanes } from "../src/planes";
import { createPlaneTransformReflector } from "../src/reflectors/plane-transform";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);
  return { container, host, planes };
}

describe("createPlanes", () => {
  it("mounts the lifted plane after the content plane (P3 above P1), transform-ready", () => {
    const { container, host, planes } = setup();
    expect(planes.content).toBe(host.contentPlane);
    expect(planes.lifted.parentElement).toBe(container);
    // Appended AFTER content ⇒ lifted is the container's last child (stacks above).
    expect(container.lastElementChild).toBe(planes.lifted);
    expect(planes.content.nextElementSibling).toBe(planes.lifted);
    expect(planes.lifted.style.position).toBe("absolute");
    expect(planes.lifted.style.transformOrigin).toBe("0 0");
    expect(planes.lifted.style.willChange).toBe("transform");
  });

  it("leaves createCanvasHost's content plane untouched", () => {
    const { host, planes } = setup();
    expect(planes.content).toBe(host.contentPlane);
    expect(host.contentPlane.style.transformOrigin).toBe("0 0"); // still the P1 authority
  });
});

describe("plane-transform reflector (widened for the lifted plane)", () => {
  it("writes BOTH planes from one camera, counting one write per frame", () => {
    const { host, planes } = setup();
    const world = createWorld();
    const engine = createEngine(world);
    const reflector = createPlaneTransformReflector({ contentPlane: planes.content, liftedPlane: planes.lifted });
    engine.registerReflector(reflector);

    world.setResource(Camera, { x: 100, y: 50, zoom: 2, gesturing: false });
    engine.step(0);

    const expected = "translate(-200px, -100px) scale(2)";
    expect(planes.content.style.transform).toBe(expected);
    expect(planes.lifted.style.transform).toBe(expected); // P3 tracks P1 exactly
    expect(reflector.transformWrites()).toBe(1); // one flush writes both planes
    expect(host.contentPlane.style.transform).toBe(expected);
  });

  it("stays backward compatible: a bare CanvasHost writes only the content plane", () => {
    const { host } = setup();
    const world = createWorld();
    const engine = createEngine(world);
    // The M3 call shape — a CanvasHost with no liftedPlane.
    const reflector = createPlaneTransformReflector(host);
    engine.registerReflector(reflector);

    world.setResource(Camera, { x: 5, y: 0, zoom: 1, gesturing: false });
    engine.step(0);
    expect(host.contentPlane.style.transform).toBe("translate(-5px, 0px) scale(1)");
    expect(reflector.transformWrites()).toBe(1);
  });
});
