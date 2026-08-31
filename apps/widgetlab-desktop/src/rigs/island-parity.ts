/**
 * The S5 exit rig: do islands rendered on the APP-OWNED WebGPU device carry the
 * same pixels as the WebGL islands they replace — and did MSAA, sRGB and
 * orientation survive the swap?
 *
 * Mounted from `island-parity.html`, driven by `scripts/island-parity.mjs`.
 *
 * WHY IT READS RENDER TARGETS RATHER THAN A SCREEN. At S5 the compositor's
 * `WidgetQuadPass` has no `gl` leg yet (S1 shipped the skeleton deliberately
 * without WGSL; the dom leg is landing in the parallel S2 worktree), so there is
 * no composited screen to photograph. But every claim S5 actually makes lives
 * BELOW that seam — the targets render on the shared device, the sources resolve
 * to real GPUTextures, the formats are what the shader will be guarded on — and
 * all of it is reachable by copying the target itself back. three creates every
 * render target with `COPY_SRC` (WebGPUTextureUtils.js:352-364), so this needs
 * nothing from the quad pass and nothing from three.
 *
 * THREE THINGS THIS RIG REFUSES TO DO:
 *
 *  1. Grade a blank. Two empty images compare perfectly equal, and S1 already
 *     paid for this lesson in the ground rig. Every capture is content-checked
 *     (distinct colours, ink pixels) before any diff is believed.
 *  2. Report a diff with no control. "WebGL and WebGPU differ by 3%" is a
 *     confident number about nothing unless you know what two renders of the
 *     SAME backend score. Each arm is captured twice.
 *  3. Assume an orientation. WebGL's `readRenderTargetPixels` reads bottom-up
 *     and WebGPU's `copyTextureToBuffer` reads top-down, so a naive
 *     cross-backend compare is upside down and scores ~100% differing for a
 *     reason that has nothing to do with the renderers. The rig computes BOTH
 *     orientations and reports which one matches — turning the y-flip from an
 *     assumption into a measurement (design-012 §1.2 gotcha 7).
 */
import {
  acquireCompositorDevice,
  createCompositorSourceRegistry,
  type EngineGpu,
  type Entity,
} from "@ice/core";
import {
  RenderTargetPool,
  WebGpuRenderTargetPool,
  createIslandSourceBinder,
  islandIsMultisampled,
  islandIsSrgb,
  backendDevice,
} from "@ice/r3f";
import { createIslandRenderer } from "@ice/r3f/webgpu";
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  TorusKnotGeometry,
  WebGLRenderer,
} from "three";

export type Variant = "stratified" | "composited";

/**
 * Island pixel size. 256 wide keeps `bytesPerRow` (256 × 4 = 1024) on WebGPU's
 * 256-byte alignment with no padding row maths, which removes a whole class of
 * "the readback is subtly sheared" bug from the witness itself.
 */
const PX = 256;

/**
 * Extra SYNCHRONOUS paints before the composited arm's first capture
 * (driver knob: `?warmup=N`).
 *
 * THE FIRST-PAINT TRANSIENT, characterised 2026-08-31 on this host. A freshly
 * built `WebGPURenderer`'s first island paint differs from every later one:
 * 496/65536 px, 84 of them in the opaque INTERIOR, maxDelta 23. Everything
 * after it is bit-identical forever. What the knob established:
 *
 *  - `warmup=0|1|2|3` all produce the SAME first image, so extra synchronous
 *    paints do not converge it — consecutive `render()` calls inside one task
 *    do not re-render.
 *  - Four consecutive READBACKS of one paint are bit-identical, so the copy
 *    path is not the source.
 *  - A repaint after ANY turn of the event loop (a 200 ms sleep works as well
 *    as a readback) converges it, permanently.
 *  - The WebGL arm shows NO such transient: its first paint already equals its
 *    repaint.
 *
 * The mechanism inside three is NOT pinned and is deliberately not guessed at
 * here — `createRenderPipelineAsync` was the obvious suspect and is ruled out
 * (`WebGPUPipelineUtils.js:261` takes the synchronous branch unless
 * `compileAsync()` supplied a promise array, which a plain `render()` never
 * does). What is established is the shape, the bound, and that it converges.
 *
 * Kept as a knob rather than deleted because it is the control that makes the
 * negative half of that finding reproducible.
 */
const WARMUP_PAINTS = Number(new URLSearchParams(location.search).get("warmup") ?? "0");

