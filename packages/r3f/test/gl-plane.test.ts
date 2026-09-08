// @vitest-environment node
// The `gl` presentation plane has an owner again (B9 review blocker 5): the facade requires the plane
// for every mounted GL widget, and a cross-type enter is gated to a SNAP until every required plane
// prepared — B8 deleted the retained-quad adapter that owned it, and the composited leg never had one.
import { Camera, createEngine, createPresentationTransitionCoordinator, type FrameSwitchDescriptor, Viewport } from "@ice/core";
import { createWorld, type Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { GL_PLANE_ADAPTER, claimGlPlane } from "../src/gl-plane";

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

describe("claimGlPlane (D-C4.6): GLViews' mount effect", () => {
  it("claims a free plane and names GLViews as the owner", () => {
    const { coordinator } = setup();
    expect(coordinator.ownerOf("gl")).toBeUndefined();

    const release = claimGlPlane(coordinator);

    expect(release).toBeTypeOf("function");
    expect(coordinator.ownerOf("gl")).toBe("@ice/r3f/gl");
    coordinator.dispose();
  });

  it("the unmount cleanup frees the plane, and the next mount claims it again", () => {
    const { coordinator } = setup();
    const release = claimGlPlane(coordinator);
    release?.();
    expect(coordinator.ownerOf("gl")).toBeUndefined();

    const second = claimGlPlane(coordinator);
    expect(second).toBeTypeOf("function");
    expect(coordinator.ownerOf("gl")).toBe("@ice/r3f/gl");
    second?.();
    coordinator.dispose();
  });

  it("TWO GLViews over one engine: the second stands down instead of throwing", () => {
    const { coordinator } = setup();
    const first = claimGlPlane(coordinator);

    // Before D-C4.6 this threw — inside a useEffect, which unmounts the tree.
    let second: (() => void) | undefined;
    expect(() => {
      second = claimGlPlane(coordinator);
    }).not.toThrow();

    expect(second).toBeUndefined(); // no claim ⇒ no cleanup to run
    expect(coordinator.ownerOf("gl")).toBe("@ice/r3f/gl"); // exactly one owner
    first?.();
    expect(coordinator.ownerOf("gl")).toBeUndefined(); // and the first still owns its release
    coordinator.dispose();
  });

  it("a bare-engine mount (no coordinator) claims nothing and asks for no cleanup", () => {
    expect(claimGlPlane(undefined)).toBeUndefined();
  });
});
