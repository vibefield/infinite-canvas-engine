/**
 * M3 reactivity-tax baseline (design-002 §4, implementation-plan M3 exit:
 * "reactivity-tax baseline recorded").
 *
 * strata-ecs's reactivity layer is lazily armed — stamping only turns on once
 * the FIRST `world.reactive.observe*` call registers (world.ts's `reactive`
 * getter is side-effect-free; `RuntimeStore.armAccessEnforcement` fires on
 * that first call). This bench times two otherwise-identical scenarios to
 * isolate that fixed tax:
 *
 *   A (unarmed)  — engine.step() calls world.reactive.notify() every frame,
 *                  but nothing ever calls observe*, so the world never arms.
 *   B (armed)    — one observeQuery registered before stepping; every write
 *                  through the declared access.write column now stamps.
 *
 * design-002 §4 budgets the always-armed path at +17–28% on write-heavy
 * paths (strata's own benchmark for the ungated case, cited in
 * draft/design-002-frame-contract.md §4). This file records THIS engine's
 * measured number against that budget — see docs/benchmarks.md.
 *
 * Guarded by BENCH=1 (see the "bench" script in package.json) so normal
 * `pnpm run ci` / `vitest run` skips it instantly — it does real timed work
 * and is not a correctness test.
 *
 * Schema is defined ONCE at module scope with file-unique "bench*" names —
 * strata's schema registry is process-global with no public reset, so
 * per-test redefinition would throw on the second scenario.
 */
import { createWorld, defineQuery, defineSystem, field } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine/engine";
import { defineComponent } from "../src/schema/meta";

const benchPos = defineComponent("benchPos", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
});
const benchVel = defineComponent("benchVel", {
  vx: field("f64", { default: 0 }),
  vy: field("f64", { default: 0 }),
});

const moveQ = defineQuery([benchPos, benchVel]);

const ENTITY_COUNT = 10_000;
const WARMUP_FRAMES = 100;
const TIMED_FRAMES = 500;
const TIMED_REPEATS = 5;

function makeWorld(): World {
  const world = createWorld();
  for (let i = 0; i < ENTITY_COUNT; i++) {
    world.spawn({
      components: [
        [benchPos, { x: i, y: -i }],
        [benchVel, { vx: 1, vy: -1 }],
      ],
    });
  }
  return world;
}

/** pos += vel over the batch's raw columns — the one write-heavy system both scenarios share. */
function makeSimulateSystem() {
  return defineSystem(
    moveQ,
    (b) => {
      const px = b.col(benchPos).x;
      const py = b.col(benchPos).y;
      const vx = b.col(benchVel).vx;
      const vy = b.col(benchVel).vy;
      for (let i = 0; i < b.count; i++) {
        const r = b.rows[i];
        px[r] += vx[r];
        py[r] += vy[r];
      }
    },
    { name: "simulate", access: { write: [benchPos] } },
  );
}

/**
 * Median of `repeats` timed blocks of `frames` engine.step() calls, after `warmup` untimed
 * frames. Returns µs/frame — `performance.now()` is milliseconds, so the raw per-frame delta is
 * scaled by 1000.
 */
function timeScenario(
  world: World,
  engine: ReturnType<typeof createEngine>,
  warmup: number,
  frames: number,
  repeats: number,
): number {
  let now = 0;
  for (let i = 0; i < warmup; i++) {
    now += 16;
    engine.step(now);
  }

  const samples: number[] = [];
  for (let rep = 0; rep < repeats; rep++) {
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      now += 16;
      engine.step(now);
    }
    samples.push(((performance.now() - start) / frames) * 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

describe("reactivity-tax baseline (BENCH=1 only)", () => {
  it.runIf(process.env.BENCH === "1")(
    "measures unarmed vs. armed µs/frame over a write-heavy 10k-entity pipeline",
    () => {
      // Scenario A: unarmed. engine.step() reads world.reactive (the getter itself is
      // side-effect-free) to call notify(), but no observe* call ever registers, so
      // RuntimeStore.armAccessEnforcement() never fires and no stamping occurs.
      const worldA = makeWorld();
      const engineA = createEngine(worldA);
      engineA.addSystems("simulate", makeSimulateSystem());
      const usPerFrameA = timeScenario(worldA, engineA, WARMUP_FRAMES, TIMED_FRAMES, TIMED_REPEATS);

      // Scenario B: armed. One observeQuery before stepping arms stamping for the
      // world's whole life (one-way gate, design-002 §4).
      const worldB = makeWorld();
      const engineB = createEngine(worldB);
      engineB.addSystems("simulate", makeSimulateSystem());
      worldB.reactive.observeQuery(moveQ, () => {}, { cols: [benchPos] });
      const usPerFrameB = timeScenario(worldB, engineB, WARMUP_FRAMES, TIMED_FRAMES, TIMED_REPEATS);

      const overheadPct = ((usPerFrameB - usPerFrameA) / usPerFrameA) * 100;

      const sign = overheadPct >= 0 ? "+" : "";
      console.log(`
reactivity-tax baseline (10k entities, pos+=vel, access.write=[benchPos]):
  scenario | us/frame | overhead
  A unarmed | ${usPerFrameA.toFixed(2).padStart(8)} | —
  B armed   | ${usPerFrameB.toFixed(2).padStart(8)} | ${sign}${overheadPct.toFixed(1)}%
`);

      // Sanity only — no brittle thresholds (this file exists to MEASURE, not gate).
      expect(usPerFrameA).toBeGreaterThan(0);
      expect(usPerFrameB).toBeGreaterThan(0);
      expect(overheadPct).toBeGreaterThan(-50);
    },
  );
});
