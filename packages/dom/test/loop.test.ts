/**
 * rAF loop (design-002 §1): drives engine.step once per frame with the rAF
 * timestamp, and the stop fn latches so an in-flight frame cannot re-schedule.
 * requestAnimationFrame is stubbed for determinism (no real frame timing).
 */
import { createEngine, createWorld, FrameInfo, SLEEP_TAIL, Viewport } from "@ice/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("runs `beforeStep` BEFORE each step that runs, with its timestamp — never for a parked frame (K1: the host's ratio read)", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const seen: string[] = [];
    startRafLoop(engine, (now) => seen.push(`${now}@${world.getResource(FrameInfo)?.tick ?? 0}`));
    scheduled.shift()?.(16);
    scheduled.shift()?.(32);
    expect(seen).toEqual(["16@0", "32@1"]); // before the step: the tick the step then advances
    engine.frame.freeze("godview");
    scheduled.shift()?.(48); // the settle step runs, and its hook
    scheduled.shift()?.(64); // parks: no step, no hook
    expect(seen).toEqual(["16@0", "32@1", "48@2"]);
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

describe("startRafLoop — surviving a throwing step (petition I14)", () => {
  it("keeps scheduling after a publish hook throws, and recovers on the next frame", () => {
    const world = createWorld();
    const engine = createEngine(world);
    let boom = true;
    engine.onPublish(() => {
      if (boom) throw new Error("hostile publish hook");
    });
    startRafLoop(engine);

    // The faulting frame: the throw escapes to the rAF callback (loud, by
    // design — publish throws are not swallowed) but the loop is NOT dead.
    expect(() => scheduled.shift()?.(16)).toThrow(/hostile publish hook/);
    expect(scheduled).toHaveLength(1);

    // Before the fix this frame never existed: `handle` was never renewed and
    // `wake` early-returned forever, so the canvas was gone until remount.
    boom = false;
    scheduled.shift()?.(32);
    expect(world.getResource(FrameInfo)?.tick).toBe(2);
    expect(scheduled).toHaveLength(1);
  });

  it("a step that throws EVERY frame stays alive rather than dying once", () => {
    const world = createWorld();
    const engine = createEngine(world);
    engine.onPublish(() => {
      throw new Error("always");
    });
    startRafLoop(engine);

    for (let i = 1; i <= 3; i++) {
      expect(() => scheduled.shift()?.(i * 16)).toThrow(/always/);
      expect(world.getResource(FrameInfo)?.tick).toBe(i); // still stepping
      expect(scheduled).toHaveLength(1); // still scheduled
    }
  });

  it("stop() called from INSIDE a step still wins over the finally reschedule", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const loop: { stop?: () => void } = {};
    engine.onPublish(() => loop.stop?.());
    loop.stop = startRafLoop(engine);

    scheduled.shift()?.(16);
    expect(scheduled).toHaveLength(0); // no resurrection past its own stopper
  });
});

/**
 * THE SLEEP (K7a — `@ice/core` frame-control.ts): with `sleep`, the loop stops scheduling frames once the gate says the engine is
 * quiet, and a wake (a write from outside a step, an input) or a registered time brings it back; a freeze rises it so its settle
 * walk can park. Without `sleep` nothing changed (the tests above). Fake timers own `setTimeout` and `performance.now`.
 */
describe("startRafLoop — the sleep", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); });
  afterEach(() => { vi.useRealTimers(); });
  /** Runs the scheduled frames (the rAF timestamp at the fake clock) until none is left or `cap`. Returns how many ran. */
  const drain = (cap = 50): number => {
    let n = 0;
    while (scheduled.length > 0 && n < cap) { n += 1; scheduled.shift()?.(performance.now()); vi.advanceTimersByTime(16); }
    return n;
  };

  it("sleeps after the tail — no frame scheduled — and a write from outside a step wakes it", () => {
    const world = createWorld();
    const engine = createEngine(world);
    startRafLoop(engine, undefined, { sleep: true });
    expect(drain()).toBe(SLEEP_TAIL);
    expect(scheduled).toHaveLength(0);
    expect(engine.frame.sleepStats().asleep).toBe(true);
    const tick = world.getResource(FrameInfo)?.tick ?? 0;
    world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });   // the world's door: a wake
    expect(scheduled).toHaveLength(1);
    expect(engine.frame.sleepStats().asleep).toBe(false);
    expect(drain()).toBe(SLEEP_TAIL);
    expect(world.getResource(FrameInfo)?.tick).toBe(tick + SLEEP_TAIL);
  });

  it("a registered time: asleep with a timer, and the frame it asks for comes when the time does", () => {
    const world = createWorld();
    const engine = createEngine(world);
    let at = Number.POSITIVE_INFINITY;
    engine.frame.wakeWhen("blink", () => at);
    startRafLoop(engine, undefined, { sleep: true });
    at = performance.now() + 3 * 16 + 530;   // 530 ms after the tail's three frames
    drain();
    expect(scheduled).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(scheduled).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(scheduled).toHaveLength(1);
    at = Number.POSITIVE_INFINITY;
    expect(drain()).toBe(1);   // the time's frame alone: no tail
    expect(engine.frame.sleepStats()).toMatchObject({ asleep: true, timed: 1 });
  });

  it("a freeze taken while it sleeps rises it, and the settle walk parks it; stop() clears a pending timer", () => {
    const world = createWorld();
    const engine = createEngine(world);
    engine.frame.wakeWhen("later", () => performance.now() + 10_000);
    const stop = startRafLoop(engine, undefined, { sleep: true });
    drain();
    expect(scheduled).toHaveLength(0);
    engine.frame.freeze("cover");
    expect(scheduled).toHaveLength(1);
    drain();
    expect(engine.frame.isParked()).toBe(true);
    stop();
    vi.advanceTimersByTime(20_000);
    expect(scheduled).toHaveLength(0);
  });
});
