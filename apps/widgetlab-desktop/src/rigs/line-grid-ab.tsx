/**
 * The C1d RECORDED A/B (design-013 §8, D-C1.4 + D-C2.1): the OLD TSL line grid
 * and the NEW engine `line` glyph, drawn in ONE page, on ONE device, at three
 * zooms, from the same camera into the same viewport — and read back.
 *
 * It is a RECORD, not a gate. D-C2.1 ruled that the new glyph's LOD is the
 * engine's lattice (`mid = 20·10^k`, `fine = mid/10`, `coarse = mid·10`, with
 * `fadeIn` only) and not the old decade ladder (three fixed `spacings` with
 * `fadeIn`/`fadeOut`/`levelWeight`), so the two do not draw the same lines and
 * the glyph is NOT tuned to make them. What this rig owes is the honest number
 * and a description of the difference: what each arm's dominant rung pitch is,
 * what its ink measures, and how far apart the two pictures are.
 *
 * What it DOES fail on: a GPU error, a blank readback (the
 * webgpu-canvas-readback-is-blank class — a blank arm would "match" anything),
 * or an A-vs-A control that is not 0. Each arm is captured TWICE in the same
 * run and diffed against itself first; a control above 0 means the measurement
 * is worthless and the numbers below it mean nothing.
 *
 * Both arms render into an offscreen texture at the same device size and are
 * read back as raw bytes — no canvas, no PNG, no colour management between the
 * pixel and the number. The ground clears to black and so does three, because
 * black is the one value no transfer function moves: what is left in the frame
 * is the grid, and the arms' inks are directly comparable.
 *
 * Mounted from `line-grid-ab.html`, driven by `scripts/line-grid-ab.mjs`.
 */
import { acquireCompositorDevice } from "@ice/core";
import {
  beginPass,
  DEFAULT_FIELD_CONFIG,
  Field,
  type FieldConfig,
  type FieldFrame,
  GROUND_SHADERS,
  LINE_GLYPH,
  readback,
  Target,
} from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import type { GroundProgramInput } from "@ice/ground";
import { lineGridGroundProgram } from "@ice/ground/programs/line-grid";
import { OrthographicCamera, RenderTarget, Scene, SRGBColorSpace, WebGPURenderer } from "three/webgpu";

const FORMAT: GPUTextureFormat = "rgba8unorm";
const CSS_W = 600;
const CSS_H = 400;
const DPR = 2;
const W = CSS_W * DPR;
const H = CSS_H * DPR;
/** The oracle's camera, so the two witnesses talk about the same world point. */
const CAM = { x: 13.7, y: -21.3 };
/** D-C2.1's three: one decade below the identity, the identity, and mid-decade above it. */
const ZOOMS = [0.5, 1, 2.5] as const;

