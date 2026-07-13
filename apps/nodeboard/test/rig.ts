/**
 * Shared headless rig for the node-board behavior tests: the REAL engine wiring
 * the app boots (interaction stack + widget runtime + nested canvas + a durable
 * doc session), minus the DOM reflectors and React mount. Screen == world
 * (identity camera), so synthetic pointer coords ARE world coords — the same
 * idiom as core's trace rigs and gl-board's gl-router test.
 *
 * Nodes are seeded through the app's exported `spawnMathNode` / `spawnSumNode` /
 * `spawnGroupNode` helpers, so these tests exercise the demo's actual spawn +
 * equip + membership path (capability tags + `Active` land one frame after
 * projection — step a couple frames before driving input).
 */
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  type Entity,
  NO_MODS,
  Position,
  Size,
  Viewport,
  type World,
  createDocSession,
  createEngine,
  createNestedCanvas,
  createRecordingCommitSink,
  createWorld,
  installInteractionStack,
  installWidgetRuntime,
  writeRuntimeResource,
} from "@ice/core";
import type { Rect } from "@ice/kernel";

export interface Rig {
  world: World;
  session: DocSession;
  stack: ReturnType<typeof installInteractionStack>;
  nav: ReturnType<typeof createNestedCanvas>;
  recorder: ReturnType<typeof createRecordingCommitSink>;
  step(n?: number): void;
  setTool(id: string): void;
  down(x: number, y: number, button?: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  /** World rect of a widget (Position + Size) for kernel `portAnchor`. */
  rectOf(e: Entity): Rect;
}

export function makeRig(): Rig {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  world.setResource(Viewport, { w: 2000, h: 2000, dpr: 1 });
  const engine = createEngine(world);

  const recorder = createRecordingCommitSink();
  const sinkRef: { target?: CommitSink } = {};
  const stack = installInteractionStack(engine, {
    sink: {
      commit: (i) => {
        recorder.commit(i as never);
        sinkRef.target?.commit(i as never);
      },
    },
  });
  installWidgetRuntime(engine); // installs activeMembership (design-004 §7)
  const nav = createNestedCanvas(world, { index: stack.index, clearSpatialCaches: () => stack.clearCaches() });
  engine.addSystems("react", nav.navIntegrity);
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} }); // arm strata access enforcement

  const session = createDocSession(world);
  sinkRef.target = session.sink;
  writeRuntimeResource(world, ActiveTool, { id: "select" });

  let now = 1000;
  const held = { buttons: 0 };
  const enqueue = (kind: "down" | "move" | "up", x: number, y: number): void => {
    stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: held.buttons, mods: NO_MODS });
  };

  return {
    world,
    session,
    stack,
    nav,
    recorder,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    },
    setTool: (id) => writeRuntimeResource(world, ActiveTool, { id }),
    down(x, y, button = 1) {
      held.buttons |= button;
      enqueue("down", x, y);
    },
    move(x, y) {
      enqueue("move", x, y);
    },
    up(x, y) {
      held.buttons = 0;
      enqueue("up", x, y);
    },
    rectOf(e) {
      const p = world.read(e, Position);
      const s = world.read(e, Size);
      return { x: p.x, y: p.y, width: s.w, height: s.h };
    },
  };
}