/**
 * A deliberately DETERMINISTIC and ASYMMETRIC island scene.
 *
 * Deterministic: fixed rotations, no clock, no animation — this rig compares two
 * renders, so anything that varied frame to frame would be measuring itself.
 *
 * Asymmetric: the knot sits ABOVE centre and a small cube sits at the lower
 * LEFT. A vertically symmetric scene cannot detect a y-flip — it compares equal
 * to its own mirror — and a y-flip is exactly one of the things this rig exists
 * to measure. The ink-centroid it produces is the orientation witness.
 */
function buildScene(): { scene: Scene; camera: OrthographicCamera } {
  const scene = new Scene();
  scene.background = null;

  const key = new DirectionalLight(0xffffff, 2.6);
  key.position.set(2.5, 3, 4);
  scene.add(key);

  const material = new MeshStandardMaterial({
    color: new Color(0xffa64d),
    roughness: 0.28,
    metalness: 0.6,
  });

  const knot = new Mesh(new TorusKnotGeometry(26, 8, 180, 24), material);
  knot.position.set(0, 44, 0); // ABOVE centre — the y-flip witness
  knot.rotation.set(0.6, 1.1, 0.2); // fixed pose; never advanced
  scene.add(knot);

  const cube = new Mesh(new BoxGeometry(26, 26, 26), material);
  cube.position.set(-58, -52, 0); // lower LEFT — the x witness
  cube.rotation.set(0.3, 0.5, 0.1);
  scene.add(cube);

  // Island-space convention (kernel Law 13): center-origin, Y-up, sized to the
  // card. Matches what the real compositor pass writes at paint time.
  const camera = new OrthographicCamera(-PX / 2, PX / 2, PX / 2, -PX / 2, 0.1, 2000);
  camera.position.set(0, 0, 500);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

export interface Capture {
  readonly width: number;
  readonly height: number;
  /** RGBA8, ROW 0 = TOP, always — each arm normalises into this convention. */
  readonly data: Uint8ClampedArray;
  /** The raw reader's own row order, before normalisation (the y-flip fact). */
  readonly nativeRowOrder: "top-down" | "bottom-up";
}

export interface CaptureStats {
  readonly id: string;
  readonly variant: Variant;
  readonly width: number;
  readonly height: number;
  readonly distinctColors: number;
  readonly inkPixels: number;
  readonly hash: string;
  /**
   * Vertical centre of mass of the ink, 0 = top row, 1 = bottom row. The scene
   * puts its heavy mass ABOVE centre, so a correctly oriented capture reads
   * < 0.5 and a flipped one reads > 0.5. This is the orientation measurement.
   */
  readonly inkCentroidY: number;
  readonly inkCentroidX: number;
  readonly nativeRowOrder: "top-down" | "bottom-up";
  // --- device facts (composited arm only) ---
  readonly deviceAdopted?: boolean;
  readonly compatibilityMode?: boolean;
  readonly srgbFormat?: boolean;
  readonly multisampled?: boolean;
  readonly sourcesRegistered?: number;
  readonly sourceResolves?: boolean;
  readonly gpuErrors?: number;
}

export interface DiffResult {
  readonly a: string;
  readonly b: string;
  readonly totalPixels: number;
  readonly differingPixels: number;
  readonly differingPct: number;
  readonly maxChannelDelta: number;
  readonly meanAbsDelta: number;
  /** Pixels differing by more than 1/255 in any channel — ignores rounding. */
  readonly differingBeyond1: number;
  /**
   * Of the differing pixels, how many sit on an ANTIALIASED EDGE (partial alpha
   * in either image) versus in the opaque interior of the geometry.
   *
   * This is what turns "0.76% of pixels differ" from a mystery into a diagnosis.
   * Edge-only disagreement is a coverage/resolve difference — the MSAA sample
   * pattern, or the order fragments were resolved in. Interior disagreement
   * would be a shading or colour-space difference, which is a different bug
   * entirely and would mean the sRGB guard is wrong.
   */
  readonly differingOnEdges: number;
  readonly differingInInterior: number;
}

const captures = new Map<string, Capture>();
let seq = 0;

// --- the two arms -------------------------------------------------------------

interface Arm {
  capture(): Promise<Capture>;
  /**
   * Re-run the paint on the SAME renderer and target, then capture again.
   *
   * This separates two questions a single "run it twice" control conflates:
   * "does this renderer produce the same pixels twice?" and "do two freshly
   * constructed renderers agree with each other?". They have different answers
   * (see the rig's findings), and only the first one is a noise floor — the
   * second is a fact about renderer construction.
   */
  repaintAndCapture(): Promise<Capture>;
  stats(): Partial<CaptureStats>;
  dispose(): void;
}

/**
 * STRATIFIED: today's path — a WebGLRenderer, the WebGL FBO pool, an island
 * painted into a `WebGLRenderTarget`.
 */
function stratifiedArm(): Arm {
  const canvas = document.createElement("canvas");
  canvas.width = PX;
  canvas.height = PX;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(1);
  const pool = new RenderTargetPool();
  const { scene, camera } = buildScene();

  const rt = pool.acquire(1, PX, PX, 1);
  const paint = (): void => {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  };
  paint();

  const grab = async (): Promise<Capture> => {
    const buffer = new Uint8Array(PX * PX * 4);
      // WebGL reads with the ORIGIN AT BOTTOM-LEFT — row 0 of this buffer is
      // the BOTTOM of the image. Normalised below so both arms hand back the
      // same convention and the diff compares images rather than conventions.
    renderer.readRenderTargetPixels(rt, 0, 0, PX, PX, buffer);
    return {
      width: PX,
      height: PX,
      data: flipRows(new Uint8ClampedArray(buffer), PX, PX),
      nativeRowOrder: "bottom-up" as const,
    };
  };

  return {
    capture: grab,
    async repaintAndCapture() {
      paint();
      return await grab();
    },
    stats: () => ({}),
    dispose() {
      pool.dispose();
      renderer.dispose();
    },
  };
}

/**
 * COMPOSITED: islands on the app-owned device, published as `gl` sources.
 * Everything here is the shipping code path — the real renderer factory, the
 * real pool, the real binder, core's real registry.
 */
async function compositedArm(gpu: EngineGpu): Promise<Arm> {
  const island = await createIslandRenderer({ device: gpu.device });
  const renderer = island.renderer;
  const pool = new WebGpuRenderTargetPool({ renderer: () => renderer as never });
  const registry = createCompositorSourceRegistry();
  const binder = createIslandSourceBinder({ registry, pool });
  const { scene, camera } = buildScene();

  const rt = pool.acquire(1, PX, PX, 1);
  const paint = (): void => {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  };
  paint();
  if (WARMUP_PAINTS > 0) for (let i = 0; i < WARMUP_PAINTS; i++) paint();

  // Publication is what the frame pass does after a paint; done here so the
  // rig witnesses the real source contract, not a private texture read.
  binder.publish(1);

  const grab = async (): Promise<Capture> => {
    const source = registry.get(1 as Entity);
    if (source?.kind !== "gl") throw new Error("no gl source registered for the island");
    const texture = source.texture();
    if (texture === undefined) throw new Error("the registered gl source resolved no GPUTexture");
    return await readTexture(gpu.device, texture);
  };

  return {
    capture: grab,
    async repaintAndCapture() {
      paint();
      return await grab();
    },
    stats() {
      const source = registry.get(1 as Entity);
      const resolves = source?.kind === "gl" && source.texture() !== undefined;
      const target = pool.targetTexture(1);
      return {
        // Adoption by REFERENCE — "the option was accepted" and "three is
        // sitting on our device" are different claims and only the second one
        // is device sharing.
        deviceAdopted: backendDevice(renderer) === gpu.device,
        compatibilityMode: island.compatibilityMode,
        srgbFormat: target !== undefined && islandIsSrgb(renderer, target),
        multisampled: target !== undefined && islandIsMultisampled(renderer, target),
        sourcesRegistered: registry.size(),
        sourceResolves: resolves,
        gpuErrors: gpu.errors().length,
      };
    },
    dispose() {
      binder.dispose();
      pool.dispose();
      renderer.dispose(); // must NOT destroy the device — three only destroys its own
    },
  };
}

// --- readback -----------------------------------------------------------------

/** Reverse row order in place-ish, returning a new buffer. */
function flipRows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const stride = width * 4;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    out.set(data.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  }
  return out;
}

