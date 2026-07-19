/**
 * M8 nested-canvas traces (design-004 §7): membership flips, camera memory,
 * the explicit index rebuild, and nav integrity (dead frame → pop to live).
 *
 * Runs the REAL stack (installInteractionStack + activeMembership/navIntegrity
 * in their design slots) with an armed reflector — the full-stack idiom.
 */
import { describe, expect, it } from "vitest";
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import {
  Active,
  Camera,
  CameraLimits,
  Container,
  ContainerCamera,
  ChildOf,
  Culled,
  Position,
  PrefabId,
  Selectable,
  Selected,
  Size,
  Viewport,
  Visible,
  WidgetEquipped,
  NO_MODS,
  createEngine,
  createNestedCanvas,
  createRecordingCommitSink,
  installInteractionStack,
  type Entity,
} from "../../src";

const activeQ = defineQuery([Active]);

function makeRig() {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  const nav = createNestedCanvas(world, {
    index: stack.index,
    clearSpatialCaches: () => stack.clearCaches(),
  });
  engine.addSystems("react", nav.navIntegrity);
  engine.addSystems("derive", nav.activeMembership);
  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const spawnBox = (x: number, y: number, opts: { container?: boolean; parent?: Entity } = {}): Entity => {
    const e = world.spawn({
      components: [
        [Position, { x, y }],
        [Size, { w: 100, h: 80 }],
        [PrefabId, { id: "navbox" }],
      ],
      tags: opts.container ? [Selectable, WidgetEquipped, Container] : [Selectable, WidgetEquipped],
    });
    if (opts.parent !== undefined) world.setRelation(e, ChildOf, opts.parent);
    return e;
  };
  return { world, engine, stack, nav, step, mouse, spawnBox };
}

describe("trace: active membership (design-004 §7)", () => {
  it("root widgets are Active; container CONTENT is not until entered; nav flips are change-only", () => {
    const rig = makeRig();
    const box = rig.spawnBox(100, 100);
    const folder = rig.spawnBox(300, 100, { container: true });
    const inner = rig.spawnBox(50, 50, { parent: folder });
    rig.step(2);

    // Root frame: box + folder Active; folder's content is not (Culled).
    expect(rig.world.hasTag(box, Active)).toBe(true);
    expect(rig.world.hasTag(folder, Active)).toBe(true);
    expect(rig.world.hasTag(inner, Active)).toBe(false);
    expect(rig.world.hasTag(inner, Culled)).toBe(true);
    expect(rig.world.hasTag(inner, Visible)).toBe(false);

    rig.nav.enterContainer(folder);
    rig.step(2);
    expect(rig.nav.depth()).toBe(1);
    expect(rig.world.hasTag(inner, Active)).toBe(true);
    expect(rig.world.hasTag(box, Active)).toBe(false); // root content left behind
    expect(rig.world.hasTag(box, Culled)).toBe(true);

    rig.nav.exitContainer();
    rig.step(2);
    expect(rig.nav.depth()).toBe(0);
    expect(rig.world.hasTag(box, Active)).toBe(true);
    expect(rig.world.hasTag(inner, Active)).toBe(false);
  });

  it("picking works across the nav rebuild: tap selects the INNER widget only inside the frame", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(100, 100, { container: true });
    const inner = rig.spawnBox(120, 120, { parent: folder }); // overlaps folder in world coords
    rig.step(2);

    rig.nav.enterContainer(folder);
    // Zoom-to-fit moved the camera; put it back to identity for screen==world.
    rig.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    rig.step(2); // spatialSync repopulates the cleared index from the Active set

    rig.mouse("down", 150, 150, 1); // inner's bounds
    rig.step();
    rig.mouse("up", 150, 150, 0);
    rig.step();
    expect(rig.world.hasTag(inner, Selected)).toBe(true);
    expect(rig.world.hasTag(folder, Selected)).toBe(false); // folder is NOT in this frame's index
  });
});

