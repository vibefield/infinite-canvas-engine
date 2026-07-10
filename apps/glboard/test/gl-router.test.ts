/**
 * M7 exit (gl-board): the GL router claims taps on a spin-cube's interactive
 * internals, while DOM note-card taps (and empty canvas, and the cube's own
 * draggable margin) are left for the canvas gesture layer.
 *
 * Built on the REAL engine + interaction stack + widget runtime + durable
 * session, seeding widgets through the app's own `spawnSpinCube` / `spawnNoteCard`
 * helpers. Islands are real three scenes whose interactive mesh carries R3F v9
 * instance state on `__r3f` (the dispatcher's one internal-adjacent seam — same
 * pattern as packages/r3f/test/gl-router.test.ts). No React, no WebGL.
 */
import {
  Camera,
  type Entity,
  Viewport,
  createDocSession,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  installInteractionStack,
  installWidgetRuntime,
} from "@ice/core";
import { type IslandPointerEvent, createGLBridge, createGLPointerRouter } from "@ice/r3f";
import { Mesh, type Object3D, OrthographicCamera, PlaneGeometry, Scene } from "three";
import { describe, expect, it } from "vitest";
import { spawnNoteCard, spawnSpinCube } from "../src/app";

type Handlers = Partial<Record<string, (ev: IslandPointerEvent) => void>>;

/** Attach handlers the way R3F v9 does — instance state on the object. */
function withHandlers<T extends Object3D>(obj: T, handlers: Handlers): T {
  (obj as unknown as { __r3f: { eventCount: number; handlers: Handlers } }).__r3f = {
    eventCount: Object.keys(handlers).length,
    handlers,
  };
  return obj;
}

function makeRig() {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  world.setResource(Viewport, { w: 2000, h: 2000, dpr: 1 });
  const engine = createEngine(world);
  const stack = installInteractionStack(engine, { sink: createRecordingCommitSink() });
  installWidgetRuntime(engine);
  const session = createDocSession(world);
  const bridge = createGLBridge(engine);
  const router = createGLPointerRouter({ world, bridge, index: stack.index });

  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const mountIsland = (e: Entity, content: Object3D): void => {
    const scene = new Scene();
    scene.add(content);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    bridge.registerIsland(e, { scene, camera });
  };
  const ev = (pointerId: number, buttons: number): PointerEvent => ({ pointerId, buttons }) as PointerEvent;
  return { world, engine, stack, session, bridge, router, step, mountIsland, ev };
}

describe("gl-board M7 exit: GL router claims cube taps, canvas keeps card taps", () => {
  it("claims a cube-center tap and declines DOM-card / margin / empty taps", () => {
    const rig = makeRig();
    // 200×200 spin-cube, top-left (100,100) ⇒ center (200,200).
    const cube = spawnSpinCube(rig.session.store, rig.world, 100, 100);
    // 220×150 note card, top-left (500,400) ⇒ center (610,475) — well clear of the cube.
    spawnNoteCard(rig.session.store, rig.world, 500, 400);
    rig.step(4); // project durable spawns + spatialSync indexes both

    const log: string[] = [];
    // Interactive region = the cube footprint (120×120, island-local ±60). A
    // handler that stopPropagation()s claims the tap (design-004 §4).
    rig.mountIsland(
      cube,
      withHandlers(new Mesh(new PlaneGeometry(120, 120)), {
        onPointerDown: (e) => {
          log.push(`cube@${e.point?.x.toFixed(0)},${e.point?.y.toFixed(0)}`);
          e.stopPropagation();
        },
      }),
    );

    // (1) Cube center → island raycast hits the interactive mesh → CLAIMED.
    expect(rig.router.route("down", 200, 200, rig.ev(1, 1))).toBe(true);
    expect(log).toEqual(["cube@0,0"]); // island-local center (Y-up, origin center)

    // (2) A corner of the SAME widget, outside the 120 cube footprint → the ray
    // misses the mesh → NOT claimed → the canvas is free to drag the card.
    expect(rig.router.route("down", 110, 110, rig.ev(2, 1))).toBe(false);

    // (3) The DOM note card is surface:"dom" — the router never claims it.
    expect(rig.router.route("down", 610, 475, rig.ev(3, 1))).toBe(false);

    // (4) Empty canvas → nothing to claim.
    expect(rig.router.route("down", 1500, 1500, rig.ev(4, 1))).toBe(false);
  });
});
