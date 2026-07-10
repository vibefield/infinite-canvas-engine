/**
 * measureIngest: the ResizeObserver → queue → `MeasuredSize` rider path
 * (design-004 §2). Asserts the ±1px dead-band, the 0×0 hidden-measure skip, the
 * add-then-set transition, and same-tick last-wins folding.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  createEngine,
  createMeasureIngest,
  createMeasureQueue,
  ensureCanvasSurface,
  MeasuredSize,
  Position,
} from "../src";

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  // Arm access enforcement like a real app (undeclared writes must DEV-throw here).
  engine.registerReflector({ name: "armed", always: false, flush: () => {} });
  ensureCanvasSurface(world);
  const queue = createMeasureQueue();
  engine.addSystems("input", createMeasureIngest(world, queue));
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const target = () => world.spawn({ components: [[Position, { x: 0, y: 0 }]] });
  return { world, engine, queue, step, target };
}

describe("measureIngest", () => {
  it("adds MeasuredSize on the first non-zero measurement", () => {
    const { world, queue, step, target } = rig();
    const e = target();
    queue.enqueue({ entity: e, w: 120, h: 80 });
    step();
    expect(world.get(e, MeasuredSize)).toEqual({ w: 120, h: 80 });
  });

  it("never ingests a 0×0 measurement (hidden host)", () => {
    const { world, queue, step, target } = rig();
    const e = target();
    queue.enqueue({ entity: e, w: 0, h: 0 });
    step();
    expect(world.has(e, MeasuredSize)).toBe(false);

    // A later real measurement still lands.
    queue.enqueue({ entity: e, w: 200, h: 150 });
    step();
    expect(world.get(e, MeasuredSize)).toEqual({ w: 200, h: 150 });
  });

  it("holds within the ±1px dead-band and updates past it", () => {
    const { world, queue, step, target } = rig();
    const e = target();
    queue.enqueue({ entity: e, w: 100, h: 100 });
    step();
    expect(world.get(e, MeasuredSize)).toEqual({ w: 100, h: 100 });

    // 1px on each axis is within the band — no restamp.
    queue.enqueue({ entity: e, w: 101, h: 99 });
    step();
    expect(world.get(e, MeasuredSize)).toEqual({ w: 100, h: 100 });

    // >1px on width crosses the band — restamps both axes to the new sample.
    queue.enqueue({ entity: e, w: 103, h: 99 });
    step();
    expect(world.get(e, MeasuredSize)).toEqual({ w: 103, h: 99 });
  });

  it("folds same-tick samples last-wins (one write, no duplicate add)", () => {
    const { world, queue, step, target } = rig();
    const e = target();
    queue.enqueue({ entity: e, w: 10, h: 10 });
    queue.enqueue({ entity: e, w: 20, h: 20 });
    queue.enqueue({ entity: e, w: 30, h: 30 });
    step(); // a single addComponent with the last sample — no flush-time duplicate
    expect(world.get(e, MeasuredSize)).toEqual({ w: 30, h: 30 });
  });

  it("skips a measurement for a despawned entity", () => {
    const { world, queue, step, target } = rig();
    const e = target();
    world.destroy(e);
    queue.enqueue({ entity: e, w: 50, h: 50 });
    expect(() => step()).not.toThrow();
    expect(world.isAlive(e)).toBe(false);
  });
});
