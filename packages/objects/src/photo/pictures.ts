// THE PICTURES' RESIDENCY (design-016 §6, K-L4; K6a) — every print's picture in SHARED textures under the desk's ONE budget,
// so a run of prints is ONE instanced draw: its record carries where its pixels are, never a bind group of its own.
//
// Two tiers, one mip chain. A picture's chain is made on the device from its level 0 (mips.ts, as it always was) and its
// TAIL — the levels from the first that fits THUMB² — is copied, texel for texel, into a layer of the THUMBNAIL array
// (`photo/thumbnails`, THUMB² × layers, grown by doubling): always resident while a print names the picture, so no print is
// ever blank. A print LARGE on screen — one that samples its picture finer than the thumbnail holds, or within HEADROOM
// of a level of it — asks for a DETAIL: the chain from the finest level it samples (`floor(lod)`: what the screen needs, never
// the whole picture for a print a third of the screen wide), made again from the picture's source (a raw picture's bytes;
// the kind's blob, decoded again) and bound in one of DETAIL_SLOTS pool bindings for the frames it is wanted. Both tiers
// are cuts of the same chain, so where they overlap they are the same texels: the swap shows nothing while the print
// samples at or above the thumbnail's base, and the detail is asked a level before that.
//
// THE BUDGET (engine/budget.ts — the one the boards, the notebook's pages and the calendar's tiles are under): the thumbnail
// array is charged and always kept ("photo" / "thumbnails"); each detail is charged ("photo" / "detail <id>") and kept while a
// slot binds it (on screen and wanted) — off screen it is a cache the budget's LRU takes when the desk is over its cap, made
// again when the print is next large. A detail finer than the print now samples (it zoomed out) is cut down to what it
// samples by a device copy (no fetch).
//
// A frame: each slot's `prepare` ASKS for its prints' pictures at their lod (`ask`); the kind's tick runs `step` once before
// the next frame's build — slots given and taken, details fetched or cut — so what a frame binds never moves inside it.

import { bindGroup, bindLayout } from "@ice/desk/engine";
import type { RasterBudget } from "@ice/desk";
import { type DecodedPicture, generateMips, mipCount } from "@ice/desk/kit";

/** The thumbnail array's layer side, texels: a picture's chain from its first level that fits (a print up to THUMB device px wide samples nothing finer). */
export const THUMB = 512;
export const THUMB_MIPS = mipCount(THUMB, THUMB);
/** The pool: how many details one frame binds (the prints larger on screen than the thumbnail serves, largest first). */
export const DETAIL_SLOTS = 8;
/**
 * A detail is asked this far (levels) BEFORE the print needs it — once it shows its picture larger than THUMB / √2 device px —
 * so it lands while both tiers are still the same texels and the swap shows nothing (a zoom from there to THUMB px is 1.41×).
 */
export const HEADROOM = 0.5;
/** Details fetched at once (each decodes its picture again). */
export const BUILDS = 2;

/** How a picture's level 0 comes back: raw sRGB rgba8 bytes, or a decoded source the device copies; undefined when it cannot. */
export type PictureSource = () => Promise<DecodedPicture | undefined>;

/** The finer cut of a picture's chain a print large on screen samples: its own texture from level `base` down. */
export interface Detail {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly base: number;
  readonly bytes: number;
}

/** A picture on the device: its thumbnail's layer, the chain level that layer starts at, the detail and the slot a frame binds it in. */
export interface Picture {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly mips: number;
  /** Its thumbnail's layer in the shared array (−1 once dropped). */
  layer: number;
  /** The chain's level the thumbnail's level 0 is (0: the whole picture fits the layer). */
  readonly base: number;
  detail: Detail | null;
  /** The pool slot binding the detail this frame; −1: the thumbnail serves. */
  slot: number;
  /** Turns over whenever the slot or the detail moves — a print's record folds it in (`aux`) and is packed again. */
  tier: number;
}

