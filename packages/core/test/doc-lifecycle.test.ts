/**
 * M5 document lifecycle — close() and switch (design-001 §6, design-005 §6.1–§6.3;
 * doc-kit close()). close() is an IN-PLACE world reset: entities die with the
 * attachment, systems/observers survive (R3), and the interaction stack's
 * canvas-surface anchor is respawned so the same world keeps ticking. Switching
 * documents is close() then create/open the next on the SAME world.
 */
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  CanvasSurface,
  Position,
  Size,
  StackZ,
  createDocSession,
  createEngine,
  installInteractionCore,
  openDocSession,
} from "../src";

const boxQ = defineQuery([Position, Size]);
const anchorQ = defineQuery([CanvasSurface]);

function countBoxes(world: World): number {
  let n = 0;
  world.query(boxQ).each((b) => {
    n += b.count;
  });
  return n;
}

function countAnchors(world: World): number {
  let n = 0;
  world.query(anchorQ).each((b) => {
    n += b.count;
  });
  return n;
}

function positionsOf(world: World): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  world.query(boxQ).each((b) => {
    for (const r of b) out.push({ ...world.read(b.entity(r), Position) });
  });
  return out.sort((p, q) => p.x - q.x);
}

describe("doc lifecycle: close() then re-create on the same world", () => {
  it("close() clears entities, leaves exactly one canvas anchor, and the world still ticks", () => {
    const world = createWorld();
    const engine = createEngine(world);
    installInteractionCore(engine); // canvas-surface anchor + the spine systems
    const session = createDocSession(world);

    session.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 10, y: 20 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
    });
    engine.step(1000); // project the durable box
    expect(countBoxes(world)).toBe(1);
    expect(countAnchors(world)).toBe(1);

    session.close();
    // The world still ticks after the in-place reset (systems survived R3).
    expect(() => engine.step(1016)).not.toThrow();
    expect(countBoxes(world)).toBe(0); // the doc's entities are gone
    expect(countAnchors(world)).toBe(1); // exactly one anchor was respawned

    // A FRESH session on the SAME world attaches and projects normally.
    const session2 = createDocSession(world);
    session2.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 5, y: 5 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
    });
    engine.step(1032);
    expect(countBoxes(world)).toBe(1);
    expect(countAnchors(world)).toBe(1);

    // The OLD (closed) session's store is detached — undo() is inert here, never
    // throws, and cannot disturb the live session's world (documented behavior).
    expect(() => session.store.undo()).not.toThrow();
    engine.step(1048);
    expect(countBoxes(world)).toBe(1); // unchanged: still session2's single box
  });
});

describe("doc lifecycle: switch A → B on one world", () => {
  it("close A, open B from A's exported envelope → entities reappear with the same Positions", () => {
    const world = createWorld();
    const engine = createEngine(world);
    installInteractionCore(engine);
    const sessionA = createDocSession(world);

    sessionA.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 42, y: 7 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
      tx.spawn({ components: [[Position, { x: 200, y: 90 }], [Size, { w: 80, h: 60 }], [StackZ, { z: 0 }]] });
    });
    engine.step(1000);
    expect(positionsOf(world)).toEqual([{ x: 42, y: 7 }, { x: 200, y: 90 }]);

    // Snapshot A, close it, open a NEW session from that snapshot on the SAME world.
    const envelope = sessionA.exportEnvelope(123);
    sessionA.close();
    engine.step(1016);
    expect(countBoxes(world)).toBe(0);

    const opened = openDocSession(world, envelope);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.readOnly).toBe(false);
    engine.step(1032);

    // B is A's document — the same two boxes reappear at the same Positions.
    expect(positionsOf(world)).toEqual([{ x: 42, y: 7 }, { x: 200, y: 90 }]);
    expect(countAnchors(world)).toBe(1);
  });
});
