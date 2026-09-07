/**
 * The standard behaviour's IDLE row, isolated (design-013 A1b's recorded cost;
 * A3b fix 5's witness).
 *
 * `ice:surface.domAtRest` is attached to every dom widget, and it reads
 * `FrameInfo` — a RESOURCE — so its poll fires on every frame and its delivery
 * runs on every frame, idle or not. That much is the design: the settle window
 * expires on a clock, and nothing writes ECS when 250 ms pass.
 *
 * What this bench measures is what that delivery COSTS when there is nothing to
 * deliver. A1b recorded the row and attributed it to the walk reporting `full`
 * every frame; the review showed that is not what happens — `full` is computed
 * from `generationDirty`, `!seeded` and the collectors' `reset`/`coarse` only,
 * and the poll sets `readsFired`. The one unconditional O(instances) statement
 * in the delivery path was the instance-snapshot spread. This file is the
 * instrument for the row, so the claim is a measurement either way.
 *
 * Reported: the median µs of the `behavior:ice:surface.domAtRest:deliver`
 * system row over TIMED_FRAMES idle frames, plus the whole-frame median and the
 * top idle systems for scale. Guarded by BENCH=1 (`pnpm --filter @ice/core
 * bench`), like every other file here — real timed work, not a correctness
 * test. Numbers are recorded in docs/benchmarks.md.
 *
 * A/B METHOD (the reviewer's, and the one A1a's equip-stamp row had to adopt
 * after a naive pair read load as a regression): run the two arms INTERLEAVED
 * as separate processes and compare pairwise medians. A single before/after
 * pair on a loaded machine measures the machine.
 *
 * Widget types are defined ONCE at module scope: the widget/prefab/schema
 * registries are process-global (same caveat as bench/membership-scale.test.ts).
 */
import { describe, expect, it } from "vitest";
import { Camera, Viewport, createCanvasEngine, defineWidget, domAtRest } from "../src";
import type { CanvasEngine } from "../src";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { widgetSpawnInits } from "../src/widget/spawn";

const IdleCard = defineWidget({
  type: "idle-bench-card",
  surface: "dom",
  component: () => null,
  defaultSize: { w: 100, h: 60 },
});

/** The row this file exists to read. */
const ROW = `behavior:${domAtRest.name}:deliver`;

const BOARDS = [10_000, 100_000] as const;
const WARMUP_FRAMES = 50;
const TIMED_FRAMES = 200;
const TIMED_REPEATS = 5;

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** A flat board of N dom cards, seeded in ONE {undoable:false} transaction. */
function seed(cards: number): { ce: CanvasEngine; seedMs: number } {
  const ce = createCanvasEngine({ widgets: [IdleCard] });
  // A real window: without it cull and mount take their headless early-return
  // and every card is Culled, which is not the posture being measured.
  ce.world.setResource(Viewport, { w: 1600, h: 1000, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const session = ce.docs.create();
  const t0 = performance.now();
  guardedTransaction(
    session.store,
    ce.world,
    (tx) => {
      for (let i = 0; i < cards; i++) {
        const { prefab, overrides } = widgetSpawnInits("idle-bench-card", {
          x: (i % 400) * 120,
          y: Math.floor(i / 400) * 80,
        });
        tx.spawnPrefab(prefab, overrides);
      }
    },
    { undoable: false },
  );
  ce.world.sync();
  return { ce, seedMs: performance.now() - t0 };
}

/** Median µs for the target row, the whole frame, and the top five systems. */
function timeIdle(ce: CanvasEngine): {
  rowUs: number;
  rowRuns: number;
  frameUs: number;
  top: string;
} {
  ce.engine.enableTelemetry();
  let now = 0;
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    now += 16;
    ce.engine.step(now);
  }
  const frameSamples: number[] = [];
  const rowSamples: number[] = [];
  const systemUs = new Map<string, number[]>();
  for (let rep = 0; rep < TIMED_REPEATS; rep++) {
    const start = performance.now();
    for (let i = 0; i < TIMED_FRAMES; i++) {
      now += 16;
      ce.engine.step(now);
      const frame = ce.engine.lastFrame();
      if (frame === undefined) continue;
      for (const s of frame.systems) {
        if (!s.ran) continue;
        let arr = systemUs.get(s.system);
        if (arr === undefined) {
          arr = [];
          systemUs.set(s.system, arr);
        }
        arr.push(s.micros);
        if (s.system === ROW) rowSamples.push(s.micros);
      }
    }
    frameSamples.push(((performance.now() - start) / TIMED_FRAMES) * 1000);
  }
  const top = [...systemUs.entries()]
    .map(([name, xs]) => ({ name, us: median(xs) }))
    .sort((a, b) => b.us - a.us)
    .slice(0, 5)
    .map((s) => `${s.name}=${s.us.toFixed(0)}µs`)
    .join("  ");
  return {
    rowUs: median(rowSamples),
    rowRuns: rowSamples.length,
    frameUs: median(frameSamples),
    top,
  };
}

describe("the standard behaviour's idle row (BENCH=1 only)", () => {
  for (const cards of BOARDS) {
    it.runIf(process.env.BENCH === "1")(
      `${cards} dom cards: ${ROW} idle`,
      () => {
        const { ce, seedMs } = seed(cards);
        const idle = timeIdle(ce);

        // The row must actually be there. A rename, a behaviour that stopped
        // being attached, or a delivery that stopped running would otherwise
        // report a confident 0 µs — the shape of a measurement about nothing.
        expect(idle.rowRuns).toBeGreaterThan(0);

        console.log(`
behavior-idle-snapshot ${cards} cards (µs = median over ${TIMED_REPEATS}×${TIMED_FRAMES} idle frames):
  ${ROW.padEnd(42)} = ${idle.rowUs.toFixed(1).padStart(8)} µs   (ran ${idle.rowRuns} frames)
  whole frame                                = ${idle.frameUs.toFixed(1).padStart(8)} µs
  seed                                       = ${seedMs.toFixed(0).padStart(8)} ms
  top idle systems: ${idle.top}
`);
      },
      600_000,
    );
  }
});
