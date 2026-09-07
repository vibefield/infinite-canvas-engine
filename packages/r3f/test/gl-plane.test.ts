// @vitest-environment node
// The `gl` presentation plane has an owner again (B9 review blocker 5): the facade requires the plane
// for every mounted GL widget, and a cross-type enter is gated to a SNAP until every required plane
// prepared — B8 deleted the retained-quad adapter that owned it, and the composited leg never had one.
import { Camera, createEngine, createPresentationTransitionCoordinator, type FrameSwitchDescriptor, Viewport } from "@ice/core";
import { createWorld, type Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { GL_PLANE_ADAPTER } from "../src/gl-plane";

const descriptor: FrameSwitchDescriptor = Object.freeze({
  kind: "enter" as const,
  documentEpoch: 1,
  fromFrame: 1 as Entity,
  toFrame: 2 as Entity,
  fromTypeId: "board",
  toTypeId: "whiteboard",
  fromCamera: { x: 0, y: 0, zoom: 1 },
  toCamera: { x: 100, y: 200, zoom: 2 },
  affine: { s: 0.5, ox: 25, oy: 30 },
  requestedMotion: true,
  requiresFullT2: true,
  requiredPlanes: Object.freeze(["gl"] as const),
});

function setup() {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 1000, h: 700, dpr: 1 });
  const engine = createEngine(world);
  const coordinator = createPresentationTransitionCoordinator(world, engine);
  engine.step(0);
  return { coordinator };
}

describe("the gl plane's adapter", () => {
  it("is what lets a cross-type enter with an island on the board FLY rather than snap", () => {
    const gated = setup();
    const before = gated.coordinator.prepare(descriptor);
    expect(before.allowFlight).toBe(false);
    before.cancel("cancelled");
    gated.coordinator.dispose();

    const owned = setup();
    const unregister = owned.coordinator.register(GL_PLANE_ADAPTER);
    const prepared = owned.coordinator.prepare(descriptor);
    expect(prepared.complete).toBe(true);
    expect(prepared.allowFlight).toBe(true);
    prepared.cancel("cancelled");
    unregister();
    owned.coordinator.dispose();
  });

  it("names its plane and prepares with no outgoing visual of its own", () => {
    expect(GL_PLANE_ADAPTER.plane).toBe("gl");
    expect(GL_PLANE_ADAPTER.prepare(descriptor)).toBeNull();
  });
});
