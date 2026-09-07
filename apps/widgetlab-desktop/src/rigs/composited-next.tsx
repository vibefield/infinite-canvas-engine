/**
 * The B2 exit witness (design-013 §8 B2): the NEW composited profile boots through the
 * REAL React path — `<InfiniteCanvas profile={compositedNextProfile} ground={groundCompose(…)}>`
 * — on the app-owned device, to a ground with no cards. Three claims, each measured:
 *
 *  1. it mounts: one canvas in the L0 slot, the ground available, at least one redraw and
 *     one real submit, zero uncaptured GPU errors;
 *  2. idle-zero: over a quiet window it submits nothing (the instrument counts at
 *     `queue.submit`, so nothing can hide work);
 *  3. it is alive: a camera write is one more redraw and one more submit.
 *
 * Mounted from `composited-next.html`, driven by `scripts/composited-next.mjs`.
 */
import { acquireCompositorDevice, Camera, type EngineGpu } from "@ice/core";
import { instrumentSubmits, type SubmitInstrument } from "@ice/ground";
import { groundCompose, type GroundComposeContext, type GroundComposeHandle } from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { compositedNextProfile, InfiniteCanvas } from "@ice/react";
import { createRoot } from "react-dom/client";
import { createDemoEngine } from "../App";

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly available: boolean;
  readonly redraws: number;
  readonly submits: number;
  readonly gpuErrors: number;
  readonly viewport: string;
}
interface NextRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  idle(ms: number): Promise<{ frames: number; submits: number; redraws: number }>;
  nudge(): Promise<{ submits: number; redraws: number }>;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };

function mountNextRig(): NextRig {
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let handle: GroundComposeHandle | null = null;
  let engine: ReturnType<typeof createDemoEngine> | undefined;
  const rootEl = document.getElementById("root") as HTMLElement;

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    engine = createDemoEngine(gpu);
    const factory = groundCompose({ device: gpu.device, theme: THEMES.dark });
    const ground = (ctx: GroundComposeContext) => { handle = factory(ctx); return handle; };
    createRoot(rootEl).render(
      <InfiniteCanvas engine={engine} ground={ground} profile={compositedNextProfile} className="h-full w-full" />,
    );
    await frames(2);
  })();

  const snapshot = (): Mounted => ({
    profile: compositedNextProfile.name,
    canvases: rootEl.querySelectorAll("canvas").length,
    available: handle?.compose.available() ?? false,
    redraws: handle?.compose.redraws() ?? 0,
    submits: instrument?.total() ?? 0,
    gpuErrors: gpu?.errors().length ?? 0,
    viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
  });

  return {
    ready,
    async mount() {
      await ready;
      // the pipelines compile asynchronously; wait for the first real paint (bounded)
      for (let i = 0; i < 300 && !(handle?.compose.available() && (handle?.compose.redraws() ?? 0) > 0); i++) await frame();
      return snapshot();
    },
    async idle(ms) {
      const submits0 = instrument?.total() ?? 0;
      const redraws0 = handle?.compose.redraws() ?? 0;
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < ms) { await frame(); n++; }
      return { frames: n, submits: (instrument?.total() ?? 0) - submits0, redraws: (handle?.compose.redraws() ?? 0) - redraws0 };
    },
    async nudge() {
      const submits0 = instrument?.total() ?? 0;
      const redraws0 = handle?.compose.redraws() ?? 0;
      const world = (engine as NonNullable<typeof engine>).world;
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      // a rig SETUP write, outside the tick — the same debt the S6 rig carries
      world.setResource(Camera, { ...cam, x: cam.x + 40 });
      await frames(6);
      return { submits: (instrument?.total() ?? 0) - submits0, redraws: (handle?.compose.redraws() ?? 0) - redraws0 };
    },
  };
}

declare global {
  interface Window { __nextRig?: NextRig }
}
window.__nextRig = mountNextRig();