interface Capture {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

interface ArmStats {
  /** Fraction of pixels with any ink at all (the blank guard). */
  readonly inkPct: number;
  /** The brightest channel byte in the frame — the arm's ink as it lands. */
  readonly peak: number;
  /** The colour of the brightest pixel, as bytes. */
  readonly peakRgb: readonly [number, number, number];
  /** Median gap, DEVICE px, between the VERTICAL lines of the strongest rung. */
  readonly pitchX: number;
  /** …and between the HORIZONTAL lines of the same rung: a square lattice's two answers must agree. */
  readonly pitchY: number;
  readonly linesX: number;
  readonly linesY: number;
  /** Median gap between the vertical lines of EVERY rung that draws at all — the finest live one's pitch. */
  readonly finePitchX: number;
  readonly fineLinesX: number;
  /** The first vertical line centres, device px from the left — the phase, for the alignment row. */
  readonly firstX: readonly number[];
  readonly firstY: readonly number[];
}

interface Diff {
  /** The worst COLOUR delta, and the worst delta on alpha — kept apart, they mean different things. */
  readonly maxRgbDelta: number;
  readonly maxAlphaDelta: number;
  readonly differingPct: number;
  readonly meanAbsRgbDelta: number;
}

interface ZoomRow {
  readonly zoom: number;
  readonly old: ArmStats;
  readonly new: ArmStats;
  readonly ab: Diff;
  readonly controlOld: Diff;
  readonly controlNew: Diff;
  /** The worst distance, device px, from a NEW line to the nearest OLD one (x, y) — only meaningful when the pitches match. */
  readonly alignX: number;
  readonly alignY: number;
  /** What the new arm's field reported: the surface program that drew, and whether it baked. */
  readonly surface: string | null;
  readonly baked: boolean;
}

interface Report {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly cam: { readonly x: number; readonly y: number };
  readonly rows: readonly ZoomRow[];
  readonly gpuErrors: readonly string[];
  readonly backend: string;
  /** Both arms at each zoom, as PNG data URLs — the record's pictures; the script writes them out. */
  readonly shots: ReadonlyArray<{ readonly zoom: number; readonly old: string; readonly new: string }>;
}

function diff(a: Capture, b: Capture): Diff {
  const n = Math.min(a.data.length, b.data.length);
  let differing = 0;
  let maxRgb = 0;
  let maxAlpha = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
      sum += d;
      if (d > worst) worst = d;
    }
    const da = Math.abs((a.data[i + 3] as number) - (b.data[i + 3] as number));
    if (da > maxAlpha) maxAlpha = da;
    if (worst > 0) differing += 1;
    if (worst > maxRgb) maxRgb = worst;
  }
  const px = n / 4;
  return { maxRgbDelta: maxRgb, maxAlphaDelta: maxAlpha, differingPct: (differing / px) * 100, meanAbsRgbDelta: sum / (px * 3) };
}

/** For each of `b`'s line centres, the distance to the nearest of `a`'s — the phase check between the arms. */
function alignment(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return -1;
  let worst = 0;
  for (const x of b) {
    let best = Number.POSITIVE_INFINITY;
    for (const y of a) best = Math.min(best, Math.abs(x - y));
    if (best > worst) worst = best;
  }
  return worst;
}

/**
 * three hands back what `copyTextureToBuffer` wrote: rows padded to WebGPU's
 * 256-byte alignment (`WebGPUTextureUtils.copyTextureToBuffer`), NOT a tight
 * W×H×4. At 1200 px wide that is 4864 bytes a row against 4800 of pixels, and
 * reading it tightly skews every row 16 px further left than the last — a
 * picture that still looks like a grid and measures like nothing. `readback()`
 * does the same for the ground's own captures; this is the same undo.
 */
function unpad(raw: Uint8Array, width: number, height: number): Uint8Array {
  const tight = width * 4;
  if (raw.length === tight * height) return new Uint8Array(raw.slice(0));
  const stride = Math.ceil(tight / 256) * 256;
  const expected = (height - 1) * stride + tight;
  if (raw.length !== expected) throw new Error(`line-ab: a readback of ${raw.length} bytes is neither tight (${tight * height}) nor padded (${expected})`);
  const out = new Uint8Array(tight * height);
  for (let y = 0; y < height; y++) out.set(raw.subarray(y * stride, y * stride + tight), y * tight);
  return out;
}

/** The median of a list of gaps (0 when there are none). */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * The centres of the runs in a line PROFILE at or above `floor`, and the gaps
 * between them. The profile is the MEAN down a column (or across a row), never
 * the max: a vertical line lights its whole column, but the horizontal lines
 * crossing it light one pixel of every column — a max profile says every column
 * is a line, which is how this rig first measured nothing.
 */
function runs(profile: Float64Array, floor: number): { centres: number[]; gaps: number[] } {
  const centres: number[] = [];
  let start = -1;
  for (let x = 0; x <= profile.length; x++) {
    const lit = x < profile.length && (profile[x] as number) >= floor;
    if (lit && start < 0) start = x;
    else if (!lit && start >= 0) {
      centres.push((start + x - 1) / 2);
      start = -1;
    }
  }
  const gaps: number[] = [];
  for (let i = 1; i < centres.length; i++) gaps.push((centres[i] as number) - (centres[i - 1] as number));
  return { centres, gaps };
}

const peakOf = (profile: Float64Array): number => { let t = 0; for (const v of profile) if (v > t) t = v; return t; };

