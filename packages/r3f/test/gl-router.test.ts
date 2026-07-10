/**
 * Router GL path traces (design-004 §4; M7 exit "first-tap-on-GL-widget").
 *
 * The full-stack trace drives the REAL interaction stack (real picking, real
 * spatial index, armed enforcement) with the router in front, mirroring the
 * adapter contract: `route()` first, the fact enqueues `surfaceHandled` when
 * island content claimed it. The rev-1 defect this pins: routing decisions
 * come from the router's own synchronous pick, never last-frame `Targets` —
 * so the FIRST tap on an interactive GL widget reaches its handler.
 *
 * Islands here are real three scenes; handlers ride `object.__r3f` exactly
 * as R3F v9 attaches them (the dispatcher's one internal-adjacent seam).
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "@vibecook/strata-ecs";
import { Mesh, type Object3D, OrthographicCamera, PlaneGeometry, Scene } from "three";
import {
  Camera,
  NO_MODS,
  Position,
  PrefabId,
  Selectable,
  Selected,
  Size,
  StackZ,
  Visible,
  createEngine,
  createRecordingCommitSink,
  defineWidget,
  installInteractionStack,
  widgets,
  type Entity,
} from "@ice/core";
import { createGLBridge } from "../src/bridge";
import { createGLPointerRouter, type IslandPointerEvent } from "../src/gl-router";

const PAD =
  widgets.get("trace:gl-pad") ??
  defineWidget({ type: "trace:gl-pad", surface: "gl", component: () => null });

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
  const engine = createEngine(world);
  const sink = createRecordingCommitSink();
  const stack = installInteractionStack(engine, { sink });
  engine.registerReflector({ name: "armed", always: false, flush: () => {} }); // arm enforcement like a real app
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  const bridge = createGLBridge(engine);
  const router = createGLPointerRouter({ world, bridge, index: stack.index });

  let now = 1000;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  /** The adapter contract: route first, enqueue flagged when claimed. */
  const mouse = (kind: "down" | "move" | "up" | "cancel", x: number, y: number, buttons: number): boolean => {
    const handled = router.route(kind, x, y, { pointerId: 1, buttons } as PointerEvent);
    stack.queue.enqueue({
      kind,
      pointerId: "mouse",
      device: "mouse",
      screenX: x,
      screenY: y,
      buttons,
      mods: NO_MODS,
      ...(handled ? { surfaceHandled: true } : {}),
    });
    return handled;
  };
  const spawnPad = (x: number, y: number, w = 100, h = 100): Entity =>
    world.spawn({
      components: [
        [Position, { x, y }],
        [Size, { w, h }],
        [StackZ, { z: 0 }],
        [PrefabId, { id: PAD.type }],
      ],
      tags: [Selectable, Visible],
    });
  const mountIsland = (e: Entity, content: Object3D): void => {
    const scene = new Scene();
    scene.add(content);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    bridge.registerIsland(e, { scene, camera });
  };
  return { world, engine, stack, bridge, router, step, mouse, spawnPad, mountIsland };
}

describe("first tap on an interactive GL widget (M7 exit)", () => {
  it("reaches the handler at DOWN (no Targets warm-up) and suppresses select", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100);
    const log: string[] = [];
    rig.mountIsland(
      pad,
      withHandlers(new Mesh(new PlaneGeometry(100, 100)), {
        onPointerDown: (ev) => {
          log.push(`down@${ev.point?.x.toFixed(0)},${ev.point?.y.toFixed(0)}`);
          ev.stopPropagation();
        },
      }),
    );
    rig.step(); // spatial index picks up the widget — but NO pointer has ever existed

    // THE first tap: no pointer entity, no Targets edge — router must hit.
    const handled = rig.mouse("down", 150, 150, 1); // widget center
    expect(handled).toBe(true);
    expect(log).toEqual(["down@0,0"]); // island-local center (Y-up, origin center)
    rig.step();
    rig.mouse("up", 150, 150, 0);
    rig.step();
    // The claimed tap NEVER became a canvas gesture: no selection.
    expect(rig.world.hasTag(pad, Selected)).toBe(false);
  });

  it("a NON-stopping handler lets the canvas gesture proceed — tap selects (composability)", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100);
    const log: string[] = [];
    rig.mountIsland(
      pad,
      withHandlers(new Mesh(new PlaneGeometry(100, 100)), {
        onPointerDown: () => log.push("saw-down"), // observes, does not claim
      }),
    );
    rig.step();

    expect(rig.mouse("down", 150, 150, 1)).toBe(false);
    rig.step();
    rig.mouse("up", 150, 150, 0);
    rig.step();
    expect(log).toEqual(["saw-down"]);
    expect(rig.world.hasTag(pad, Selected)).toBe(true); // normal tap→select
  });

  it("tap on a GL widget with no interactive content selects it (plain widget)", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100);
    rig.mountIsland(pad, new Mesh(new PlaneGeometry(100, 100))); // no handlers
    rig.step();
    expect(rig.mouse("down", 150, 150, 1)).toBe(false);
    rig.step();
    rig.mouse("up", 150, 150, 0);
    rig.step();
    expect(rig.world.hasTag(pad, Selected)).toBe(true);
  });
});