/**
 * Copy a GPUTexture back to the CPU.
 *
 * `copyTextureToBuffer` reads with the origin at TOP-LEFT, so row 0 is already
 * the top — no normalisation needed on this arm, which is precisely the
 * asymmetry with WebGL that makes the y-flip a real question.
 *
 * `bytesPerRow` must be a multiple of 256; PX = 256 makes it exactly 1024, so
 * there is no padding to strip. Asserted rather than assumed — a padded readback
 * shears the image and still produces a plausible picture.
 */
async function readTexture(device: GPUDevice, texture: GPUTexture): Promise<Capture> {
  const width = texture.width;
  const height = texture.height;
  const bytesPerRow = width * 4;
  if (bytesPerRow % 256 !== 0) {
    throw new Error(`readback needs a 256-aligned bytesPerRow; got ${bytesPerRow} (width ${width})`);
  }
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: "island-readback" });
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const data = new Uint8ClampedArray(buffer.getMappedRange().slice(0));
  buffer.unmap();
  buffer.destroy();
  return { width, height, data, nativeRowOrder: "top-down" };
}

// --- statistics ---------------------------------------------------------------

function statsOf(id: string, variant: Variant, cap: Capture, extra: Partial<CaptureStats>): CaptureStats {
  const { data, width, height } = cap;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const px =
      ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    counts.set(px, (counts.get(px) ?? 0) + 1);
  }
  let modeCount = 0;
  for (const n of counts.values()) if (n > modeCount) modeCount = n;
  const total = data.length / 4;

  // Ink = anything with real alpha. Islands clear to transparent, so alpha is
  // the honest discriminator here (the ground rig used a modal-colour test
  // because ground fills its whole canvas; an island does not).
  let ink = 0;
  let sumY = 0;
  let sumX = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3] ?? 0;
      if (a > 8) {
        ink++;
        sumY += y;
        sumX += x;
      }
    }
  }

  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return {
    id,
    variant,
    width,
    height,
    distinctColors: counts.size,
    inkPixels: ink,
    hash: hash.toString(16).padStart(8, "0"),
    inkCentroidY: ink === 0 ? 0.5 : sumY / ink / (height - 1),
    inkCentroidX: ink === 0 ? 0.5 : sumX / ink / (width - 1),
    nativeRowOrder: cap.nativeRowOrder,
    ...extra,
    // `total` is only used for the mode above; kept out of the row deliberately.
    ...(modeCount === total ? {} : {}),
  };
}

