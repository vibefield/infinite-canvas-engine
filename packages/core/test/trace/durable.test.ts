/**
 * M5 divergence traces (design-001 §3 gesture write protocol against a REAL
 * second peer): remote edit to a dragged cell is HELD during the gesture and
 * released per outcome — committer-wins on commit, remote-lands on cancel —
 * plus per-gesture undo steps and undo-restores-selection (history hooks).
 *
 * Commits flow through the REAL `createDocCommitSink` (late-bound into the
 * rig's tee — the session needs the rig's world, so the sink target is set
 * right after construction). Peer B is a bare world + attached store; the
 * "network" is a hand-pumped snapshot relay (loro imports dedupe, so full
 * snapshots are a valid dumb relay — M9 brings update-mode + bootstrap).
 */
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Accepts,
  Camera,
  Container,
  Movable,
  NO_MODS,
  Position,
  Selectable,
  Selected,
  Size,
  StackZ,
  cancelActiveGestures,
  createDocSession,
  createEngine,
  installInteractionStack,
  type CommitSink,
  type DocSession,
} from "../../src";
import { createTraceRig, type TraceRig } from "./rig";

const boxQ = defineQuery([Position, Size]);

interface DuoRig {
  rig: TraceRig;
  session: DocSession;
  worldB: World;
  sessionB: DocSession;
  /** Ship all pending state both ways and project on both worlds. */
  pump(): void;
  /** Spawn a durable box through the doc (one tx), pump, return both handles. */
  spawnBox(x: number, y: number): { onA: Entity; onB: Entity };
}

function createDuo(): DuoRig {
  // Late-bound sink: the rig needs a sink at construction, the doc session
  // needs the rig's world — the ref closes the loop with the REAL doc sink.
  const sinkRef: { target?: CommitSink } = {};
  const rig = createTraceRig({ sink: { commit: (i) => sinkRef.target?.commit(i as never) } });
  const session = createDocSession(rig.world);
  sinkRef.target = session.sink;

  // Peer B: bare world + its own session (no engine; manual world.sync()).
  const worldB = createWorld();
  const sessionB = createDocSession(worldB);

  const pump = (): void => {
    sessionB.applyRemote(session.exportSnapshot());
    session.applyRemote(sessionB.exportSnapshot());
    worldB.sync();
    rig.step(); // engine.step syncs + ticks peer A
  };

  const findOn = (world: World, x: number, y: number): Entity => {
    let found: Entity | undefined;
    world.query(boxQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        const p = world.read(e, Position);
        if (p.x === x && p.y === y) {
          found = e;
          return;
        }
      }
    });
    if (found === undefined) throw new Error(`no box at ${x},${y}`);
    return found;
  };

  return {
    rig,
    session,
    worldB,
    sessionB,
    pump,
    spawnBox(x, y) {
      session.store.transaction((tx) => {
        tx.spawn({ components: [[Position, { x, y }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
      });
      rig.step(); // structure lands at sync
      const onA = findOn(rig.world, x, y);
      rig.world.addTag(onA, Selectable); // capability tags are runtime riders here
      rig.world.addTag(onA, Movable);
      pump();
      const onB = findOn(worldB, x, y);
      return { onA, onB };
    },
  };
}

describe("durable trace: remote edit to a dragged cell", () => {
  it("is HELD during the drag and superseded by the commit (committer-wins)", () => {
    const { rig, worldB, sessionB, pump, spawnBox } = createDuo();
    const { onA, onB } = spawnBox(100, 100);

    rig.target("mouse", onA);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.move("mouse", 125, 110); // claim frame
    rig.step();
    rig.move("mouse", 145, 110); // +20 past dead-zone exit
    rig.step();
    expect(rig.world.read(onA, Position)).toEqual({ x: 120, y: 100 });

    // B edits the SAME cell remotely mid-drag.
    sessionB.store.transaction((tx) => {
      tx.edit(onB).set(Position, { x: 999, y: 999 });
    });
    pump();
    // Divergence-is-the-signal: A's runtime keeps the drag value; remote is held.
    expect(rig.world.read(onA, Position)).toEqual({ x: 120, y: 100 });

    // Up → moveBehavior emits ONE intent → the REAL doc sink commits in-system.
    rig.up("mouse", 145, 110);
    rig.step();
    expect(rig.sink.intents.at(-1)?.kind).toBe("move");
    pump();
    pump();
    // Committer wins on both peers.
    expect(rig.world.read(onA, Position)).toEqual({ x: 120, y: 100 });
    expect(worldB.read(onB, Position)).toEqual({ x: 120, y: 100 });
  });

  it("is HELD during the drag and LANDS after a cancel reconverges the cell", () => {
    const { rig, worldB, sessionB, pump, spawnBox } = createDuo();
    const { onA, onB } = spawnBox(100, 100);

    rig.target("mouse", onA);
    rig.down("mouse", 110, 110);
    rig.step();
    rig.move("mouse", 125, 110);
    rig.step();
    rig.move("mouse", 145, 110);
    rig.step();

    sessionB.store.transaction((tx) => {
      tx.edit(onB).set(Position, { x: 999, y: 999 });
    });
    pump();
    expect(rig.world.read(onA, Position)).toEqual({ x: 120, y: 100 }); // held

    cancelActiveGestures(rig.world);
    rig.step(); // sweep → Cancelled → restore to Grab origin → cell reconverges
    pump();
    // The held remote value releases and lands — never lose remote data.
    expect(rig.world.read(onA, Position)).toEqual({ x: 999, y: 999 });
    expect(worldB.read(onB, Position)).toEqual({ x: 999, y: 999 });
  });
});

describe("durable trace: fly-back reconvergence (design-003 decision 13)", () => {
  it("rejected drop commits NOTHING; the tween holds the cell diverged until arrival, then the held remote lands", () => {
    // Full stack (drop + tween) with the REAL doc sink late-bound.
    const world = createWorld();
    const engine = createEngine(world);
    const sinkRef: { target?: CommitSink } = {};
    const stack = installInteractionStack(engine, {
      sink: { commit: (i) => sinkRef.target?.commit(i as never) },
    });
    const session = createDocSession(world);
    sinkRef.target = session.sink;
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });

    const worldB = createWorld();
    const sessionB = createDocSession(worldB);
    let now = 1000;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    };
    const pump = (): void => {
      sessionB.applyRemote(session.exportSnapshot());
      session.applyRemote(sessionB.exportSnapshot());
      worldB.sync();
      step();
    };
    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
      stack.queue.enqueue({
        kind,
        pointerId: "mouse",
        device: "mouse",
        screenX: x,
        screenY: y,
        buttons,
        mods: NO_MODS,
      });
    };

    // Durable box; runtime container that does NOT accept it (no Provides ⇒ mismatch).
    session.store.transaction((tx) => {
      tx.spawn({
        components: [[Position, { x: 100, y: 100 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]],
      });
    });
    step();
    let onA: Entity | undefined;
    world.query(boxQ).each((b) => {
      for (const r of b) {
        if (world.read(b.entity(r), Position).x === 100) onA = b.entity(r);
      }
    });
    if (onA === undefined) throw new Error("box missing");
    world.addTag(onA, Selectable);
    world.addTag(onA, Movable);
    world.spawn({
      components: [
        [Position, { x: 400, y: 80 }],
        [Size, { w: 240, h: 200 }],
        [StackZ, { z: -1 }],
        [Accepts, { list: '["cards"]' }],
      ],
      tags: [Container],
    });
    pump();
    let onB: Entity | undefined;
    worldB.query(boxQ).each((b) => {
      for (const r of b) {
        if (worldB.read(b.entity(r), Position).x === 100) onB = b.entity(r);
      }
    });
    if (onB === undefined) throw new Error("peer copy missing");

    // Drag the box onto the container and release — rejected drop.
    mouse("down", 120, 120, 1);
    step();
    mouse("move", 140, 130, 1);
    step();
    mouse("move", 500, 170, 1); // over the container
    step();
    mouse("up", 500, 170, 0);
    step();
    // NO commit — fly-back instead (TransformTween now easing home).
    expect(session.store.getComponent(onA, Position)).toEqual({ x: 100, y: 100 }); // doc untouched
    expect(world.read(onA, Position).x).not.toBe(100); // runtime mid-flight

    // Remote edit mid-tween: held (the tween IS the diverging authority).
    sessionB.store.transaction((tx) => {
      const target = onB;
      if (target !== undefined) tx.edit(target).set(Position, { x: 999, y: 999 });
    });
    pump();
    expect(world.read(onA, Position).x).not.toBe(999); // still held

    step(20); // tween lands (200ms), cell reconverges with baseline
    pump();
    pump();
    // Held remote releases and lands on both peers.
    expect(world.read(onA, Position)).toEqual({ x: 999, y: 999 });
    expect(worldB.read(onB, Position)).toEqual({ x: 999, y: 999 });
  });
});