interface Held extends Picture {
  readonly source: PictureSource;
  /** The smallest lod a print asked it at since the last step (Infinity: not asked). */
  want: number;
  /** A detail on its way, from this level; Infinity when none. */
  building: number;
  dropped: boolean;
}

/** The level of a `w × h` picture's chain the thumbnail starts at: the first whose both sides fit `side`. */
export function thumbBase(w: number, h: number, side: number = THUMB): number {
  let k = 0;
  while (Math.max(w >> k, 1) > side || Math.max(h >> k, 1) > side) k += 1;
  return k;
}

/**
 * The lod a print samples its picture at (photo.wgsl `photo_picture`): texels per device pixel along the picture's wider axis,
 * log2 — `inner` the picture's half extents on the sheet (world), `zoom · dpr` device pixels a world unit.
 */
export function pictureLod(width: number, height: number, inner: readonly [number, number], zoom: number, dpr: number): number {
  return Math.log2(Math.max(width / (2 * Math.max(inner[0], 1e-6)), height / (2 * Math.max(inner[1], 1e-6))) / Math.max(zoom * dpr, 1e-9));
}

/** The detail a print sampling at `lod` needs: the finest level it samples, below the thumbnail's `base` — null when the thumbnail serves (or will within HEADROOM). */
export function detailNeed(lod: number, base: number): number | null {
  if (base === 0 || !(lod < base + HEADROOM)) return null;
  return Math.min(Math.max(Math.floor(lod), 0), base - 1);
}

/** Bytes of `levels` of a chain from `w × h` (rgba8). */
export function chainBytes(w: number, h: number, levels: number): number {
  let b = 0;
  for (let l = 0; l < levels; l++) b += Math.max(w >> l, 1) * Math.max(h >> l, 1) * 4;
  return b;
}

/**
 * THE LAYER ALLOCATOR: a thumbnail array's layers handed out lowest first and taken back; `grow` says how many the array must
 * hold for the next (doubling, from `first`, to the device's `max`) — `null` when it holds no more.
 */
export class Layers {
  private readonly free: number[] = [];
  private next = 0;
  capacity = 0;
  constructor(readonly first = 4, readonly max = 256) {}
  /** The layer the next picture takes, and the capacity it needs (≥ the current one). */
  take(): { readonly layer: number; readonly capacity: number } | null {
    if (this.free.length > 0) { this.free.sort((a, b) => a - b); return { layer: this.free.shift() as number, capacity: this.capacity }; }
    if (this.next >= this.max) return null;
    const layer = this.next++;
    if (layer >= this.capacity) this.capacity = Math.min(Math.max(this.first, this.capacity * 2), this.max);
    return { layer, capacity: this.capacity };
  }
  give(layer: number): void { if (layer >= 0 && layer < this.next && !this.free.includes(layer)) this.free.push(layer); }
  get used(): number { return this.next - this.free.length; }
}

