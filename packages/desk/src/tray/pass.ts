// THE TRAY PASS — the pegboard drawer on the GPU (design-017 §5–§6; K3): one pipeline, one draw of one quad in the ROOT's render pass
// after the marks — the view whole while the desk is dimmed (the dim, the drawer's shadows, the board: each pixel drawn once); shut
// (p 0) it lies wholly below the view with its shadows and NOTHING is laid, uploaded or drawn (design-018 §5) — where tray.wgsl shades the
// research board in closed form to its edge (the arris, design-018 §2). Its light is the DESK's: a block of the mat's own struct carrying the theme's light, the
// root grid's shadow grade and the frame's blue-noise offset (so `shade_mat` / `night_mat` are the mat's functions, not copies),
// and the research's HOME lamp (D-K3.4). That block is the tray's OWN, never a slot's view block: K-L3 binds a slot's kinds, and the
// drawer is screen-space chrome drawn in no slot — the desk's camera, box, clocks, portal chain and presence are nothing to it, only
// the light's words are — so its program asks the kit for the struct and the mat's light by name (shaders.ts) and binds its own.
// It samples the root mat's blue noise (rebinding when the mat's assets change) and
// its own HASH texture — every value-noise octave's four lattice corners pre-gathered in one texel (`hashTexels`), made once.
// Both blocks are uploaded only when they change. Labelled `tray/pegboard` (the pipeline, the bind group, a debug group).

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer } from "../engine/pipeline";
import type { StructBuffer } from "../engine/struct";
import { compile, compose } from "../engine/shader";
import type { View } from "../lattice/lod";
import type { GridConfig } from "../mat/grid";
import { type MatFrame, MatUniforms, NOISE_SIZE } from "../mat/layout";
import type { MatPass } from "../kit/view";
import { lightValues } from "../mat/night";
import type { GroundTheme } from "../theme";
import { DRAWER, type DrawerRect, drawerRect } from "./drawer";
import { carry, PEG } from "./lattice";
import { TrayAccessoryStruct, TrayUniforms } from "./layout";
import { TRAY_LOOK } from "./look";
import type { TrayShaders } from "./shaders";
import { accessoryOf, type TrayCarriedFrame, type TraySpecimenFrame } from "./specimens";

/** The tray this frame (the renderer's flux — design-017 §3): where the slide is, and the SHOWN scroll. */
export interface TrayFrameInputs {
  /** The slide as drawn: 0 closed (wholly off the view — nothing drawn) … 1 open. */
  readonly p: number;
  /** The SHOWN scroll — CSS px of board past its top, the band included; any size (its whole rows are carried on the CPU). */
  readonly scroll: number;
  /** K5a: the specimens this frame (tray/specimens.ts) — their accessories are the pass's, their pixels their kinds'; absent = none. */
  readonly specimens?: readonly TraySpecimenFrame[];
  /** K5b: what is CARRIED this frame (tray/carry.ts) — the lifted copy, a ghost growing out of it or shrinking home — over the drawer, whole. */
  readonly carried?: readonly TrayCarriedFrame[];
}

type TrayField = (typeof TrayUniforms.fields)[number][0];
type AccessoryField = (typeof TrayAccessoryStruct.fields)[number][0];
type MatField = (typeof MatUniforms.fields)[number][0];

const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** What the last prepare laid (a rig's and a check's witness): the rect, the carry, the dim, the accessories' records (screen px). */
export interface TrayLaid {
  readonly rect: DrawerRect;
  readonly rowBase: number;
  readonly frac: number;
  readonly dim: number;
  readonly accessories: readonly ReturnType<typeof accessoryOf>[];
}

/** The research's pcg (shader.js `pcg`), in 32-bit integer arithmetic. */
function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** The hash texture's side: the noise tiles every 256 lattice cells (for a band of F per pitch, every 256/F pitches). */
export const HASH_SIZE = 256;

/**
 * The PRE-GATHERED noise (design-017 §6.7), 256² rgba8 — each texel the four corners one value-noise lookup interpolates, so a band is
 * ONE load: texel (i, j) holds the research's hash of lattice points (i, j), (i+1, j), (i, j+1), (i+1, j+1) (`pcg(i ^ pcg(j))`, its
 * top 8 bits), wrapping at the side; each band reads it at its own offset. It tiles every 256 cells of a band's lattice.
 */
