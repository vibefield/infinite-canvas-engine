/**
 * M8 node-editor exit criteria (design-004 §6 ports & wires, design-003 §5.8
 * connect). Full stack via `installInteractionStack` — REAL picking, the shared
 * spatial index, wire sync + port materialization + the connect gesture wired in
 * the §5 in-phase order. An "armed" reflector arms strata's access enforcement
 * (undeclared value writes DEV-throw here, not first in the browser).
 *
 * Node types are `defineWidget`'d for their PORT DECLS (the connect/port/wire
 * systems resolve decls by PrefabId → registry); the node ENTITIES are plain
 * spawns stamped with PrefabId + Selectable/Movable (no equip system installed).
 */
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ActiveTool,
  Camera,
  Movable,
  NO_MODS,
  PortOf,
  Port,
  Position,
  PrefabId,
  Selectable,
  Size,
  StackZ,
  Viewport,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  cascadeDestroy,
  createDocSession,
  createEngine,
  createRecordingCommitSink,
  defineWidget,
  installInteractionStack,
  type CommitSink,
  type DocSession,
} from "../../src";
import { SpatialVersion } from "../../src/helpers/version-stamps";
import { __resetWidgetsForTests } from "../../src/widget/define-widget";
import { __resetPrefabsForTests } from "../../src/schema/prefab";

// --- node types (declared once per isolated test file) -----------------------

function defineNodeTypes(): void {
  // out port on the east edge; accepts "num".
  defineWidget({
    type: "m8-src",
    surface: "dom",
    component: {},
    ports: [{ id: "out", side: "e", accepts: ["num"] }],
  });
  // in port on the west edge; accepts "num" → compatible with m8-src/out.
  defineWidget({
    type: "m8-dst",
    surface: "dom",
    component: {},
    ports: [{ id: "in", side: "w", accepts: ["num"] }],
  });
  // in port accepting only "str" → INCOMPATIBLE with m8-src/out.
  defineWidget({
    type: "m8-bad",
    surface: "dom",
    component: {},
    ports: [{ id: "in", side: "w", accepts: ["str"] }],
  });
  // wildcard single port (empty accepts) — the crowd for staging/pan traces.
  defineWidget({
    type: "m8-node",
    surface: "dom",
    component: {},
    ports: [{ id: "p", side: "e", accepts: [] }],
  });
}

// East/west single-port anchors are the edge midpoint (kernel portAnchor, count 1).
const eastAnchor = (x: number, y: number, w: number, h: number): [number, number] => [x + w, y + h / 2];
const westAnchor = (x: number, y: number, _w: number, h: number): [number, number] => [x, y + h / 2];

const wireQ = defineQuery([Wire, WirePorts]);
const portQ = defineQuery([Port]);
const nodeQ = defineQuery([PrefabId, Position]);

interface GraphRig {
  world: World;
  stack: ReturnType<typeof installInteractionStack>;
  recorder: ReturnType<typeof createRecordingCommitSink>;
  session?: DocSession;
  step(n?: number): void;
  setTool(id: string): void;
  down(x: number, y: number, button?: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  /** Port entities materialized for a widget (PortOf reverse). */
  portsOf(widget: Entity): Entity[];
}

function makeGraphRig(opts: { doc?: boolean } = {}): GraphRig {
  const world = createWorld();
  const engine = createEngine(world);
  const recorder = createRecordingCommitSink();
  const sinkRef: { target?: CommitSink } = {};
  // Tee: the recorder always sees intents (assertions); the doc sink (when a
  // session is attached) turns them into real transactions.
  const stack = installInteractionStack(engine, {
    sink: {
      commit: (i) => {
        recorder.commit(i as never);
        sinkRef.target?.commit(i as never);
      },
    },
  });
  engine.registerReflector({ name: "armed", always: false, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  world.setResource(Viewport, { w: 2000, h: 2000, dpr: 1 });

  let session: DocSession | undefined;
  if (opts.doc) {
    session = createDocSession(world);
    sinkRef.target = session.sink;
  }

  let now = 1000;
  const held = { buttons: 0 };
  const enqueue = (kind: "down" | "move" | "up", x: number, y: number): void => {
    stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: held.buttons, mods: NO_MODS });
  };

  return {
    world,
    stack,
    recorder,
    ...(session !== undefined ? { session } : {}),
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    },
    setTool: (id) => world.setResource(ActiveTool, { id }),
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
    portsOf(widget) {
      const out: Entity[] = [];
      world.query(portQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (world.getRelation(p, PortOf) === widget) out.push(p);
        }
      });
      return out;
    },
  };
}

