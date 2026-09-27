// The board pass — the whiteboards, and the ink on them. Owns, like the note's and the
// notebook's passes, its copy of the mat's uniform block (filled for the slot's camera and
// light every frame, the gobo on only when the mat is the grid), its own knobs, the per-board
// record buffer and the slot's bind group; shares with every slot spawned from the first the
// pipelines, the samplers and the RASTERS — each board's ink (rgba8, premultiplied LINEAR
// colour with its coverage, a full mip chain so a board seen small reads a filtered copy), the
// stroke being laid (r8, max-blended stamps) and the wet layer (r8, fading). Four programs:
// the board on the desk (a run of boards ONE instanced draw — K6a, K-L4: group 1 is shared, see
// below), the STAMP, the INK (a finished stroke laid into the raster; the wet marked and dried) and
// the MIP.
//
// RESIDENCY (K6a, design-016 §6): every board keeps a FAR-LOD THUMBNAIL — the tail of its ink's mip
// chain from the first level that fits BOARD_THUMB², a layer of one shared array (`board/thumbnails`,
// the kit's `LayerArray`), cut again whenever its ink changes — and, while it is large on screen, its
// RASTER at the density its zoom rung asks (`boardRung`, never a fixed 4 texels a unit) bound in one
// of BOARD_SLOTS pool slots; the board being laid on (or drying) binds its stroke and wet layers in the
// one LIVE slot. A board's record says where its ink is (`tier`), so every board of a run is an
// instance of one draw. A raster not bound is a cache the budget may take (its strokes replay it).
// K6b: a raster to MAKE (none held, or a density raised) is the desk's frame raster queue's — the kind asks,
// the queue makes it in its turn (`makes` says whether `ensure` would); a board with no ink at all
// meanwhile draws its melamine BARE, from one layer of the thumbnails kept empty (`bare`).
//
// The raster is a CACHE of the board's history (history.ts): a stroke is laid live as its
// stamps arrive and committed at the lift; an undo, a redo or a new density REPLAYS the
// history into a cleared raster — stamps are world units, so a replay at any density is the
// same drawing. Uploads are the host's pace: `lay` queues stamps, `prepare` sends them before
// the frame's pass (its own small submit, so the frame's encoder never waits on it).

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer, compile, compose, readback } from "@ice/desk/engine";
import { createRecordStore, type RecordStore, type GroundTheme, MAT_COLORS, type RGB } from "@ice/desk";
import { type FadeIn, type View, type MatConfig, type MatFrame, type MatPass, type Presentation, DAY_LIGHT, LayerArray, type MatLight, sentBytes, tailBase, writeChanged } from "@ice/desk/kit";
import { BOARD } from "./theme";
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
/** The far-LOD thumbnails' layer side, texels (a board's ink chain from its first level that fits: 1 texel a unit for the law's board). */
export const BOARD_THUMB = 512;
/** What a BARE board's record reads its ink from (K6b): the empty layer, whole — a thumbnail's side, a texel a unit. */
const BARE = { size: [BOARD_THUMB, BOARD_THUMB] as readonly [number, number], density: 1 };
/** The pool: the rasters one frame binds (the boards larger on screen than their thumbnail serves). */
export const BOARD_SLOTS = 8;
/** Density changes (re-rasters) one step asks for — the rest wait a frame, their old raster standing. */
export const BOARD_RASTERS_A_STEP = 2;
/**
 * THE ZOOM RUNG (K6a): the density a board's raster is made at for `zd` device px a world unit (zoom × dpr × the hold's scale) —
 * two texels a device px as the law's 4 gave at zoom 1 on a 2× screen, a power of two, from 1 (the thumbnail's own) to `max`.
 */
export function boardRung(zd: number, max: number = BOARD.ink.density): number {
  let d = 1;
  while (d < max && d < 2 * zd) d *= 2;
  return Math.min(d, max);
}
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
  /** Group 1, the same for every board: the thumbnail array, BOARD_SLOTS rasters' ink, the live board's stroke and wet. */
  readonly layout1: GPUBindGroupLayout;
  group1: GPUBindGroup;
  readonly thumbs: LayerArray;
  /** Each board's thumbnail: its layer, the level of its source's chain the layer starts at, that source's size and density. */
  readonly thumbOf: Map<number, BoardThumb>;
  /** The pool: the board each slot binds (null: free), and the live board (its stroke and wet bound). */
  readonly pool: (number | null)[];
  live: number | null;
  /** The boards on screen since the last step and the density each asked (the most). */
  readonly asked: Map<number, number>;
  /** K6b: the thumbnails' layer kept EMPTY — a board with no ink yet (its first replay the queue's) draws its melamine from it; taken on first need. */
  bare: number | null;
  readonly blank: GPUTexture;
  readonly blankR: GPUTexture;
  readonly blankArray: GPUTexture;
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

