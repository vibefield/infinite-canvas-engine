/**
 * The scripted measurement harness — the M3 exit numbers, "measured, not
 * asserted" (docs/implementation-plan.md M3), now driven through the REAL M4
 * interaction stack.
 *
 *  - scriptedPan (design-002 §5 O(1) pan): a held pan drag driven ENTIRELY
 *    through the input queue — synthetic pointer down + one move per frame. The
 *    real L0→L2→cameraControl path moves the Camera resource; the property under
 *    test is unchanged from M3: the plane-transform reflector writes exactly ONE
 *    transform per moving frame (it observes Camera) and the gray-box reflector
 *    writes ZERO styles (a camera move stamps no Position/Size). Pan cost stays
 *    independent of node count — now proven end-to-end, not by a direct Camera poke.
 *
 *  - scriptedDrag (design-001 §7 churn budget): a `simulate` system moves ONE
 *    entity per frame through the honest in-tick value-write path
 *    (`ctx.edit().set(Position)`), camera untouched. Per frame: exactly ONE
 *    gray-box style write (the change-only cache suppresses the other 9,999), ZERO
 *    plane-transform writes, and a stable live node count.
 *
 * A warm-up `step` precedes every measured window so first-paint is NOT charged
 * to the steady-state deltas.
 */
import {
  Camera,
  defineQuery,
  defineResource,
  defineSystem,
  type Engine,
  type Entity,
  field,
  type InputEvent,
  type InputQueue,
  NO_MODS,
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

/** A synthetic mouse InputEvent (canvas pan driver — no picking in the harness ⇒ canvas capture). */
function mouseEvent(kind: InputEvent["kind"], x: number, y: number, buttons: number): InputEvent {
  return { kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS };
}

export function scriptedPan(
  engine: Engine,
  reflectors: HarnessReflectors,
  queue: InputQueue,
  frames = 300,
): PanResult {
  let now = performance.now();

  // Warm-up: consume first-paint (plane writes 1, gray-box mounts N).
  engine.step(now);
  now += 16;

  // Begin a held pan on empty canvas: down, then a slop-exit move → RoutedPan.
  // The harness stack runs the pan tool with no picking installed, so the drag
  // captures the canvas and routes to pan (never a widget move).
  let px = 400;
  const py = 300;
  queue.enqueue(mouseEvent("down", px, py, 1));
  engine.step(now);
  now += 16;
  px += 20; // 20px > drag slop → Active this frame (total 0, no camera move yet)
  queue.enqueue(mouseEvent("move", px, py, 1));
  engine.step(now);
  now += 16;

  const plane0 = reflectors.plane.transformWrites();
  const style0 = reflectors.graybox.styleWrites();
  const micros: number[] = [];

  for (let i = 0; i < frames; i++) {
    px += 3; // one per-frame delta → cameraControl pans at current zoom
    queue.enqueue(mouseEvent("move", px, py, 1));
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

  // Release (not measured — inertia after this point is outside the window).
  queue.enqueue(mouseEvent("up", px, py, 0));
  engine.step(now);

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
export function installHarnessHotkeys(
  engine: Engine,
  reflectors: HarnessReflectors,
  queue: InputQueue,
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "p") scriptedPan(engine, reflectors, queue);
    else if (e.key === "d") scriptedDrag(engine, reflectors);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
