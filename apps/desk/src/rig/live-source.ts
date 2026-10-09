// THE RIG'S LIVE SOURCE (M24 LT1 — design-019 §3.2 as a host lends it; `rig.html?live` alone): a `LiveSources` the rigs' harness
// lends through `deskLayer({ services })`, over one OffscreenCanvas per face that the RIG ticks or holds still — so `rig:live` can
// say exactly when something arrived. A face opened by an object's durable key draws its frame 0 at once (the kind's first take lands
// it in the frame that opens it); each `tick` draws the next frame — a ground of its own colour, its number — and says it ARRIVED
// (`arrived()`: outside a frame, coalescing until the kind takes); a take copies the newest frame ONCE into the face's texture
// (`createLiveTexture` on the desk's device, from `deskLayer({ onDevice })`, labelled `rig/live <key>`: the memory ledger shows it
// under `rig`). Every demand the kind sends is logged, so the rig holds it change-only. Never the product's: the product page never
// loads src/rig/.

import { createLiveTexture, type LiveDemand, type LiveFace, type LiveSources, type LiveWriter } from "@ice/desk/kit";

/** The frame size every rig face is drawn at (texels): its level 0. */
export const RIG_LIVE_SIZE = { width: 512, height: 320 } as const;

/** The ground colour of frame `n` — distinct from one frame to the next, so a capture says which one is shown (sRGB). */
export const rigFrameColour = (n: number): readonly [number, number, number] => [(40 + n * 67) % 256, (90 + n * 131) % 256, (160 + n * 29) % 256];

/** One face as the rig sees it: its key and spec, what arrived and was taken, the demands it was sent, its frame and texture. */
export interface RigLiveFaceState {
  readonly key: string;
  readonly spec: Readonly<Record<string, unknown>>;
  /** `arrived()` calls made (each tick of this face, after frame 0). */
  readonly arrivals: number;
  /** `take()` calls asked, and those that copied a frame. */
  readonly asked: number;
  readonly takes: number;
  /** The frame last drawn into its canvas, and the one last copied into its texture (−1: none). */
  readonly frame: number;
  readonly shown: number;
  readonly demands: readonly LiveDemand[];
  readonly closed: boolean;
  /** Its texture as the kind reads it: revision, epoch, bytes (undefined before the first take). */
  readonly texture?: { readonly revision: number; readonly epoch: number; readonly bytes: number; readonly width: number; readonly height: number };
}

export interface RigLive {
  /** What the harness lends: `service(LIVE, live.sources)`. */
  readonly sources: LiveSources;
  /** The desk's device (`deskLayer({ onDevice })`): every face's texture is made on it. */
  device(device: GPUDevice): void;
  /** Draw the next frame into every open face's canvas — or `key`'s alone — and say it arrived. Returns the faces ticked. */
  tick(key?: string): number;
  /** Tick every face `fps` times a second until `hold` (a source that keeps arriving). */
  play(fps: number): void;
  /** Stop playing: the source is QUIET (sends nothing). */
  hold(): void;
  faces(): RigLiveFaceState[];
}

interface Face {
  readonly key: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly arrived: () => void;
  readonly canvas: OffscreenCanvas;
  readonly g: OffscreenCanvasRenderingContext2D;
  writer: LiveWriter | undefined;
  frame: number;
  shown: number;
  pending: boolean;
  arrivals: number;
  asked: number;
  takes: number;
  readonly demands: LiveDemand[];
  closed: boolean;
}

/** The frame's other inks — the fake page's content, numbers as its grounds are (sRGB; never a desk colour: those are the theme's). */
const STRIPE = [255, 255, 255] as const;
const PRINT = [20, 20, 20] as const;

/** A fill of `rgb` at `alpha` on a frame's canvas. */
function fill(g: OffscreenCanvasRenderingContext2D, rgb: readonly [number, number, number], alpha = 1): void {
  g.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`;
}

/** Frame `n` of a face: its ground, a band of stripes that moves with `n`, the number and the key. */
function draw(f: Face, n: number): void {
  const { width: w, height: h } = f.canvas;
  fill(f.g, rigFrameColour(n));
  f.g.fillRect(0, 0, w, h);
  fill(f.g, STRIPE, 0.85);
  for (let x = (n * 24) % 48 - 48; x < w; x += 48) f.g.fillRect(x, h - 40, 24, 24);
  fill(f.g, PRINT, 0.9);
  f.g.font = "bold 72px sans-serif";
  f.g.fillText(String(n), 24, 96);
  f.g.font = "20px monospace";
  f.g.fillText(f.key, 24, 136);
  f.frame = n;
  f.pending = true;
}

export function createRigLive(): RigLive {
  let gpu: GPUDevice | undefined;
  const faces = new Map<string, Face>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = (key?: string): number => {
    let n = 0;
    for (const f of faces.values()) {
      if (f.closed || (key !== undefined && f.key !== key)) continue;
      draw(f, f.frame + 1);
      f.arrivals += 1;
      n += 1;
      f.arrived();
    }
    return n;
  };
  const sources: LiveSources = {
    open(key, spec, arrived) {
      if (faces.get(key)?.closed === false) throw new Error(`rig live: the face "${key}" is open twice — one face per key per desk`);
      const canvas = new OffscreenCanvas(RIG_LIVE_SIZE.width, RIG_LIVE_SIZE.height);
      const g = canvas.getContext("2d");
      if (g === null) throw new Error("rig live: no 2D context on an OffscreenCanvas");
      const f: Face = { key, spec, arrived, canvas, g, writer: undefined, frame: -1, shown: -1, pending: false, arrivals: 0, asked: 0, takes: 0, demands: [], closed: false };
      faces.set(key, f);
      draw(f, 0);   // the first take lands it — nothing arrives for frame 0
      const face: LiveFace = {
        key,
        texture: () => f.writer?.face,
        take() {
          f.asked += 1;
          if (f.closed || !f.pending || gpu === undefined) return false;
          f.writer ??= createLiveTexture(gpu, { label: `rig/live ${key}`, width: RIG_LIVE_SIZE.width, height: RIG_LIVE_SIZE.height });
          f.writer.present(f.canvas);   // ONE copy into level 0
          f.pending = false;
          f.shown = f.frame;
          f.takes += 1;
          return true;
        },
        state: () => (f.closed ? { is: "closed" } : f.shown < 0 ? { is: "starting" } : { is: "live" }),
        info: () => ({ title: `rig ${key}`, extra: { frame: f.shown } }),
        demand(d) { f.demands.push(d); },
        close() {
          if (f.closed) return;
          f.closed = true;
          f.writer?.destroy();
          f.writer = undefined;
        },
      };
      return face;
    },
  };
  return {
    sources,
    device(d) { gpu = d; },
    tick,
    play(fps) {
      if (timer !== undefined) clearInterval(timer);
      timer = setInterval(() => tick(), 1000 / Math.max(1, fps));
    },
    hold() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
    faces: () => [...faces.values()].map((f) => {
      const t = f.writer?.face;
      return {
        key: f.key, spec: f.spec, arrivals: f.arrivals, asked: f.asked, takes: f.takes, frame: f.frame, shown: f.shown, demands: [...f.demands], closed: f.closed,
        ...(t !== undefined ? { texture: { revision: t.revision, epoch: t.epoch, bytes: t.bytes, width: t.width, height: t.height } } : {}),
      };
    }),
  };
}