function diffCaptures(a: Capture, b: Capture, flipB: boolean): DiffResult {
  const bData = flipB ? flipRows(b.data, b.width, b.height) : b.data;
  let differing = 0;
  let beyond1 = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  let onEdges = 0;
  let inInterior = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelDiffers = false;
    let pixelBeyond1 = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs((a.data[i + c] ?? 0) - (bData[i + c] ?? 0));
      if (d > 0) pixelDiffers = true;
      if (d > 1) pixelBeyond1 = true;
      if (d > maxDelta) maxDelta = d;
      sumDelta += d;
    }
    if (pixelDiffers) differing++;
    if (pixelBeyond1) {
      beyond1++;
      const alphaA = a.data[i + 3] ?? 0;
      const alphaB = bData[i + 3] ?? 0;
      // Partial alpha in EITHER image means the pixel is on an antialiased
      // silhouette in at least one of the two renders.
      const edge = (alphaA > 0 && alphaA < 255) || (alphaB > 0 && alphaB < 255) || alphaA !== alphaB;
      if (edge) onEdges++;
      else inInterior++;
    }
  }
  const total = a.data.length / 4;
  return {
    a: "",
    b: "",
    totalPixels: total,
    differingPixels: differing,
    differingPct: (differing / total) * 100,
    maxChannelDelta: maxDelta,
    meanAbsDelta: sumDelta / a.data.length,
    differingBeyond1: beyond1,
    differingOnEdges: onEdges,
    differingInInterior: inInterior,
  };
}

// --- GPU cost -----------------------------------------------------------------

export interface CostSample {
  readonly label: string;
  readonly medianMs: number;
  readonly samples: readonly number[];
}

/**
 * Time N island paints on the shared device, wall-clock around a submitted
 * queue with a completion await.
 *
 * MEDIANS, and a NULL CONTROL. The null arm submits an empty encoder, so the
 * reported island cost is the difference between "a frame that drew the island"
 * and "a frame that drew nothing" on the same machine in the same window —
 * which is the only form in which a number from a loaded developer laptop means
 * anything. `onSubmittedWorkDone` is drained once before sampling: the first
 * call bills the arm for whatever the previous one left in flight.
 */
