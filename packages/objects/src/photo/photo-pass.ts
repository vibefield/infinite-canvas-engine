// The photo pass — the prints, a run of them ONE instanced draw (K6a, K-L4). Owns
// its knobs and the record buffer (the camera and the light are the slot's view
// block, K4a); shares — with every slot spawned from the first — the pipeline,
// the samplers and the PICTURES (pictures.ts): each picture's mip chain made from
// whatever the host decoded (a pasted image, a dropped file), its tail a layer of
// one THUMBNAIL array, and a print large on screen its DETAIL bound in a pool
// slot — all of it group 1, the same for every print, so a print's record says
// where its pixels are and a picture made once draws in any slot.
// A slot reads its OWN mat's animated silhouette and blue noise, so a print is
// dappled by the same palm as the mat under it — and a slot lit from elsewhere
// (a mini mat's inside: MINIMAT.md §4) takes the lamp of the desk it lies on,
// through a second pipeline (`LIT_ELSEWHERE`, the note's precedent). The pass
// draws in RANGES of the prints it was handed (design-015 §4.2): the desk's runs.

import { bindGroup, bindLayout, renderPipeline, uniformBuffer, compile, compose } from "@ice/desk/engine";
import { createRecordStore, type RasterBudget, type RecordStore } from "@ice/desk";
import { type FadeIn, type View, litByOwn, type MatConfig, type MatFrame, type SlotLight, type MatPass, type Presentation, DAY_LIGHT, type MatLight, sentBytes, writeChanged } from "@ice/desk/kit";
import { MAX_PHOTOS, Photo, PhotoUniforms, photoUniformValues, photoValues } from "./layout";
import { type Picture, PictureStore, type PictureSource, type PictureStats, pictureLod } from "./pictures";
import { PHOTO, type PhotoGeometry, type PhotoLaw } from "./photo";
import type { PhotoShaders } from "./shaders";

/** Premultiplied "source over". */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** The largest side a picture keeps on the device — a 6×4 print at zoom 5 on a 2× screen. */
export const PICTURE_MAX = 4096;

export type { Picture } from "./pictures";

/** One print for the pass: its resolved pose, its border's width, its picture. */
export interface PhotoInstance {
  readonly geometry: PhotoGeometry;
  readonly border: number;
  readonly picture: Picture | null;
}

/** What every slot's pass shares with the root's: the layout, the pipeline, the samplers — and the pictures (group 1). */
interface PhotoShared {
  readonly layout0: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  /** The same, for a slot lit from elsewhere — a mini mat's inside, a handover (MINIMAT.md §4): `LIT_ELSEWHERE` is a pipeline constant. */
  readonly litPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly picSampler: GPUSampler;
  /** The pictures: the thumbnail array, the details, the pool (pictures.ts) — group 1 of every slot. */
  readonly pictures: PictureStore;
  slots: number;
}

