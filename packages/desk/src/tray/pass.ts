// THE TRAY PASS — the pegboard drawer on the GPU (design-017 §5–§6; K3): one pipeline, one draw of one quad in the ROOT's render pass
// after the marks — the view whole while the desk is dimmed (the dim, the drawer's shadows, the board: each pixel drawn once), the
// drawer's box and its shadows' reach while it is closed — where tray.wgsl shades the rim
// and the research board in closed form. Its light is the DESK's: a block of the mat's own struct carrying the theme's light, the
// root grid's shadow grade and the frame's blue-noise offset (so `shade_mat` / `night_mat` are the mat's functions, not copies),
// and the research's HOME lamp (D-K3.4). It samples the root mat's blue noise (rebinding when the mat's assets change) and
// its own HASH texture — every value-noise octave's four lattice corners pre-gathered in one texel (`hashTexels`), made once.
// Both blocks are uploaded only when they change. Labelled `tray/pegboard` (the pipeline, the bind group, a debug group).

import { bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import { defineStruct } from "../engine/struct";
import type { View } from "../lattice/lod";
import type { GridConfig } from "../mat/grid";
import { type MatFrame, MatUniforms, NOISE_SIZE } from "../mat/layout";
import type { MatPass } from "../kit/view";
import { lightValues } from "../mat/night";
import type { GroundTheme } from "../theme";
import { DRAWER, type DrawerRect, drawerRect } from "./drawer";
import { carry, PEG } from "./lattice";
import { TRAY_LOOK } from "./look";
import type { TrayShaders } from "./shaders";

/** The tray this frame (the renderer's flux — design-017 §3): where the slide is, the lip's lift, and the SHOWN scroll. */
export interface TrayFrameInputs {
  /** The slide as drawn: 0 closed (the lip alone) … 1 open. */
  readonly p: number;
  /** The lip's hover lift, 0 … 1. */
  readonly lift: number;
  /** The SHOWN scroll — CSS px of board past its top, the band included; any size (its whole rows are carried on the CPU). */
  readonly scroll: number;
}

/** The tray's own block (tray.wgsl `t`). */
export const TrayUniforms = defineStruct("TrayUniforms", [
  ["view", "vec4f"],     // the view: CSS width, height, dpr, the pitch (CSS px)
  ["rect", "vec4f"],     // the drawer as drawn (drawer.ts `drawerRect`): left, top, width, full height — CSS px
  ["rowBase", "i32"],    // THE CARRY (lattice.ts): the shown scroll's whole rows…
  ["frac", "f32"],       // …and the fraction of a row, the only part of the scroll in an f32
  ["fp", "f32"],         // pitches per device px — the footprint every band fades by
  ["dim", "f32"],        // the dim's alpha this frame
  ["shape", "vec4f"],    // the top corners' radius, the rim, the notch's half-width and depth — CSS px
  ["hole", "vec4f"],     // the stadium's radius and straight half-length, the rim fillet k, the solid side border — pitches
  ["depth", "vec4f"],    // the board's thickness, the gap to the wall — pitches; the phase: columns, rows
  ["lamp", "vec4f"],     // the unit direction to the lamp (x right, y down, z toward the eye), its angular radius (rad)
  ["room", "vec4f"],     // the room's shadow round the outline: σ, α; the notch's join radius — CSS px
  ["shadow", "vec4f"],   // the lamp's shadow: σ, α, its push along the lamp's ground direction (x, y) — CSS px
  ["face", "vec4f"],     // the tempered face, linear
  ["faceSrgb", "vec4f"], // …and its configured byte (sRGB): the plain face's colour lit flat
  ["edge", "vec4f"],     // the punched fibre, linear
  ["wall", "vec4f"],     // the plaster, linear
  ["cavity", "vec4f"],   // the room's light on the wall in a hole: at its edge, at its heart, over what width (pitches)
  ["keepFace", "vec4f"], // each band's share at this footprint (tray.wgsl, the research's fade): the face's grain (≈ 19 a pitch), —, 85, 190…
  ["keepFine", "vec4f"], // …its 210 (bump) · 42 · 105 (flecks)…
  ["keepEdge", "vec4f"], // …and the punched fibre's 9 · 18 · 36
]);

type TrayField = (typeof TrayUniforms.fields)[number][0];
type MatField = (typeof MatUniforms.fields)[number][0];

const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** What the last prepare laid (a rig's and a check's witness): the rect, the carry, the dim. */
export interface TrayLaid {
  readonly rect: DrawerRect;
  readonly rowBase: number;
  readonly frac: number;
  readonly dim: number;
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
  private group: GPUBindGroup | null = null;
  private boundAssets = -1;
  private last: TrayLaid | null = null;

  private constructor(device: GPUDevice, mat: MatPass, pipeline: GPURenderPipeline, layout: GPUBindGroupLayout) {
    this.device = device;
    this.mat = mat;
    this.pipeline = pipeline;
    this.layout = layout;
    this.sampler = device.createSampler({ label: "tray/pegboard/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    this.trayBuf = uniformBuffer(device, TrayUniforms.size, "tray/pegboard/uniforms");
    this.lightBuf = uniformBuffer(device, MatUniforms.size, "tray/pegboard/light");
    this.hash = device.createTexture({ label: "tray/pegboard/hash", size: [HASH_SIZE, HASH_SIZE], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: this.hash }, hashTexels(), { bytesPerRow: HASH_SIZE * 4 }, [HASH_SIZE, HASH_SIZE]);
  }

  /** The pipeline on `format`, sampling `mat`'s blue noise (the root's: its assets are every slot's). */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: TrayShaders, mat: MatPass): Promise<TrayPass> {
    const module = await compile(device, compose({ structs: [MatUniforms, TrayUniforms], modules: src.modules, entry: src.entry }));
    const layout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 2, stages: ["fragment"], texture: "float" },
      { binding: 3, stages: ["fragment"], sampler: "filtering" },
      { binding: 4, stages: ["fragment"], texture: "float" },
    ], "tray/pegboard");
    const pl = device.createPipelineLayout({ label: "tray/pegboard", bindGroupLayouts: [layout] });
    const pipeline = await renderPipeline(device, { label: "tray/pegboard", layout: pl, module, format, blend: BLEND_PREMUL });
    return new TrayPass(device, mat, pipeline, layout);
  }

  /**
   * Lay the drawer out for this frame and upload what changed (before the frame's pass begins): the view, the theme's light, the
   * root grid's grade, the frame's noise offset. Returns the quads that will draw: one (the view whole while it dims, else
   * the drawer's box).
   */
  prepare(view: View & { readonly dpr: number }, theme: GroundTheme, grid: GridConfig, frame: MatFrame | undefined, inputs: TrayFrameInputs): number {
    const P = DRAWER.pitch;
    const p = Math.min(Math.max(inputs.p, 0), 1);
    const rect = drawerRect(view.width, view.height, p, Math.min(Math.max(inputs.lift, 0), 1));
    const { rowBase, frac } = carry(inputs.scroll, P);
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
      shape: [DRAWER.radius, DRAWER.rim, DRAWER.notch.w / 2, DRAWER.notch.h],
      hole: [PEG.holeR, PEG.holeHalf, PEG.rimK, PEG.border],
      depth: [PEG.thick, PEG.gap, PEG.colPhase, PEG.rowPhase],
      lamp: [L[0], L[1], L[2], T.lampSize],
      room: [Rm.sigma, Rm.alpha, DRAWER.notchRound, 0],
      shadow: [S.sigma, S.alpha, (-L[0] / g) * S.push, (-L[1] / g) * S.push],
      face: [...T.face, 0], faceSrgb: [...T.faceSrgb, 0], edge: [...T.edge, 0], wall: [...T.wall, 0],
      cavity: [T.cavity.edge, T.cavity.heart, T.cavity.width, 0],
      keepFace: [keep(fp, 6 * Math.sqrt(10)), 0, keep(fp, 85), keep(fp, 190)],
      // the flecks fade by their cell; their strokes are anti-aliased in the shader (tray.wgsl `peg_flecks`)
      keepFine: [keep(fp, 210), keep(fp, 42), keep(fp, 105), 0],
      keepEdge: [keep(fp, 9), keep(fp, 18), keep(fp, 36), 0],
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
    this.last = { rect, rowBase, frac, dim };
    return 1;
  }

  /** A block to the GPU only when its bytes moved since the last upload (a drawer at rest costs no write). */
  private upload(buf: GPUBuffer, bytes: Uint8Array<ArrayBuffer>, sent: Uint8Array): void {
    let same = this.sent;
    for (let i = 0; same && i < bytes.length; i++) if (bytes[i] !== sent[i]) same = false;
    if (same) return;
    sent.set(bytes);
    this.device.queue.writeBuffer(buf, 0, bytes);
  }

  /** The drawer into the open pass — over everything drawn so far (the caller left the scissor on the whole view). */
  draw(pass: GPURenderPassEncoder): void {
    const laid = this.last;
    if (laid === null) return;
    if (this.group === null || this.boundAssets !== this.mat.assetVersion) {
      this.group = bindGroup(this.device, this.layout, [this.lightBuf, this.trayBuf, this.mat.noiseTexture.createView(), this.sampler, this.hash.createView()], "tray/pegboard");
      this.boundAssets = this.mat.assetVersion;
    }
    pass.pushDebugGroup("tray/pegboard");
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6);
    pass.popDebugGroup();
  }

  /** What the last prepare laid (a rig's witness). */
  get laid(): TrayLaid | null { return this.last; }

  dispose(): void { this.trayBuf.destroy(); this.lightBuf.destroy(); this.hash.destroy(); }
}
