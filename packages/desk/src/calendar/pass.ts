// The CALENDAR pass — desk pads drawn beneath everything else on the desk (CALENDAR.md §6). Like the
// notebook's, it draws into its own LAYER (4× multisampled colour + depth, then resolved): the pads'
// meshes (the sheet in motion bent by the roll in its vertex shader), then the mat under each (its
// shadow, its contact, its ring) wherever the pad does not cover it. Unlike the notebook's, the layer
// is not laid over the frame afterwards: the host renders it first (`renderLayer`, its own command
// buffer) and the ground lays it on the mat inside its own pass, right after the field
// (`underlay()` — ground.ts `underlays`), so the cards, the notes, the boards and the notebooks all lie
// ON the calendar: a sticky note stuck to a day is drawn over its paper by the paper pass, casting on it.
//
// As a kind of the desk's registry (kinds/calendar.ts; design-015 D3r-b) the layer is recorded into the
// frame's own encoder after the mat's wind (`layer`) and laid as the pads stratum's one run (`composite`)
// — the underlay's own draw, where the underlay lay: right after the mat, beneath everything else.
//
// The print is a pyramid of tiles (tiles.ts) in a texture array; the host draws them (Canvas 2D) and
// hands them over with `uploadTile`, and writes each sheet's page table with `writeTable`. The pads'
// shadows are analytic (a slab on the mat, a roll on the paper): no shadow map is drawn.

import { bindGroup, bindLayout, storageBuffer, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import type { RenderTarget } from "../kind";
import type { FadeIn, View } from "../lattice/lod";
import { type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, STILL_MAT_FRAME } from "../mat/layout";
import type { MatPass } from "../mat/mat-pass";
import { DAY_LIGHT, type MatLight } from "../mat/night";
import { MAT_GRID, type RGB } from "../theme";
import { type DeskEye, eyeValues, project } from "../notebook/eye";
import { NbBook, NbUniforms } from "../notebook/layout";
import type { BuiltMesh } from "../notebook/mesh";
import { VERTEX_BYTES } from "../notebook/mesh";
import { inverseOf, matrixOf, type Rigid, worldBounds } from "../notebook/place";
import { PAPER_TEX, paperTexture } from "../notebook/paper-tex";
import { generateMips, mipCount } from "../photo/mips";
import type { CalendarLaw } from "./law";
import { CalPad, type CalendarColours, CalUniforms, calUniformValues, MAX_CALENDARS, TABLE_SLOTS } from "./layout";
import { movingGrid, type PadFrame } from "./pad";
import type { RollState } from "./roll";
import type { CalendarShaders } from "./shaders";
import { MISSING, TILE_TEX, type TileGrid } from "./tiles";

const SAMPLES = 4;
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};
/** The moving sheet's grid: fine enough down the sheet that a turn of the roll is ~40 facets. */
const GRID_COLS = 96;
const GRID_ROWS = 220;

/** A box on a sheet, x0 y0 x1 y1 (sheet units); absent = none. */
export type SheetBox = readonly [number, number, number, number];

/** One sheet in play: where its grid is printed and which rows and days it has, and its tile table. */
export interface SheetDraw {
  readonly x0: number; readonly y0: number; readonly cw: number; readonly ch: number;
  readonly rows: number;
  /** Bit c set: column c is a weekend. */
  readonly weekends: number;
  readonly lead: number;
  readonly days: number;
  /** Its page table's slot (0 … TABLE_SLOTS − 1). */
  readonly slot: number;
}

