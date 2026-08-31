import { createWorld, type Entity } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { Camera, Viewport } from "../src/catalog";
import {
  createPresentationTransitionCoordinator,
  type FrameSwitchDescriptor,
  type PresentationReleaseReason,
  type PresentationTransitionFrame,
} from "../src/canvas/presentation-transition";
import { createEngine } from "../src/engine/engine";
import { NavTransition, publishNavCut, startNavFlight } from "../src/systems/nav-flight";

const descriptor = Object.freeze({
  kind: "enter" as const,
  documentEpoch: 4,
  fromFrame: 1 as Entity,
  toFrame: 2 as Entity,
  fromTypeId: "board",
  toTypeId: "whiteboard",
  fromCamera: { x: 10, y: 20, zoom: 2 },
  toCamera: { x: 100, y: 200, zoom: 1 },
  affine: { s: 0.5, ox: 25, oy: 30 },
  requestedMotion: true,
  requiresFullT2: true,
  requiredPlanes: Object.freeze(["ground", "dom", "gl"] as const),
}) satisfies FrameSwitchDescriptor;

function setup() {
  const world = createWorld();
  world.setResource(Camera, { x: 10, y: 20, zoom: 2, gesturing: false });
  world.setResource(Viewport, { w: 1_000, h: 700, dpr: 1 });
  const engine = createEngine(world);
  const coordinator = createPresentationTransitionCoordinator(world, engine);
  engine.step(0);
  return { world, engine, coordinator };
}

