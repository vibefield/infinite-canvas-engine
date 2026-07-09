/**
 * The scripted measurement harness — the M3 exit numbers, "measured, not
 * asserted" (docs/implementation-plan.md M3). Each run drives `engine.step`
 * directly (no rAF) so the frame count and the write counters are exact.
 *
 * Two runs, each also bound to a hotkey by {@link installHarnessHotkeys}:
 *
 *  - scriptedPan (design-002 §5 O(1) pan): translate the Camera resource each
 *    frame. Expectation — the plane-transform reflector writes exactly ONE
 *    transform per frame (it observes Camera), and the gray-box reflector writes
 *    ZERO styles (a camera move stamps no Position/Size, so its query never
 *    wakes). Pan cost is independent of node count.
 *
 *  - scriptedDrag (design-001 §7 churn budget): a `simulate` system moves ONE
 *    entity per frame through the honest in-tick value-write path
 *    (`ctx.edit().set(Position)`), camera untouched. Expectation — per frame:
 *    value writes on one entity ⇒ the gray-box reflector wakes and writes
 *    exactly ONE style (its change-only geometry cache suppresses the other
 *    9,999), ZERO plane-transform writes (camera static), and the live node
 *    count never moves (zero enter/exit ⇒ zero migrations/tag flips).
 *
 * A warm-up `step` precedes every measured window so first-paint (the reflectors'
 * unconditional first flush — plane paints once, gray-box mounts all N) is NOT
 * charged to the steady-state deltas.
 */
import {
  Camera,
  defineQuery,
  defineResource,
  defineSystem,
  type Engine,
  type Entity,
  field,
  Position,
  Size,
} from "@ice/core";

/** The reflector instruments the harness reads (structural subset of the real reflectors). */
export interface HarnessReflectors {
  plane: { transformWrites(): number };
  graybox: { styleWrites(): number; nodeCount(): number };
}

export interface FrameMicros {
  samples: number;
  mean: number;
  median: number;
  min: number;
  max: number;
}

export interface PanResult {
  run: "pan";
  frames: number;
  transformWrites: number;
  styleWrites: number;
  frameMicros: FrameMicros;
}

export interface DragResult {
  run: "drag";
  frames: number;
  styleWrites: number;
  transformWrites: number;
  nodeDelta: number;
  frameMicros: FrameMicros;
}

// --- the scripted-drag system (defined ONCE at module scope; strata's schema
//     registry throws on duplicate names, so these must not be re-declared) ---

/** Demo-only flag the drag system's runIf gates on (design-002 §4 runIf doctrine). */
const DragActive = defineResource("demo:DragActive", { on: field("bool", { default: false }) });

/** Module-scope so the once-defined system body can see the current target. */
let dragTarget: Entity | undefined;

const dragQuery = defineQuery([Position, Size]);

/**
 * Moves the single `dragTarget` by a few world units per frame. It matches the
 * whole [Position, Size] set and early-continues the 9,999 non-targets — the
 * in-body filter still blanket-stamps `access.write: [Position]` (expected), so
 * the gray-box reflector wakes; its change-only cache keeps DOM writes at one.
 */
const dragSystem = defineSystem(
  dragQuery,
  (batch, ctx) => {
    const target = dragTarget;
    if (target === undefined) return;
    const px = batch.col(Position).x;
    const py = batch.col(Position).y;
    for (const r of batch) {
      if (batch.entity(r) !== target) continue;
      ctx.edit(target).set(Position, { x: (px[r] as number) + 2, y: (py[r] as number) + 1 });
    }
  },
  {
    name: "scriptedDrag",
    access: { write: [Position] },
    runIf: (ctx) => ctx.getResource(DragActive)?.on === true,
  },
);