function statsOf(cap: Capture): ArmStats {
  const { width, height, data } = cap;
  const cols = new Float64Array(width);
  const rows = new Float64Array(height);
  let ink = 0;
  let peak = 0;
  let peakRgb: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r > 0 || g > 0 || b > 0) ink += 1;
      cols[x] = (cols[x] as number) + l / height;
      rows[y] = (rows[y] as number) + l / width;
      const m = Math.max(r, g, b);
      if (m > peak) {
        peak = m;
        peakRgb = [r, g, b];
      }
    }
  }
  // the STRONGEST rung: the lines within half of the brightest profile value.
  // every LIVE rung: anything a twentieth of it and up — a faint fading-in rung included.
  const topX = peakOf(cols);
  const topY = peakOf(rows);
  const strongX = runs(cols, topX * 0.5);
  const strongY = runs(rows, topY * 0.5);
  const allX = runs(cols, Math.max(topX * 0.05, 0.05));
  return {
    inkPct: (ink / (width * height)) * 100,
    peak,
    peakRgb,
    pitchX: median(strongX.gaps),
    pitchY: median(strongY.gaps),
    linesX: strongX.centres.length,
    linesY: strongY.centres.length,
    finePitchX: median(allX.gaps),
    fineLinesX: allX.centres.length,
    firstX: strongX.centres.slice(0, 4),
    firstY: strongY.centres.slice(0, 4),
  };
}

/**
 * A capture as a PNG data URL, for the eye. Alpha is forced opaque: an arm whose
 * frame carries alpha 0 would otherwise read as a blank picture, which is exactly
 * the confusion this record exists to avoid.
 */
function toPng(cap: Capture): string {
  const canvas = document.createElement("canvas");
  canvas.width = cap.width;
  canvas.height = cap.height;
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("line-ab: no 2d context for the record's picture");
  const bytes = new Uint8ClampedArray(cap.data);
  for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
  g.putImageData(new ImageData(bytes, cap.width, cap.height), 0, 0);
  return canvas.toDataURL("image/png");
}

/** The NEW arm: the engine's `line` glyph through the real `Field`, into a readable target. */
class NewArm {
  private readonly device: GPUDevice;
  private readonly field: Field;
  private readonly target: Target;
  last: { surface: string | null; baked: boolean } = { surface: null, baked: false };

  private constructor(device: GPUDevice, field: Field, target: Target) {
    this.device = device;
    this.field = field;
    this.target = target;
  }

  static async create(device: GPUDevice): Promise<NewArm> {
    const field = await Field.create(device, FORMAT, GROUND_SHADERS.field);
    return new NewArm(device, field, new Target(device, { format: FORMAT, label: "line-ab/new", readable: true }, W, H));
  }

  async capture(zoom: number): Promise<Capture> {
    const theme = THEMES.dark;
    const frame: FieldFrame = {
      view: { camX: CAM.x, camY: CAM.y, zoom, width: CSS_W, height: CSS_H, dpr: DPR },
      pointer: { x: 0, y: 0, on: false },
    };
    const config: FieldConfig = { ...DEFAULT_FIELD_CONFIG, glyph: LINE_GLYPH, ink: theme.fieldInk, inkAlpha: theme.fieldInkAlpha };
    this.field.config = config;
    const encoder = this.device.createCommandEncoder({ label: "line-ab/new" });
    this.field.prepare(encoder, frame, [], theme);
    const pass = beginPass(encoder, this.target.view, [0, 0, 0, 1], "line-ab/new");
    const stats = this.field.draw(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.last = { surface: stats.surface, baked: stats.baked };
    const data = await readback(this.device, this.target.texture, 4);
    return { width: W, height: H, data };
  }

  dispose(): void {
    this.field.dispose();
    this.target.dispose();
  }
}

/** The OLD arm: `lineGridGroundProgram`'s TSL mesh through three's WebGPURenderer, into a render target. */
class OldArm {
  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  // the mesh's `vertexNode` writes clip space itself (programs/line-grid-renderer.ts), so the
  // camera decides nothing about the picture — three only needs a real one to render at all
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly rt: RenderTarget;
  private readonly instance: ReturnType<ReturnType<typeof lineGridGroundProgram>["create"]>;

