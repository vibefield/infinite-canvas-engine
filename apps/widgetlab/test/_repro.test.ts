/**
 * TEMP repro — does an INVISIBLE backplate behind VISIBLE bodies receive the
 * GL router's onPointerDown claim? (ShapesCard structure.) Delete after.
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

void GL_WIDGETS; // register all 7 gl widgets (defineWidget side effects)

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
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
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
  return { world, engine, stack, session, bridge, router, step, mountIsland, ev };
}

describe("repro: invisible backplate behind visible bodies", () => {
  it("backplate onPointerDown fires + claims through the body cloud", () => {
    const rig = makeRig();
    // shapes-card at (100,100), size 329×345 → center (264.5, 272.5).
    const shapes = spawnWidget(rig.session.store, rig.world, "shapes-card", { x: 100, y: 100 }) as Entity;
    rig.step(4);

    const log: string[] = [];
    const group = new Group();
    // Invisible full-card backplate WITH handlers (the interaction surface).
    const backplate = withHandlers(new Mesh(new PlaneGeometry(329, 345), new MeshBasicMaterial({ visible: false })), {
      onPointerDown: (e) => {
        log.push(`down@${e.point?.x.toFixed(0)},${e.point?.y.toFixed(0)}`);
        e.stopPropagation();
      },
      onClick: () => log.push("click"),
    });
    backplate.position.set(0, 0, 0);
    group.add(backplate);
    // 9 VISIBLE bodies, no handlers, some IN FRONT of the backplate (z>0).
    for (let i = 0; i < 9; i++) {
      const body = new Mesh(new SphereGeometry(36, 16, 12), new MeshBasicMaterial());
      body.position.set(0, 0, ((i % 3) - 1) * 18); // z ∈ {-18,0,18}
      group.add(body);
    }
    rig.mountIsland(shapes, group);

    const claimed = rig.router.route("down", 264.5, 272.5, rig.ev(1, 1));
    // up on same object → click
    rig.router.route("up", 264.5, 272.5, rig.ev(1, 0));

    console.log("[repro] claimed:", claimed, "log:", JSON.stringify(log));
    expect(claimed).toBe(true);
    expect(log[0]).toMatch(/^down@/);
    expect(log).toContain("click");
  });
});
