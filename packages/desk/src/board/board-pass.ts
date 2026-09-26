// The board pass — the whiteboards, and the ink on them. Owns, like the note's and the
// notebook's passes, its copy of the mat's uniform block (filled for the slot's camera and
// light every frame, the gobo on only when the mat is the grid), its own knobs, the per-board
// record buffer and the slot's bind group; shares with every slot spawned from the first the
// pipelines, the samplers and the RASTERS — each board's ink (rgba8, premultiplied LINEAR
// colour with its coverage, a full mip chain so a board seen small reads a filtered copy), the
// stroke being laid (r8, max-blended stamps) and the wet layer (r8, fading). Four programs:
// the board on the desk (one quad per board, its raster in group 1), the STAMP, the INK
// (a finished stroke laid into the raster; the wet marked and dried) and the MIP.
//
// The raster is a CACHE of the board's history (history.ts): a stroke is laid live as its
// stamps arrive and committed at the lift; an undo, a redo or a new density REPLAYS the
// history into a cleared raster — stamps are world units, so a replay at any density is the
// same drawing. Uploads are the host's pace: `lay` queues stamps, `prepare` sends them before
// the frame's pass (its own small submit, so the frame's encoder never waits on it).

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import { readback } from "../engine/target";
import type { FadeIn, View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, STILL_MAT_FRAME } from "../mat/layout";
import type { MatPass } from "../mat/mat-pass";
import { DAY_LIGHT, type MatLight } from "../mat/night";
import { BOARD, type GroundTheme, MAT_COLORS, MAT_GRID, type RGB } from "../theme";
import { rasterSize } from "./board";
import type { BoardOp } from "./history";
import { Board, type BoardInstance, BoardUniforms, boardValues, InkUniforms, MAX_BOARDS, Stamp, StampUniforms } from "./layout";
import type { BoardShaders } from "./shaders";
import { STAMP_FLOATS, type Tool } from "./stroke";