  private constructor(renderer: WebGPURenderer, scene: Scene, rt: RenderTarget, instance: OldArm["instance"]) {
    this.renderer = renderer;
    this.scene = scene;
    this.rt = rt;
    this.instance = instance;
  }

  static async create(device: GPUDevice): Promise<OldArm> {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const renderer = new WebGPURenderer({ canvas, device, alpha: true, antialias: false });
    await renderer.init();
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    const instance = lineGridGroundProgram({ id: "line-ab" }).create();
    const scene = new Scene();
    scene.add(instance.object);
    const rt = new RenderTarget(W, H, { depthBuffer: false, stencilBuffer: false, samples: 0 });
    // the old leg never sets a colour space, so three's default output conversion applies
    // on the canvas; a render target only applies it when its texture says sRGB — this
    // makes the offscreen arm what the old leg actually puts on screen.
    rt.texture.colorSpace = SRGBColorSpace;
    return new OldArm(renderer, scene, rt, instance);
  }

  async capture(zoom: number): Promise<Capture> {
    // `collect` reads nothing off its input — the line grid is analytic (programs/line-grid.ts)
    this.instance.collect({} as unknown as GroundProgramInput, { width: CSS_W, height: CSS_H, dpr: DPR, camera: { x: CAM.x, y: CAM.y, zoom } }, { opacity: 1 });
    this.renderer.setRenderTarget(this.rt);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear(true, false, false);
    await this.renderer.renderAsync(this.scene, this.camera);
    const raw = await this.renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, W, H);
    this.renderer.setRenderTarget(null);
    return { width: W, height: H, data: unpad(raw as Uint8Array, W, H) };
  }

  get backend(): string {
    const b = this.renderer.backend as { isWebGPUBackend?: boolean; isWebGLBackend?: boolean };
    return b.isWebGPUBackend === true ? "webgpu" : b.isWebGLBackend === true ? "webgl2" : "unknown";
  }

  dispose(): void {
    this.instance.dispose();
    this.rt.dispose();
    this.renderer.dispose();
  }
}

async function run(): Promise<Report> {
  const gpu = await acquireCompositorDevice();
  const oldArm = await OldArm.create(gpu.device);
  const newArm = await NewArm.create(gpu.device);
  const rows: ZoomRow[] = [];
  const shots: Array<{ zoom: number; old: string; new: string }> = [];
  try {
    for (const zoom of ZOOMS) {
      // each arm twice, in the same run: the A-vs-A control that says the measurement is real
      const old1 = await oldArm.capture(zoom);
      const old2 = await oldArm.capture(zoom);
      const new1 = await newArm.capture(zoom);
      const surface = newArm.last;
      const new2 = await newArm.capture(zoom);
      const oldStats = statsOf(old1);
      const newStats = statsOf(new1);
      shots.push({ zoom, old: toPng(old1), new: toPng(new1) });
      rows.push({
        zoom,
        old: oldStats,
        new: newStats,
        ab: diff(old1, new1),
        alignX: alignment(oldStats.firstX, newStats.firstX),
        alignY: alignment(oldStats.firstY, newStats.firstY),
        controlOld: diff(old1, old2),
        controlNew: diff(new1, new2),
        surface: surface.surface,
        baked: surface.baked,
      });
    }
  } finally {
    newArm.dispose();
  }
  const backend = oldArm.backend;
  oldArm.dispose();
  return {
    width: W, height: H, dpr: DPR, cam: CAM, rows, backend, shots,
    gpuErrors: gpu.errors().map((e) => `${e.type}: ${e.message}`),
  };
}

declare global {
  interface Window {
    __lineAb?: { ready: Promise<void>; run(): Promise<Report> };
  }
}

const root = document.getElementById("root");
if (root) root.textContent = "line-ab: the old TSL line grid against the engine's `line` glyph — driven by scripts/line-grid-ab.mjs";
window.__lineAb = { ready: Promise.resolve(), run };
