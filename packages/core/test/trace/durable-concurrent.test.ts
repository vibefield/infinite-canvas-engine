/**
 * M5 concurrent editing (design-001 §3; design-005 §6.5 dumb relay) with TWO
 * full peers. Unlike durable.test.ts (where peer B is a bare world), BOTH tabs
 * are complete trace rigs — own world + engine + interaction core + doc session —
 * so each drives a REAL gesture through the REAL loop. Tab A drags widget1 while
 * tab B SIMULTANEOUSLY drags widget2 (the steps interleave); both commit; the
 * snapshot relay is pumped both ways; both worlds converge on BOTH final
 * positions, and each rig recorded exactly its OWN one commit.
 */
import { defineQuery } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Movable,
  Position,
  Selectable,
  Size,
  StackZ,
  createDocSession,
  type CommitSink,
  type DocSession,
} from "../../src";
import { createTraceRig, type TraceRig } from "./rig";

const boxQ = defineQuery([Position, Size]);

function findAt(world: World, x: number, y: number): Entity {
  let found: Entity | undefined;
  world.query(boxQ).each((b) => {
    for (const r of b) {
      const p = world.read(b.entity(r), Position);
      if (p.x === x && p.y === y) found = b.entity(r);
    }
  });
  if (found === undefined) throw new Error(`no box at ${x},${y}`);
  return found;
}

interface Duo {
  rigA: TraceRig;
  rigB: TraceRig;
  sessionA: DocSession;
  sessionB: DocSession;
  /** Relay both snapshots both ways and tick both engines (project the merge). */
  pump(): void;
}

function createDuoRigs(): Duo {
  const refA: { target?: CommitSink } = {};
  const rigA = createTraceRig({ sink: { commit: (i) => refA.target?.commit(i as never) } });
  const sessionA = createDocSession(rigA.world);
  refA.target = sessionA.sink;

  const refB: { target?: CommitSink } = {};
  const rigB = createTraceRig({ sink: { commit: (i) => refB.target?.commit(i as never) } });
  const sessionB = createDocSession(rigB.world);
  refB.target = sessionB.sink;

  const pump = (): void => {
    // Full snapshots dedupe on import, so a dumb both-ways relay converges (M5).
    sessionB.applyRemote(sessionA.exportSnapshot());
    sessionA.applyRemote(sessionB.exportSnapshot());
    rigA.step();
    rigB.step();
  };

  return { rigA, rigB, sessionA, sessionB, pump };
}

describe("durable concurrent trace: two full rigs, simultaneous drags", () => {
  it("A drags widget1 while B drags widget2 → both worlds converge on both positions; one commit each", () => {
    const { rigA, rigB, sessionA, pump } = createDuoRigs();

    // Two durable widgets, authored on A, relayed to B (common baseline).
    sessionA.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 100, y: 100 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
      tx.spawn({ components: [[Position, { x: 400, y: 100 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
    });
    rigA.step(); // project structure on A
    pump(); // relay to B + tick both

    const a1 = findAt(rigA.world, 100, 100);
    const a2 = findAt(rigA.world, 400, 100);
    const b1 = findAt(rigB.world, 100, 100);
    const b2 = findAt(rigB.world, 400, 100);

    // Capability tags are runtime riders — stamp each world's own handles.
    for (const [world, e] of [[rigA.world, a1], [rigA.world, a2], [rigB.world, b1], [rigB.world, b2]] as const) {
      world.addTag(e, Selectable);
      world.addTag(e, Movable);
    }
    pump(); // project the riders

    // Interleave the two drags so both gestures are live at once.
    rigA.target("mouse", a1);
    rigB.target("mouse", b2);
    rigA.down("mouse", 110, 110);
    rigA.step();
    rigB.down("mouse", 410, 110);
    rigB.step();
    rigA.move("mouse", 125, 110); // A claims widget1 (15px > slop)
    rigA.step();
    rigB.move("mouse", 425, 110); // B claims widget2
    rigB.step();
    rigA.move("mouse", 145, 110); // A: +20 from its slop-exit
    rigA.step();
    rigB.move("mouse", 445, 110); // B: +20 from its slop-exit
    rigB.step();
    rigA.up("mouse", 145, 110); // A commits widget1 → x 120
    rigA.step();
    rigB.up("mouse", 445, 110); // B commits widget2 → x 420
    rigB.step();

    // Ship both commits both ways and settle.
    pump();
    pump();
    pump();

    // BOTH worlds converge on BOTH final positions (edits to disjoint cells).
    expect(rigA.world.read(a1, Position).x).toBe(120);
    expect(rigA.world.read(a2, Position).x).toBe(420);
    expect(rigB.world.read(b1, Position).x).toBe(120);
    expect(rigB.world.read(b2, Position).x).toBe(420);

    // Each rig recorded EXACTLY its own single commit (its own widget only).
    expect(rigA.sink.intents).toHaveLength(1);
    expect(rigA.sink.intents[0]?.kind).toBe("move");
    expect(rigA.sink.intents[0]?.writes.some((w) => w.entity === a1)).toBe(true);
    expect(rigA.sink.intents[0]?.writes.some((w) => w.entity === a2)).toBe(false);

    expect(rigB.sink.intents).toHaveLength(1);
    expect(rigB.sink.intents[0]?.kind).toBe("move");
    expect(rigB.sink.intents[0]?.writes.some((w) => w.entity === b2)).toBe(true);
    expect(rigB.sink.intents[0]?.writes.some((w) => w.entity === b1)).toBe(false);
  });
});
