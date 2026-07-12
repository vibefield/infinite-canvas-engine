/**
 * Regression guard for ShapesCard's RFC-006 interaction path (task 64 field
 * fix). ShapesCard's interaction surface is a full-card backplate mounted
 * BEHIND a cloud of handler-less body meshes. This pins that the GL router
 * still reaches that backplate through the bodies:
 *   - a claimed pointerdown (stopPropagation) → the swarm/card claims the tap
 *     so the engine never drags the widget;
 *   - a captured pointermove → an island-local `point` (the repel input);
 *   - down+up on the same object → a synthesized click (accent cycle).
 *
 * Built on the real engine + interaction stack + router with a real shapes-card
 * entity; the island scene mirrors GlCardBackplate (plane behind bodies). No
 * React, no WebGL — the scene is hand-built with R3F-shaped `__r3f` handlers,
 * the same seam packages/r3f and glboard test against.
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
  spawnWidget,
} from "@ice/core";
import { type IslandPointerEvent, createGLBridge, createGLPointerRouter } from "@ice/r3f";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from "three";
import { describe, expect, it } from "vitest";
import { GL_WIDGETS } from "../src/widgets/gl";

void GL_WIDGETS; // register the gl widgets (defineWidget side effects)

type Handlers = Partial<Record<string, (ev: IslandPointerEvent) => void>>;
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
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);
    bridge.registerIsland(e, { scene, camera });
  };
  const ev = (pointerId: number, buttons: number): PointerEvent => ({ pointerId, buttons }) as PointerEvent;
  return { world, session, stack, router, step, mountIsland, ev };
}

describe("ShapesCard interaction: router reaches the backplate through the body cloud", () => {
  it("claims the down, delivers a captured-move point, and pairs a click", () => {
    const rig = makeRig();
    // shapes-card at top-left (100,100), size 329×345 → centre (264.5, 272.5).
    const shapes = spawnWidget(rig.session.store, rig.world, "shapes-card", { x: 100, y: 100 }) as Entity;
    rig.step(4); // project + index

    const downs: string[] = [];
    const moves: string[] = [];
    let clicks = 0;
    const group = new Group();
    // Interaction backplate BEHIND the swarm (GlCardBackplate default z=-40).
    const backplate = withHandlers(new Mesh(new PlaneGeometry(329, 345), new MeshBasicMaterial()), {
      onPointerDown: (e) => {
        downs.push(`${e.point?.x.toFixed(0)},${e.point?.y.toFixed(0)}`);
        e.stopPropagation();
      },
      onPointerMove: (e) => {
        if (e.point) moves.push(`${e.point.x.toFixed(0)},${e.point.y.toFixed(0)}`);
      },
      onClick: () => {
        clicks += 1;
      },
    });
    backplate.position.set(0, 0, -40);
    group.add(backplate);
    // Handler-less bodies IN FRONT of the backplate (z up to +30).
    for (let i = 0; i < 9; i++) {
      const body = new Mesh(new SphereGeometry(36, 12, 8), new MeshBasicMaterial());
      body.position.set(0, 0, ((i % 3) - 1) * 30);
      group.add(body);
    }
    rig.mountIsland(shapes, group);

    // Press at the card centre → the backplate claims it (engine must not drag).
    expect(rig.router.route("down", 264.5, 272.5, rig.ev(1, 1))).toBe(true);
    expect(downs).toEqual(["0,0"]); // island-local centre (Y-up)

    // Captured move → onPointerMove fires with an island-local point (the repel).
    rig.router.route("move", 300, 300, rig.ev(1, 1));
    expect(moves.length).toBeGreaterThan(0);

    // Release on the same object → a click (accent cycle).
    rig.router.route("up", 264.5, 272.5, rig.ev(1, 0));
    expect(clicks).toBe(1);
  });
});