/** A runtime node stamped with PrefabId + capability tags (no equip system here). */
function spawnNode(world: World, type: string, x: number, y: number, w = 80, h = 60): Entity {
  return world.spawn({
    components: [
      [PrefabId, { id: type }],
      [Position, { x, y }],
      [Size, { w, h }],
      [StackZ, { z: 0 }],
    ],
    tags: [Selectable, Movable],
  });
}

/** A DURABLE node through the doc (so wire commit + cascade act on the doc). The
 *  handle is resolved by the caller after sync via {@link nodeAt}. */
function spawnDocNode(session: DocSession, type: string, x: number, y: number): void {
  session.store.transaction((tx) => {
    tx.spawn({
      components: [
        [PrefabId, { id: type }],
        [Position, { x, y }],
        [Size, { w: 80, h: 60 }],
        [StackZ, { z: 0 }],
      ],
    });
  });
}

function countPorts(world: World): number {
  let n = 0;
  world.query(portQ).each((b) => {
    for (const _r of b) n++;
  });
  return n;
}

function nodeAt(world: World, x: number): Entity {
  let found: Entity | undefined;
  world.query(nodeQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (world.read(e, Position).x === x) {
        found = e;
        return;
      }
    }
  });
  if (found === undefined) throw new Error(`no node at x=${x}`);
  return found;
}

function firstWire(world: World): Entity | undefined {
  let found: Entity | undefined;
  world.query(wireQ).each((b) => {
    for (const r of b) {
      found = b.entity(r);
      return;
    }
  });
  return found;
}

beforeEach(() => {
  __resetWidgetsForTests();
  __resetPrefabsForTests();
  defineNodeTypes();
});

