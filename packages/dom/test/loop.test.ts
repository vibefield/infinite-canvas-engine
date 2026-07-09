/**
 * rAF loop (design-002 §1): drives engine.step once per frame with the rAF
 * timestamp, and the stop fn latches so an in-flight frame cannot re-schedule.
 * requestAnimationFrame is stubbed for determinism (no real frame timing).
 */
import { createEngine, createWorld, FrameInfo } from "@ice/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRafLoop } from "../src/loop";

let scheduled: FrameRequestCallback[];
let canceled: Set<number>;
let origRaf: typeof globalThis.requestAnimationFrame;
let origCancel: typeof globalThis.cancelAnimationFrame;

beforeEach(() => {
  scheduled = [];
  canceled = new Set();
  let nextId = 1;
  origRaf = globalThis.requestAnimationFrame;
  origCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    scheduled.push(cb);
    return nextId++;
  };
  globalThis.cancelAnimationFrame = (id) => {
    canceled.add(id);
  };
});

afterEach(() => {
  globalThis.requestAnimationFrame = origRaf;
  globalThis.cancelAnimationFrame = origCancel;
});

describe("startRafLoop", () => {
  it("steps the engine each frame with the rAF timestamp, then stops cleanly", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const stop = startRafLoop(engine);

    const frame0 = scheduled.shift();
    frame0?.(16);
    expect(world.getResource(FrameInfo)?.tick).toBe(1);
    expect(world.getResource(FrameInfo)?.now).toBe(16);

    const frame1 = scheduled.shift();
    frame1?.(32);
    expect(world.getResource(FrameInfo)?.tick).toBe(2);

    stop();
    expect(canceled.size).toBe(1);

    // The frame the last step scheduled must be inert after stop.
    const frame2 = scheduled.shift();
    frame2?.(48);
    expect(world.getResource(FrameInfo)?.tick).toBe(2);
  });
});
