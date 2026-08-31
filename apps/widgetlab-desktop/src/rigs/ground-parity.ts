/**
 * The S1 exit rig: does device injection change the pixels?
 *
 * S1's claim is that the composited profile "renders ground alone", identical
 * to the stratified render of the same ground config — the only difference
 * being WHO created the GPUDevice. That is not a safe assumption, it is a
 * question with a real way to be no: three's own adapter request asks for
 * `featureLevel: 'compatibility'` (WebGPUBackend.js:213), a compatibility
 * device lacks `core-features-and-limits`, and three then force-sets
 * `renderer._samples = 0` (:254-258). So the STRATIFIED path runs with MSAA
 * off and the COMPOSITED path (a core device, by rule 1 of
 * `acquireCompositorDevice`) runs with it on. If any ground geometry has an
 * edge, the two renders can legitimately differ — and that is a finding, not a
 * failure.
 *
 * THE CONTROL IS THE POINT. A diff between two renders means nothing without
 * knowing what two IDENTICAL renders score, so the rig runs
 * stratified → stratified → composited and reports A-vs-A beside A-vs-B. It
 * also refuses to grade a blank: two empty canvases compare perfectly equal,
 * which is the easiest way for a pixel test to pass while proving nothing, so
 * every capture is checked for real content first.
 *
 * Mounted from `ground-parity.html`, driven by `scripts/ground-parity.mjs`.
 */
import {
  acquireCompositorDevice,
  Camera,
  createEngine,
  createWorld,
  DEFAULT_GRID_CONFIG,
  Viewport,
  type EngineGpu,
  type GridConfig,
} from "@ice/core";
import { ground, instrumentSubmits, type SubmitInstrument } from "@ice/ground";

export type Variant = "stratified" | "composited";

/**
 * A deliberately high-contrast, deterministic ground: dot glyphs (needles
 * orient along a field, and with no poles and no widgets that field is zero —
 * degenerate, not wrong, but nothing to compare), widget sources off, no zoom
 * fade. Determinism first: this rig compares two renders, so anything that
 * varies frame to frame would be measuring itself.
 */
const GRID: Partial<GridConfig> = {
  ...DEFAULT_GRID_CONFIG,
  spacings: [40, 200, 1000],
  dotColor: [0.95, 0.6, 0.2],
  dotAlpha: 1,
  dotRadius: [1.6, 1.6],
  levelWeight: [1, 0],
  magnet: { glyph: "dot", widgets: false, fadeZoom: 0, maxSources: 0 },
};

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface CaptureStats {
  readonly id: string;
  readonly variant: Variant;
  readonly width: number;
  readonly height: number;
  /** Distinct RGBA values — 1 means a flat fill, i.e. nothing was drawn. */
  readonly distinctColors: number;
  /** Pixels differing from the top-left (background) sample. */
  readonly inkPixels: number;
  /** FNV-1a over the whole buffer; equal hashes ⇒ identical images. */
  readonly hash: string;
  /** Did the ground layer report itself available, and how many times did it draw? */
  readonly available: boolean;
  readonly redraws: number;
  /** Composited runs only: device facts worth pinning. */
  readonly coreFeatures?: boolean;
  readonly deviceAdopted?: boolean;
  /**
   * Does the device three ACTUALLY ended up on carry
   * `core-features-and-limits`? Measured on BOTH arms, because this is the one
   * documented way the two paths can render differently: three reads exactly
   * this flag to decide `compatibilityMode`, and compatibilityMode force-sets
   * `renderer._samples = 0` — MSAA off. Reading it on the stratified arm turns
   * "three asks for a compatibility adapter (source line :213)" from a citation
   * into a measurement.
   */
  readonly adoptedHasCoreFeatures?: boolean;
}

export interface DiffResult {
  readonly a: string;
  readonly b: string;
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingPct: number;
  readonly maxChannelDelta: number;
  readonly meanAbsDelta: number;
}

const captures = new Map<string, Capture>();
let seq = 0;

// --- one live mount at a time ------------------------------------------------

interface Mount {
  dispose(): void;
  canvas: HTMLCanvasElement;
  redraws(): number;
  available(): boolean;
  step(): void;
  /** three's actual backend device (the ground layer's diagnostic seam). */
  adoptedDevice(): GPUDevice | undefined;
  submits?: SubmitInstrument;
  gpu?: EngineGpu;
  deviceAdopted?: boolean;
}
let live: Mount | null = null;

async function mount(variant: Variant): Promise<Mount> {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;overflow:hidden";
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);

  const world = createWorld();
  const engine = createEngine(world);
  // Fixed camera and viewport: the comparison is of renderers, not of layout.
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, {
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
  });

  let gpu: EngineGpu | undefined;
  let submits: SubmitInstrument | undefined;
  if (variant === "composited") {
    gpu = await acquireCompositorDevice();
    // Before three exists — the instrument must see three's submits too.
    submits = instrumentSubmits(gpu.device);
  }

  const layer = ground({
    grid: GRID,
    ...(gpu !== undefined ? { device: gpu.device } : {}),
  })({ host: { container, contentPlane }, world });

  engine.registerReflector(layer.reflector);
  if (layer.compositorReflector !== undefined) engine.registerReflector(layer.compositorReflector);

  const canvas = container.querySelector("canvas");
  if (canvas === null) throw new Error("ground mounted no canvas");

  let now = 0;
  const m: Mount = {
    canvas,
    redraws: () => layer.reflector.redraws(),
    available: () => layer.reflector.available(),
    adoptedDevice: () => layer.device(),
    step: () => {
      now += 16;
      engine.step(now);
    },
    dispose() {
      layer.dispose();
      container.remove();
      // The device is NOT destroyed with the layer — that is the point of
      // app ownership (§4), and three never destroys an injected one.
      submits?.detach();
      gpu?.destroy();
    },
    ...(submits !== undefined ? { submits } : {}),
    ...(gpu !== undefined ? { gpu } : {}),
  };

  return m;
}

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Step until the layer is ready and has painted, plus a settle margin. */
async function settle(m: Mount, maxFrames = 600): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    m.step();
    await raf();
    if (m.available() && m.redraws() > 0) break;
  }
  for (let i = 0; i < 5; i++) {
    m.step();
    await raf();
  }
}