/** Premultiplied "source over" — the frames' blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
/** A stroke never darkens where it crosses itself: the footprints meet by MAX. */
const BLEND_MAX: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one", operation: "max" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "max" } };
/** The eraser: ink *= 1 − coverage. */
const BLEND_ERASE: GPUBlendState = { color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" } };
/** The wet fades: dst *= the blend constant. */
const BLEND_DRY: GPUBlendState = { color: { srcFactor: "zero", dstFactor: "constant", operation: "add" }, alpha: { srcFactor: "zero", dstFactor: "constant", operation: "add" } };

/** Stamps one upload carries — a longer stroke replays in chunks. */
export const STAMP_CAP = 1 << 16;
/** How long ink keeps some of its wet after its stroke lands, in `wetSeconds` (the research's six time constants: e⁻⁶ of the wet is left). */
const WET_HOLD = 6;

/** The board's materials the host hands in (lab/theme.ts `BOARD_LOOK`): a marker's barrel, the eraser's felt and back. */
export interface BoardLook { readonly barrel: RGB; readonly felt: RGB; readonly wood: RGB }

interface Raster {
  readonly id: number;
  readonly size: readonly [number, number];
  readonly density: number;
  readonly levels: number;
  readonly ink: GPUTexture;
  readonly stroke: GPUTexture;
  readonly wet: GPUTexture;
  readonly level0: GPUTextureView;
  readonly strokeView: GPUTextureView;
  readonly wetView: GPUTextureView;
  readonly mipDst: readonly GPUTextureView[];
  readonly mipGroups: readonly GPUBindGroup[];
  readonly group: GPUBindGroup;
  readonly inkGroup: GPUBindGroup;
  /** The stroke being laid: its tool and the stamps not yet sent. */
  tool: Tool | null;
  pending: Float32Array[];
  /** The wet layer holds something, and for how many seconds more it fades. */
  wetting: boolean;
  wetLeft: number;
  dryBy: number;
  clearWet: boolean;
}

interface BoardShared {
  readonly device: GPUDevice;
  readonly layout0: GPUBindGroupLayout;
  readonly layout1: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  readonly stampPipeline: GPURenderPipeline;
  readonly stampU: GPUBuffer;
  readonly stampBuf: GPUBuffer;
  readonly stampGroup: GPUBindGroup;
  readonly inkLayout: GPUBindGroupLayout;
  readonly inkU: GPUBuffer;
  readonly inkDraw: GPURenderPipeline;
  readonly inkErase: GPURenderPipeline;
  readonly inkWet: GPURenderPipeline;
  readonly inkDry: GPURenderPipeline;
  readonly mipLayout: GPUBindGroupLayout;
  readonly mipPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly inkSampler: GPUSampler;
  readonly linSampler: GPUSampler;
  readonly rasters: Map<number, Raster>;
  slots: number;
}

export class BoardPass {
  readonly name = "board/whiteboards";
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = BoardUniforms.alloc(1);
  private readonly records = Board.alloc(MAX_BOARDS);
  private readonly stampU = StampUniforms.alloc(1);
  private readonly inkU = InkUniforms.alloc(1);
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private readonly recordBuf: GPUBuffer;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private drawList: GPUBindGroup[] = [];
  /** Each drawn board's index in the list `prepare` was handed (a board whose raster is missing is skipped) — what `drawRange` counts in. */
  private drawnFrom: number[] = [];
  /** The materials a host projects (lab/theme.ts); black until it says. */
  look: BoardLook = { barrel: [0, 0, 0], felt: [0, 0, 0], wood: [0, 0, 0] };
  /** The day's chain on the board: false = a lit melamine shows its configured byte; true = the mat's double gamma. */
  chain = false;
  private readonly device: GPUDevice;
  private readonly shared: BoardShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: BoardShared, mat: MatPass) {
    this.device = device; this.shared = shared; this.mat = mat;
    shared.slots += 1;
    this.matBuf = uniformBuffer(device, MatUniforms.size, "board/mat uniforms");
    this.knobBuf = uniformBuffer(device, BoardUniforms.size, "board/knobs");
    this.recordBuf = storageBuffer(device, Board.size * MAX_BOARDS, "board/boards");
    this.rebind();
  }

  /** The root's pass, on the root's mat. */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: BoardShaders, mat: MatPass): Promise<BoardPass> {
    const layout0 = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], buffer: "uniform" },
      { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 3, stages: ["fragment"], texture: "float" },
      { binding: 4, stages: ["fragment"], sampler: "filtering" },
      { binding: 5, stages: ["fragment"], texture: "float" },
      { binding: 6, stages: ["fragment"], sampler: "filtering" },
      { binding: 7, stages: ["fragment"], sampler: "filtering" },
      { binding: 8, stages: ["fragment"], sampler: "filtering" },
    ], "board/slot");
    const layout1 = bindLayout(device, [
      { binding: 0, stages: ["fragment"], texture: "float" },
      { binding: 1, stages: ["fragment"], texture: "float" },
      { binding: 2, stages: ["fragment"], texture: "float" },
    ], "board/raster");
    const stampLayout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
    ], "board/stamp");
    const inkLayout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], texture: "unfilterable-float" },
    ], "board/ink");
    const mipLayout = bindLayout(device, [
      { binding: 0, stages: ["fragment"], texture: "float" },
      { binding: 1, stages: ["fragment"], sampler: "filtering" },
    ], "board/mip");

    const [boardModule, stampModule, inkModule, mipModule] = await Promise.all([
      compile(device, compose({ structs: [MatUniforms, BoardUniforms, Board], modules: src.board.modules, entry: src.board.entry })),
      compile(device, compose({ structs: [StampUniforms, Stamp], modules: src.stamp.modules, entry: src.stamp.entry })),
      compile(device, compose({ structs: [InkUniforms], modules: src.ink.modules, entry: src.ink.entry })),
      compile(device, compose({ modules: src.mip.modules, entry: src.mip.entry })),
    ]);
    const inkPL = device.createPipelineLayout({ bindGroupLayouts: [inkLayout] });
    const [pipeline, stampPipeline, inkDraw, inkErase, inkWet, inkDry, mipPipeline] = await Promise.all([
      renderPipeline(device, { label: "board/desk", layout: device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] }), module: boardModule, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "board/stamp", layout: device.createPipelineLayout({ bindGroupLayouts: [stampLayout] }), module: stampModule, format: "r8unorm", blend: BLEND_MAX, topology: "triangle-strip" }),
      renderPipeline(device, { label: "board/ink draw", layout: inkPL, module: inkModule, fragment: "fs_draw", format: "rgba8unorm", blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "board/ink erase", layout: inkPL, module: inkModule, fragment: "fs_erase", format: "rgba8unorm", blend: BLEND_ERASE }),
      renderPipeline(device, { label: "board/ink wet", layout: inkPL, module: inkModule, fragment: "fs_wet", format: "r8unorm", blend: BLEND_MAX }),
      renderPipeline(device, { label: "board/ink dry", layout: inkPL, module: inkModule, fragment: "fs_dry", format: "r8unorm", blend: BLEND_DRY }),
      renderPipeline(device, { label: "board/mip", layout: device.createPipelineLayout({ bindGroupLayouts: [mipLayout] }), module: mipModule, format: "rgba8unorm" }),
    ]);
    const stampU = uniformBuffer(device, StampUniforms.size, "board/stamp uniforms");
    const stampBuf = storageBuffer(device, Stamp.size * STAMP_CAP, "board/stamps");
    const linear = { magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" } as const;
    const shared: BoardShared = {
      device, layout0, layout1, pipeline,
      stampPipeline, stampU, stampBuf, stampGroup: bindGroup(device, stampLayout, [stampU, stampBuf], "board/stamp"),
      inkLayout, inkU: uniformBuffer(device, InkUniforms.size, "board/ink uniforms"), inkDraw, inkErase, inkWet, inkDry,
      mipLayout, mipPipeline,
      goboSampler: device.createSampler({ label: "board/gobo", ...linear }),
      noiseSampler: device.createSampler({ label: "board/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      inkSampler: device.createSampler({ label: "board/ink", ...linear, mipmapFilter: "linear" }),
      linSampler: device.createSampler({ label: "board/linear", ...linear }),
      rasters: new Map(), slots: 0,
    };
    return new BoardPass(device, shared, mat);
  }

  /** A second slot on the same pipelines and rasters, reading ITS mat's silhouette — a portal's inside, a flight's departed frame. */
  spawn(mat: MatPass): BoardPass {
    const b = new BoardPass(this.device, this.shared, mat);
    b.copy(this);
    return b;
  }

  /** Copy the root's tuning — what every slot takes each frame. */
  copy(from: BoardPass): void { this.look = from.look; this.chain = from.chain; }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion) return;
    const s = this.shared;
    this.group = bindGroup(this.device, s.layout0, [this.matBuf, this.knobBuf, this.recordBuf, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, s.inkSampler, s.linSampler], "board/slot");
    this.boundAssets = this.mat.assetVersion;
  }

  // ---------------------------------------------------------------- the rasters

  /**
   * The raster board `id` draws with: a melamine `surface` world units across at `density`
   * texels a unit. Made on first ask and whenever the size or density changes — `true` then:
   * it is blank, and the host replays the board's history into it.
   */
  ensure(id: number, surface: readonly [number, number], density: number = BOARD.ink.density): boolean {
    const size = rasterSize(surface, density);
    const had = this.shared.rasters.get(id);
    if (had && had.size[0] === size[0] && had.size[1] === size[1] && had.density === density) return false;
    if (had) this.release(id);
    const d = this.device;
    const s = this.shared;
    const levels = Math.floor(Math.log2(Math.max(size[0], size[1]))) + 1;
    const RW = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const ink = d.createTexture({ label: `board/ink ${id}`, size: [size[0], size[1]], format: "rgba8unorm", mipLevelCount: levels, usage: RW | GPUTextureUsage.COPY_SRC });
    const stroke = d.createTexture({ label: `board/stroke ${id}`, size: [size[0], size[1]], format: "r8unorm", usage: RW });
    const wet = d.createTexture({ label: `board/wet ${id}`, size: [size[0], size[1]], format: "r8unorm", usage: RW });
    const level = (i: number) => ink.createView({ baseMipLevel: i, mipLevelCount: 1 });
    const mipDst: GPUTextureView[] = [];
    const mipGroups: GPUBindGroup[] = [];
    for (let i = 1; i < levels; i++) { mipDst.push(level(i)); mipGroups.push(bindGroup(d, s.mipLayout, [level(i - 1), s.linSampler], `board/mip ${id}.${i}`)); }
    const strokeView = stroke.createView();
    const wetView = wet.createView();
    const r: Raster = {
      id, size, density, levels, ink, stroke, wet, level0: level(0), strokeView, wetView, mipDst, mipGroups,
      group: bindGroup(d, s.layout1, [ink.createView(), strokeView, wetView], `board/raster ${id}`),
      inkGroup: bindGroup(d, s.inkLayout, [s.inkU, strokeView], `board/ink ${id}`),
      tool: null, pending: [], wetting: false, wetLeft: 0, dryBy: 1, clearWet: false,
    };
    s.rasters.set(id, r);
    const enc = d.createCommandEncoder({ label: "board/new raster" });
    this.clear(enc, r.level0); this.clear(enc, strokeView); this.clear(enc, wetView);
    d.queue.submit([enc.finish()]);
    return true;
  }

  /** Forget board `id`'s raster. */
  release(id: number): void {
    const r = this.shared.rasters.get(id);
    if (!r) return;
    r.ink.destroy(); r.stroke.destroy(); r.wet.destroy();
    this.shared.rasters.delete(id);
  }

  /** The raster's size in texels, or null. */
  sizeOf(id: number): readonly [number, number] | null { return this.shared.rasters.get(id)?.size ?? null; }

  /** Is any board's ink still drying (the host keeps its clock awake)? */
  get wetting(): boolean { for (const r of this.shared.rasters.values()) if (r.wetting || r.pending.length) return true; return false; }

  private clear(enc: GPUCommandEncoder, view: GPUTextureView): void {
    enc.beginRenderPass({ label: "board/clear", colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] }).end();
  }

  private writeStampTool(r: Raster, tool: Tool): void {
    const t = tool.tip;
    this.stampU.set({
      tex: [r.size[0], r.size[1], r.density, 0],
      tip: [t.half[0], t.half[1], t.angle, t.radius],
      felt: [t.softness, tool.mode === "erase" ? 1 : 0, tool.opacity, tool.streak],
      lanes: [BOARD.felt.lanes, BOARD.felt.along[0], BOARD.felt.along[1], 0],
    });
    this.device.queue.writeBuffer(this.shared.stampU, 0, this.stampU.view());
  }

  /** Stamp `count` stamps (from `data`) into the raster's stroke layer. The caller submits `enc` before the next upload. */
  private stampInto(enc: GPUCommandEncoder, r: Raster, data: Float32Array, count: number): void {
    if (count === 0) return;
    this.device.queue.writeBuffer(this.shared.stampBuf, 0, data.buffer, data.byteOffset, count * STAMP_FLOATS * 4);
    const pass = enc.beginRenderPass({ label: "board/stamp", colorAttachments: [{ view: r.strokeView, loadOp: "load", storeOp: "store" }] });
    pass.setPipeline(this.shared.stampPipeline);
    pass.setBindGroup(0, this.shared.stampGroup);
    pass.draw(4, count);
    pass.end();
  }

  /** Every stamp of `data`, in chunks: one upload and one submit each. */
  private stampAll(r: Raster, tool: Tool, data: Float32Array): void {
    this.writeStampTool(r, tool);
    const n = data.length / STAMP_FLOATS;
    for (let i = 0; i < n; i += STAMP_CAP) {
      const count = Math.min(STAMP_CAP, n - i);
      const enc = this.device.createCommandEncoder({ label: "board/stamps" });
      this.stampInto(enc, r, data.subarray(i * STAMP_FLOATS), count);
      this.device.queue.submit([enc.finish()]);
    }
  }

  /** Lay the stroke layer into the ink (and, live, mark it wet), then clear the stroke layer. */
  private composite(enc: GPUCommandEncoder, r: Raster, tool: Tool, wet: boolean): void {
    this.inkU.set({ color: [tool.color[0], tool.color[1], tool.color[2], 0] });
    this.device.queue.writeBuffer(this.shared.inkU, 0, this.inkU.view());
    const full = (view: GPUTextureView, pipeline: GPURenderPipeline) => {
      const pass = enc.beginRenderPass({ label: "board/ink", colorAttachments: [{ view, loadOp: "load", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, r.inkGroup); pass.draw(3); pass.end();
    };
    full(r.level0, tool.mode === "erase" ? this.shared.inkErase : this.shared.inkDraw);
    if (wet && tool.mode === "ink") full(r.wetView, this.shared.inkWet);
    this.clear(enc, r.strokeView);
  }

  /** The ink's mip chain, from level 0 down. */
  private mips(enc: GPUCommandEncoder, r: Raster): void {
    for (let i = 0; i < r.mipDst.length; i++) {
      const pass = enc.beginRenderPass({ label: "board/mip", colorAttachments: [{ view: r.mipDst[i] as GPUTextureView, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }] });
      pass.setPipeline(this.shared.mipPipeline); pass.setBindGroup(0, r.mipGroups[i] as GPUBindGroup); pass.draw(3); pass.end();
    }
  }

  // ---------------------------------------------------------------- a stroke, live

  /** Queue stamps for the stroke being laid on board `id` (they reach its stroke layer at the next `prepare`). */
  lay(id: number, tool: Tool, stamps: Float32Array): void {
    const r = this.shared.rasters.get(id);
    if (!r || stamps.length === 0) return;
    r.tool = tool;
    r.pending.push(stamps.slice());
  }

  /** Send the queued stamps now: one upload, one submit, per board with any. */
  private flush(): void {
    for (const r of this.shared.rasters.values()) {
      if (!r.pending.length || !r.tool) continue;
      const all = r.pending.length === 1 ? (r.pending[0] as Float32Array) : concat(r.pending);
      r.pending = [];
      this.stampAll(r, r.tool, all);
    }
  }

  /** The lift: the stroke's last stamps, laid into the ink, marked wet; the mips follow. */
  commit(id: number, tool: Tool): void {
    const r = this.shared.rasters.get(id);
    if (!r) return;
    r.tool = tool;
    this.flush();
    const enc = this.device.createCommandEncoder({ label: "board/commit" });
    this.composite(enc, r, tool, true);
    this.mips(enc, r);
    this.device.queue.submit([enc.finish()]);
    r.tool = null;
    if (tool.mode === "ink") { r.wetting = true; r.wetLeft = BOARD.ink.wetSeconds * WET_HOLD; }
  }

  /** A stroke abandoned: its stamps dropped, its layer cleared. */
  cancel(id: number): void {
    const r = this.shared.rasters.get(id);
    if (!r) return;
    r.pending = []; r.tool = null;
    const enc = this.device.createCommandEncoder({ label: "board/cancel" });
    this.clear(enc, r.strokeView);
    this.device.queue.submit([enc.finish()]);
  }

  /** The board's ink rebuilt from its history (history.ts `replay`): a cleared raster, every op in order, dry. */
  replay(id: number, ops: readonly BoardOp[]): void {
    const r = this.shared.rasters.get(id);
    if (!r) return;
    r.pending = []; r.tool = null; r.wetting = false; r.wetLeft = 0;
    let enc = this.device.createCommandEncoder({ label: "board/replay clear" });
    this.clear(enc, r.level0); this.clear(enc, r.strokeView); this.clear(enc, r.wetView);
    this.device.queue.submit([enc.finish()]);
    for (const op of ops) {
      enc = this.device.createCommandEncoder({ label: "board/replay" });
      if (op.kind === "wipe") { this.clear(enc, r.level0); this.device.queue.submit([enc.finish()]); continue; }
      this.stampAll(r, op.tool, op.stamps);
      this.composite(enc, r, op.tool, false);
      this.device.queue.submit([enc.finish()]);
    }
    enc = this.device.createCommandEncoder({ label: "board/replay mips" });
    this.mips(enc, r);
    this.device.queue.submit([enc.finish()]);
  }

  /** Fresh ink dries: every wet raster's wet layer fades by `dt` seconds (sent at the next `prepare`). */
  dry(dt: number): void {
    if (dt <= 0) return;
    for (const r of this.shared.rasters.values()) {
      if (!r.wetting) continue;
      r.dryBy *= Math.exp(-dt / BOARD.ink.wetSeconds);
      r.wetLeft -= dt;
      if (r.wetLeft <= 0) { r.wetting = false; r.clearWet = true; }
    }
  }

  /** The ink's bytes, level 0 — rgba8 premultiplied linear, row 0 the melamine's top (a harness's witness). */
  async readInk(id: number): Promise<{ width: number; height: number; bytes: Uint8Array } | null> {
    const r = this.shared.rasters.get(id);
    if (!r) return null;
    const bytes = await readback(this.device, r.ink, 4);
    return { width: r.size[0], height: r.size[1], bytes };
  }

  // ---------------------------------------------------------------- the frame

  /**
   * Send what the host queued (stamps, the drying), then upload this frame's boards (in paint
   * order) and the mat's block for this slot's camera and light: the dapple, the lamp's shading
   * and the shadows. A board whose raster is missing is skipped. Returns the count that will draw.
   */
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, instances: readonly BoardInstance[], present: Presentation | undefined, light: MatLight = DAY_LIGHT, theme?: GroundTheme): number {
    this.rebind();
    this.flush();
    this.dryNow();
    const s = this.shared;
    const list: GPUBindGroup[] = [];
    const from: number[] = [];
    for (const [i, b] of instances.entries()) {
      if (list.length >= MAX_BOARDS) break;
      const r = s.rasters.get(b.id);
      if (!r) continue;
      this.records.set(boardValues(b, { size: r.size, density: r.density, wet: r.wetting }), list.length);
      list.push(r.group);
      from.push(i);
    }
    this.drawList = list;
    this.drawnFrom = from;
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, present, light, NO_GLYPHS));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    const sh = BOARD.shadow;
    const sf = BOARD.surface;
    const fr = BOARD.frame;
    const pen = BOARD.pen;
    const blk = BOARD.block;
    const look = this.look;
    const cast = MAT_COLORS.cast;
    const select = theme?.select ?? [0, 0, 0];
    this.knobs.set({
      light: [BOARD.light.ambient, BOARD.light.cap, this.chain ? 1 : 0, 0.22],
      shadow: [sh.penumbra.sigma0, sh.penumbra.sigmaPerHeight, sh.penumbra.alpha, sh.contact.alpha],
      shadow2: [sh.contact.sigma, sh.contact.reach, BOARD.ring, 0],
      castTint: [cast[0], cast[1], cast[2], 1],
      select: [select[0], select[1], select[2], 1],
      mel: [sf.tone, sf.grain, sf.ghost, BOARD.ink.film],
      sheen: [sf.sheen, sf.spread, sf.eye, BOARD.ink.wetDarken],
      lip: [sf.lip.alpha, sf.lip.sigma, fr.brushed, fr.roll],
      glint: [fr.glint, 0, 0, 0],
      barrel: [look.barrel[0], look.barrel[1], look.barrel[2], 1],
      felt: [look.felt[0], look.felt[1], look.felt[2], 1],
      wood: [look.wood[0], look.wood[1], look.wood[2], 1],
      pen: [pen.length, pen.radius, pen.cap, pen.rise],
      pen2: [pen.hover, pen.lean, 0, 0],
      block: [blk.half[0], blk.half[1], blk.felt, blk.wood],
      block2: [(BOARD.eraser.angle * Math.PI) / 180, 0, 0, 0],
    });
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    if (list.length > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(list.length));
    return list.length;
  }

  /** The wet layers' fading, sent: one pass each at the accumulated factor, or a clear once dry. */
  private dryNow(): void {
    let enc: GPUCommandEncoder | null = null;
    for (const r of this.shared.rasters.values()) {
      if (r.clearWet) { enc ??= this.device.createCommandEncoder({ label: "board/dry" }); this.clear(enc, r.wetView); r.clearWet = false; r.dryBy = 1; continue; }
      if (!r.wetting || r.dryBy >= 1) continue;
      enc ??= this.device.createCommandEncoder({ label: "board/dry" });
      const pass = enc.beginRenderPass({ label: "board/dry", colorAttachments: [{ view: r.wetView, loadOp: "load", storeOp: "store" }] });
      pass.setPipeline(this.shared.inkDry); pass.setBindGroup(0, r.inkGroup);
      pass.setBlendConstant({ r: r.dryBy, g: r.dryBy, b: r.dryBy, a: r.dryBy });
      pass.draw(3); pass.end();
      r.dryBy = 1;
    }
    if (enc) this.device.queue.submit([enc.finish()]);
  }

  get drawn(): number { return this.drawList.length; }

  /** Every board drawn this frame. */
  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, Number.POSITIVE_INFINITY); }

  /**
   * The boards `prepare` was handed at [first, end) — indices into ITS list, as the ground's runs count a
   * kind's records (a board whose raster is missing draws nothing) — one quad each with its raster bound,
   * the slot's group bound once before the first. The whole list is `draw`: the same commands it always gave.
   */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    let bound = false;
    for (let i = 0; i < this.drawList.length; i++) {
      const at = this.drawnFrom[i] as number;
      if (at >= end) break;   // ascending: nothing further is in range
      if (at < first) continue;
      if (!bound) { pass.setPipeline(this.shared.pipeline); pass.setBindGroup(0, this.group); bound = true; }
      pass.setBindGroup(1, this.drawList[i] as GPUBindGroup);
      pass.draw(6, 1, 0, i);
    }
  }

  /** This slot's buffers; the rasters and the stamp buffers go with the last slot standing. */
  dispose(): void {
    this.matBuf.destroy(); this.knobBuf.destroy(); this.recordBuf.destroy();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) { for (const id of [...s.rasters.keys()]) this.release(id); s.stampBuf.destroy(); s.stampU.destroy(); s.inkU.destroy(); }
  }
}

function concat(parts: readonly Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