async function measure(
  device: GPUDevice,
  paint: () => void,
  rounds: number,
): Promise<{ island: CostSample; nullControl: CostSample }> {
  const timeOne = async (work: () => void): Promise<number> => {
    const t0 = performance.now();
    work();
    await device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  };
  const emptySubmit = (): void => {
    device.queue.submit([device.createCommandEncoder().finish()]);
  };

  // Drain: the first measurement otherwise carries the previous arm's tail.
  await device.queue.onSubmittedWorkDone();
  for (let i = 0; i < 5; i++) {
    paint();
    await device.queue.onSubmittedWorkDone();
  }

  const islandSamples: number[] = [];
  const nullSamples: number[] = [];
  // INTERLEAVED, so a load spike lands on both arms rather than on one.
  for (let i = 0; i < rounds; i++) {
    islandSamples.push(await timeOne(paint));
    nullSamples.push(await timeOne(emptySubmit));
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
  };
  return {
    island: { label: "island paint", medianMs: median(islandSamples), samples: islandSamples },
    nullControl: { label: "null submit", medianMs: median(nullSamples), samples: nullSamples },
  };
}

// --- the rig ------------------------------------------------------------------

export interface Rig {
  run(variant: Variant): Promise<CaptureStats>;
  /**
   * Repaint and re-capture the LIVE arm — the true noise floor. Distinct from
   * `run()` twice, which also rebuilds the renderer; see `Arm.repaintAndCapture`.
   */
  rerun(): Promise<CaptureStats>;
  /** Re-read the live arm's target WITHOUT repainting — isolates read from paint. */
  recapture(): Promise<CaptureStats>;
  /** Diff two captures as-is (both already normalised to row 0 = top). */
  diff(a: string, b: string): DiffResult;
  /** Diff with B's rows reversed — the orientation control. */
  diffFlipped(a: string, b: string): DiffResult;
  cost(rounds: number): Promise<{ island: CostSample; nullControl: CostSample; loadavg: number | null }>;
  teardown(): void;
}

let gpu: EngineGpu | undefined;
let live: Arm | null = null;
let liveVariant: Variant = "composited";
let liveStats: Partial<CaptureStats> = {};

const rig: Rig = {
  async rerun() {
    if (live === null) throw new Error("no live arm to rerun");
    const cap = await live.repaintAndCapture();
    const id = `c${++seq}`;
    captures.set(id, cap);
    return statsOf(id, liveVariant, cap, liveStats);
  },

  async recapture() {
    if (live === null) throw new Error("no live arm to recapture");
    const cap = await live.capture();
    const id = `c${++seq}`;
    captures.set(id, cap);
    return statsOf(id, liveVariant, cap, liveStats);
  },

  async run(variant) {
    live?.dispose();
    live = null;
    let extra: Partial<CaptureStats> = {};
    if (variant === "composited") {
      gpu ??= await acquireCompositorDevice();
      const arm = await compositedArm(gpu);
      live = arm;
      extra = arm.stats();
    } else {
      live = stratifiedArm();
    }
    liveVariant = variant;
    liveStats = extra;
    const cap = await live.capture();
    const id = `c${++seq}`;
    captures.set(id, cap);
    return statsOf(id, variant, cap, extra);
  },

  diff(aId, bId) {
    const a = captures.get(aId);
    const b = captures.get(bId);
    if (a === undefined || b === undefined) throw new Error(`unknown capture ${aId}/${bId}`);
    return { ...diffCaptures(a, b, false), a: aId, b: bId };
  },

  diffFlipped(aId, bId) {
    const a = captures.get(aId);
    const b = captures.get(bId);
    if (a === undefined || b === undefined) throw new Error(`unknown capture ${aId}/${bId}`);
    return { ...diffCaptures(a, b, true), a: aId, b: bId };
  },

  async cost(rounds) {
    gpu ??= await acquireCompositorDevice();
    const island = await createIslandRenderer({ device: gpu.device });
    const pool = new WebGpuRenderTargetPool({ renderer: () => island.renderer as never });
    const { scene, camera } = buildScene();
    const rt = pool.acquire(1, PX, PX, 1);
    const paint = (): void => {
      island.renderer.setRenderTarget(rt);
      island.renderer.setClearColor(0x000000, 0);
      island.renderer.clear(true, true, false);
      island.renderer.render(scene, camera);
      island.renderer.setRenderTarget(null);
    };
    try {
      const out = await measure(gpu.device, paint, rounds);
      return { ...out, loadavg: null };
    } finally {
      pool.dispose();
      island.renderer.dispose();
    }
  },

  teardown() {
    live?.dispose();
    live = null;
    gpu?.destroy();
    gpu = undefined;
  },
};

declare global {
  interface Window {
    __islandParityRig?: Rig;
  }
}
window.__islandParityRig = rig;
console.log("[rig] island-parity ready");
