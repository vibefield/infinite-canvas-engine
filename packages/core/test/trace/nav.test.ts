/**
 * M8 nested-canvas traces (design-004 §7): membership flips, camera memory,
 * the explicit index rebuild, and nav integrity (dead frame → pop to live).
 *
 * Runs the REAL stack (installInteractionStack + activeMembership/navIntegrity
 * in their design slots) with an armed reflector — the full-stack idiom.
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "@vibecook/strata-ecs";
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
  StackZ,
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
        [StackZ, { z: 0 }],
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

describe("trace: camera memory + nav integrity (design-004 §7)", () => {
  it("enter saves the live camera; exit writes the rider back and restores", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.step(2);

    rig.world.setResource(Camera, { x: 42, y: 24, zoom: 2, gesturing: false });
    rig.nav.enterContainer(folder);
    rig.step();
    // Inside: camera is the frame's (zoom-to-fit — anything but the outer).
    const inside = rig.world.getResource(Camera);
    expect(inside?.x).not.toBe(42);

    rig.world.setResource(Camera, { x: -5, y: -7, zoom: 0.5, gesturing: false });
    rig.nav.exitContainer();
    rig.step();
    const outside = rig.world.getResource(Camera);
    expect(outside).toMatchObject({ x: 42, y: 24, zoom: 2 }); // NavCamera restore
    expect(rig.world.get(folder, ContainerCamera)).toMatchObject({ x: -5, y: -7, zoom: 0.5 }); // rider saved

    rig.nav.enterContainer(folder);
    rig.step();
    expect(rig.world.getResource(Camera)).toMatchObject({ x: -5, y: -7, zoom: 0.5 }); // rider applied
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

  it("enter clamps zoom into the CameraLimits band (empty reset + out-of-band rider)", () => {
    const rig = makeRig();
    rig.world.setResource(CameraLimits, { minZoom: 3, maxZoom: 5 });
    const folder = rig.spawnBox(100, 100, { container: true }); // empty: no content
    rig.step(2);

    // Empty container would reset to zoom 1 — clamp up to minZoom, not 1.
    rig.nav.enterContainer(folder);
    rig.step();
    expect(rig.world.getResource(Camera)?.zoom).toBe(3);

    // A saved rider zoom outside the band clamps to maxZoom on re-entry.
    rig.nav.exitContainer();
    rig.step();
    rig.world.edit(folder).set(ContainerCamera, { x: 5, y: 6, zoom: 99 });
    rig.nav.enterContainer(folder);
    rig.step();
    expect(rig.world.getResource(Camera)?.zoom).toBe(5);
  });
});