/** A board's far-LOD thumbnail: its layer, the level of its source's ink chain the layer starts at, that source's texels and density. */
interface BoardThumb { readonly layer: number; base: number; size: readonly [number, number]; density: number; tier: number }

/** Group 1 made again: the array (or its stand-in), each pool slot's ink (a blank where free), the live board's stroke and wet. */
function bindPool(s: BoardShared): void {
  const ink = s.pool.map((id) => (id === null ? undefined : s.rasters.get(id)));
  const live = s.live === null ? undefined : s.rasters.get(s.live);
  s.group1 = bindGroup(s.device, s.layout1, [
    s.thumbs.view(s.blankArray),
    ...ink.map((r) => (r === undefined ? s.blank.createView() : r.ink.createView())),
    live === undefined ? s.blankR.createView() : live.strokeView,
    live === undefined ? s.blankR.createView() : live.wetView,
  ], "board/pool");
}

export class BoardPass {
  readonly name = "board/whiteboards";
  private readonly knobs = BoardUniforms.alloc(1);
  /** The boards' PERSISTENT records (engine/records.ts, design-015 §4.3; D6): a slot per drawn board, written when its record or its raster's facts changed. */
  private readonly store: RecordStore<BoardInstance>;
  /** The records the last prepare turned away at the pass's cap — not drawn; the ground reports them (`GroundStats.dropped`, D7). */
  dropped = 0;
  private readonly stampU = StampUniforms.alloc(1);
  private readonly inkU = InkUniforms.alloc(1);
  private readonly knobBuf: GPUBuffer;
  /** What the GPU holds of the knobs: they are written only when they change (K4a — a standing value costs a frame nothing). */
  private readonly knobsSent = sentBytes(BoardUniforms.size);
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  /** Each drawn board's index in the list `prepare` was handed (a board with no ink to show is skipped) — what `drawRange` counts in. */
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
    this.knobBuf = uniformBuffer(device, BoardUniforms.size, "board/knobs");
    // the pack reads the board's raster afresh (its size, density and wet are the `aux` the change test folds in)
    this.store = createRecordStore<BoardInstance, keyof typeof Board.slots>({
      device, def: Board, capacity: MAX_BOARDS, max: MAX_BOARDS * 64, label: "board/boards",
      // (with where its ink is — the pool slot, the live slot, the thumbnail's layer and base: the `tier`, K6a)
      pack: (b, _aux, into, slot) => {
        const r = shared.rasters.get(b.id);
        const src = r ?? shared.thumbOf.get(b.id) ?? (shared.bare !== null ? BARE : undefined);
        if (src) into.set(boardValues(b, { size: src.size, density: src.density, wet: r?.wetting === true && shared.live === b.id }, tierOf(shared, b.id)), slot);
        return 0;
      },
    });
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
      { binding: 9, stages: ["vertex"], buffer: "read-only-storage" },   // the draw list: paint index → record slot (D6)
    ], "board/slot");
    const layout1 = bindLayout(device, [
      { binding: 0, stages: ["fragment"], texture: "float", dimension: "2d-array" },   // the far-LOD thumbnails
      ...Array.from({ length: BOARD_SLOTS }, (_, i) => ({ binding: 1 + i, stages: ["fragment"] as const, texture: "float" as const })),   // the pool's ink
      { binding: 1 + BOARD_SLOTS, stages: ["fragment"], texture: "float" },   // the live board's stroke
      { binding: 2 + BOARD_SLOTS, stages: ["fragment"], texture: "float" },   // …and its wet
    ], "board/pool");
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
      compile(device, compose(src.board)),
      compile(device, compose(src.stamp)),
      compile(device, compose(src.ink)),
      compile(device, compose(src.mip)),
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
      group1: undefined as unknown as GPUBindGroup,
      thumbs: new LayerArray(device, { label: "board/thumbnails", format: "rgba8unorm", side: BOARD_THUMB }),
      thumbOf: new Map(), pool: Array.from({ length: BOARD_SLOTS }, () => null), live: null, asked: new Map(), bare: null,
      blank: device.createTexture({ label: "board/pool blank", size: [1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING }),
      blankR: device.createTexture({ label: "board/pool blank r8", size: [1, 1], format: "r8unorm", usage: GPUTextureUsage.TEXTURE_BINDING }),
      blankArray: device.createTexture({ label: "board/thumbnails (none yet)", size: [1, 1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING }),
    };
    bindPool(shared);
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
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version) return;
    const s = this.shared;
    this.group = bindGroup(this.device, s.layout0, [this.mat.view, this.knobBuf, this.store.records, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, s.inkSampler, s.linSampler, this.store.order], "board/slot");
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
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
      inkGroup: bindGroup(d, s.inkLayout, [s.inkU, strokeView], `board/ink ${id}`),
      tool: null, pending: [], wetting: false, wetLeft: 0, dryBy: 1, clearWet: false,
    };
    s.rasters.set(id, r);
    const enc = d.createCommandEncoder({ label: "board/new raster" });
    this.clear(enc, r.level0); this.clear(enc, strokeView); this.clear(enc, wetView);
    d.queue.submit([enc.finish()]);
    if (s.pool.includes(id) || s.live === id) bindPool(s);   // a bound board's new raster: the pool binds it
    return true;
  }

  /**
   * Would `ensure` make board `id`'s raster — none held (never made, or evicted), or another size or density (K6b: the frame raster
   * queue's to make, in its turn)?
   */
  makes(id: number, surface: readonly [number, number], density: number = BOARD.ink.density): boolean {
    const size = rasterSize(surface, density);
    const had = this.shared.rasters.get(id);
    return !(had && had.size[0] === size[0] && had.size[1] === size[1] && had.density === density);
  }

  /** The thumbnails' EMPTY layer (K6b): taken and filled with nothing on first need; null when the device holds no more layers. */
  private bareLayer(): number | null {
    const s = this.shared;
    if (s.bare !== null) return s.bare;
    const was = s.thumbs.version;
    const layer = s.thumbs.take();
    if (layer === null) return null;
    s.thumbs.fill(s.blank, 1, layer, 0);   // a layer given back holds a board's old thumbnail: filled from the 1 × 1 transparent
    s.bare = layer;
    if (s.thumbs.version !== was) bindPool(s);   // the array grew
    return layer;
  }

  /** Forget board `id` — its raster, its thumbnail's layer, its slot (it left the desk; a scene's board). */
  release(id: number): void {
    this.evict(id);
    const s = this.shared;
    const t = s.thumbOf.get(id);
    if (t !== undefined) { s.thumbs.give(t.layer); s.thumbOf.delete(id); }
  }

  /**
   * Let board `id`'s RASTER go and keep its thumbnail (the budget's eviction — the raster is a cache of its strokes, replayed
   * when it is next wanted): destroyed, its slot freed.
   */
  evict(id: number): void {
    const s = this.shared;
    const r = s.rasters.get(id);
    if (!r) return;
    r.ink.destroy(); r.stroke.destroy(); r.wet.destroy();
    s.rasters.delete(id);
    const slot = s.pool.indexOf(id);
    if (slot >= 0) s.pool[slot] = null;
    const live = s.live === id;
    if (live) s.live = null;
    const t = s.thumbOf.get(id);
    if (t !== undefined) t.tier += 1;
    if (slot >= 0 || live) bindPool(s);
  }

  /** Board `id`'s far-LOD thumbnail cut again from its raster's chain (the ink changed): its layer taken on the first cut. */
  private cutThumb(r: Raster): void {
    const s = this.shared;
    let t = s.thumbOf.get(r.id);
    if (t === undefined) {
      const was = s.thumbs.version;
      const layer = s.thumbs.take();
      if (layer === null) return;   // the device holds no more layers: the board draws while it has a raster
      t = { layer, base: 0, size: r.size, density: r.density, tier: 0 };
      s.thumbOf.set(r.id, t);
      if (s.thumbs.version !== was) bindPool(s);   // the array grew
    }
    t.base = tailBase(r.size[0], r.size[1], BOARD_THUMB);
    t.size = r.size;
    t.density = r.density;
    t.tier += 1;
    s.thumbs.fill(r.ink, r.levels, t.layer, t.base);
  }

  /** Is board `id`'s raster bound this frame (a pool slot, or the live one)? The budget keeps what is. */
  bound(id: number): boolean { return this.shared.pool.includes(id) || this.shared.live === id; }

  /** The thumbnails' array: what it weighs (the budget's `board`/`thumbnails`, always kept). */
  get thumbnailBytes(): number { return this.shared.thumbs.bytes; }

  /** Has board `id` its far-LOD thumbnail (a layer, cut)? */
  thumbed(id: number): boolean { return this.shared.thumbOf.has(id); }

  /** Board `id`'s raster density (texels a unit), or null without one. */
  densityOf(id: number): number | null { return this.shared.rasters.get(id)?.density ?? null; }

  /**
   * THE FRAME BOUNDARY (the kind's tick, before the next build): the slots of boards no frame asked for since the last step are
   * freed (their rasters stay, a cache), the live slot of a board no longer laid on or wet; and the boards that asked for more
   * than their raster holds — largest first, BOARD_RASTERS_A_STEP a step — are returned with the density to remake them at
   * (the kind replays their strokes into it). Nothing is freed when nothing was drawn since the last step.
   */
  step(): { readonly id: number; readonly density: number }[] {
    const s = this.shared;
    if (s.asked.size === 0) return [];
    let moved = false;
    if (s.live !== null && !liveOf(s.rasters.get(s.live))) { s.live = null; moved = true; }
    for (let i = 0; i < s.pool.length; i++) {
      const id = s.pool[i];
      if (id !== null && id !== undefined && !s.asked.has(id) && s.live !== id) { s.pool[i] = null; moved = true; const t = s.thumbOf.get(id); if (t) t.tier += 1; }
    }
    const raise = [...s.asked].filter(([id, want]) => (s.rasters.get(id)?.density ?? 0) < want).sort((a, b) => b[1] - a[1]).slice(0, BOARD_RASTERS_A_STEP).map(([id, density]) => ({ id, density }));
    s.asked.clear();
    if (moved) bindPool(s);
    return raise;
  }

  /** The last frame's asks still unanswered (K7a): the next tick owes them a `step` — a slot freed, a board raised to its rung. */
  get stepOwed(): boolean { return this.shared.asked.size > 0; }

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
    this.cutThumb(r);
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
    this.cutThumb(r);
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
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, instances: readonly BoardInstance[], present: Presentation | undefined, light: MatLight = DAY_LIGHT, theme?: GroundTheme, keys?: readonly number[]): number {
    this.flush();
    this.dryNow();
    const s = this.shared;
    const from: number[] = [];
    // the boards with ink to show (a raster, or its thumbnail), in paint order — the store's records (D6); their keys alongside,
    // and each one's facts as the aux (its raster's, and where its ink is bound: a tier move repacks it)
    const drawn: BoardInstance[] = [];
    const drawnKeys: number[] | undefined = keys === undefined ? undefined : [];
    const aux: number[] = [];
    const cap = MAX_BOARDS * 64;
    this.dropped = 0;
    const zd = view.zoom * view.dpr;
    const x0 = view.camX;
    const y0 = view.camY;
    const x1 = x0 + view.width / view.zoom;
    const y1 = y0 + view.height / view.zoom;
    let bind = false;
    for (const [i, b] of instances.entries()) {
      // a board recorded without the desk's local asked for no raster (id 0 — a tray specimen, K5a): it draws on the one clean raster,
      // made once at the lowest rung (blank ink reads the same at any density — ≈ 1 MB, never a full raster the budget cannot see),
      // bound in the pool like any board on screen
      if (b.id === 0 && !s.rasters.has(0)) this.ensure(0, [BOARD.spec.width, BOARD.spec.height], 1);
      const r = s.rasters.get(b.id);
      const t = s.thumbOf.get(b.id);
      // no ink yet (K6b — its first replay the queue's): its melamine drawn BARE, from the empty layer, until its turn
      if (!r && !t && this.bareLayer() === null) continue;
      if (drawn.length >= cap) { this.dropped += 1; continue; }
      // ON SCREEN it asks for the density its size wants (the step raises its raster to it); a frame only ADDS to the pool (the
      // step frees it between frames): a board on screen with a raster takes a free slot — one in the cull's margin draws its
      // thumbnail (unseen; a slot it took would be freed at the next step, every frame) — and the one laid on or drying the live slot
      const q = b.quad;
      const seen = q.x1 >= x0 && q.x0 <= x1 && q.y1 >= y0 && q.y0 <= y1;
      if (seen) s.asked.set(b.id, Math.max(s.asked.get(b.id) ?? 0, boardRung(zd * b.geometry.scale)));
      if (r) {
        if (seen && !s.pool.includes(b.id)) { const free = s.pool.indexOf(null); if (free >= 0) { s.pool[free] = b.id; bind = true; } }
        if (s.live === null && (liveOf(r) || b.stroke !== undefined)) { s.live = b.id; bind = true; }
      }
      if (t === undefined && r !== undefined && !s.pool.includes(b.id)) continue;   // a raster with no layer and no slot: nothing to draw it from
      drawn.push(b);
      drawnKeys?.push(keys?.[i] as number);
      const facts = r === undefined ? 0 : (r.wetting ? 1 : 0) + 2 * r.density + 64 * r.size[0] + 64 * 8192 * r.size[1];
      const [, , slot, live] = tierOf(s, b.id);
      aux.push(facts + 5e9 * (2 + slot + 10 * live + 20 * ((t?.tier ?? 0) % 100000)));
      from.push(i);
    }
    if (bind) bindPool(s);
    this.store.prepare(drawn, drawnKeys, (i) => aux[i] as number);
    this.rebind();   // after: the store's buffers may have grown
    this.drawnFrom = from;
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
    writeChanged(this.device.queue, this.knobBuf, this.knobs, this.knobsSent);
    return from.length;
  }

  /** The store's counters (a rig's witness): records written, bytes, draw-list writes, slots in use. */
  get records() { return this.store.stats(); }

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

  get drawn(): number { return this.drawnFrom.length; }

  /** Every board drawn this frame. */
  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, Number.POSITIVE_INFINITY); }

  /**
   * The boards `prepare` was handed at [first, end) — indices into ITS list, as the ground's runs count a
   * kind's records (a board with no ink to show draws nothing) — as ONE instanced draw (K6a, K-L4): the
   * slot's group and the pool's bound once, each board an instance whose record says where its ink is.
   */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < this.drawnFrom.length; i++) {
      const at = this.drawnFrom[i] as number;
      if (at >= end) break;   // ascending: nothing further is in range
      if (at < first) continue;
      if (lo < 0) lo = i;
      hi = i + 1;
    }
    if (lo < 0) return;
    pass.setPipeline(this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.setBindGroup(1, this.shared.group1);
    pass.draw(6, hi - lo, 0, lo);
  }

  /** This slot's buffers; the rasters and the stamp buffers go with the last slot standing. */
  dispose(): void {
    this.knobBuf.destroy(); this.store.dispose();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) {
      for (const id of [...new Set([...s.rasters.keys(), ...s.thumbOf.keys()])]) this.release(id);
      s.stampBuf.destroy(); s.stampU.destroy(); s.inkU.destroy();
      s.thumbs.destroy(); s.blank.destroy(); s.blankR.destroy(); s.blankArray.destroy();
    }
  }
}

/** A raster in use by the hand: a stroke being laid, stamps waiting, or ink still wet — its stroke and wet layers are read. */
const liveOf = (r: Raster | undefined): boolean => r !== undefined && (r.wetting || r.tool !== null || r.pending.length > 0);

/** Where board `id`'s ink is this frame: its thumbnail's layer, the level its source's chain starts the layer at, its pool slot (−1: the thumbnail), live (1: its stroke and wet are bound). */
function tierOf(s: BoardShared, id: number): [number, number, number, number] {
  const t = s.thumbOf.get(id);
  const r = s.rasters.has(id);
  // a board with no ink yet reads the empty layer (K6b); one with a raster and no layer, as before, layer 0 behind its slot
  return [t?.layer ?? (r ? 0 : (s.bare ?? 0)), t?.base ?? 0, r ? s.pool.indexOf(id) : -1, s.live === id ? 1 : 0];
}

function concat(parts: readonly Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