/**
 * Read the ground canvas back.
 *
 * MEASURED, not assumed (2026-08-31, Electron 43.1.1): `drawImage` from a LIVE
 * WebGPU canvas into a 2D context returns a fully blank image — via
 * OffscreenCanvas, via an in-DOM canvas, and via `createImageBitmap(canvas)`
 * alike, all three silently, with no error. `toDataURL()` on the same canvas
 * DOES snapshot it (125 KB of real PNG). So the route is: snapshot to PNG,
 * decode that, and draw the DECODED IMAGE — the source is then an ordinary
 * bitmap rather than a live swap chain.
 *
 * The base64 is decoded by hand rather than with `fetch(dataUrl)`, which the
 * page's own CSP (`connect-src 'self'`) refuses.
 *
 * Kept separate from the Electron screenshot the driver also takes: two
 * witnesses at different layers, because one witness can agree with itself
 * about a defect.
 */
async function grab(canvas: HTMLCanvasElement): Promise<Capture> {
  const width = canvas.width;
  const height = canvas.height;
  const url = canvas.toDataURL("image/png");
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const off = new OffscreenCanvas(width, height);
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context for readback");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

function statsOf(id: string, variant: Variant, cap: Capture, m: Mount): CaptureStats {
  const { data, width, height } = cap;
  // Background is the MODAL colour, not the corner sample: on this ground the
  // top-left pixel lands ON a grid dot, so a corner-as-background metric
  // reported the whole canvas as ink and the dots as background — inverted,
  // and passing.
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const px =
      ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }
  const adopted = m.adoptedDevice();
  let modeCount = 0;
  for (const n of counts.values()) if (n > modeCount) modeCount = n;
  const total = data.length / 4;
  const ink = total - modeCount;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const colors = counts;
  return {
    id,
    variant,
    width,
    height,
    distinctColors: colors.size,
    inkPixels: ink,
    hash: hash.toString(16).padStart(8, "0"),
    available: m.available(),
    redraws: m.redraws(),
    ...(m.gpu !== undefined ? { coreFeatures: m.gpu.hasCoreFeatures } : {}),
    ...(m.deviceAdopted !== undefined ? { deviceAdopted: m.deviceAdopted } : {}),
    ...(adopted === undefined ? {} : { adoptedHasCoreFeatures: adopted.features.has("core-features-and-limits") }),
  };
}

export interface Rig {
  run(variant: Variant): Promise<CaptureStats>;
  diff(a: string, b: string): DiffResult;
  /** Submits over `ms` of genuine idleness on the LIVE composited mount. */
  idleSubmits(ms: number): Promise<{ submits: number; frames: number; redraws: number }>;
  teardown(): void;
}

const rig: Rig = {
  async run(variant) {
    live?.dispose();
    live = null;
    const m = await mount(variant);
    live = m;
    await settle(m);
    if (m.gpu !== undefined) {
      // The difference between "the option was accepted" and "three is sitting
      // on the very device we created". Only the second one is adoption.
      m.deviceAdopted = m.adoptedDevice() === m.gpu.device;
    }
    const id = `c${++seq}`;
    const cap = await grab(m.canvas);
    captures.set(id, cap);
    return statsOf(id, variant, cap, m);
  },

  diff(aId, bId) {
    const a = captures.get(aId);
    const b = captures.get(bId);
    if (a === undefined || b === undefined) throw new Error(`unknown capture ${aId}/${bId}`);
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    }
    let differing = 0;
    let maxDelta = 0;
    let sumDelta = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      let pixelDiffers = false;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
        if (d > 0) pixelDiffers = true;
        if (d > maxDelta) maxDelta = d;
        sumDelta += d;
      }
      if (pixelDiffers) differing++;
    }
    const total = a.data.length / 4;
    return {
      a: aId,
      b: bId,
      totalPixels: total,
      differingPixels: differing,
      differingPct: (differing / total) * 100,
      maxChannelDelta: maxDelta,
      meanAbsDelta: sumDelta / a.data.length,
    };
  },

  async idleSubmits(ms) {
    const m = live;
    if (m?.submits === undefined) throw new Error("no instrumented composited mount is live");
    // Settle first: boot work is not idleness.
    await settle(m);
    m.submits.reset();
    const redrawsBefore = m.redraws();
    const t0 = performance.now();
    let frames = 0;
    while (performance.now() - t0 < ms) {
      // The real loop: step the engine every frame and touch NOTHING else.
      m.step();
      await raf();
      frames++;
    }
    return {
      submits: m.submits.total(),
      frames,
      redraws: m.redraws() - redrawsBefore,
    };
  },

  teardown() {
    live?.dispose();
    live = null;
  },
};

declare global {
  interface Window {
    __groundParityRig?: Rig;
  }
}
window.__groundParityRig = rig;
console.log("[rig] ground-parity ready");