describe("M8 connect gesture", () => {
  it("1. happy path — drag source port → target port commits ONE wire that the doc sink places", () => {
    const rig = makeGraphRig({ doc: true });
    const session = rig.session as DocSession;
    spawnDocNode(session, "m8-src", 100, 100);
    spawnDocNode(session, "m8-dst", 400, 100);
    rig.step(); // project the durable nodes into runtime
    const a = nodeAt(rig.world, 100);
    const b = nodeAt(rig.world, 400);
    rig.world.addTag(a, Selectable);
    rig.world.addTag(a, Movable);
    rig.world.addTag(b, Selectable);
    rig.world.addTag(b, Movable);

    rig.setTool("connect");
    rig.step(3); // trigger (a) materializes + indexes both nodes' ports; picking sees them

    const [sx, sy] = eastAnchor(100, 100, 80, 60); // (180, 130)
    const [tx, ty] = westAnchor(400, 100, 80, 60); // (400, 130)

    rig.down(sx, sy); // captures the source out-port (port pick tier)
    rig.step();
    rig.move(sx + 15, sy); // exits slop → Active → RoutedConnect
    rig.step();
    rig.move(tx, ty); // over the target in-port
    rig.step();
    rig.up(tx, ty);
    rig.step(); // JustEnded → connect commit (doc sink spawns the wire)

    const connects = rig.recorder.intents.filter((i) => i.kind === "connect");
    expect(connects).toHaveLength(1);
    const wireSpawn = connects[0]?.wires?.[0];
    expect(wireSpawn).toEqual({ from: a, to: b, fromPort: "out", toPort: "in" });

    rig.step(2); // wire structure projects at sync
    const wire = firstWire(rig.world);
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    expect(rig.world.read(wire, WirePorts)).toEqual({ from: "out", to: "in" });
    expect(rig.world.getRelation(wire, WireFrom)).toBe(a);
    expect(rig.world.getRelation(wire, WireTo)).toBe(b);
  });

  it("2. incompatible ports — no intent, preview cleared", () => {
    const rig = makeGraphRig();
    spawnNode(rig.world, "m8-src", 100, 100);
    spawnNode(rig.world, "m8-bad", 400, 100); // accepts ["str"] — no overlap with ["num"]
    rig.setTool("connect");
    rig.step(3);

    const [sx, sy] = eastAnchor(100, 100, 80, 60);
    const [tx, ty] = westAnchor(400, 100, 80, 60);

    rig.down(sx, sy);
    rig.step();
    rig.move(sx + 15, sy);
    rig.step();
    rig.move(tx, ty); // over the incompatible in-port
    rig.step();
    expect(rig.stack.wirePreview.active).toBe(true);
    expect(rig.stack.wirePreview.compatible).toBe(false); // never snaps
    rig.up(tx, ty);
    rig.step(); // JustEnded over incompatible → nothing commits

    expect(rig.recorder.intents.filter((i) => i.kind === "connect")).toHaveLength(0);
    rig.step(); // JustEnded+1 → preview clears
    expect(rig.stack.wirePreview.active).toBe(false);
    expect(firstWire(rig.world)).toBeUndefined();
  });

  it("6. port pick tier — a port over the widget body routes CONNECT, not move", () => {
    // Select tool + a MOVABLE node: without the port tier this drag would move.
    const rig = makeGraphRig();
    const a = spawnNode(rig.world, "m8-src", 100, 100);
    rig.setTool("select");
    const [sx, sy] = eastAnchor(100, 100, 80, 60); // (180,130) — on the node's edge/body

    // Hover the node so trigger (b) materializes its port, then let picking see it.
    rig.move(140, 130); // over the body
    rig.step(2);
    rig.move(sx, sy); // over the port anchor
    rig.step();
    expect(rig.portsOf(a).length).toBe(1); // materialized by hover

    rig.down(sx, sy); // TouchesExact resolves the PORT (tier), not the body
    rig.step();
    rig.move(sx + 15, sy); // claims → dragRoute honors the port capture
    rig.step();

    // The recognizer routed CONNECT (connectClaim latched a source port → preview
    // armed). Had it routed MOVE, the movable node would have moved — assert it
    // did NOT, and that no wire exists yet (nothing committed on a live drag).
    expect(rig.stack.wirePreview.active).toBe(true);
    expect(rig.world.read(a, Position)).toEqual({ x: 100, y: 100 });
    expect(firstWire(rig.world)).toBeUndefined();
  });
});

