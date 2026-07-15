/**
 * Nested-canvas membership at scale (design-004 §7; the container-model
 * stress question of 2026-07-15: "huge amounts of containers, way deep").
 *
 * Measures, on the REAL facade pipeline (createCanvasEngine — full stack,
 * widget runtime, nav):
 *
 *   1. idle µs/frame at N widgets — with per-system attribution for
 *      `activeMembership` (the design-004 §7 derive system) from engine
 *      telemetry. The 2026-07-15 audit found the implementation scans every
 *      equipped widget's ChildOf chain every tick (design-004 §7 specifies
 *      `runIf: nav-change ∨ ChildOf churn`); this bench records that tax
 *      before and after the gate lands.
 *   2. nav enter/exit wall ms (resweep + spatial-index rebuild + cull flips).
 *   3. attach-projection: docs.open(envelope) wall ms + envelope bytes at N
 *      rows (the "whole doc loads at open" half of the container-model
 *      discussion — one doc per board, gated not sharded).
 *
 * Tree shapes:
 *   flat-100k    100,000 leaves at root (container-free board posture)
 *   nested-10k   10 roots × depth-8 folder chains × 125 leaves/folder
 *   nested-100k  100 roots × depth-8 folder chains × 125 leaves/folder
 *
 * Guarded by BENCH=1 (package.json "bench" script) — real timed work, not a
 * correctness test. Numbers are recorded in docs/benchmarks.md.
 *
 * Widget types are defined ONCE at module scope: the widget/prefab/schema
 * registries are process-global (same caveat as bench/reactivity-tax.test.ts).
 */
import { describe, expect, it } from "vitest";
import { Camera, ChildOf, Viewport, createCanvasEngine, defineWidget } from "../src";
import type { CanvasEngine } from "../src";
import type { Entity } from "@vibecook/strata-ecs";
import { guardedTransaction } from "../src/guards/guarded-tx";
import { widgetSpawnInits } from "../src/widget/spawn";

const BenchLeaf = defineWidget({
  type: "bench-leaf",
  surface: "dom",
  component: () => null,
  defaultSize: { w: 100, h: 60 },
  provides: ["widget"],
});

const BenchFolder = defineWidget({
  type: "bench-folder",
  surface: "dom",
  component: () => null,
  defaultSize: { w: 300, h: 300 },
  container: { accepts: ["widget"] },
});

const WIDGETS = [BenchLeaf, BenchFolder];

const WARMUP_FRAMES = 50;
const TIMED_FRAMES = 200;
const TIMED_REPEATS = 5;

interface TreeShape {
  readonly name: string;
  /** Root-level folder chains (0 ⇒ flat: `flatLeaves` spawn at root). */
  readonly roots: number;
  readonly depth: number;
  readonly leavesPerFolder: number;
  /** Flat mode only. */
  readonly flatLeaves?: number;
}

const SHAPES: readonly TreeShape[] = [
  { name: "flat-100k", roots: 0, depth: 0, leavesPerFolder: 0, flatLeaves: 100_000 },
  { name: "nested-10k", roots: 10, depth: 8, leavesPerFolder: 125 },
  { name: "nested-100k", roots: 100, depth: 8, leavesPerFolder: 125 },
];

interface Seeded {
  readonly ce: CanvasEngine;
  readonly session: ReturnType<CanvasEngine["docs"]["create"]>;
  /** One mid-chain folder per root (depth ~D/2) — the nav target. */
  readonly midFolders: readonly Entity[];
  readonly widgetCount: number;
  readonly folderCount: number;
  readonly seedMs: number;
}

/** Build the tree in ONE {undoable:false} transaction (batch-seed idiom). */
function seed(shape: TreeShape): Seeded {
  const ce = createCanvasEngine({ widgets: WIDGETS });
  // A real window — without it cull/mount take their headless early-return
  // and the bench measures nothing but scheduler overhead for them.
  ce.world.setResource(Viewport, { w: 1600, h: 1000, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const session = ce.docs.create();
  const midFolders: Entity[] = [];
  let widgetCount = 0;
  let folderCount = 0;

  const t0 = performance.now();
  guardedTransaction(
    session.store,
    ce.world,
    (tx) => {
      const spawnOne = (type: string, x: number, y: number): Entity => {
        const { prefab, overrides } = widgetSpawnInits(type, { x, y });
        return tx.spawnPrefab(prefab, overrides);
      };
      if (shape.flatLeaves !== undefined) {
        for (let i = 0; i < shape.flatLeaves; i++) {
          spawnOne("bench-leaf", (i % 400) * 120, Math.floor(i / 400) * 80);
          widgetCount++;
        }
        return;
      }
      for (let r = 0; r < shape.roots; r++) {
        let parent: Entity | undefined;
        for (let d = 0; d < shape.depth; d++) {
          const folder = spawnOne("bench-folder", r * 400, d * 40);
          folderCount++;
          if (parent !== undefined) tx.setRelation(folder, ChildOf, parent);
          if (d === Math.floor(shape.depth / 2)) midFolders.push(folder);
          for (let k = 0; k < shape.leavesPerFolder; k++) {
            const leaf = spawnOne("bench-leaf", (k % 25) * 120, Math.floor(k / 25) * 80);
            tx.setRelation(leaf, ChildOf, folder);
            widgetCount++;
          }
          parent = folder;
        }
      }
    },
    { undoable: false },
  );
  ce.world.sync();
  const seedMs = performance.now() - t0;
  return { ce, session, midFolders, widgetCount, folderCount, seedMs };
}

/** Median idle µs/frame + median activeMembership µs + top systems by µs. */
function timeIdle(
  ce: CanvasEngine,
  nowRef: { now: number },
): { frameUs: number; membershipUs: number; top: string } {
  ce.engine.enableTelemetry();
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    nowRef.now += 16;
    ce.engine.step(nowRef.now);
  }
  const frameSamples: number[] = [];
  const memberSamples: number[] = [];
  const systemUs = new Map<string, number[]>();
  for (let rep = 0; rep < TIMED_REPEATS; rep++) {
    const start = performance.now();
    for (let i = 0; i < TIMED_FRAMES; i++) {
      nowRef.now += 16;
      ce.engine.step(nowRef.now);
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
        if (s.system === "activeMembership") memberSamples.push(s.micros);
      }
    }
    frameSamples.push(((performance.now() - start) / TIMED_FRAMES) * 1000);
  }
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const top = [...systemUs.entries()]
    .map(([name, xs]) => ({ name, us: median(xs) }))
    .sort((a, b) => b.us - a.us)
    .slice(0, 5)
    .map((s) => `${s.name}=${s.us.toFixed(0)}µs`)
    .join("  ");
  return { frameUs: median(frameSamples), membershipUs: median(memberSamples), top };
}