describe("trace: gated membership delta paths (design-004 §7 runIf, 2026-07-15)", () => {
  it("spawn classifies SAME tick (the M6 mount-timing invariant)", () => {
    const rig = makeRig();
    rig.step(2); // settle: seeded, journal drained
    const folder = rig.spawnBox(300, 100, { container: true });
    const inner = rig.spawnBox(50, 50, { parent: folder });
    const root = rig.spawnBox(100, 100);
    rig.step(1); // ONE tick: the delta route must classify all three
    expect(rig.world.hasTag(root, Active)).toBe(true);
    expect(rig.world.hasTag(folder, Active)).toBe(true);
    expect(rig.world.hasTag(inner, Active)).toBe(false);
    expect(rig.world.hasTag(inner, Culled)).toBe(true);
  });

  it("reparent (with the frame-local Position co-write) flips membership without a nav change", () => {
    const rig = makeRig();
    const box = rig.spawnBox(100, 100);
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.step(2);
    expect(rig.world.hasTag(box, Active)).toBe(true);

    // The consume shape: ChildOf + Position rewritten together (design-001
    // frame-local coordinates — the co-write IS the collector's churn signal).
    rig.world.setRelation(box, ChildOf, folder);
    rig.world.edit(box).set(Position, { x: 10, y: 10 });
    rig.step(1);
    expect(rig.world.hasTag(box, Active)).toBe(false);
    expect(rig.world.hasTag(box, Culled)).toBe(true);

    // Drag-out shape: back to root.
    rig.world.removeRelation(box, ChildOf);
    rig.world.edit(box).set(Position, { x: 150, y: 150 });
    rig.step(1);
    expect(rig.world.hasTag(box, Active)).toBe(true);
  });

  it("container-ness flip re-anchors the subtree (the equip-lag correction path)", () => {
    const rig = makeRig();
    const group = rig.spawnBox(300, 100); // NOT a container yet
    const child = rig.spawnBox(20, 20, { parent: group });
    rig.step(2);
    // A non-container parent is transparent: child anchors to root → Active.
    expect(rig.world.hasTag(child, Active)).toBe(true);

    rig.world.addTag(group, Container); // equip stamps Container one flush later
    rig.step(1);
    expect(rig.world.hasTag(group, Active)).toBe(true); // still a root widget
    expect(rig.world.hasTag(child, Active)).toBe(false); // now CONTENT of group
    expect(rig.world.hasTag(child, Culled)).toBe(true);
  });

  it("container reparent moves the folder, not its content's anchor (DFS stops at container children)", () => {
    const rig = makeRig();
    const a = rig.spawnBox(100, 100, { container: true });
    const w = rig.spawnBox(10, 10, { parent: a });
    const b = rig.spawnBox(500, 100, { container: true });
    rig.step(2);
    expect(rig.world.hasTag(a, Active)).toBe(true);
    expect(rig.world.hasTag(w, Active)).toBe(false);

    // Consume folder A into folder B (co-write).
    rig.world.setRelation(a, ChildOf, b);
    rig.world.edit(a).set(Position, { x: 5, y: 5 });
    rig.step(1);
    expect(rig.world.hasTag(a, Active)).toBe(false); // A is B's content now
    expect(rig.world.hasTag(w, Active)).toBe(false); // w still anchors to A

    rig.nav.enterContainer(b);
    rig.step(2);
    expect(rig.world.hasTag(a, Active)).toBe(true); // inside B: A is a member
    expect(rig.world.hasTag(w, Active)).toBe(false); // w is A's content, not B's

    rig.nav.enterContainer(a);
    rig.step(2);
    expect(rig.world.hasTag(w, Active)).toBe(true); // inside A at last
  });

  it("container despawn (remote analog, NO cascade) resweeps: orphaned content re-anchors", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    const inner = rig.spawnBox(50, 50, { parent: folder });
    rig.step(2);
    expect(rig.world.hasTag(inner, Active)).toBe(false);

    // Bare destroy — the ChildOf edge auto-clears with it and the orphan's
    // own row journals NOTHING; the container-despawn insurance resweeps.
    rig.world.destroy(folder);
    rig.step(1);
    expect(rig.world.hasTag(inner, Active)).toBe(true); // root-level now
    expect(rig.world.hasTag(inner, Culled)).toBe(false);
  });

  it("idle frames after settle leave membership untouched (no churn, no flips)", () => {
    const rig = makeRig();
    const box = rig.spawnBox(100, 100);
    const folder = rig.spawnBox(300, 100, { container: true });
    const inner = rig.spawnBox(50, 50, { parent: folder });
    rig.step(2);

    // 20 idle ticks: the drain-empty early return must hold the partition
    // stable (any Active flip changes the query's membership and fires this).
    let flips = 0;
    rig.world.reactive.observeQuery(activeQ, () => {
      flips++;
    });
    rig.step(20);
    expect(flips).toBe(0);
    expect(rig.world.hasTag(box, Active)).toBe(true);
    expect(rig.world.hasTag(inner, Active)).toBe(false);
  });
});

