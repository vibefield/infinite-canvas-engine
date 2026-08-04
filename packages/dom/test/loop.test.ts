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

describe("startRafLoop — the freeze gate", () => {
  it("takes the settle step, then PARKS: no further frame is scheduled", () => {
    const world = createWorld();
    const engine = createEngine(world);
    startRafLoop(engine);

    scheduled.shift()?.(16);
    expect(world.getResource(FrameInfo)?.tick).toBe(1);

    engine.frame.freeze("godview");
    scheduled.shift()?.(32); // the settle step still runs
    expect(world.getResource(FrameInfo)?.tick).toBe(2);

    // The parking frame: it neither steps nor re-arms rAF. A stopped engine
    // means the browser has no work queued for it either.
    scheduled.shift()?.(48);
    expect(world.getResource(FrameInfo)?.tick).toBe(2);
    expect(scheduled).toHaveLength(0);
  });

  it("thaw wakes the parked loop", () => {
    const world = createWorld();
    const engine = createEngine(world);
    startRafLoop(engine);

    scheduled.shift()?.(16);
    const thaw = engine.frame.freeze("godview");
    scheduled.shift()?.(32); // settle
    scheduled.shift()?.(48); // park
    expect(scheduled).toHaveLength(0);

    thaw();
    expect(scheduled).toHaveLength(1); // woken by the gate's change hook
    scheduled.shift()?.(64);
    expect(world.getResource(FrameInfo)?.tick).toBe(3);
  });

  it("a freeze taken while parked does not double-schedule on thaw", () => {
    const world = createWorld();
    const engine = createEngine(world);
    startRafLoop(engine);

    scheduled.shift()?.(16);
    const a = engine.frame.freeze("godview");
    scheduled.shift()?.(32);
    scheduled.shift()?.(48);
    const b = engine.frame.freeze("window-hidden"); // arrives while parked
    expect(scheduled).toHaveLength(0);

    a();
    expect(scheduled).toHaveLength(0); // still frozen by the other holder
    b();
    expect(scheduled).toHaveLength(1);
  });

  it("resumes on a CLAMPED dt — an hour parked must not teleport tweens", () => {
    const world = createWorld();
    const engine = createEngine(world);
    startRafLoop(engine);

    scheduled.shift()?.(1000);
    const thaw = engine.frame.freeze("godview");
    scheduled.shift()?.(1016); // settle
    scheduled.shift()?.(1032); // park

    thaw();
    scheduled.shift()?.(3_601_016); // an hour later
    expect(world.getResource(FrameInfo)?.dt).toBe(64); // CAMERA_DEFAULTS.dtClampMs
  });

  it("stop() unsubscribes: a thaw after teardown revives nothing", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const stop = startRafLoop(engine);

    scheduled.shift()?.(16);
    const thaw = engine.frame.freeze("godview");
    scheduled.shift()?.(32);
    scheduled.shift()?.(48);

    stop();
    thaw();
    expect(scheduled).toHaveLength(0);
  });
});
