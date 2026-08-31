/**
 * Headless CPU proxy for the legacy ground → typed GroundHost change.
 *
 * This intentionally proves only orchestration/collect overhead and redraw
 * parity. The renderer is a no-op seam; real WebGPU/WebGL2 GPU and visual
 * evidence comes from widgetlab's ?evidence=1 browser matrix.
 */
import {
  Camera,
  Viewport,
  createEngine,
  createWorld,
  defineCanvasType,
} from "@ice/core";
import type { Camera as ThreeCamera, Scene } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  ground,
  groundHost,
  type GroundFactory,
  type GroundRendererLike,
} from "../src/index";
import { magnetGridGroundProgram } from "../src/programs/magnet-grid";

const ID = "bench:ground:magnet";
const BenchCanvas = defineCanvasType({
  id: "bench:canvas",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { ground: { program: ID } },
});

// The per-frame work is only a few microseconds with a no-op renderer. Long
// blocks keep scheduler/timer quantization from masquerading as regression.
const WARMUP = 1_000;
const IDLE_FRAMES = 20_000;
const CAMERA_FRAMES = 10_000;
const REPEATS = 7;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function fakeRenderer(doc: Document): GroundRendererLike & { renders: number } {
  const result: GroundRendererLike & { renders: number } = {
    canvas: doc.createElement("canvas"),
    renders: 0,
    ready: () => true,
    failed: () => false,
    status: () => ({ backend: "unknown", ready: true, failed: false }),
    onReady: (cb) => cb(),
    setSize: () => {},
    render(_scene: Scene, _camera: ThreeCamera) {
      result.renders += 1;
    },
    dispose: () => {},
  };
  return result;
}

function makeRig(variant: "legacy" | "typed") {
  const world = createWorld();
  const engine = createEngine(world);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 1_440, h: 900, dpr: 1 });
  const container = document.createElement("div");
  container.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1_440,
    bottom: 900,
    width: 1_440,
    height: 900,
    toJSON: () => ({}),
  }) as DOMRect;
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);
  const renderer = fakeRenderer(document);
  const factory: GroundFactory = variant === "legacy"
    ? ground({ rendererOverride: renderer })
    : groundHost({
        programs: [magnetGridGroundProgram({ id: ID })],
        fallback: ID,
        rendererOverride: renderer,
      });
  const layer = factory({
    host: { container, contentPlane },
    world,
    readWirePreview: () => ({ active: false, compatible: false, sx: 0, sy: 0, tx: 0, ty: 0 }),
    readSpatial: () => [],
    canvas: {
      type: () => BenchCanvas,
      subscribe: () => () => {},
    },
  });
  const unregister = engine.registerReflector(layer.reflector);
  let now = 0;
  const run = (frames: number, cameraMotion: boolean): { usPerFrame: number; redraws: number } => {
    const before = layer.reflector.redraws();
    const started = performance.now();
    for (let i = 0; i < frames; i += 1) {
      if (cameraMotion) {
        world.setResource(Camera, {
          x: i % 2 === 0 ? 0.5 : -0.5,
          y: 0,
          zoom: 1,
          gesturing: true,
        });
      }
      now += 16;
      engine.step(now);
    }
    return {
      usPerFrame: ((performance.now() - started) / frames) * 1_000,
      redraws: layer.reflector.redraws() - before,
    };
  };
  return {
    run,
    dispose() {
      unregister();
      layer.dispose();
      container.remove();
    },
  };
}

describe("legacy vs typed ground CPU proxy", () => {
  it.runIf(process.env.BENCH === "1")("records idle and camera-motion parity", () => {
    const legacy = makeRig("legacy");
    const typed = makeRig("typed");
    legacy.run(WARMUP, true);
    typed.run(WARMUP, true);
    const idleLegacy: number[] = [];
    const idleTyped: number[] = [];
    const cameraLegacy: number[] = [];
    const cameraTyped: number[] = [];
    let idleRedrawsLegacy = 0;
    let idleRedrawsTyped = 0;
    let cameraRedrawsLegacy = 0;
    let cameraRedrawsTyped = 0;

    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      const order = repeat % 2 === 0 ? [legacy, typed] : [typed, legacy];
      for (const rig of order) {
        const idle = rig.run(IDLE_FRAMES, false);
        const camera = rig.run(CAMERA_FRAMES, true);
        if (rig === legacy) {
          idleLegacy.push(idle.usPerFrame);
          cameraLegacy.push(camera.usPerFrame);
          idleRedrawsLegacy += idle.redraws;
          cameraRedrawsLegacy += camera.redraws;
        } else {
          idleTyped.push(idle.usPerFrame);
          cameraTyped.push(camera.usPerFrame);
          idleRedrawsTyped += idle.redraws;
          cameraRedrawsTyped += camera.redraws;
        }
      }
    }

    const il = median(idleLegacy);
    const it = median(idleTyped);
    const cl = median(cameraLegacy);
    const ct = median(cameraTyped);
    const pct = (candidate: number, baseline: number): string => {
      const value = ((candidate - baseline) / baseline) * 100;
      return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
    };
    console.log(`
ground host CPU proxy (no-op renderer, ${REPEATS} alternating repeats):
  phase         | legacy us/frame | typed us/frame | delta    | redraws legacy/typed
  idle          | ${il.toFixed(3).padStart(15)} | ${it.toFixed(3).padStart(14)} | ${pct(it, il).padStart(8)} | ${idleRedrawsLegacy}/${idleRedrawsTyped}
  camera motion | ${cl.toFixed(3).padStart(15)} | ${ct.toFixed(3).padStart(14)} | ${pct(ct, cl).padStart(8)} | ${cameraRedrawsLegacy}/${cameraRedrawsTyped}
`);

    expect(idleRedrawsLegacy).toBe(0);
    expect(idleRedrawsTyped).toBe(0);
    expect(cameraRedrawsLegacy).toBe(CAMERA_FRAMES * REPEATS);
    expect(cameraRedrawsTyped).toBe(CAMERA_FRAMES * REPEATS);
    expect(il).toBeGreaterThan(0);
    expect(it).toBeGreaterThan(0);
    legacy.dispose();
    typed.dispose();
  });
});