describe("trace: camera memory + nav integrity (design-004 §7)", () => {
  it("enter saves the live camera; exit writes the rider back and restores", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.step(2);

    rig.world.setResource(Camera, { x: 42, y: 24, zoom: 2, gesturing: false });
    rig.nav.enterContainer(folder, { transition: "none" });
    rig.step();
    // Inside: the DEFAULT framing (zoom-to-fit — anything but the outer).
    const inside = rig.world.getResource(Camera);
    expect(inside?.x).not.toBe(42);

    rig.world.setResource(Camera, { x: -5, y: -7, zoom: 0.5, gesturing: false });
    rig.nav.exitContainer({ transition: "none" });
    rig.step();
    const outside = rig.world.getResource(Camera);
    expect(outside).toMatchObject({ x: 42, y: 24, zoom: 2 }); // NavCamera restore
    // design-006 (James, 2026-07-15): NO per-canvas view memory — the engine
    // neither writes nor reads the ContainerCamera rider on nav.
    expect(rig.world.get(folder, ContainerCamera)).toBeUndefined();

    rig.nav.enterContainer(folder, { transition: "none" });
    rig.step();
    // Re-entry lands the SAME default framing, not where the camera was left.
    expect(rig.world.getResource(Camera)).toMatchObject(inside as object);
  });

  it("integrity: the current frame's container dies → pop to root, camera restored", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.step(2);

    rig.world.setResource(Camera, { x: 9, y: 9, zoom: 1, gesturing: false });
    rig.nav.enterContainer(folder);
    rig.step();
    expect(rig.nav.depth()).toBe(1);

    rig.world.destroy(folder); // undo/remote analog — NavFrame edge dies with it
    rig.step(2); // navIntegrity pops in react

    expect(rig.nav.depth()).toBe(0);
    expect(rig.world.getResource(Camera)).toMatchObject({ x: 9, y: 9, zoom: 1 });
  });

  it("enter clamps the ARRIVAL zoom into the natural band ∩ CameraLimits", () => {
    const rig = makeRig();
    rig.world.setResource(CameraLimits, { minZoom: 3, maxZoom: 5 });
    const folder = rig.spawnBox(100, 100, { container: true }); // empty: no content
    rig.step(2);

    // Empty container would reset to zoom 1 — the natural band tops out at 1,
    // but a HARD minZoom above it wins (band ∩ limits collapses to [3,3]).
    rig.nav.enterContainer(folder, { transition: "none" });
    rig.step();
    expect(rig.world.getResource(Camera)?.zoom).toBe(3);

    // A lone 100×80 child fits at zoom 2.5 (600/240) — the NATURAL cap
    // (2026-07-18, James: "not super zoomed in") lands the arrival at 100%,
    // well before the hard maxZoom 2 would have.
    rig.nav.exitContainer({ transition: "none" });
    rig.step();
    rig.world.setResource(CameraLimits, { minZoom: 0.1, maxZoom: 2 });
    rig.spawnBox(0, 0, { parent: folder });
    rig.step();
    rig.nav.enterContainer(folder, { transition: "none" });
    rig.step();
    expect(rig.world.getResource(Camera)?.zoom).toBe(1);
  });
});