function stats(samples: readonly number[]): FrameMicros {
  if (samples.length === 0) return { samples: 0, mean: 0, median: 0, min: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = n >> 1;
  const median = n % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
  return {
    samples: n,
    mean: Math.round((sum / n) * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
  };
}

function collectMicros(engine: Engine, samples: number[]): void {
  const frame = engine.lastFrame();
  if (frame !== undefined) samples.push(frame.totalMicros);
}

export function scriptedPan(
  engine: Engine,
  reflectors: HarnessReflectors,
  frames = 300,
): PanResult {
  const world = engine.world;
  let now = performance.now();

  // Warm-up: consume first-paint (plane writes 1, gray-box mounts N) so the
  // measured deltas are steady-state only.
  engine.step(now);
  now += 16;

  const plane0 = reflectors.plane.transformWrites();
  const style0 = reflectors.graybox.styleWrites();
  const micros: number[] = [];

  for (let i = 0; i < frames; i++) {
    const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
    world.setResource(Camera, { ...cam, x: cam.x + 3, y: cam.y + 1 });
    engine.step(now);
    now += 16;
    collectMicros(engine, micros);
  }

  const result: PanResult = {
    run: "pan",
    frames,
    transformWrites: reflectors.plane.transformWrites() - plane0,
    styleWrites: reflectors.graybox.styleWrites() - style0,
    frameMicros: stats(micros),
  };
  reportPan(result);
  return result;
}

export function scriptedDrag(
  engine: Engine,
  reflectors: HarnessReflectors,
  frames = 300,
): DragResult {
  const world = engine.world;
  const removeSystem = engine.addSystems("simulate", dragSystem);
  dragTarget = pickTarget(engine);
  let now = performance.now();

  // Warm-up with the drag OFF: first-paint mounts all N boxes, then the deltas
  // below measure only the steady-state per-frame churn.
  world.setResource(DragActive, { on: false });
  engine.step(now);
  now += 16;

  world.setResource(DragActive, { on: true });
  const style0 = reflectors.graybox.styleWrites();
  const plane0 = reflectors.plane.transformWrites();
  const nodes0 = reflectors.graybox.nodeCount();
  const micros: number[] = [];

  for (let i = 0; i < frames; i++) {
    engine.step(now);
    now += 16;
    collectMicros(engine, micros);
  }

  const result: DragResult = {
    run: "drag",
    frames,
    styleWrites: reflectors.graybox.styleWrites() - style0,
    transformWrites: reflectors.plane.transformWrites() - plane0,
    nodeDelta: reflectors.graybox.nodeCount() - nodes0,
    frameMicros: stats(micros),
  };

  world.setResource(DragActive, { on: false });
  dragTarget = undefined;
  removeSystem();
  reportDrag(result);
  return result;
}

/** The first live entity of the drag query (deterministic given the seeded scene). */
function pickTarget(engine: Engine): Entity | undefined {
  let picked: Entity | undefined;
  engine.world.query(dragQuery).each((batch) => {
    if (picked !== undefined) return;
    for (const r of batch) {
      picked = batch.entity(r);
      break;
    }
  });
  return picked;
}

function reportPan(r: PanResult): void {
  console.table({
    "scripted pan": {
      frames: r.frames,
      "transform writes": `${r.transformWrites} (expect ${r.frames})`,
      "graybox style writes": `${r.styleWrites} (expect 0)`,
      "frame µs median": r.frameMicros.median,
      "frame µs mean": r.frameMicros.mean,
    },
  });
}

function reportDrag(r: DragResult): void {
  console.table({
    "scripted drag": {
      frames: r.frames,
      "graybox style writes": `${r.styleWrites} (expect ${r.frames})`,
      "transform writes": `${r.transformWrites} (expect 0)`,
      "node count delta": `${r.nodeDelta} (expect 0)`,
      "frame µs median": r.frameMicros.median,
      "frame µs mean": r.frameMicros.mean,
    },
  });
}

/** Wire `p` → scriptedPan, `d` → scriptedDrag on the document. Returns a detach fn. */
export function installHarnessHotkeys(engine: Engine, reflectors: HarnessReflectors): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "p") scriptedPan(engine, reflectors);
    else if (e.key === "d") scriptedDrag(engine, reflectors);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