describe("M8 port materialization budget & churn", () => {
  it("3. zero-churn pan — select tool, 30-frame middle-button pan spawns ZERO ports; SpatialVersion idle-stable", () => {
    const rig = makeGraphRig();
    for (let i = 0; i < 10; i++) spawnNode(rig.world, "m8-node", 100 + (i % 5) * 100, 100 + Math.floor(i / 5) * 100, 40, 30);
    rig.setTool("select");
    rig.step(2);

    const spawned: Entity[] = [];
    rig.world.observe({ onSpawn: (e) => spawned.push(e) });

    // Middle-button pan on empty canvas, far from every node.
    rig.down(1500, 1500, 4);
    rig.step();
    for (let f = 0; f < 30; f++) {
      rig.move(1500 - f * 2, 1500 - f * 2);
      rig.step();
    }
    rig.up(1440, 1440);
    rig.step();

    const portSpawns = spawned.filter((e) => rig.world.isAlive(e) && rig.world.has(e, Port));
    expect(portSpawns).toHaveLength(0);

    // SpatialVersion is stable across idle frames after the pan (no node moved,
    // no port churned — camera-only motion never bumps it).
    const v0 = rig.world.getResource(SpatialVersion)?.v;
    rig.step(3);
    expect(rig.world.getResource(SpatialVersion)?.v).toBe(v0);
  });

  it("4. light-up staging — connect drag among 300+ ported widgets: ≤64 spawns/frame, only near ports materialize", () => {
    const rig = makeGraphRig();
    // A dense cluster (all within the light-up radius of its center) + a source
    // node beside it + one far node well outside the radius.
    const cols = 20;
    const rows = 15; // 300 nodes
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < rows; rr++) {
        spawnNode(rig.world, "m8-node", 1000 + c * 30, 1000 + rr * 30, 20, 12);
      }
    }
    const src = spawnNode(rig.world, "m8-src", 900, 1200, 80, 60);
    const far = spawnNode(rig.world, "m8-node", 8000, 8000, 20, 12);
    rig.setTool("select");

    // Materialize the source port by hovering, then start the connect from it.
    rig.move(940, 1230); // over the source body
    rig.step(2);
    const [sx, sy] = eastAnchor(900, 1200, 80, 60); // (980, 1230)
    rig.move(sx, sy);
    rig.step();
    expect(rig.portsOf(src).length).toBe(1);

    rig.down(sx, sy);
    rig.step();
    rig.move(sx + 15, sy); // claim → RoutedConnect
    rig.step();
    rig.move(1300, 1225); // pointer into the cluster centre
    rig.step();

    // Hold the drag: staging fills the light-up over several frames, ≤64 each.
    const spawned: Entity[] = [];
    rig.world.observe({ onSpawn: (e) => spawned.push(e) });
    let maxPerFrame = 0;
    let total = 0;
    for (let f = 0; f < 8; f++) {
      const before = spawned.length;
      rig.move(1300, 1225); // keep the pointer (and the light-up centre) put
      rig.step();
      let framePorts = 0;
      for (let i = before; i < spawned.length; i++) {
        const e = spawned[i];
        if (e !== undefined && rig.world.isAlive(e) && rig.world.has(e, Port)) framePorts++;
      }
      maxPerFrame = Math.max(maxPerFrame, framePorts);
      total += framePorts;
    }

    expect(maxPerFrame).toBeLessThanOrEqual(64); // spawn budget respected
    expect(total).toBeGreaterThan(64); // staging actually happened (multi-frame fill)
    // Only near ports materialized: the far node (outside the radius) has none,
    // while the light-up near the pointer lit many.
    expect(rig.portsOf(far)).toHaveLength(0);
    expect(countPorts(rig.world)).toBeGreaterThan(64);
  });
});

describe("M8 wire cascade (doc-level)", () => {
  it("5. destroying an endpoint cascades the wire away", () => {
    const rig = makeGraphRig({ doc: true });
    const session = rig.session as DocSession;
    spawnDocNode(session, "m8-src", 100, 100);
    spawnDocNode(session, "m8-dst", 400, 100);
    rig.step();
    const a = nodeAt(rig.world, 100);
    const b = nodeAt(rig.world, 400);
    for (const n of [a, b]) {
      rig.world.addTag(n, Selectable);
      rig.world.addTag(n, Movable);
    }

    rig.setTool("connect");
    rig.step(3);
    const [sx, sy] = eastAnchor(100, 100, 80, 60);
    const [tx, ty] = westAnchor(400, 100, 80, 60);
    rig.down(sx, sy);
    rig.step();
    rig.move(sx + 15, sy);
    rig.step();
    rig.move(tx, ty);
    rig.step();
    rig.up(tx, ty);
    rig.step(2); // commit + project the wire

    const wire = firstWire(rig.world);
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    expect(rig.world.isAlive(wire)).toBe(true);

    // Destroy endpoint A inside a doc transaction — the cascade takes the wire.
    session.store.transaction((tx2) => {
      cascadeDestroy(tx2, rig.world, a);
    });
    rig.step(2); // structural despawns land at sync

    expect(rig.world.isAlive(a)).toBe(false);
    expect(rig.world.isAlive(wire)).toBe(false); // wire cascaded with its endpoint
  });
});