/** One calendar as the pass draws it this frame. */
export interface CalendarDraw {
  readonly id: number;
  readonly frame: PadFrame;
  /** The pad's static mesh (pad.ts `buildPad`: its solid parts, then from `sheetFirst` its paper), and its version — the upload's key. */
  readonly mesh: BuiltMesh & { readonly sheetFirst: number; readonly rollFirst: number };
  readonly version: number;
  readonly rigid: Rigid;
  /** The unit direction toward the lamp (world). */
  readonly lamp: readonly [number, number, number];
  readonly lift: number;
  /** The ring's presence, 0 … 1. */
  readonly ring: number;
  readonly base: SheetDraw;
  /** The sheet in motion and its roll, or none. */
  readonly moving: SheetDraw | null;
  readonly roll: RollState | null;
  /** Which sheet the host's marks are on: 0 the base, 1 the moving sheet. */
  readonly marksOn: 0 | 1;
  readonly sel: readonly SheetBox[];
  readonly mark: SheetBox | null;
  readonly drop: SheetBox | null;
  /** The caret: x, top, bottom, width — or none. */
  readonly caret: readonly [number, number, number, number] | null;
  /** The newest glyph's box and its progress (0 … 1). */
  readonly wipe: { readonly box: SheetBox; readonly t: number } | null;
  readonly colours: CalendarColours;
}

interface PadBuffers { vb: GPUBuffer; ib: GPUBuffer; vcap: number; icap: number; version: number; icount: number; sheetFirst: number; rollFirst: number; seen: number }

/**
 * What one RENDER TARGET keeps between its prepares (D7) — as the notebook's (notebook/pass.ts `NbTarget`): the layer's targets at its
 * size, the pads' meshes it drew, its frame count, this prepare's pads, their screen extent and scissor, its stats; the held desk
 * copy's apart from the frame's, so a held frame's two prepares never undo each other.
 */
interface CalTarget {
  msaa: GPUTexture | null;
  depth: GPUTexture | null;
  resolve: GPUTexture | null;
  compGroup: GPUBindGroup | null;
  size: { w: number; h: number };
  readonly buffers: Map<number, PadBuffers>;
  list: CalendarDraw[];
  frameNo: number;
  screen: { x0: number; y0: number; x1: number; y1: number } | null;
  scissor: readonly [number, number, number, number] | null;
  stats: CalendarStats;
}

const calTarget = (): CalTarget => ({ msaa: null, depth: null, resolve: null, compGroup: null, size: { w: 0, h: 0 }, buffers: new Map(), list: [], frameNo: 0, screen: null, scissor: null, stats: { calendars: 0, moving: 0 } });

function dropTarget(t: CalTarget): void {
  for (const b of t.buffers.values()) { b.vb.destroy(); b.ib.destroy(); }
  t.buffers.clear();
  t.msaa?.destroy(); t.depth?.destroy(); t.resolve?.destroy();
  t.msaa = null; t.depth = null; t.resolve = null; t.compGroup = null; t.size = { w: 0, h: 0 };
}

export interface CalendarStats { readonly calendars: number; readonly moving: number }

export class CalendarPass {
  readonly name = "calendar/pads";
  /** Tile layers in the print's texture array. */
  readonly layers: number;
  private readonly device: GPUDevice;
  private readonly mat: MatPass;
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = CalUniforms.alloc(1);
  private readonly records = CalPad.alloc(MAX_CALENDARS);
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private readonly recordBuf: GPUBuffer;
  private tableBuf: GPUBuffer;
  private readonly layoutMain: GPUBindGroupLayout;
  private readonly layoutComp: GPUBindGroupLayout;
  private readonly facePipe: GPURenderPipeline;
  private readonly sheetPipe: GPURenderPipeline;
  private readonly solidPipe: GPURenderPipeline;
  private readonly movingPipe: GPURenderPipeline;
  private readonly recvPipe: GPURenderPipeline;
  private readonly compPipe: GPURenderPipeline;
  private readonly goboSampler: GPUSampler;
  private readonly noiseSampler: GPUSampler;
  private readonly tileSampler: GPUSampler;
  private readonly paperSampler: GPUSampler;
  private readonly tileTex: GPUTexture;
  private readonly paperTex: GPUTexture;
  private readonly gridVb: GPUBuffer;
  private readonly gridIb: GPUBuffer;
  private readonly gridCount: number;
  private mainGroup!: GPUBindGroup;
  private boundAssets = -1;
  /** The frame's target (the canvas; the hand) and the held desk copy's, apart (D7) — `t` the one this prepare is for (`use`). */
  private readonly frameT = calTarget();
  private copyT: CalTarget | null = null;
  private t = this.frameT;
  private tableCount = 0;
  /** Profiling switches: 2 no print or paper detail · 4 no gobo · 8 no rolls' shade · 16 no layer on the mat · 32 no marks · 64 no tiles · 128 no mat under it · 256 no moving sheet · 512 flat colour. */
  debug = 0;