export class PhotoPass {
  readonly name = "photo/prints";
  private readonly knobs = PhotoUniforms.alloc(1);
  /** The prints' PERSISTENT records (engine/records.ts, design-015 §4.3; D6): a slot per print while drawn, written when it changed. */
  private readonly store: RecordStore<PhotoInstance>;
  /** The records the last prepare turned away at the pass's cap — not drawn; the ground reports them (`GroundStats.dropped`, D7). */
  dropped = 0;
  private readonly knobBuf: GPUBuffer;
  /** What the GPU holds of the knobs: they are written only when they change (K4a — a standing value costs a frame nothing). */
  private readonly knobsSent = sentBytes(PhotoUniforms.size);
  private group!: GPUBindGroup;
  private bound = -1;
  private boundStore = -1;
  /** This frame's prints, in the order `prepare` was handed them — what `drawRange` counts in. */
  private count = 0;
  /** This frame's slot is lit from elsewhere: it draws with the second pipeline. */
  private litElsewhere = false;
  /** The print's numbers (photo.ts `PHOTO`) — a host tunes the root's copy; every slot takes it (`tune`). */
  law: PhotoLaw = PHOTO;
  private readonly device: GPUDevice;
  private readonly shared: PhotoShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: PhotoShared, mat: MatPass) {
    this.device = device; this.shared = shared; this.mat = mat;
    shared.slots += 1;
    this.knobBuf = uniformBuffer(device, PhotoUniforms.size, "photo/knobs");
    this.store = createRecordStore<PhotoInstance, keyof typeof Photo.slots>({
      device, def: Photo, capacity: MAX_PHOTOS, max: MAX_PHOTOS * 64, label: "photo/prints",
      // (a print's picture's tier — its detail's slot and cut — is the `aux` the change test folds in: a detail bound or let go repacks it)
      pack: (p, _aux, into, slot) => { into.set(photoValues(p.geometry, p.border, p.picture), slot); return 0; },
    });
    this.rebind();
  }

  /** The root's pass, on the root's mat (its silhouette and noise). */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: PhotoShaders, mat: MatPass): Promise<PhotoPass> {
    const layout0 = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], buffer: "uniform" },
      { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 3, stages: ["fragment"], texture: "float" },
      { binding: 4, stages: ["fragment"], sampler: "filtering" },
      { binding: 5, stages: ["fragment"], texture: "float" },
      { binding: 6, stages: ["fragment"], sampler: "filtering" },
      { binding: 7, stages: ["fragment"], sampler: "filtering" },
      { binding: 8, stages: ["vertex"], buffer: "read-only-storage" },   // the draw list: paint index → record slot (D6)
    ], "photo/prints");
    const pictures = new PictureStore(device);
    const module = await compile(device, compose(src));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout0, pictures.layout] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, { label: "photo/prints", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "photo/prints, lit from elsewhere", layout: pl, module, format, blend: BLEND_PREMUL, constants: { LIT_ELSEWHERE: 1 } }),
    ]);
    const shared: PhotoShared = {
      layout0, pipeline, litPipeline,
      goboSampler: device.createSampler({ label: "photo/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      noiseSampler: device.createSampler({ label: "photo/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      picSampler: device.createSampler({ label: "photo/picture", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      pictures, slots: 0,
    };
    return new PhotoPass(device, shared, mat);
  }

  /** A second slot on the same pipeline, samplers and pictures, reading ITS mat's silhouette and noise — a mini mat's inside, a flight's departed desk. */
  spawn(mat: MatPass): PhotoPass {
    const p = new PhotoPass(this.device, this.shared, mat);
    p.law = this.law;
    return p;
  }

  /** Take the root's law — what every spawned slot does each frame. */
  tune(from: PhotoPass): void { this.law = from.law; }

  private rebind(): void {
    if (this.bound === this.mat.assetVersion && this.boundStore === this.store.version) return;
    const s = this.shared;
    this.group = bindGroup(this.device, s.layout0, [this.mat.view, this.knobBuf, this.store.records, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, s.picSampler, this.store.order], "photo/prints");
    this.bound = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /**
   * A picture from raw sRGB rgba8 bytes (row 0 = top, straight alpha) — what a Node host or a test hands in. A picture is
   * the PASS's resource, shared by every slot: a print's record names it by this handle (`PhotoInstance.picture`), and it
   * lives until the host drops it (`dropPicture`). The bytes are kept (by reference) to make a detail from; null when the
   * thumbnail array holds no more pictures (the device's layers — the print draws its paper alone).
   */
  picture(bytes: Uint8Array<ArrayBuffer>, width: number, height: number): Picture | null {
    const raw = { kind: "rgba", bytes, width, height } as const;
    return this.shared.pictures.make(raw, async () => raw);
  }

  /**
   * A picture from a decoded image (a pasted or dropped file, an `<img>`, a canvas) — the browser's path; `again` decodes it
   * afresh for a print large on screen (its detail) — without it the picture keeps its thumbnail alone.
   */
  pictureFrom(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement, width: number, height: number, again?: PictureSource): Picture | null {
    return this.shared.pictures.make({ kind: "source", source, width, height }, again ?? (async () => undefined));
  }

  /** A picture no print names any more: its layer given back, its detail destroyed. */
  dropPicture(p: Picture): void { this.shared.pictures.drop(p); }

  /**
   * THE RESIDENCY's frame boundary (pictures.ts `step` — the kind's tick, before the build): details bound, fetched, cut or let
   * go for what the last frame's prints asked. True when a print's tier moved (the desk must draw again).
   */
  residency(): boolean { return this.shared.pictures.step(); }
  /** The last frame's asks still unanswered (K7a): the next tick owes them a `residency` step — a detail fetched, a slot freed. */
  get residencyOwed(): boolean { return this.shared.pictures.pending(); }

  /** The pictures under the desk's budget (the kind's host lends it) — and its ask of what stays. */
  budget(budget: RasterBudget | undefined): void { this.shared.pictures.attach(budget); }
  keeps(key: string): boolean { return this.shared.pictures.keeps(key); }
  /** A detail landed or was evicted (async): `wake` asks the desk for a frame. */
  set onPictures(wake: () => void) { this.shared.pictures.onReady = wake; }
  /** The pictures' counters (a rig's witness): thumbnails, details, slots, bytes. */
  get pictureStats(): PictureStats { return this.shared.pictures.stats(); }

  /**
   * Upload this frame's prints in paint order (first = lowest) and the mat's block for this slot's camera,
   * its light (`light` the Sun or the Moon, `lit` the lamp it is seen by — MINIMAT.md §4): the dapple falls
   * on the prints. Returns the count that will draw.
   */
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, prints: readonly PhotoInstance[], present?: Presentation, light: MatLight = DAY_LIGHT, lit?: SlotLight, keys?: readonly number[]): number {
    const cap = MAX_PHOTOS * 64;
    const list = prints.length > cap ? prints.slice(0, cap) : prints;
    this.dropped = prints.length - list.length;
    // the store (D6): a print keyed by `keys[i]` keeps its slot and is written only when its record changed; no keys = every one packed
    const n = this.store.prepare(list, keys !== undefined && keys.length > cap ? keys.slice(0, cap) : keys, (i) => list[i]?.picture?.tier ?? 0);
    this.rebind();   // after: the store's buffers may have grown
    this.count = list.length;
    // K7b: the prints the flat-card pipeline draws — every one whose picture has no detail bound (the card reads the thumbnails alone)
    if (this.cards.length < list.length) this.cards = new Int32Array(Math.max(list.length, this.cards.length * 2));
    for (let i = 0; i < list.length; i++) this.cards[i] = (list[i]?.picture?.slot ?? -1) < 0 ? this.store.slotAt(i) : -1;
    // each print ON SCREEN asks for its picture at the lod it samples it (pictures.ts): the residency's next step answers — a
    // print in the cull's margin asks nothing (its thumbnail stands; a detail is the screen's, never a prefetch)
    const pics = this.shared.pictures;
    const zd = view.zoom * view.dpr;
    const x0 = view.camX;
    const y0 = view.camY;
    const x1 = x0 + view.width / view.zoom;
    const y1 = y0 + view.height / view.zoom;
    for (const p of list) {
      const pic = p.picture;
      const G = p.geometry;
      if (pic === null || G.alpha <= 0 || G.bounds.x1 < x0 || G.bounds.x0 > x1 || G.bounds.y1 < y0 || G.bounds.y0 > y1) continue;
      pics.ask(pic, pictureLod(pic.width, pic.height, [G.half[0] - p.border, G.half[1] - p.border], zd, 1));
    }
    this.litElsewhere = !litByOwn(view, lit);
    this.knobs.set(photoUniformValues(this.law));
    writeChanged(this.device.queue, this.knobBuf, this.knobs, this.knobsSent);
    return n;
  }

  /** The store's counters (a rig's witness): records written, bytes, draw-list writes, slots in use. */
  get records() { return this.store.stats(); }

  /** K7b: record `index` of the last prepare drawn by the flat-card pipeline — its slot in the store — or −1: a detail is bound, the pass draws it. */
  cardSlot(index: number): number { return index < this.count ? (this.cards[index] as number) : -1; }
  private cards = new Int32Array(64);

  /** K7b: this slot's resources for the print's card material (shaders.ts `photoCard`), in its bindings' order — made again when the store or the thumbnails grew. */
  cardResources(): { readonly version: number; readonly resources: readonly (GPUBuffer | GPUTextureView | GPUSampler)[] } {
    const t = this.shared.pictures.thumbView();
    if (this.card === null || this.cardOver[0] !== this.store.version || this.cardOver[1] !== t.version) {
      const s = this.shared;
      this.cardOver = [this.store.version, t.version];
      this.card = { version: (this.card?.version ?? 0) + 1, resources: [this.knobBuf, this.store.records, s.goboSampler, s.noiseSampler, s.picSampler, t.view] };
    }
    return this.card;
  }
  private card: { readonly version: number; readonly resources: readonly (GPUBuffer | GPUTextureView | GPUSampler)[] } | null = null;
  private cardOver: readonly number[] = [];

  get drawn(): number { return this.count; }

  /** Every print prepared this frame, into a pass the caller opened: `drawRange` over the whole list. */
  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, this.count); }

  /**
   * The prints `prepare` was handed at [first, end) — indices into ITS list, as the ground's runs count a kind's records —
   * as ONE instanced draw (K6a, K-L4): the slot's group and the pictures' bound once, on the pipeline for the slot's light,
   * each print an instance whose record says where its pixels are. An empty range records nothing, not even the pipeline.
   */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.litElsewhere ? this.shared.litPipeline : this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.setBindGroup(1, this.shared.pictures.group);
    pass.draw(6, hi - first, 0, first);
  }

  /** This slot's buffers; the pictures go with the last slot standing (a host's pictures are the host's to drop until then). */
  dispose(): void {
    this.knobBuf.destroy(); this.store.dispose();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) s.pictures.dispose();
  }
}