describe("durable trace: undo", () => {
  it("gives one undo step per gesture and restores the captured selection", () => {
    const { rig, session, spawnBox } = createDuo();
    const { onA } = spawnBox(100, 100);
    const { onA: otherA } = spawnBox(400, 100);

    const dragBy = (target: Entity, fromX: number, dx: number): void => {
      rig.target("mouse", target);
      rig.down("mouse", fromX, 110);
      rig.step();
      rig.move("mouse", fromX + 15, 110);
      rig.step();
      rig.move("mouse", fromX + 15 + dx, 110);
      rig.step();
      rig.up("mouse", fromX + 15 + dx, 110);
      rig.step(2); // commit frame + reap
    };

    dragBy(onA, 110, 20); // gesture 1: box 1 → x 120; selection {box1} captured
    dragBy(otherA, 410, 30); // gesture 2: box 2 → x 430; selection {box2} captured
    expect(rig.world.read(onA, Position).x).toBe(120);
    expect(rig.world.read(otherA, Position).x).toBe(430);
    expect(rig.world.hasTag(otherA, Selected)).toBe(true);
    expect(rig.world.hasTag(onA, Selected)).toBe(false); // replaced by gesture 2's grab

    // Undo #1: reverts ONLY gesture 2; history hooks restore its captured selection.
    expect(session.store.undo()).toBe(true);
    rig.step();
    expect(rig.world.read(otherA, Position).x).toBe(400);
    expect(rig.world.read(onA, Position).x).toBe(120); // gesture 1 untouched

    // Undo #2: reverts gesture 1 and restores ITS captured selection {box1}.
    expect(session.store.undo()).toBe(true);
    rig.step();
    expect(rig.world.read(onA, Position).x).toBe(100);
    expect(rig.world.hasTag(onA, Selected)).toBe(true); // undo restored the selection
  });
});