/** Median µs/frame + per-system medians under camera churn (zoom or pan). */
function timeCamera(
  ce: CanvasEngine,
  nowRef: { now: number },
  mode: "zoom" | "pan",
): { frameUs: number; sys: string } {
  const base = ce.world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
  const frameSamples: number[] = [];
  const systemUs = new Map<string, number[]>();
  const FRAMES = 150;
  for (let rep = 0; rep < 3; rep++) {
    const start = performance.now();
    for (let i = 0; i < FRAMES; i++) {
      if (mode === "zoom") {
        const z = 0.8 + 0.4 * ((i % 20) / 20); // wiggle: every frame differs
        ce.world.setResource(Camera, { x: base.x, y: base.y, zoom: z, gesturing: true });
      } else {
        ce.world.setResource(Camera, { x: base.x + i * 7, y: base.y, zoom: base.zoom, gesturing: true });
      }
      nowRef.now += 16;
      ce.engine.step(nowRef.now);
      const frame = ce.engine.lastFrame();
      if (frame === undefined) continue;
      for (const s of frame.systems) {
        if (!s.ran || (s.system !== "breakpoint" && s.system !== "cull" && s.system !== "widgetMount")) continue;
        let arr = systemUs.get(s.system);
        if (arr === undefined) {
          arr = [];
          systemUs.set(s.system, arr);
        }
        arr.push(s.micros);
      }
    }
    frameSamples.push(((performance.now() - start) / FRAMES) * 1000);
  }
  ce.world.setResource(Camera, base);
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const sys = ["breakpoint", "cull", "widgetMount"]
    .map((n) => `${n}=${median(systemUs.get(n) ?? []).toFixed(0)}µs(${systemUs.get(n)?.length ?? 0} runs)`)
    .join("  ");
  return { frameUs: median(frameSamples), sys };
}

const HEADER =
  "shape        | widgets+fold | frame µs | member µs  | enter ms | exit ms | attach ms | envelope | seed ms";

describe("membership at scale (BENCH=1 only)", () => {
  for (const shape of SHAPES) {
    it.runIf(process.env.BENCH === "1")(
      `${shape.name}: idle tax, nav cost, attach-projection`,
      () => {
        const { ce, session, midFolders, widgetCount, folderCount, seedMs } = seed(shape);
        const nowRef = { now: 0 };

        const idle = timeIdle(ce, nowRef);
        const zoomChurn = timeCamera(ce, nowRef, "zoom");
        const panChurn = timeCamera(ce, nowRef, "pan");

        // Nav: enter a mid-depth folder, one step (resweep + index rebuild),
        // then exit + one step. Flat boards have no folders — skipped.
        let enterMs = 0;
        let exitMs = 0;
        const target = midFolders[0];
        if (target !== undefined) {
          const t1 = performance.now();
          ce.ops.enterContainer(target);
          nowRef.now += 16;
          ce.engine.step(nowRef.now);
          enterMs = performance.now() - t1;
          const t2 = performance.now();
          ce.ops.exitContainer();
          nowRef.now += 16;
          ce.engine.step(nowRef.now);
          exitMs = performance.now() - t2;
        }

        // Attach-projection: envelope → fresh engine → docs.open (projects
        // the whole doc immediately) → sync + first frame.
        const bytes = session.exportEnvelope();
        const ce2 = createCanvasEngine({ widgets: WIDGETS });
        const t3 = performance.now();
        const opened = ce2.docs.open(bytes);
        ce2.world.sync();
        ce2.engine.step(16);
        const attachMs = performance.now() - t3;
        expect(opened.ok, opened.ok ? "" : `docs.open failed: ${(opened as { reason?: string }).reason}`).toBe(true);

        console.log(`
membership-scale ${shape.name} (µs = median):
  ${HEADER}
  ${shape.name.padEnd(12)} | ${String(widgetCount).padStart(7)}+${String(folderCount).padEnd(4)} | ${idle.frameUs.toFixed(1).padStart(8)} | ${idle.membershipUs.toFixed(1).padStart(10)} | ${enterMs.toFixed(1).padStart(8)} | ${exitMs.toFixed(1).padStart(7)} | ${attachMs.toFixed(0).padStart(9)} | ${(bytes.length / 1024).toFixed(0).padStart(7)}k | ${seedMs.toFixed(0).padStart(7)}
  top idle systems: ${idle.top}
  zoom frames: ${zoomChurn.frameUs.toFixed(1)}µs/frame  ${zoomChurn.sys}
  pan frames:  ${panChurn.frameUs.toFixed(1)}µs/frame  ${panChurn.sys}
`);
        expect(idle.frameUs).toBeGreaterThan(0);
      },
      600_000,
    );
  }
});