describe("presentation transition coordinator", () => {
  it("gates cross-type flight until every required visual plane prepares", () => {
    const rig = setup();
    const releases: PresentationReleaseReason[] = [];
    rig.coordinator.register({
      id: "dom",
      plane: "dom",
      prepare: () => ({ update: () => {}, release: (reason) => releases.push(reason) }),
    });
    const prepared = rig.coordinator.prepare(descriptor);
    expect(prepared.complete).toBe(false);
    expect(prepared.allowFlight).toBe(false);
    publishNavCut(
      rig.world,
      "enter",
      descriptor.fromCamera,
      descriptor.toCamera,
      descriptor,
      descriptor.affine,
    );
    prepared.commit();
    expect(rig.coordinator.stats()).toMatchObject({ active: true, motion: "crossfade" });
    rig.engine.step(64);
    rig.engine.step(128);
    rig.engine.step(192);
    expect(releases).toEqual(["settled"]);
    expect(rig.coordinator.stats().active).toBe(false);
    rig.coordinator.dispose();
  });

  it("updates all retained planes from one epoch/camera and releases exactly at settle", () => {
    const rig = setup();
    const frames: PresentationTransitionFrame[] = [];
    const releases: string[] = [];
    const preparations: string[] = [];
    for (const plane of descriptor.requiredPlanes) {
      rig.coordinator.register({
        id: plane,
        plane,
        prepare: () => {
          preparations.push(plane);
          return {
            update: (frame) => frames.push(frame),
            release: (reason) => releases.push(`${plane}:${reason}`),
          };
        },
      });
    }
    const prepared = rig.coordinator.prepare(descriptor);
    expect(prepared).toMatchObject({ complete: true, allowFlight: true });
    expect(preparations).toEqual(["dom", "gl", "ground"]);
    startNavFlight(
      rig.world,
      "enter",
      descriptor.affine,
      descriptor.fromCamera,
      descriptor.toCamera,
      descriptor,
    );
    prepared.commit();
    const initialEpoch = rig.world.getResource(NavTransition)?.epoch;
    expect(frames.at(-1)).toMatchObject({ epoch: initialEpoch, motion: "flight" });
    const transition = rig.world.getResource(NavTransition);
    if (transition === undefined) throw new Error("expected transition");
    rig.world.setResource(NavTransition, { ...transition, active: false, p: 1, v: 0 });
    rig.engine.step(64);
    expect(releases).toEqual([
      "dom:settled",
      "gl:settled",
      "ground:settled",
    ]);
    expect(rig.coordinator.stats().retainers).toBe(0);
    rig.coordinator.dispose();
  });

  it("fast-fades an interrupted epoch and enforces idempotent superseding release", () => {
    const rig = setup();
    const releases: PresentationReleaseReason[] = [];
    rig.coordinator.register({
      id: "ground",
      plane: "ground",
      prepare: () => ({ update: () => {}, release: (reason) => releases.push(reason) }),
    });
    const request = { ...descriptor, requiredPlanes: ["ground"] as const };
    const prepared = rig.coordinator.prepare(request);
    startNavFlight(
      rig.world,
      "enter",
      request.affine,
      request.fromCamera,
      request.toCamera,
      request,
    );
    prepared.commit();
    const transition = rig.world.getResource(NavTransition);
    if (transition === undefined) throw new Error("expected transition");
    rig.world.setResource(NavTransition, { ...transition, active: false, p: 0.4, v: 0 });
    rig.engine.step(64);
    rig.engine.step(128);
    rig.engine.step(192);
    rig.engine.step(256);
    expect(releases).toEqual(["interrupted"]);
    rig.coordinator.abort();
    expect(releases).toHaveLength(1);
    rig.coordinator.dispose();
  });

  it("owns only one prepared capture and refuses to bind it to a later epoch", () => {
    const rig = setup();
    const releases: PresentationReleaseReason[] = [];
    rig.coordinator.register({
      id: "ground",
      plane: "ground",
      prepare: () => ({ update: () => {}, release: (reason) => releases.push(reason) }),
    });
    const request = { ...descriptor, requiredPlanes: ["ground"] as const };

    const first = rig.coordinator.prepare(request);
    const second = rig.coordinator.prepare(request);
    expect(releases).toEqual(["superseded"]);
    first.cancel();
    expect(releases).toHaveLength(1);

    // The prepared handle expected epoch 1. A re-entrant/unrelated switch
    // publishes two epochs before commit, so it must release instead of
    // animating the captured presentation against the wrong identity.
    publishNavCut(
      rig.world,
      "enter",
      request.fromCamera,
      request.toCamera,
      request,
      request.affine,
    );
    publishNavCut(
      rig.world,
      "enter",
      request.fromCamera,
      request.toCamera,
      request,
      request.affine,
    );
    second.commit();
    expect(releases).toEqual(["superseded", "superseded"]);
    expect(rig.coordinator.stats().active).toBe(false);
    rig.coordinator.dispose();
  });

  it("preserves an explicit post-authority terminal reason on prepared release", () => {
    const rig = setup();
    const releases: PresentationReleaseReason[] = [];
    rig.coordinator.register({
      id: "ground",
      plane: "ground",
      prepare: () => ({ update: () => {}, release: (reason) => releases.push(reason) }),
    });
    const prepared = rig.coordinator.prepare({
      ...descriptor,
      requiredPlanes: ["ground"] as const,
    });

    prepared.cancel("fault");
    prepared.cancel();

    expect(releases).toEqual(["fault"]);
    expect(rig.coordinator.stats()).toMatchObject({ active: false, retainers: 0 });
    rig.coordinator.dispose();
  });

  it("releases a PENDING retainer when its adapter unregisters before commit", () => {
    // `unregister` swept only the ACTIVE transition. A preparation in flight
    // holds its own retainer map, finished by the caller's commit/cancel —
    // which is later, and under the public `prepare` API may be never. The
    // detached adapter's release is what hands back what it retained (the DOM
    // plane's returns the mount store's retention), so skipping it strands the
    // hold and can still commit the retainer into a transition it cannot serve.
    const rig = setup();
    const releases: PresentationReleaseReason[] = [];
    const detach = rig.coordinator.register({
      id: "dom",
      plane: "dom",
      prepare: () => ({ update: () => {}, release: (reason) => releases.push(reason) }),
    });
    const prepared = rig.coordinator.prepare(descriptor);
    expect(releases).toEqual([]);

    detach();
    expect(releases).toEqual(["detached"]);

    // And the emptied preparation commits nothing.
    publishNavCut(
      rig.world,
      "enter",
      descriptor.fromCamera,
      descriptor.toCamera,
      descriptor,
      descriptor.affine,
    );
    prepared.commit();
    expect(rig.coordinator.stats()).toMatchObject({ active: false, retainers: 0 });
    expect(releases).toEqual(["detached"]); // exactly once
    rig.coordinator.dispose();
  });

  it("refuses to bank a retainer for an adapter that unregistered inside its own prepare", () => {
    // The same defect one instant earlier, and the reachable one: `prepare` is
    // a user-code boundary (the DOM adapter blurs focus and notifies the mount
    // store there), so the mount owning the adapter can tear down mid-call.
    // The retainer would then be banked a moment AFTER unregister swept the map.
    const rig = setup();
    const domReleases: PresentationReleaseReason[] = [];
    const glReleases: PresentationReleaseReason[] = [];
    let detach: () => void = () => {};
    detach = rig.coordinator.register({
      id: "dom",
      plane: "dom",
      prepare: () => {
        detach(); // the mount goes away from inside the boundary
        return { update: () => {}, release: (reason) => domReleases.push(reason) };
      },
    });
    rig.coordinator.register({
      id: "gl",
      plane: "gl",
      prepare: () => ({ update: () => {}, release: (reason) => glReleases.push(reason) }),
    });

    const prepared = rig.coordinator.prepare(descriptor);
    expect(domReleases).toEqual(["detached"]);
    expect(prepared.complete).toBe(false); // the dom plane did not prepare

    // `continue`, not `break`: the planes that are still ours keep theirs.
    publishNavCut(
      rig.world,
      "enter",
      descriptor.fromCamera,
      descriptor.toCamera,
      descriptor,
      descriptor.affine,
    );
    prepared.commit();
    expect(rig.coordinator.stats()).toMatchObject({ active: true, retainers: 1 });
    expect(glReleases).toEqual([]);
    rig.coordinator.dispose();
    expect(glReleases).toEqual(["detached"]);
    expect(domReleases).toEqual(["detached"]); // never released twice
  });

  it("uses a bounded non-geometric crossfade under reduced motion", () => {
    const rig = setup();
    const frames: PresentationTransitionFrame[] = [];
    const releases: PresentationReleaseReason[] = [];
    rig.coordinator.register({
      id: "ground",
      plane: "ground",
      prepare: () => ({
        update: (frame) => frames.push(frame),
        release: (reason) => releases.push(reason),
      }),
    });
    rig.coordinator.setReducedMotion(true);
    const request = { ...descriptor, requiredPlanes: ["ground"] as const };
    const prepared = rig.coordinator.prepare(request);
    expect(prepared).toMatchObject({ complete: true, allowFlight: false });
    publishNavCut(
      rig.world,
      "enter",
      request.fromCamera,
      request.toCamera,
      request,
      request.affine,
    );
    rig.world.setResource(Camera, { ...request.toCamera, gesturing: false });
    prepared.commit();
    expect(frames.at(-1)).toMatchObject({ motion: "crossfade", camera: request.toCamera });
    rig.engine.step(64);
    rig.engine.step(128);
    rig.engine.step(192);
    expect(releases).toEqual(["settled"]);
    rig.coordinator.dispose();
  });

  it("isolates a faulting plane and releases every remaining hold at the absolute ceiling", () => {
    const rig = setup();
    const releases: string[] = [];
    rig.coordinator.register({
      id: "bad-ground",
      plane: "ground",
      prepare: () => ({
        update: () => {
          throw new Error("bad shader adapter");
        },
        release: (reason) => releases.push(`ground:${reason}`),
      }),
    });
    rig.coordinator.register({
      id: "dom",
      plane: "dom",
      prepare: () => ({
        update: () => {},
        release: (reason) => releases.push(`dom:${reason}`),
      }),
    });
    const request = { ...descriptor, requiredPlanes: ["ground", "dom"] as const };
    const prepared = rig.coordinator.prepare(request);
    startNavFlight(
      rig.world,
      "enter",
      request.affine,
      request.fromCamera,
      request.toCamera,
      request,
    );
    prepared.commit();
    expect(releases).toEqual(["ground:fault"]);
    // The ceiling is wall-time, not the animation dt (which intentionally
    // clamps background-tab gaps). One late frame must still release.
    rig.engine.step(5_000);
    expect(releases).toEqual(["ground:fault", "dom:timeout"]);
    expect(rig.coordinator.stats().active).toBe(false);
    rig.coordinator.dispose();
  });

  it("lets a navigation re-entered by pre-cut adapter work supersede the outer capture", () => {
    const rig = setup();
    const releases: string[] = [];
    const innerDescriptor = {
      ...descriptor,
      toFrame: 3 as Entity,
      toTypeId: "mindmap",
      requiredPlanes: ["ground"] as const,
    };
    let nested: ReturnType<typeof rig.coordinator.prepare> | undefined;
    let calls = 0;
    rig.coordinator.register({
      id: "ground",
      plane: "ground",
      prepare: () => {
        const call = ++calls;
        if (call === 1) nested = rig.coordinator.prepare(innerDescriptor);
        return {
          update: () => {},
          release: (reason) => releases.push(`${call}:${reason}`),
        };
      },
    });
    const outer = rig.coordinator.prepare({
      ...descriptor,
      requiredPlanes: ["ground"] as const,
    });
    expect(outer).toMatchObject({ complete: false, allowFlight: false });
    expect(nested).toMatchObject({ complete: true, allowFlight: true });
    expect(releases).toEqual(["1:superseded"]);

    startNavFlight(
      rig.world,
      "enter",
      innerDescriptor.affine,
      innerDescriptor.fromCamera,
      innerDescriptor.toCamera,
      innerDescriptor,
    );
    nested?.commit();
    expect({
      stats: rig.coordinator.stats(),
      releases,
      transition: rig.world.getResource(NavTransition),
    }).toMatchObject({
      stats: { active: true, retainers: 1 },
      releases: ["1:superseded"],
      transition: {
        epoch: 1,
        documentEpoch: innerDescriptor.documentEpoch,
        fromFrame: innerDescriptor.fromFrame,
        toFrame: innerDescriptor.toFrame,
        fromTypeId: innerDescriptor.fromTypeId,
        toTypeId: innerDescriptor.toTypeId,
      },
    });
    outer.cancel();
    expect(releases).toEqual(["1:superseded"]);
    rig.coordinator.abort("interrupted");
    expect(releases).toEqual(["1:superseded", "2:interrupted"]);
    rig.coordinator.dispose();
  });

  it("releases every plane exactly once across 240 rapid terminal paths", () => {
    const rig = setup();
    const active = new Set<number>();
    const reasons = new Set<PresentationReleaseReason>();
    let serial = 0;
    let releases = 0;
    let duplicateReleases = 0;
    let peakActive = 0;
    for (const plane of descriptor.requiredPlanes) {
      rig.coordinator.register({
        id: `stress-${plane}`,
        plane,
        prepare: () => {
          const token = ++serial;
          active.add(token);
          peakActive = Math.max(peakActive, active.size);
          return {
            update: () => {},
            release: (reason) => {
              if (!active.delete(token)) duplicateReleases += 1;
              releases += 1;
              reasons.add(reason);
            },
          };
        },
      });
    }
    let now = 0;

    for (let i = 0; i < 240; i += 1) {
      const first = rig.coordinator.prepare(descriptor);
      if (i % 4 === 0) {
        first.cancel();
      } else if (i % 4 === 1) {
        const replacement = rig.coordinator.prepare(descriptor);
        replacement.cancel();
      } else {
        startNavFlight(
          rig.world,
          descriptor.kind,
          descriptor.affine,
          descriptor.fromCamera,
          descriptor.toCamera,
          descriptor,
        );
        first.commit();
        if (i % 4 === 2) {
          rig.coordinator.abort("interrupted");
        } else {
          const transition = rig.world.getResource(NavTransition);
          if (transition === undefined) throw new Error("expected stress transition");
          rig.world.setResource(NavTransition, { ...transition, active: false, p: 1, v: 0 });
          now += 16;
          rig.engine.step(now);
        }
      }

      expect(rig.coordinator.stats()).toMatchObject({ active: false, retainers: 0 });
      expect(active.size).toBe(0);
    }

    expect(duplicateReleases).toBe(0);
    expect(releases).toBe(serial);
    expect(peakActive).toBe(3);
    expect(reasons).toEqual(new Set(["cancelled", "superseded", "interrupted", "settled"]));
    rig.coordinator.dispose();
  });
});
