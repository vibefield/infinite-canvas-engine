/**
 * The behavior frame-loop bench (BENCH=1 only, like its siblings).
 *
 * Born as the 0.7.0 pre-publish A/B: run identically at 0e31050 (the 0.6.0
 * release point) and at the I16+I17 candidate to price the invokeHook
 * boundary. Verdict then: 0.1397 → 0.1423 ms/frame at 2000 ticking instances
 * (~1.3ns per hook call — the thenable typeof checks) and 0.19 → 0.39 ms
 * ONE-TIME for 40 registrations (reorderExecution's O(N²) churn). Kept
 * because ICE had no bench on the behavior loop at its stated scale ceiling
 * (design-009 §10: ≤~2k ticking instances) — future hook-path changes should
 * move these numbers deliberately, not by surprise.
 *
 * Measures median ms/frame for (a) 2000 ticking runtime instances — the
 * per-instance hook path; (b) a changed-only carrier behavior — the delivery
 * drain (once per behavior per frame). No declared writes (no stamping
 * noise). Plus registration churn as a separate one-time cost.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { __resetBehaviorsForTests, defineBehavior } from "../src/behavior/define-behavior";
import { createBehaviorRuntime } from "../src/behavior/runtime";
import { createEngine } from "../src/engine/engine";
import { p } from "../src/widget/props";

const FRAMES = 300;
const WARMUP = 60;
const REPS = 5;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function run(frames: number, step: (now: number) => void): number {
  let now = 0;
  for (let i = 0; i < WARMUP; i++) {
    now += 16;
    step(now);
  }
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    now += 16;
    step(now);
  }
  return (performance.now() - t0) / frames;
}

describe("behavior frame-loop bench (A/B vs 0.6.0)", () => {
  it.runIf(process.env.BENCH === "1")("2000 ticking instances + changed-path churn", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const runtime = createBehaviorRuntime({
      world,
      engine,
      onLog: () => {},
      onFault: () => {},
    });

    let ticks = 0;
    const Ticker = defineBehavior("bench:ticker", {
      store: "runtime",
      phase: "simulate",
      schema: { n: p.number({ default: 0 }) },
      on: {
        tick: () => {
          ticks++;
        },
      },
    });
    let changedRuns = 0;
    const Watcher = defineBehavior("bench:watcher", {
      store: "runtime",
      phase: "simulate",
      schema: { m: p.number({ default: 0 }) },
      reads: [Ticker],
      on: {
        changed: () => {
          changedRuns++;
        },
      },
    });
    runtime.register(Ticker);
    runtime.register(Watcher);

    const entities = Array.from({ length: 2000 }, () => world.spawn({}));
    for (const e of entities) runtime.attach(e, Ticker);
    const carrier = world.spawn({});
    runtime.attach(carrier, Watcher);

    const perFrame: number[] = [];
    for (let r = 0; r < REPS; r++) {
      perFrame.push(run(FRAMES, (now) => engine.step(now)));
    }
    // eslint-disable-next-line no-console
    console.log(
      `BENCH ticking2k: median ${median(perFrame).toFixed(4)} ms/frame ` +
        `(reps: ${perFrame.map((x) => x.toFixed(4)).join(", ")}) ticks=${ticks} changed=${changedRuns}`,
    );
    expect(ticks).toBeGreaterThan(0);
    runtime.dispose();
    __resetBehaviorsForTests();
  });

  it.runIf(process.env.BENCH === "1")("registration churn: 40 behaviors registered sequentially", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const runtime = createBehaviorRuntime({
      world,
      engine,
      onLog: () => {},
      onFault: () => {},
    });
    const defs = Array.from({ length: 40 }, (_, i) =>
      defineBehavior(`bench:reg-${i}`, {
        store: "runtime",
        phase: "simulate",
        on: { tick: () => {} },
      }),
    );
    const reps: number[] = [];
    for (let r = 0; r < REPS; r++) {
      const t0 = performance.now();
      const removers = defs.map((d) => runtime.register(d));
      const t1 = performance.now();
      for (const rm of removers) rm();
      reps.push(t1 - t0);
    }
    // eslint-disable-next-line no-console
    console.log(
      `BENCH register40: median ${median(reps).toFixed(3)} ms total ` +
        `(reps: ${reps.map((x) => x.toFixed(3)).join(", ")})`,
    );
    expect(true).toBe(true);
    runtime.dispose();
    __resetBehaviorsForTests();
  });
});