// The copy into a layer: a level of the chain at the layer's origin, its last row and column carried to the layer's edge
// (clamp-to-edge, as the picture's own texture sampled it) — through `rgba8unorm` views of both, so the bytes pass unchanged.
const FILL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[i];
  return vec4f(p, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let last = vec2i(textureDimensions(src)) - vec2i(1);
  return textureLoad(src, min(vec2i(pos.xy), last), 0);
}
`;

const USAGE_CHAIN = (): number => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;

/** The group-1 layout every print pipeline binds: the thumbnail array, then the pool's DETAIL_SLOTS details. */
export function picturesLayout(device: GPUDevice): GPUBindGroupLayout {
  return bindLayout(device, [
    { binding: 0, stages: ["fragment"], texture: "float", dimension: "2d-array" },
    ...Array.from({ length: DETAIL_SLOTS }, (_, i) => ({ binding: 1 + i, stages: ["fragment"] as const, texture: "float" as const })),
  ], "photo/pictures");
}

export interface PictureStats {
  readonly pictures: number;
  /** Thumbnail layers in use, and the array's capacity. */
  readonly layers: number;
  readonly capacity: number;
  readonly details: number;
  readonly slotted: number;
  readonly building: number;
  /** Detail builds landed, detail cuts made, details the budget evicted — since the store was made. */
  readonly built: number;
  readonly cut: number;
  readonly evicted: number;
  readonly bytes: { readonly thumbnails: number; readonly details: number };
}

/** The pictures of one device: the thumbnail array, the details, the pool — one per photo pass family (every slot shares it). */
export class PictureStore {
  readonly layout: GPUBindGroupLayout;
  /** The group every slot binds at 1 this frame: the array and the pool (blank where a slot is empty). */
  group: GPUBindGroup;
  /** A detail landed or went (async): the kind wakes the desk so the next step binds it. */
  onReady: () => void = () => {};
  private readonly device: GPUDevice;
  private readonly layers: Layers;
  private thumbs: GPUTexture | null = null;
  /** The array's layers (kept here: the texture's own count is the device's word, and a fake device has none). */
  private thumbCap = 0;
  private readonly blank: GPUTexture;
  private readonly blankArray: GPUTexture;
  private fill: { readonly module: GPUShaderModule; readonly pipe: GPURenderPipeline } | null = null;
  private readonly pictures = new Map<number, Held>();
  private readonly slots: (Held | null)[] = Array.from({ length: DETAIL_SLOTS }, () => null);
  private readonly asked = new Set<Held>();
  private budget: RasterBudget | undefined;
  private nextId = 1;
  private inflight = 0;
  private built = 0;
  private cut = 0;
  private evicted = 0;

  constructor(device: GPUDevice) {
    this.device = device;
    this.layout = picturesLayout(device);
    const max = (device as { limits?: { maxTextureArrayLayers?: number } }).limits?.maxTextureArrayLayers ?? 256;
    this.layers = new Layers(4, max);
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    this.blank = device.createTexture({ label: "photo/pictures blank", size: [1, 1], format: "rgba8unorm-srgb", usage });
    this.blankArray = device.createTexture({ label: "photo/thumbnails (none yet)", size: [1, 1, 1], format: "rgba8unorm-srgb", usage });
    this.group = this.bind();
  }

  /** Charge the desk's budget from now on (the kind's host lends it; the oracle's bare pass has none). */
  attach(budget: RasterBudget | undefined): void {
    if (budget === this.budget) return;
    this.budget = budget;
    if (budget === undefined) return;
    this.chargeThumbs();
    for (const p of this.pictures.values()) if (p.detail !== null) this.chargeDetail(p);
  }

  /** The budget's ask: the thumbnails always; a detail while a slot binds it. */
  keeps(key: string): boolean {
    if (key === "thumbnails") return true;
    const id = /^detail (\d+)$/.exec(key);
    return id !== null && (this.pictures.get(Number(id[1]))?.slot ?? -1) >= 0;
  }

  /**
   * A picture from its level 0 — raw bytes written, or a decoded source copied — and how to get that level 0 again (a detail's
   * fetch): its chain made, its tail copied into a thumbnail layer, the chain let go. Null when the array holds no more layers.
   */
  make(first: DecodedPicture, source: PictureSource): Picture | null {
    const taken = this.layers.take();
    if (taken === null) return null;
    const { width, height } = first;
    const mips = mipCount(width, height);
    const base = thumbBase(width, height);
    if (this.thumbs === null || taken.capacity > this.thumbCap) this.growThumbs(taken.capacity);
    const chain = this.chain(first);
    this.fillLayer(chain, taken.layer, base, mips);
    chain.destroy();
    const p: Held = { id: this.nextId++, width, height, mips, layer: taken.layer, base, detail: null, slot: -1, tier: 0, source, want: Number.POSITIVE_INFINITY, building: Number.POSITIVE_INFINITY, dropped: false };
    this.pictures.set(p.id, p);
    return p;
  }

  /** A picture no print names any more: its layer back to the array, its detail destroyed, its slot freed. */
  drop(pic: Picture): void {
    const p = this.pictures.get(pic.id);
    if (p === undefined) return;
    p.dropped = true;
    this.pictures.delete(p.id);
    this.asked.delete(p);
    this.layers.give(p.layer);
    p.layer = -1;
    const slotted = p.slot >= 0;
    if (slotted) this.slots[p.slot] = null;
    p.slot = -1;
    this.setDetail(p, null);
    if (slotted) this.group = this.bind();
  }

  /** A print asked for its picture at `lod` this frame (a slot's prepare). */
  ask(pic: Picture, lod: number): void {
    const p = this.pictures.get(pic.id);
    if (p === undefined) return;
    if (lod < p.want) p.want = lod;
    this.asked.add(p);
  }

  /**
   * THE FRAME BOUNDARY (the kind's tick, before the next frame's build): the pictures asked since the last step, largest on
   * screen first — the first DETAIL_SLOTS that need more than the thumbnail (or will within HEADROOM) keep or take a slot
   * once their detail is resident; a missing or too-coarse detail is fetched (a coarser one binds meanwhile), a detail finer
   * than its print samples now is cut down; every other slot is freed. Returns whether a print's tier moved (its record must be
   * packed again, the desk redrawn). O(1) when nothing was drawn since the last step.
   */
  step(): boolean {
    if (this.asked.size === 0) return false;
    const chosen = [...this.asked].filter((p) => detailNeed(p.want, p.base) !== null).sort((a, b) => a.want - b.want).slice(0, DETAIL_SLOTS);
    const keep = new Set(chosen);
    let moved = false;
    for (let s = 0; s < DETAIL_SLOTS; s++) {
      const p = this.slots[s];
      if (p !== null && p !== undefined && (!keep.has(p) || p.detail === null)) { this.slots[s] = null; p.slot = -1; p.tier += 1; moved = true; }
    }
    for (const p of chosen) {
      const need = detailNeed(p.want, p.base) as number;
      const d = p.detail;
      if (d === null || d.base > need) this.fetch(p, need);   // (a coarser detail binds meanwhile)
      else if (d.base < need - 1) { this.cutTo(p, need); moved = true; }   // zoomed out: only what it samples, by a device copy
      if (p.detail !== null && p.slot < 0) {
        const s = this.slots.indexOf(null);
        if (s >= 0) { this.slots[s] = p; p.slot = s; p.tier += 1; moved = true; }
      }
      if (p.detail !== null) this.budget?.touch("photo", `detail ${p.id}`);
    }
    for (const p of this.asked) p.want = Number.POSITIVE_INFINITY;
    this.asked.clear();
    if (moved) this.group = this.bind();
    return moved;
  }

  stats(): PictureStats {
    let details = 0;
    let bytes = 0;
    let building = 0;
    for (const p of this.pictures.values()) {
      if (p.detail !== null) { details += 1; bytes += p.detail.bytes; }
      if (p.building !== Number.POSITIVE_INFINITY) building += 1;
    }
    return {
      pictures: this.pictures.size, layers: this.layers.used, capacity: this.layers.capacity, details, building,
      slotted: this.slots.filter((s) => s !== null).length, built: this.built, cut: this.cut, evicted: this.evicted,
      bytes: { thumbnails: this.thumbsBytes(), details: bytes },
    };
  }

  dispose(): void {
    for (const p of [...this.pictures.values()]) this.drop(p);
    this.thumbs?.destroy();
    this.thumbs = null;
    this.thumbCap = 0;
    this.blank.destroy();
    this.blankArray.destroy();
    this.budget?.release("photo", "thumbnails");
  }

  // ---------------------------------------------------------------- the device's side

  private bind(): GPUBindGroup {
    const thumbs = (this.thumbs ?? this.blankArray).createView({ dimension: "2d-array" });
    const details = this.slots.map((p) => p?.detail?.view ?? this.blank.createView());
    return bindGroup(this.device, this.layout, [thumbs, ...details], "photo/pictures");
  }

  private thumbsBytes(): number { return this.thumbCap * chainBytes(THUMB, THUMB, THUMB_MIPS); }

  private chargeThumbs(): void { this.budget?.charge("photo", "thumbnails", this.thumbsBytes(), () => {}); }

  private chargeDetail(p: Held): void {
    const d = p.detail;
    if (d === null) return;
    this.budget?.charge("photo", `detail ${p.id}`, d.bytes, () => { this.evicted += 1; this.setDetail(p, null, false); this.onReady(); });
  }

  /** The array at `capacity` layers: made, the old layers copied into it (every level), the old let go. */
  private growThumbs(capacity: number): void {
    const next = this.device.createTexture({
      label: "photo/thumbnails", size: [THUMB, THUMB, capacity], format: "rgba8unorm-srgb", mipLevelCount: THUMB_MIPS,
      usage: USAGE_CHAIN(), viewFormats: ["rgba8unorm"],
    });
    const old = this.thumbs;
    if (old !== null) {
      const enc = this.device.createCommandEncoder({ label: "photo/thumbnails grow" });
      for (let m = 0; m < THUMB_MIPS; m++) {
        const side = Math.max(THUMB >> m, 1);
        enc.copyTextureToTexture({ texture: old, mipLevel: m }, { texture: next, mipLevel: m }, [side, side, this.thumbCap]);
      }
      this.device.queue.submit([enc.finish()]);
      old.destroy();
    }
    this.thumbs = next;
    this.thumbCap = capacity;
    this.chargeThumbs();
    this.group = this.bind();
  }

  /** A picture's whole chain from its level 0 (as it always was made: written or copied, then mips.ts). */
  private chain(first: DecodedPicture): GPUTexture {
    const { width, height } = first;
    const texture = this.device.createTexture({
      label: `photo/picture ${width}×${height}`, size: [width, height], format: "rgba8unorm-srgb", mipLevelCount: mipCount(width, height),
      usage: USAGE_CHAIN(), viewFormats: ["rgba8unorm"],
    });
    if (first.kind === "rgba") this.device.queue.writeTexture({ texture }, first.bytes, { bytesPerRow: width * 4 }, [width, height, 1]);
    else this.device.queue.copyExternalImageToTexture({ source: first.source as ImageBitmap }, { texture, premultipliedAlpha: false }, [width, height]);
    if (mipCount(width, height) > 1) generateMips(this.device, texture);
    return texture;
  }

  /** Every level of layer `layer`: the chain's level `base + m` at the origin, its edge carried to the layer's (the chain's last level past its end). */
  private fillLayer(chain: GPUTexture, layer: number, base: number, mips: number): void {
    const thumbs = this.thumbs as GPUTexture;
    if (this.fill === null) {
      const module = this.device.createShaderModule({ label: "photo/thumbnail fill", code: FILL });
      this.fill = { module, pipe: this.device.createRenderPipeline({ label: "photo/thumbnail fill", layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] } }) };
    }
    const { pipe } = this.fill;
    const enc = this.device.createCommandEncoder({ label: "photo/thumbnail fill" });
    for (let m = 0; m < THUMB_MIPS; m++) {
      const src = chain.createView({ format: "rgba8unorm", dimension: "2d", baseMipLevel: Math.min(base + m, mips - 1), mipLevelCount: 1 });
      const dst = thumbs.createView({ format: "rgba8unorm", dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: m, mipLevelCount: 1 });
      const group = this.device.createBindGroup({ label: "photo/thumbnail fill", layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }] });
      const pass = enc.beginRenderPass({ label: "photo/thumbnail fill", colorAttachments: [{ view: dst, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([enc.finish()]);
  }

  /** The levels of `from` (a chain from level `fromBase`) from level `base` down, in a texture of their own — a device copy. */
  private cutChain(from: GPUTexture, fromBase: number, base: number, p: Held): Detail {
    const w = Math.max(p.width >> base, 1);
    const h = Math.max(p.height >> base, 1);
    const levels = p.mips - base;
    const texture = this.device.createTexture({ label: `photo/detail ${p.width}×${p.height} from ${base}`, size: [w, h], format: "rgba8unorm-srgb", mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    const enc = this.device.createCommandEncoder({ label: "photo/detail cut" });
    for (let m = 0; m < levels; m++) enc.copyTextureToTexture({ texture: from, mipLevel: base - fromBase + m }, { texture, mipLevel: m }, [Math.max(w >> m, 1), Math.max(h >> m, 1), 1]);
    this.device.queue.submit([enc.finish()]);
    return { texture, view: texture.createView(), base, bytes: chainBytes(w, h, levels) };
  }

  /** Replace `p`'s detail (null: none): the old destroyed and released, the new charged; a slot binding it is rebound. */
  private setDetail(p: Held, d: Detail | null, release = true): void {
    const old = p.detail;
    if (old === d) return;
    p.detail = d;
    p.tier += 1;
    if (old !== null) { old.texture.destroy(); if (release) this.budget?.release("photo", `detail ${p.id}`); }
    if (d !== null) this.chargeDetail(p);
    if (p.slot >= 0) {
      if (d === null) { this.slots[p.slot] = null; p.slot = -1; }
      this.group = this.bind();
    }
  }

  /**
   * The finest level from `base` whose chain the budget has room for beside what the pictures already pin (the thumbnails, the
   * other bound details) — so the pictures alone never hold more than the cap; null when not even the coarsest detail fits
   * (the thumbnail serves, a little soft). The other owners' rasters are the budget's LRU to trim, as before.
   */
  private afford(p: Held, base: number): number | null {
    const b = this.budget;
    if (b === undefined) return base;
    let pinned = this.thumbsBytes();
    for (const q of this.slots) if (q !== null && q !== p && q.detail !== null) pinned += q.detail.bytes;
    for (let j = base; j < p.base; j++) if (chainBytes(Math.max(p.width >> j, 1), Math.max(p.height >> j, 1), p.mips - j) <= b.cap - pinned) return j;
    return null;
  }

  /** Fetch `p`'s level 0 again and make its detail from level `base` — or the finest the budget affords — unless one that fine is on its way, or BUILDS are. */
  private fetch(p: Held, want: number): void {
    const base = this.afford(p, want);
    if (base === null || (p.detail !== null && p.detail.base <= base)) return;
    if (p.building <= base || this.inflight >= BUILDS) return;
    p.building = base;
    this.inflight += 1;
    const done = (): void => { this.inflight -= 1; if (p.building === base) p.building = Number.POSITIVE_INFINITY; };
    p.source().then((first) => {
      done();
      if (first === undefined) return;
      try {
        if (p.dropped || (p.detail !== null && p.detail.base <= base)) return;
        const chain = this.chain(first);
        if (base === 0) this.setDetail(p, { texture: chain, view: chain.createView(), base: 0, bytes: chainBytes(p.width, p.height, p.mips) });
        else { this.setDetail(p, this.cutChain(chain, 0, base, p)); chain.destroy(); }
        this.built += 1;
        this.onReady();
      } finally { if (first.kind === "source") first.close?.(); }
    }, done);
  }

  /** `p`'s detail cut down to level `base` (it zoomed out): a copy of what it samples, the finer levels let go. */
  private cutTo(p: Held, base: number): void {
    const d = p.detail as Detail;
    this.setDetail(p, this.cutChain(d.texture, d.base, base, p));
    this.cut += 1;
  }
}