describe("island capture (claimed down owns move/up)", () => {
  it("moves and up route to the island; click pairs on the claiming object", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100);
    const log: string[] = [];
    rig.mountIsland(
      pad,
      withHandlers(new Mesh(new PlaneGeometry(100, 100)), {
        onPointerDown: (ev) => {
          log.push("down");
          ev.stopPropagation();
        },
        onPointerMove: () => log.push("move"),
        onPointerUp: () => log.push("up"),
        onClick: () => log.push("click"),
      }),
    );
    rig.step();

    rig.mouse("down", 150, 150, 1);
    rig.step();
    expect(rig.mouse("move", 155, 152, 1)).toBe(true); // captured
    expect(rig.mouse("move", 400, 400, 1)).toBe(true); // even OFF the widget (capture)
    rig.step();
    expect(rig.mouse("up", 150, 150, 0)).toBe(true);
    rig.step();
    expect(log).toEqual(["down", "move", "move", "up", "click"]);
    // Captured facts were all flagged: the drag never moved the widget.
    expect(rig.world.get(pad, Position)).toEqual({ x: 100, y: 100 });
    // Capture released: the next move routes nowhere.
    expect(rig.mouse("move", 150, 150, 0)).toBe(false);
  });

  it("pointercancel under capture dispatches and releases", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100);
    const log: string[] = [];
    rig.mountIsland(
      pad,
      withHandlers(new Mesh(new PlaneGeometry(100, 100)), {
        onPointerDown: (ev) => ev.stopPropagation(),
        onPointerCancel: () => log.push("cancel"),
        onClick: () => log.push("click"),
      }),
    );
    rig.step();
    rig.mouse("down", 150, 150, 1);
    expect(rig.mouse("cancel", 150, 150, 0)).toBe(true);
    expect(log).toEqual(["cancel"]); // no click from a cancelled press
    expect(rig.mouse("move", 150, 150, 0)).toBe(false);
  });
});

describe("hover synthesis (buttonless moves)", () => {
  it("over/out fire on pick transitions", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100);
    const log: string[] = [];
    rig.mountIsland(
      pad,
      withHandlers(new Mesh(new PlaneGeometry(100, 100)), {
        onPointerOver: () => log.push("over"),
        onPointerOut: () => log.push("out"),
      }),
    );
    rig.step();

    rig.mouse("move", 150, 150, 0); // enter
    rig.mouse("move", 152, 150, 0); // stay — no re-fire
    rig.mouse("move", 500, 400, 0); // leave
    expect(log).toEqual(["over", "out"]);
  });
});

describe("routing boundaries", () => {
  it("empty canvas and culled (unmounted) islands never route", () => {
    const rig = makeRig();
    const pad = rig.spawnPad(100, 100); // NO island mounted (culled)
    rig.step();
    expect(rig.mouse("down", 150, 150, 1)).toBe(false); // retained texture is not interactive
    rig.step();
    rig.mouse("up", 150, 150, 0);
    rig.step();
    expect(rig.world.hasTag(pad, Selected)).toBe(true); // still a normal canvas tap
    expect(rig.router.route("down", 700, 500, { pointerId: 2, buttons: 1 } as PointerEvent)).toBe(false);
  });
});