  private constructor(device: GPUDevice, mat: MatPass, layers: number, pipes: { layoutMain: GPUBindGroupLayout; layoutComp: GPUBindGroupLayout; face: GPURenderPipeline; sheet: GPURenderPipeline; solid: GPURenderPipeline; moving: GPURenderPipeline; recv: GPURenderPipeline; comp: GPURenderPipeline }) {
    this.device = device; this.mat = mat; this.layers = layers;
    this.layoutMain = pipes.layoutMain; this.layoutComp = pipes.layoutComp;
    this.facePipe = pipes.face; this.sheetPipe = pipes.sheet; this.solidPipe = pipes.solid; this.movingPipe = pipes.moving; this.recvPipe = pipes.recv; this.compPipe = pipes.comp;
    this.matBuf = uniformBuffer(device, MatUniforms.size, "calendar/mat uniforms");
    this.knobBuf = uniformBuffer(device, CalUniforms.size, "calendar/knobs");
    this.recordBuf = storageBuffer(device, CalPad.size * MAX_CALENDARS, "calendar/pads");
    this.tableBuf = device.createBuffer({ label: "calendar/tile tables", size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.goboSampler = device.createSampler({ label: "calendar/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.noiseSampler = device.createSampler({ label: "calendar/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    this.tileSampler = device.createSampler({ label: "calendar/tiles", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.tileTex = device.createTexture({ label: "calendar/print tiles", size: [TILE_TEX, TILE_TEX, layers], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.paperTex = device.createTexture({ label: "calendar/paper", size: [PAPER_TEX, PAPER_TEX], format: "rgba8unorm", mipLevelCount: mipCount(PAPER_TEX, PAPER_TEX), usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.writeTexture({ texture: this.paperTex }, paperTexture(), { bytesPerRow: PAPER_TEX * 4 }, [PAPER_TEX, PAPER_TEX, 1]);
    generateMips(device, this.paperTex);
    this.paperSampler = device.createSampler({ label: "calendar/paper", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", maxAnisotropy: 8 });
    const g = movingGrid(GRID_COLS, GRID_ROWS);
    this.gridVb = device.createBuffer({ label: "calendar/moving grid", size: g.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.gridIb = device.createBuffer({ label: "calendar/moving grid indices", size: g.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.gridVb, 0, g.vertices);
    device.queue.writeBuffer(this.gridIb, 0, g.indices);
    this.gridCount = g.indices.length;
    this.rebind();
  }

  static async create(device: GPUDevice, format: GPUTextureFormat, src: CalendarShaders, mat: MatPass, layers = 160): Promise<CalendarPass> {
    const layoutMain = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 3, stages: ["fragment"], texture: "float" },
      { binding: 4, stages: ["fragment"], sampler: "filtering" },
      { binding: 5, stages: ["fragment"], texture: "float" },
      { binding: 6, stages: ["fragment"], sampler: "filtering" },
      { binding: 7, stages: ["fragment"], texture: "float", dimension: "2d-array" },
      { binding: 8, stages: ["fragment"], sampler: "filtering" },
      { binding: 9, stages: ["fragment"], buffer: "read-only-storage" },
      { binding: 10, stages: ["fragment"], texture: "float" },
      { binding: 11, stages: ["fragment"], sampler: "filtering" },
    ], "calendar/main");
    const layoutComp = bindLayout(device, [{ binding: 0, stages: ["fragment"], texture: "float" }], "calendar/composite");
    const module = await compile(device, compose({ structs: [MatUniforms, NbUniforms, NbBook, CalUniforms, CalPad], modules: src.modules, entry: src.entry }));
    const compModule = await compile(device, compose({ entry: src.composite }));
    const vertexLayout: GPUVertexBufferLayout = {
      arrayStride: VERTEX_BYTES,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "float32x4" },
        { shaderLocation: 4, offset: 48, format: "float32x2" },
        { shaderLocation: 5, offset: 56, format: "float32x2" },
      ],
    };
    const mainLayout = device.createPipelineLayout({ bindGroupLayouts: [layoutMain] });
    const depthStencil: GPUDepthStencilState = { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" };
    const [face, sheet, solid, moving, recv, comp] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "calendar/face", layout: mainLayout,
        vertex: { module, entryPoint: "vs_pad", buffers: [vertexLayout] },
        fragment: { module, entryPoint: "fs_face", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil, multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "calendar/paper", layout: mainLayout,
        vertex: { module, entryPoint: "vs_pad", buffers: [vertexLayout] },
        fragment: { module, entryPoint: "fs_sheet", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil, multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "calendar/solid", layout: mainLayout,
        vertex: { module, entryPoint: "vs_pad", buffers: [vertexLayout] },
        fragment: { module, entryPoint: "fs_solid", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil, multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "calendar/moving", layout: mainLayout,
        vertex: { module, entryPoint: "vs_moving", buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] },
        fragment: { module, entryPoint: "fs_sheet", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil, multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "calendar/mat", layout: mainLayout,
        vertex: { module, entryPoint: "vs_recv" },
        fragment: { module, entryPoint: "fs_recv", targets: [{ format: "rgba8unorm", blend: BLEND_PREMUL }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
        multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        label: "calendar/composite", layout: device.createPipelineLayout({ bindGroupLayouts: [layoutComp] }),
        vertex: { module: compModule, entryPoint: "vs" },
        fragment: { module: compModule, entryPoint: "fs", targets: [{ format, blend: BLEND_PREMUL }] },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    return new CalendarPass(device, mat, layers, { layoutMain, layoutComp, face, sheet, solid, moving, recv, comp });
  }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion) return;
    this.mainGroup = bindGroup(this.device, this.layoutMain, [
      this.matBuf, this.knobBuf, this.recordBuf, this.mat.silhouette, this.goboSampler, this.mat.noiseTexture.createView(), this.noiseSampler,
      this.tileTex.createView({ dimension: "2d-array" }), this.tileSampler, this.tableBuf, this.paperTex.createView(), this.paperSampler,
    ], "calendar/main");
    this.boundAssets = this.mat.assetVersion;
  }

  /** Size the page tables for a sheet's tile grid (every table the same); re-makes the buffer, all entries missing. */
  private fitTables(grid: TileGrid): void {
    if (this.tableCount === grid.count) return;
    this.tableBuf.destroy();
    this.tableBuf = this.device.createBuffer({ label: "calendar/tile tables", size: grid.count * TABLE_SLOTS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.tableBuf, 0, new Int32Array(grid.count * TABLE_SLOTS).fill(MISSING));
    this.tableCount = grid.count;
    this.boundAssets = -1;
    this.rebind();
  }

  /** A sheet's page table (a layer per tile, or MISSING / EMPTY), into its slot. */
  writeTable(slot: number, grid: TileGrid, table: Int32Array): void {
    this.fitTables(grid);
    this.device.queue.writeBuffer(this.tableBuf, slot * grid.count * 4, table.buffer, table.byteOffset, grid.count * 4);
  }

  /** A tile's raster (the host's canvas, TILE_TEX², straight alpha) into its layer. */
  uploadTile(layer: number, source: HTMLCanvasElement | OffscreenCanvas): void {
    this.device.queue.copyExternalImageToTexture({ source, origin: { x: 0, y: 0 } }, { texture: this.tileTex, origin: { x: 0, y: 0, z: layer }, premultipliedAlpha: false }, [TILE_TEX, TILE_TEX]);
  }

  /** A tile's COMMITTED raster (RGBA bytes, TILE_TEX² × 4, straight alpha, row 0 at the top) into its layer — a host with no canvas (the Node oracle; D3t-c). */
  writeTileBytes(layer: number, bytes: Uint8Array<ArrayBuffer>): void {
    if (bytes.byteLength !== TILE_TEX * TILE_TEX * 4) throw new Error(`calendar: a tile is ${TILE_TEX}² RGBA (${TILE_TEX * TILE_TEX * 4} bytes), not ${bytes.byteLength}`);
    this.device.queue.writeTexture({ texture: this.tileTex, origin: { x: 0, y: 0, z: layer } }, bytes, { bytesPerRow: TILE_TEX * 4, rowsPerImage: TILE_TEX }, [TILE_TEX, TILE_TEX, 1]);
  }

  /** The layer's targets at the canvas's device size. */
  private fit(w: number, h: number): void {
    if (this.t.size.w === w && this.t.size.h === h && this.t.msaa) return;
    this.t.msaa?.destroy(); this.t.depth?.destroy(); this.t.resolve?.destroy();
    this.t.msaa = this.device.createTexture({ label: "calendar/layer ×4", size: [w, h], format: "rgba8unorm", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.t.depth = this.device.createTexture({ label: "calendar/depth ×4", size: [w, h], format: "depth24plus", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.t.resolve = this.device.createTexture({ label: "calendar/layer", size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.t.compGroup = bindGroup(this.device, this.layoutComp, [this.t.resolve.createView()], "calendar/composite");
    this.t.size = { w, h };
  }

  private upload(d: CalendarDraw): PadBuffers {
    let b = this.t.buffers.get(d.id);
    const vbytes = d.mesh.vcount * VERTEX_BYTES;
    const ibytes = d.mesh.icount * 4;
    if (!b || b.vcap < vbytes || b.icap < ibytes) {
      b?.vb.destroy(); b?.ib.destroy();
      const vcap = Math.max(vbytes, 4096);
      const icap = Math.max(ibytes, 4096);
      b = {
        vb: this.device.createBuffer({ label: `calendar/${d.id} vertices`, size: (vcap + 3) & ~3, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
        ib: this.device.createBuffer({ label: `calendar/${d.id} indices`, size: (icap + 3) & ~3, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }),
        vcap, icap, version: -1, icount: 0, sheetFirst: 0, rollFirst: 0, seen: 0,
      };
      this.t.buffers.set(d.id, b);
    }
    if (b.version !== d.version) {
      this.device.queue.writeBuffer(b.vb, 0, d.mesh.vertices.buffer, d.mesh.vertices.byteOffset, vbytes);
      this.device.queue.writeBuffer(b.ib, 0, d.mesh.indices.buffer, d.mesh.indices.byteOffset, ibytes);
      b.version = d.version; b.icount = d.mesh.icount; b.sheetFirst = d.mesh.sheetFirst; b.rollFirst = d.mesh.rollFirst;
    }
    b.seen = this.t.frameNo;
    return b;
  }

  /**
   * This frame's calendars: the mat's block, the knobs and the eye, each pad's record (placement, lamp,
   * roll, sheets, marks, palette), its mesh. Returns how many will draw.
   */
  // biome-ignore lint/style/useDefaultParameterLast: the prototype's signature, moved verbatim — dropping the default would change what an explicit `undefined` means (design-015 D1)
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, light: MatLight = DAY_LIGHT, eye: DeskEye, law: CalendarLaw, grid: TileGrid, colours: { readonly cast: RGB; readonly select: RGB; readonly alpha: { readonly rule: number; readonly head: number; readonly weekend: number; readonly outside: number } }, calendars: readonly CalendarDraw[]): number {
    this.fitTables(grid);
    this.rebind();
    this.t.frameNo += 1;
    const reach = (d: CalendarDraw) => 3 * (law.shadow.sigma0 + law.shadow.perUnit * (d.frame.zTape + d.lift)) + 2.2 * (d.frame.zTape + d.lift) + (law.ring.offset + law.ring.width * 2 + 2) / Math.max(eye.zoom, 1e-6);
    const onScreen = (d: CalendarDraw): boolean => {
      const wb = worldBounds(d.rigid, [-d.frame.W / 2, -d.frame.H / 2, 0], [d.frame.W / 2, d.frame.H / 2, d.frame.zm + 2 * d.frame.rest + 4]);
      const pad = reach(d);
      let x0 = Number.POSITIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < 8; c++) { const [qx, qy] = project(eye, c & 1 ? wb.hi[0] + pad : wb.lo[0] - pad, c & 2 ? wb.hi[1] + pad : wb.lo[1] - pad, c & 4 ? wb.hi[2] : wb.lo[2]); x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy); }
      return x1 >= 0 && y1 >= 0 && x0 <= eye.vw && y0 <= eye.vh;
    };
    this.t.list = calendars.filter(onScreen).slice(0, MAX_CALENDARS) as CalendarDraw[];
    const n = this.t.list.length;
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, undefined, light, NO_GLYPHS));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    this.knobs.set(calUniformValues(law, eyeValues(eye), view.dpr, colours.cast, colours.select, colours.alpha, grid, this.debug));
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    let sx0 = Number.POSITIVE_INFINITY;
    let sy0 = Number.POSITIVE_INFINITY;
    let sx1 = Number.NEGATIVE_INFINITY;
    let sy1 = Number.NEGATIVE_INFINITY;
    let moving = 0;
    const box = (b: SheetBox | null | undefined): number[] => (b ? [b[0], b[1], b[2], b[3]] : [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const d = this.t.list[i] as CalendarDraw;
      this.upload(d);
      const F = d.frame;
      const wb = worldBounds(d.rigid, [-F.W / 2, -F.H / 2, 0], [F.W / 2, F.H / 2, F.zm + 2 * F.rest + 4]);
      const r = reach(d);
      const L = d.lamp;
      let rx0 = wb.lo[0];
      let ry0 = wb.lo[1];
      let rx1 = wb.hi[0];
      let ry1 = wb.hi[1];
      for (const [px, py] of [[wb.lo[0], wb.lo[1]], [wb.hi[0], wb.hi[1]]] as const) {
        const gx = px - (L[0] * (F.zTape + d.lift)) / Math.max(L[2], 1e-3);
        const gy = py - (L[1] * (F.zTape + d.lift)) / Math.max(L[2], 1e-3);
        rx0 = Math.min(rx0, gx); ry0 = Math.min(ry0, gy); rx1 = Math.max(rx1, gx); ry1 = Math.max(ry1, gy);
      }
      rx0 -= r; ry0 -= r; rx1 += r; ry1 += r;
      for (let c = 0; c < 8; c++) {
        const [qx, qy] = project(eye, c & 1 ? wb.hi[0] : wb.lo[0], c & 2 ? wb.hi[1] : wb.lo[1], c & 4 ? wb.hi[2] : wb.lo[2]);
        sx0 = Math.min(sx0, qx); sy0 = Math.min(sy0, qy); sx1 = Math.max(sx1, qx); sy1 = Math.max(sy1, qy);
      }
      for (const [qx, qy] of [[rx0, ry0], [rx1, ry1]] as const) { const [a, b] = project(eye, qx, qy, 0); sx0 = Math.min(sx0, a); sy0 = Math.min(sy0, b); sx1 = Math.max(sx1, a); sy1 = Math.max(sy1, b); }
      const R = d.roll;
      if (d.moving && R) moving += 1;
      const sheet = (s: SheetDraw | null) => s ? [[s.x0, s.y0, s.cw, s.ch], [s.rows, s.weekends, s.lead, s.days]] : [[0, 0, 1, 1], [0, 0, 0, 0]];
      const [gA, gB] = sheet(d.base);
      const [gC, gD] = sheet(d.moving);
      const c = d.colours;
      const sel: number[] = [];
      for (let k = 0; k < 6; k++) sel.push(...box(d.sel[k]));
      this.records.set({
        model: matrixOf(d.rigid), inv: matrixOf(inverseOf(d.rigid)),
        lamp: [L[0], L[1], L[2], 0],
        size: [F.W, F.H, F.T, F.L],
        z: [F.zb, F.zt, F.zm, F.zTape],
        roll: R ? [R.a, R.alpha, R.px, R.r0] : [F.L, 0, 0, 1],
        roll2: [R ? R.tau : 0, F.turns, d.moving && R ? 1 : 0, F.rest],
        gridA: gA as number[], gridB: gB as number[], gridC: gC as number[], gridD: gD as number[],
        slots: [d.base.slot, d.moving ? d.moving.slot : -1, d.marksOn, d.ring],
        sel, mark: box(d.mark), drop: box(d.drop),
        caret: d.caret ? [...d.caret] : [0, 0, 0, 0],
        wipe: box(d.wipe?.box), wipe2: [d.wipe ? d.wipe.t : 1, d.id, d.lift, Math.min(d.sel.length, 6)],
        recv: [rx0, ry0, rx1, ry1],
        col0: [...c.paper, 1], col1: [...c.ink, 1], col2: [...c.muted, 1], col3: [...c.weekend, 1], col4: [...c.hot, 1],
        col5: [...c.chipboard, 1], col6: [...c.cloth, 1], col7: [...c.foil, 1], col8: [...c.pen, 1],
      }, i);
    }
    if (n > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(n));
    for (const [id, b] of this.t.buffers) if (b.seen !== this.t.frameNo) { b.vb.destroy(); b.ib.destroy(); this.t.buffers.delete(id); }
    this.t.screen = n > 0 ? { x0: sx0, y0: sy0, x1: sx1, y1: sy1 } : null;
    this.t.stats = { calendars: n, moving };
    return n;
  }

  get drawn(): CalendarStats { return this.t.stats; }

  /** The render target the next prepare, layer and composite are for (D7): the frame's, or the held desk copy's — made on first use. */
  use(target: RenderTarget): void {
    if (target === "copy" && this.copyT === null) this.copyT = calTarget();
    this.t = target === "copy" && this.copyT !== null ? this.copyT : this.frameT;
  }

  /** The hold is over: the desk copy's target gives its layer and meshes back (D7). */
  endHold(): void {
    if (this.copyT) dropTarget(this.copyT);
    this.copyT = null;
    this.t = this.frameT;
  }

  /** The pads' screen box on an attachment of `size` device px, clamped to it — the layer's scissor and the composite's; null when none shows. */
  private boxOf(size: { readonly w: number; readonly h: number }, dpr: number): readonly [number, number, number, number] | null {
    if (this.t.list.length === 0 || !this.t.screen) return null;
    const W = Math.max(1, size.w);
    const H = Math.max(1, size.h);
    const x0 = Math.max(0, Math.floor(this.t.screen.x0 * dpr) - 2);
    const y0 = Math.max(0, Math.floor(this.t.screen.y0 * dpr) - 2);
    const x1 = Math.min(W, Math.ceil(this.t.screen.x1 * dpr) + 2);
    const y1 = Math.min(H, Math.ceil(this.t.screen.y1 * dpr) + 2);
    return x1 <= x0 || y1 <= y0 ? null : [x0, y0, x1, y1];
  }

  /** The pads' screen box of the last layer, device px [x, y, w, h] — what the composite paints at most; null: no layer to lay. */
  get screenBox(): readonly [number, number, number, number] | null { return this.t.scissor; }

  /** Draw the prepared pads into the layer (its own command buffer — submit it before the ground's). */
  renderLayer(size: { readonly w: number; readonly h: number }, dpr: number): void {
    this.t.scissor = null;
    if (!this.boxOf(size, dpr)) return;
    this.fit(Math.max(1, size.w), Math.max(1, size.h));
    const watch = this.t.frameNo < 4;
    if (watch) this.device.pushErrorScope("validation");
    const enc = this.device.createCommandEncoder({ label: "calendar" });
    this.layer(enc, size, dpr);
    this.device.queue.submit([enc.finish()]);
    if (watch) void this.device.popErrorScope().then((e) => { if (e) console.error(`calendar pass: ${e.message}`); });
  }

  /**
   * Record the prepared pads into their LAYER, into `encoder` — ahead of the pass it is laid in: the host's own command buffer
   * (`renderLayer`), or the desk's frame, after the mat's wind (the calendar a kind of its registry — kinds/calendar.ts). Draw order:
   * the sheet in motion, the faces, the past roll, the solid, the mat under each. `size`: the attachment's device px. Returns
   * whether there is a layer to lay (its box: `screenBox`).
   */
  layer(encoder: GPUCommandEncoder, size: { readonly w: number; readonly h: number }, dpr: number): boolean {
    this.t.scissor = null;
    const at = this.boxOf(size, dpr);
    if (!at) return false;
    const [x0, y0, x1, y1] = at;
    this.fit(Math.max(1, size.w), Math.max(1, size.h));
    const pass = encoder.beginRenderPass({
      label: "calendar/layer",
      colorAttachments: [{ view: (this.t.msaa as GPUTexture).createView(), resolveTarget: (this.t.resolve as GPUTexture).createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "discard" }],
      depthStencilAttachment: { view: (this.t.depth as GPUTexture).createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setScissorRect(x0, y0, x1 - x0, y1 - y0);
    pass.setBindGroup(0, this.mainGroup);
    // the sheet in motion first: the month it lies over is then skipped by the depth test, never shaded under it
    if (!(this.debug & 256)) {
      pass.setPipeline(this.movingPipe);
      pass.setVertexBuffer(0, this.gridVb);
      pass.setIndexBuffer(this.gridIb, "uint32");
      this.t.list.forEach((d, i) => { if (d.moving && d.roll) pass.drawIndexed(this.gridCount, 1, 0, 0, i); });
    }
    const range = (pipe: GPURenderPipeline, from: (b: PadBuffers) => number, to: (b: PadBuffers) => number) => {
      pass.setPipeline(pipe);
      this.t.list.forEach((d, i) => {
        const b = this.t.buffers.get(d.id);
        if (!b || to(b) <= from(b)) return;
        pass.setVertexBuffer(0, b.vb);
        pass.setIndexBuffer(b.ib, "uint32");
        pass.drawIndexed(to(b) - from(b), 1, from(b), 0, i);
      });
    };
    range(this.facePipe, (b) => b.sheetFirst, (b) => b.rollFirst);
    range(this.sheetPipe, (b) => b.rollFirst, (b) => b.icount);
    range(this.solidPipe, () => 0, (b) => b.sheetFirst);
    if (!(this.debug & 128)) { pass.setPipeline(this.recvPipe); for (let i = 0; i < this.t.list.length; i++) pass.draw(6, 1, 0, i); }
    pass.end();
    this.t.scissor = [x0, y0, x1 - x0, y1 - y0];
    return true;
  }

  /**
   * Lay the last layer over what `pass` holds — premultiplied, one fullscreen triangle — scissored to `scissor` (the pads' box, or
   * a part of it a host narrows it to). Nothing without a layer, or with the debug bit 16 (no layer on the mat). `underlay()` is
   * the same draw for a host that lays it through the ground's `underlays`.
   */
  composite(pass: GPURenderPassEncoder, scissor: readonly [number, number, number, number] | null = this.t.scissor): void {
    if (!this.t.scissor || !scissor || !this.t.compGroup || (this.debug & 16)) return;
    pass.setScissorRect(scissor[0], scissor[1], scissor[2], scissor[3]);
    pass.setPipeline(this.compPipe);
    pass.setBindGroup(0, this.t.compGroup);
    pass.draw(3);
  }

  /** The layer laid on the mat, for the ground to draw inside its own pass (ground.ts `underlays`). */
  underlay(): { draw(pass: GPURenderPassEncoder): void } | null {
    const sc = this.t.scissor;
    const group = this.t.compGroup;
    if (!sc || !group || (this.debug & 16)) return null;
    return {
      draw: (pass) => {
        pass.setScissorRect(sc[0], sc[1], sc[2], sc[3]);
        pass.setPipeline(this.compPipe);
        pass.setBindGroup(0, group);
        pass.draw(3);
      },
    };
  }

  dispose(): void {
    dropTarget(this.frameT);
    if (this.copyT) dropTarget(this.copyT);
    this.tileTex.destroy(); this.paperTex.destroy(); this.gridVb.destroy(); this.gridIb.destroy();
    this.matBuf.destroy(); this.knobBuf.destroy(); this.recordBuf.destroy(); this.tableBuf.destroy();
  }
}