export function hashTexels(): Uint8Array<ArrayBuffer> {
  const N = HASH_SIZE;
  const h = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) { const r = pcg(j); for (let i = 0; i < N; i++) h[j * N + i] = pcg((i ^ r) >>> 0) >>> 24; }
  const out = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      const j1 = (j + 1) % N;
      const o = (j * N + i) * 4;
      out[o] = h[j * N + i] as number;
      out[o + 1] = h[j * N + i1] as number;
      out[o + 2] = h[j1 * N + i] as number;
      out[o + 3] = h[j1 * N + i1] as number;
    }
  }
  return out;
}

/** A band of F cycles per pitch at a footprint of `fp` pitches per device px: kept while a cycle spans ≥ 4 px, gone at 2 (tray.wgsl's fade). */
export function keep(fp: number, F: number): number {
  const x = Math.min(Math.max((fp * F - 0.25) / 0.25, 0), 1);
  return 1 - x * x * (3 - 2 * x);
}

export class TrayPass {
  private readonly device: GPUDevice;
  private readonly mat: MatPass;
  private readonly pipeline: GPURenderPipeline;
  /** K5a: the accessories' own fragment entry on the same layout (a branch in one entry slowed the board). */
  private readonly accPipeline: GPURenderPipeline;
  /** The VEIL (design-018 rev 5): the plain board laid over everything the drawer holds at its top — its own entries on the same layout. */
  private readonly veilPipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly sampler: GPUSampler;
  private readonly trayBuf: GPUBuffer;
  private readonly lightBuf: GPUBuffer;
  private readonly hash: GPUTexture;
  private readonly tray = TrayUniforms.alloc(1);
  private readonly light = MatUniforms.alloc(1);
  private readonly sentTray = new Uint8Array(TrayUniforms.size);
  private readonly sentLight = new Uint8Array(MatUniforms.size);
  private sent = false;
  /** The quads the last prepare laid: 0 while the drawer is shut (p 0) — then it draws nothing. */
  private quads = 0;
  private group: GPUBindGroup | null = null;
  private boundAssets = -1;
  private last: TrayLaid | null = null;
  // the accessories (K5a): one record per specimen, grown by doubling; uploaded only when their bytes moved
  private acc: StructBuffer<AccessoryField> = TrayAccessoryStruct.alloc(8) as StructBuffer<AccessoryField>;
  private accBuf: GPUBuffer;
  private accSent = new Uint8Array(0);
  private accCount = 0;

