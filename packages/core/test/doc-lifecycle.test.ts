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
  Viewport,
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
      tx.spawn({ components: [[Position, { x: 10, y: 20 }], [Size, { w: 80, h: 60 }]] });
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
      tx.spawn({ components: [[Position, { x: 5, y: 5 }], [Size, { w: 80, h: 60 }]] });
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
      tx.spawn({ components: [[Position, { x: 42, y: 7 }], [Size, { w: 80, h: 60 }]] });
      tx.spawn({ components: [[Position, { x: 200, y: 90 }], [Size, { w: 80, h: 60 }]] });
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

/**
 * D-C4.14 — a world has ONE owner, and only the owner resets it.
 *
 * `DocSession.close()` ends with `world.reset()`, which is right when the
 * session being closed is the one the world is projecting. It is catastrophic
 * when it is not: strata's double-attach guard is per STORE, not per world, so
 * attaching a second session to the same world silently supersedes the first
 * without throwing (measured — no throw, and both documents project into the
 * one world) — and the first session's `close()` then resets the SECOND
 * session's entities out of existence, along with every resource on the world.
 *
 * The facade never reaches this today: `closeDoc` aborts the pending join AND
 * closes the adopted session before a newer document attaches, and either guard
 * alone suffices (both pinned in `bootstrap.test.ts`). But `close()` is an
 * exported seam and the ordering hazard is one edit away. The reset belongs to
 * the owner; a superseded session tears down only its own binding.
 */
describe("D-C4.14: a superseded session's close does not reset the world", () => {
  it("a stale session's close leaves the NEWER session's entities alone", () => {
    const world = createWorld();
    const engine = createEngine(world);
    installInteractionCore(engine);

    const stale = createDocSession(world);
    stale.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 1, y: 1 }], [Size, { w: 10, h: 10 }]] });
    });
    engine.step(1000);

    // A second session on the SAME world. Strata does not refuse this, so
    // `current` is what the world projects from here and `stale` is a leftover
    // still holding a live handle.
    const current = createDocSession(world);
    current.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 50, y: 60 }], [Size, { w: 20, h: 20 }]] });
    });
    engine.step(1016);
    expect(positionsOf(world)).toContainEqual({ x: 50, y: 60 });
    // A RESOURCE is the witness for the reset itself: entities also die with a
    // plain `attachment.detach()`, so they cannot tell "the owner reset the
    // world" apart from "nobody reset it". Resources only go on `world.reset()`.
    world.setResource(Viewport, { w: 1440, h: 900, dpr: 2 });

    stale.close(); // the superseded session lets go of ITS binding — and only that
    engine.step(1032);

    expect(positionsOf(world)).toContainEqual({ x: 50, y: 60 });
    expect(world.getResource(Viewport)).toEqual({ w: 1440, h: 900, dpr: 2 });
    expect(countAnchors(world)).toBe(1);

    // The owner still owns the reset: closing IT does clear the world.
    current.close();
    engine.step(1048);
    expect(countBoxes(world)).toBe(0);
    expect(world.getResource(Viewport)).toBeUndefined(); // the reset ran
    expect(countAnchors(world)).toBe(1); // the interaction anchor is respawned
  });

  it("a stale close is idempotent and never reaches the reset, however often it runs", () => {
    const world = createWorld();
    const engine = createEngine(world);
    installInteractionCore(engine);
    const stale = createDocSession(world);
    const current = createDocSession(world);
    current.store.transaction((tx) => {
      tx.spawn({ components: [[Position, { x: 5, y: 5 }], [Size, { w: 10, h: 10 }]] });
    });
    engine.step(1000);

    world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });

    stale.close();
    stale.close();
    stale.close();
    engine.step(1016);

    expect(positionsOf(world)).toContainEqual({ x: 5, y: 5 });
    expect(world.getResource(Viewport)).toEqual({ w: 800, h: 600, dpr: 1 });
  });
});
