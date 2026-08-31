/**
 * design-006 T1 traces — the camera-flight half of the portal zoom.
 *
 * Pins the architecture, not the feel: CUT-FIRST (nav state switches in the
 * op; the flight is pure presentation), continuity at the start (A.s·z₀ =
 * z_pre — the departed view wouldn't move a pixel), exact landing + resource
 * deactivation, the 'none'/headless snap posture, integrity aborts, and the
 * gesture-yield contract.
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "@vibecook/strata-ecs";
import {
  Camera,
  ChildOf,
  Container,
  NavTransition,
  Position,
  PrefabId,
  Size,
  Viewport,
  WidgetEquipped,
  createEngine,
  createNavFlight,
  createNestedCanvas,
  createRecordingCommitSink,
  installInteractionStack,
  startNavFlight,
  type Entity,
  type FrameSwitchRequest,
  type PreparedFrameSwitch,
} from "../../src";

function makeRig(
  opts: {
    viewport?: boolean;
    prepareTransition?: (request: FrameSwitchRequest) => PreparedFrameSwitch;
    onSwitch?: (frame: Entity | undefined, depth: number, restoreTool?: string) => void;
  } = {},
) {
  const world = createWorld();
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  if (opts.viewport !== false) world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  const nav = createNestedCanvas(world, {
    index: stack.index,
    clearSpatialCaches: () => stack.clearCaches(),
    ...(opts.prepareTransition === undefined
      ? {}
      : { prepareTransition: opts.prepareTransition }),
    ...(opts.onSwitch === undefined ? {} : { onSwitch: opts.onSwitch }),
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
  const spawnBox = (x: number, y: number, opts2: { container?: boolean; parent?: Entity } = {}): Entity => {
    const e = world.spawn({
      components: [
        [Position, { x, y }],
        [Size, { w: 100, h: 80 }],
        [PrefabId, { id: "flightbox" }],
      ],
      tags: opts2.container ? [WidgetEquipped, Container] : [WidgetEquipped],
    });
    if (opts2.parent !== undefined) world.setRelation(e, ChildOf, opts2.parent);
    return e;
  };
  return { world, engine, nav, step, spawnBox };
}

describe("trace: nav flight (design-006 T1)", () => {
  it("enter flies: dive-in start with exact continuity, settles EXACTLY on the fit arrival", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.spawnBox(400, 300, { parent: folder });
    rig.step(2);

    rig.world.setResource(Camera, { x: -100, y: -50, zoom: 0.8, gesturing: false });
    rig.nav.enterContainer(folder);

    // The CUT already happened; the camera sits at the continuity-solved start.
    expect(rig.nav.depth()).toBe(1);
    const t = rig.world.getResource(NavTransition);
    expect(t?.active).toBe(true);
    expect(t?.kind).toBe("enter");
    const cam0 = rig.world.getResource(Camera);
    expect(cam0?.x).toBeCloseTo(t?.c0x ?? Number.NaN, 4);
    expect(cam0?.zoom).toBeCloseTo(t?.c0z ?? Number.NaN, 4);
    // Dive-in: the start is zoomed OUT of the arrival.
    expect(t !== undefined && t.c0z < t.c1z).toBe(true);
    // Continuity, scale channel: A.s · z0 = z_pre (kernel solveFlightStart).
    expect((t?.as ?? Number.NaN) * (t?.c0z ?? Number.NaN)).toBeCloseTo(0.8, 6);

    // The spring lands EXACTLY on the arrival and the resource deactivates.
    rig.step(150);
    const done = rig.world.getResource(NavTransition);
    expect(done?.active).toBe(false);
    expect(done?.p).toBe(1);
    const camEnd = rig.world.getResource(Camera);
    expect(camEnd?.x).toBeCloseTo(done?.c1x ?? Number.NaN, 4);
    expect(camEnd?.y).toBeCloseTo(done?.c1y ?? Number.NaN, 4);
    expect(camEnd?.zoom).toBeCloseTo(done?.c1z ?? Number.NaN, 4);
  });

  it("'none' opts out and NO-VIEWPORT rigs snap — the pre-T1 posture exactly", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.step(2);
    rig.nav.enterContainer(folder, { transition: "none" });
    expect(rig.world.getResource(NavTransition)?.active ?? false).toBe(false);

    const headless = makeRig({ viewport: false });
    const f2 = headless.spawnBox(300, 100, { container: true });
    headless.spawnBox(10, 10, { parent: f2 });
    headless.step(2);
    headless.nav.enterContainer(f2); // default transition, but nothing to fly on
    expect(headless.world.getResource(NavTransition)?.active ?? false).toBe(false);
    expect(headless.nav.depth()).toBe(1);
  });

  it("releases prepared presentation as a fault when onSwitch throws after the cut", () => {
    const releases: string[] = [];
    let commits = 0;
    const rig = makeRig({
      prepareTransition: () => ({
        complete: true,
        allowFlight: true,
        commit: () => {
          commits += 1;
        },
        cancel: (reason = "cancelled") => releases.push(reason),
      }),
      onSwitch: () => {
        throw new Error("session publication fault");
      },
    });
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.step(2);

    expect(() => rig.nav.enterContainer(folder)).toThrow(/session publication fault/);
    expect(rig.nav.depth()).toBe(1);
    expect(commits).toBe(0);
    expect(releases).toEqual(["fault"]);
  });

  it("exitTo pops multi-level in ONE flight; the cut is instant, the landing is the saved root camera", () => {
    const rig = makeRig();
    const outer = rig.spawnBox(300, 100, { container: true });
    const inner = rig.spawnBox(50, 50, { container: true, parent: outer });
    rig.spawnBox(10, 10, { parent: inner });
    rig.step(2);

    rig.world.setResource(Camera, { x: 42, y: 24, zoom: 2, gesturing: false });
    rig.nav.enterContainer(outer, { transition: "none" });
    rig.step();
    rig.nav.enterContainer(inner, { transition: "none" });
    rig.step();
    expect(rig.nav.depth()).toBe(2);

    rig.nav.exitTo(0);
    expect(rig.nav.depth()).toBe(0); // CUT-FIRST: nav state is already home
    const t = rig.world.getResource(NavTransition);
    expect(t?.active).toBe(true);
    expect(t?.kind).toBe("exit");

    rig.step(200);
    expect(rig.world.getResource(NavTransition)?.active).toBe(false);
    const cam = rig.world.getResource(Camera);
    expect(cam?.x).toBeCloseTo(42, 4);
    expect(cam?.y).toBeCloseTo(24, 4);
    expect(cam?.zoom).toBeCloseTo(2, 4);
  });

  it("integrity mid-flight: the frame dies → pop AND abort, camera restored instantly", () => {
    const rig = makeRig();
    const folder = rig.spawnBox(300, 100, { container: true });
    rig.spawnBox(10, 10, { parent: folder });
    rig.step(2);

    rig.world.setResource(Camera, { x: 9, y: 9, zoom: 1, gesturing: false });
    rig.nav.enterContainer(folder); // flight active
    expect(rig.world.getResource(NavTransition)?.active).toBe(true);

    rig.world.destroy(folder);
    rig.step(2); // navIntegrity pops in react
    expect(rig.nav.depth()).toBe(0);
    expect(rig.world.getResource(NavTransition)?.active).toBe(false);
    expect(rig.world.getResource(Camera)).toMatchObject({ x: 9, y: 9, zoom: 1 });
  });

  it("an active camera gesture yields the flight without touching the camera", () => {
    // Mini-rig without cameraControl (which normalizes `gesturing` from real
    // recognizers): the yield contract is navFlight's alone.
    const world = createWorld();
    const engine = createEngine(world);
    engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
    engine.addSystems("simulate", createNavFlight(world));
    world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    world.setResource(Camera, { x: 100, y: 100, zoom: 0.2, gesturing: false });
    startNavFlight(
      world,
      "enter",
      { s: 1, ox: 0, oy: 0 },
      { x: 100, y: 100, zoom: 0.2 },
      { x: 0, y: 0, zoom: 1 },
    );
    let now = 0;
    now += 16;
    engine.step(now); // first frame: dt 0 (FrameInfo has no prev)
    now += 16;
    engine.step(now);
    expect(world.getResource(NavTransition)?.active).toBe(true);
    const mid = world.getResource(Camera);
    expect(mid?.zoom).toBeGreaterThan(0.2); // flying

    // A camera gesture goes Active (cameraControl would stamp this in
    // ctl:behave, earlier in the same frame navFlight runs).
    const grabbed = { x: 500, y: 500, zoom: 0.7, gesturing: true };
    world.setResource(Camera, grabbed);
    now += 16;
    engine.step(now);
    expect(world.getResource(NavTransition)?.active).toBe(false); // yielded
    expect(world.getResource(Camera)).toMatchObject(grabbed); // untouched

    now += 16;
    engine.step(now); // and it STAYS dead — no resurrection
    expect(world.getResource(NavTransition)?.active).toBe(false);
    expect(world.getResource(Camera)).toMatchObject(grabbed);
  });
});