  private constructor(device: GPUDevice, mat: MatPass, pipelines: readonly [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline], layout: GPUBindGroupLayout) {
    this.device = device;
    this.mat = mat;
    [this.pipeline, this.accPipeline, this.veilPipeline] = pipelines;
    this.layout = layout;
    this.sampler = device.createSampler({ label: "tray/pegboard/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    this.trayBuf = uniformBuffer(device, TrayUniforms.size, "tray/pegboard/uniforms");
    this.lightBuf = uniformBuffer(device, MatUniforms.size, "tray/pegboard/light");
    this.accBuf = storageBuffer(device, TrayAccessoryStruct.size * 8, "tray/pegboard/accessories");
    this.hash = device.createTexture({ label: "tray/pegboard/hash", size: [HASH_SIZE, HASH_SIZE], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: this.hash }, hashTexels(), { bytesPerRow: HASH_SIZE * 4 }, [HASH_SIZE, HASH_SIZE]);
  }

  /** The pipeline on `format`, sampling `mat`'s blue noise (the root's: its assets are every slot's). */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: TrayShaders, mat: MatPass): Promise<TrayPass> {
    const module = await compile(device, compose(src));
    const layout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 2, stages: ["fragment"], texture: "float" },
      { binding: 3, stages: ["fragment"], sampler: "filtering" },
      { binding: 4, stages: ["fragment"], texture: "float" },
      { binding: 5, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
    ], "tray/pegboard");
    const pl = device.createPipelineLayout({ label: "tray/pegboard", bindGroupLayouts: [layout] });
    const pipelines = await Promise.all([
      renderPipeline(device, { label: "tray/pegboard", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "tray/pegboard/accessories", layout: pl, module, format, blend: BLEND_PREMUL, fragment: "fs_accessory" }),
      renderPipeline(device, { label: "tray/pegboard/veil", layout: pl, module, format, blend: BLEND_PREMUL, vertex: "vs_veil", fragment: "fs_veil" }),
    ]);
    return new TrayPass(device, mat, pipelines as [GPURenderPipeline, GPURenderPipeline, GPURenderPipeline], layout);
  }

  /**
   * Lay the drawer out for this frame and upload what changed (before the frame's pass begins): the view, the theme's light, the
   * root grid's grade, the frame's noise offset. Returns the quads that will draw: one (the view whole while it dims) — none while
   * the drawer is shut (p 0: it and its shadows lie below the view — nothing is uploaded, nothing drawn; design-018 §5).
   */
  prepare(view: View & { readonly dpr: number }, theme: GroundTheme, grid: GridConfig, frame: MatFrame | undefined, inputs: TrayFrameInputs): number {
    const P = DRAWER.pitch;
    const p = Math.min(Math.max(inputs.p, 0), 1);
    const rect = drawerRect(view.width, view.height, p);
    const { rowBase, frac } = carry(inputs.scroll, P);
    if (p <= 0) {
      this.last = { rect, rowBase, frac, dim: 0, accessories: [] };
      this.quads = 0;
      return 0;
    }
    const L = TRAY_LOOK.lamp;
    const g = Math.hypot(L[0], L[1]) || 1;
    const S = DRAWER.shadow.lamp;
    const Rm = DRAWER.shadow.room;
    const fp = 1 / (P * view.dpr);
    const dim = (DRAWER.dim.day + (DRAWER.dim.night - DRAWER.dim.day) * Math.min(Math.max(theme.matLight.night, 0), 1)) * p;
    const T = TRAY_LOOK;
    const values: Partial<Record<TrayField, number | readonly number[]>> = {
      view: [view.width, view.height, view.dpr, P],
      rect: [rect.x, rect.y, rect.w, rect.h],
      rowBase, frac, fp, dim,
      shape: [DRAWER.radius, DRAWER.arris, DRAWER.inner.alpha, DRAWER.inner.width],
      hole: [PEG.holeR, PEG.holeHalf, PEG.rimK, PEG.border],
      depth: [PEG.thick, PEG.gap, PEG.colPhase, PEG.rowPhase],
      lamp: [L[0], L[1], L[2], T.lampSize],
      room: [Rm.sigma, Rm.alpha, 0, 0],
      shadow: [S.sigma, S.alpha, (-L[0] / g) * S.push, (-L[1] / g) * S.push],
      face: [...T.face, 0], faceSrgb: [...T.faceSrgb, 0], edge: [...T.edge, 0],
      cavity: [T.cavity.edge, T.cavity.heart, T.cavity.width, 0],
      keepFace: [keep(fp, 6 * Math.sqrt(10)), 0, keep(fp, 85), keep(fp, 190)],
      // the flecks fade by their cell; their strokes are anti-aliased in the shader (tray.wgsl `peg_flecks`)
      keepFine: [keep(fp, 210), keep(fp, 42), keep(fp, 105), 0],
      keepEdge: [keep(fp, 9), keep(fp, 18), keep(fp, 36), 0],
      accessory: [...T.accessory, T.accessoryShadow],
      fade: [DRAWER.fade, DRAWER.header, 0, 0],
    };
    this.tray.set(values);
    const gobo = grid.mat.gobo;
    const noise = frame?.noise ?? [0, 0];
    const light: Partial<Record<MatField, number | readonly number[]>> = {
      gobo: [gobo.opacity, gobo.blurTexels, gobo.shadeMix, gobo.darkFloor],
      grade: [gobo.saturate, 0, 0, 0],
      noise: [noise[0], noise[1], 1 / NOISE_SIZE, 0],
      ...lightValues(theme.matLight),
    };
    this.light.set(light);
    this.upload(this.trayBuf, this.tray.view(), this.sentTray);
    this.upload(this.lightBuf, this.light.view(), this.sentLight);
    this.sent = true;
    const accessories = (inputs.specimens ?? []).map(accessoryOf);
    this.layAccessories(accessories);
    this.last = { rect, rowBase, frac, dim, accessories };
    this.quads = 1;
    return 1;
  }

  /** The accessories' records to the GPU — grown by doubling, written only when their bytes moved (a drawer at rest costs no write). */
  private layAccessories(list: readonly ReturnType<typeof accessoryOf>[]): void {
    if (list.length > this.acc.count) {
      let n = this.acc.count;
      while (n < list.length) n *= 2;
      this.acc = TrayAccessoryStruct.alloc(n) as StructBuffer<AccessoryField>;
      this.accBuf.destroy();
      this.accBuf = storageBuffer(this.device, TrayAccessoryStruct.size * n, "tray/pegboard/accessories");
      this.accSent = new Uint8Array(0);
      this.group = null;
    }
    for (let i = 0; i < list.length; i++) this.acc.set(list[i] as ReturnType<typeof accessoryOf>, i);
    this.accCount = list.length;
    if (list.length === 0) return;
    const bytes = this.acc.view(list.length);
    let same = bytes.length === this.accSent.length;
    for (let i = 0; same && i < bytes.length; i++) if (bytes[i] !== this.accSent[i]) same = false;
    if (same) return;
    this.accSent = bytes.slice();
    this.device.queue.writeBuffer(this.accBuf, 0, bytes);
  }

  /** A block to the GPU only when its bytes moved since the last upload (a drawer at rest costs no write). */
  private upload(buf: GPUBuffer, bytes: Uint8Array<ArrayBuffer>, sent: Uint8Array): void {
    let same = this.sent;
    for (let i = 0; same && i < bytes.length; i++) if (bytes[i] !== sent[i]) same = false;
    if (same) return;
    sent.set(bytes);
    this.device.queue.writeBuffer(buf, 0, bytes);
  }

  /** A pipeline and the group, bound (the group remade when the mat's assets or the accessories' buffer changed). */
  private bind(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline): void {
    if (this.group === null || this.boundAssets !== this.mat.assetVersion) {
      this.group = bindGroup(this.device, this.layout, [this.lightBuf, this.trayBuf, this.mat.noiseTexture.createView(), this.sampler, this.hash.createView(), this.accBuf], "tray/pegboard");
      this.boundAssets = this.mat.assetVersion;
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.group);
  }

  /**
   * The drawer UNDER its specimens into the open pass — over everything drawn so far (the caller left the scissor on the whole view):
   * the dim, the drawer's shadows, the board to its edge; then each specimen's accessory with its shadow on the board (K5a).
   */
  draw(pass: GPURenderPassEncoder): void {
    if (this.quads === 0) return;
    pass.pushDebugGroup("tray/pegboard");
    this.bind(pass, this.pipeline);
    pass.draw(6, 1, 0, 0);
    if (this.accCount > 0) { pass.setPipeline(this.accPipeline); pass.draw(6, this.accCount, 0, 1); }
    pass.popDebugGroup();
  }

  /**
   * THE VEIL (design-018 rev 5) — LAST, over everything the drawer holds (the caller left the scissor on the whole view): the plain board
   * whole in the header and fading out over its ramp, so what hangs there and the holes behind it fade into the board together — a
   * specimen never turns see-through over a hole. One quad.
   */
  drawVeil(pass: GPURenderPassEncoder): void {
    if (this.quads === 0) return;
    pass.pushDebugGroup("tray/pegboard/veil");
    this.bind(pass, this.veilPipeline);
    pass.draw(6, 1, 0, 0);
    pass.popDebugGroup();
  }

  /** What the last prepare laid (a rig's witness). */
  get laid(): TrayLaid | null { return this.last; }

  dispose(): void { this.trayBuf.destroy(); this.lightBuf.destroy(); this.accBuf.destroy(); this.hash.destroy(); }
}
