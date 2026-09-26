/**
 * The M8 exit tests' rig, on core alone (design-015 §11.6: nodeboard's `cascade` + `port-churn` ported BY NAME
 * at D5a — the cascade and port materialisation are engine facts; nothing about them is React). nodeboard's own
 * `test/rig.ts`, minus the app: the REAL engine wiring a node board boots (interaction stack + widget runtime +
 * nested canvas + a durable doc session), no reflectors, no mount. Screen == world (identity camera), so
 * synthetic pointer coords ARE world coords.
 *
 * The node types are nodeboard's three, declared as desk OBJECTS (`surface: "object"`, an opaque kind binding,
 * no view) with the demo's exact ports, sizes and capabilities; they spawn through the paved road
 * (`spawnWidget`, one store transaction each), so equip + membership run as the app's did — capability tags and
 * `Active` land a frame after projection (step a couple of frames before driving input).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  NO_MODS,
  PrefabId,
  Viewport,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  createDocSession,
  createEngine,
  createNestedCanvas,
  createRecordingCommitSink,
  createWorld,
  defineWidget,
  installInteractionStack,
  installWidgetRuntime,
  p,
  spawnWidget,
  widgets,
  writeRuntimeResource,
} from "../src";

/** An opaque kind binding — core carries it and never reads it (the object-widget precedent). */
const NODE_KIND = Object.freeze({ name: "m8-node" });

/** nodeboard's math-node: a value and ONE east "out" port accepting "number". */
export const MATH_NODE =
  widgets.get("m8:math-node") ??
  defineWidget({
    type: "m8:math-node",
    props: { value: p.number({ default: 1 }) },
    surface: "object",
    object: NODE_KIND,
    defaultSize: { w: 150, h: 84 },
    minSize: { w: 120, h: 70 },
    interaction: { selectable: true, movable: true },
    ports: [{ id: "out", side: "e", accepts: ["number"] }],
    provides: ["node"],
  });

/** nodeboard's sum-node: a west "in" and an east "out", both accepting "number". */
export const SUM_NODE =
  widgets.get("m8:sum-node") ??
  defineWidget({
    type: "m8:sum-node",
    surface: "object",
    object: NODE_KIND,
    defaultSize: { w: 150, h: 84 },
    minSize: { w: 120, h: 70 },
    interaction: { selectable: true, movable: true },
    ports: [
      { id: "in", side: "w", accepts: ["number"] },
      { id: "out", side: "e", accepts: ["number"] },
    ],
    provides: ["node"],
  });

/** Spawn one math-node (top-left `x,y`), optional starting `value` — its own paved-road transaction. */
export function spawnMathNode(store: DocSession["store"], world: World, x: number, y: number, value?: number): Entity {
  return spawnWidget(store, world, MATH_NODE.type, { x, y, ...(value !== undefined ? { props: { value } } : {}) });
}

/** Spawn one sum-node (top-left `x,y`). */
export function spawnSumNode(store: DocSession["store"], world: World, x: number, y: number): Entity {
  return spawnWidget(store, world, SUM_NODE.type, { x, y });
}

/**
 * Seed one wire between two nodes through a store transaction, as the doc commit sink's wire block lays one
 * (design-001 §5.3): a `Wire`-tagged entity with `PrefabId{wire}` + `WirePorts{from,to}` + the
 * `WireFrom`/`WireTo` endpoint relations. Geometry never stores a port entity.
 */
export function seedWire(store: DocSession["store"], from: Entity, fromPort: string, to: Entity, toPort: string): void {
  store.transaction((tx) => {
    const wire = tx.spawn({
      components: [
        [PrefabId, { id: "wire" }],
        [WirePorts, { from: fromPort, to: toPort }],
      ],
      tags: [Wire],
    });
    tx.setRelation(wire, WireFrom, from);
    tx.setRelation(wire, WireTo, to);
  });
}

export interface M8Rig {
  world: World;
  session: DocSession;
  step(n?: number): void;
  setTool(id: string): void;
  down(x: number, y: number, button?: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
}

export function makeM8Rig(): M8Rig {
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
  };
}
