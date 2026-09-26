// The paper pass — the notes, instanced, one draw in paint order. Owns its
// copy of the mat's uniform block (filled for the slot's camera and light
// every frame), its own knobs, the per-note record buffer and the bind group;
// shares — with every slot spawned from the first — the pipeline, the samplers
// and the INK PAGES: an r8 `2d-array` the rasters live in, carved by
// `InkShelves` so both hosts put the same bytes at the same texels. A slot
// reads its OWN mat's animated silhouette (the wind target) and its light, so
// a note inside a mini mat is dappled by the lamp of the desk the mini mat
// lies on (MINIMAT.md §4). Notes lie above every mini mat on their desk.

import { bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { createRecordStore, type RecordStore } from "../engine/records";
import { compile, compose } from "../engine/shader";
import type { FadeIn, View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { litByOwn, type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, type SlotLight, STILL_MAT_FRAME } from "../mat/layout";
import type { MatPass } from "../mat/mat-pass";
import { DAY_LIGHT, type MatLight } from "../mat/night";
import { type GroundTheme, MAT_GRID, type RGB } from "../theme";
import { MAX_PAPERS, Paper, PaperUniforms, type PaperInstance, paperValues } from "./layout";
import { InkShelves, type InkRect, uvOf, type UvRect } from "./pages";
import { DEFAULT_PAPER_LAW, type PaperLaw } from "./paper";
import type { PaperShaders } from "./shaders";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** The ink pages: this many texels a side, this many layers — 4 MB a layer as r8, 16 MB in all. */
export const INK_PAGE = 2048;
export const INK_LAYERS = 4;

interface PaperShared {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  /** The same, for a slot lit from elsewhere — a mini mat's inside, a handover (MINIMAT.md §4): `LIT_ELSEWHERE` is a pipeline constant. */
  readonly litPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly inkSampler: GPUSampler;
  readonly pages: GPUTexture;
  readonly pagesView: GPUTextureView;
  readonly shelves: InkShelves;
  slots: number;
}

export class PaperPass {
  readonly name = "paper/notes";
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = PaperUniforms.alloc(1);
  /** The notes' PERSISTENT records (engine/records.ts, design-015 §4.3; D6): a slot per note while it is drawn, written when it changed. */
  private readonly store: RecordStore<PaperInstance>;
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  /** This frame's slot is lit from elsewhere: it draws with the second pipeline. */
  private litElsewhere = false;
  private lawNow: PaperLaw = DEFAULT_PAPER_LAW;
  /** The paper's numbers (theme.ts `PAPER`) — the caret's and the ring's widths, the fibre. A host tweaks the root's; every slot copies it. A new law repacks every record (the fibre is packed). */
  get law(): PaperLaw { return this.lawNow; }
  set law(next: PaperLaw) { if (next !== this.lawNow) { this.lawNow = next; this.store.invalidate(); } }
  /** The day's chain on the paper: false = a lit sheet shows its configured byte; true = the mat's own double gamma (the golden note). */
  chain = false;
  /** The wipe's softness — how wide the pen's edge is as a glyph arrives, note units. */
  wipeSoft = 6;
  private readonly device: GPUDevice;
  private readonly shared: PaperShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: PaperShared, mat: MatPass) {
    this.device = device; this.shared = shared; this.mat = mat;
    shared.slots += 1;
    this.matBuf = uniformBuffer(device, MatUniforms.size, "paper/mat uniforms");
    this.knobBuf = uniformBuffer(device, PaperUniforms.size, "paper/knobs");
    this.store = createRecordStore<PaperInstance, keyof typeof Paper.slots>({
      device, def: Paper, capacity: MAX_PAPERS, max: MAX_PAPERS * 64, label: "paper/notes",
      pack: (p, _aux, into, slot) => { into.set(paperValues(p, this.lawNow.grain), slot); return 0; },
    });
    this.rebind();
  }

  /** The root's pass, on the root's mat. */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: PaperShaders, mat: MatPass): Promise<PaperPass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["fragment"], buffer: "uniform" },
      { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 3, stages: ["fragment"], texture: "float" },
      { binding: 4, stages: ["fragment"], sampler: "filtering" },
      { binding: 5, stages: ["fragment"], texture: "float" },
      { binding: 6, stages: ["fragment"], sampler: "filtering" },
      { binding: 7, stages: ["fragment"], texture: "float", dimension: "2d-array" },
      { binding: 8, stages: ["fragment"], sampler: "filtering" },
      { binding: 9, stages: ["vertex"], buffer: "read-only-storage" },   // the draw list: paint index → record slot (D6)
    ], "paper/notes");
    const module = await compile(device, compose({ structs: [MatUniforms, PaperUniforms, Paper], modules: src.modules, entry: src.entry }));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, { label: "paper/notes", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "paper/notes, lit from elsewhere", layout: pl, module, format, blend: BLEND_PREMUL, constants: { LIT_ELSEWHERE: 1 } }),
    ]);
    const pages = device.createTexture({ label: "paper/ink pages", size: [INK_PAGE, INK_PAGE, INK_LAYERS], format: "r8unorm", dimension: "2d", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const shared: PaperShared = {
      layout, pipeline, litPipeline,
      goboSampler: device.createSampler({ label: "paper/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      noiseSampler: device.createSampler({ label: "paper/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      inkSampler: device.createSampler({ label: "paper/ink", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      pages, pagesView: pages.createView({ dimension: "2d-array" }), shelves: new InkShelves(INK_PAGE, INK_LAYERS), slots: 0,
    };
    return new PaperPass(device, shared, mat);
  }

  /** A second slot on the same pipeline and pages, reading ITS mat's silhouette — a portal's inside, a flight's departed frame. */
  spawn(mat: MatPass): PaperPass {
    const p = new PaperPass(this.device, this.shared, mat);
    p.law = this.law; p.chain = this.chain; p.wipeSoft = this.wipeSoft;
    return p;
  }

  /** Copy the root's tuning — what every slot takes each frame. */
  tune(from: PaperPass): void { this.law = from.law; this.chain = from.chain; this.wipeSoft = from.wipeSoft; }

  /** The ink pages' carving — shared by every slot: a raster's place is the same on both hosts when the notes come in the same order. */
  get shelves(): InkShelves { return this.shared.shelves; }
  /** Room for a `w × h` raster, or null when the pages are full (the note then draws its paper alone). */
  alloc(w: number, h: number): InkRect | null { return this.shared.shelves.alloc(w, h); }
  free(r: InkRect): void { this.shared.shelves.free(r); }
  /** Give back the layers' trailing empty rows (pages.ts `trim`) — the writing's own housekeeping after a free (D2c). */
  trim(): number { return this.shared.shelves.trim(); }
  /**
   * Every raster forgotten — a scene reload. The texels stay until overwritten — and a raster's
   * edge, sampled bilinearly, reads one texel beyond its rect, so a host that wants the pages as a
   * fresh device has them (a parity scene: the Node oracle's pages start blank) passes `clear`.
   */
  reset(clear = false): void {
    this.shared.shelves.reset();
    if (!clear) return;
    const zero = new Uint8Array(INK_PAGE * INK_PAGE);
    for (let l = 0; l < INK_LAYERS; l++) this.device.queue.writeTexture({ texture: this.shared.pages, origin: [0, 0, l] }, zero, { bytesPerRow: INK_PAGE }, [INK_PAGE, INK_PAGE, 1]);
  }

  /** Write r8 coverage rows (row 0 = top) into a rect `alloc` gave; returns the rect's uv for the record. */
  write(r: InkRect, bytes: Uint8Array<ArrayBuffer>): UvRect {
    if (bytes.byteLength !== r.w * r.h) throw new Error(`paper/ink: expected ${r.w}×${r.h} r8 (${r.w * r.h} bytes), got ${bytes.byteLength}`);
    this.device.queue.writeTexture({ texture: this.shared.pages, origin: [r.x, r.y, r.layer] }, bytes, { bytesPerRow: r.w }, [r.w, r.h, 1]);
    return uvOf(r.x, r.y, r.w, r.h, INK_PAGE, INK_PAGE);
  }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version) return;
    const s = this.shared;
    this.group = bindGroup(this.device, s.layout, [this.matBuf, this.knobBuf, this.store.records, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, s.pagesView, s.inkSampler, this.store.order], "paper/notes");
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /**
   * This frame's notes in paint order — through the persistent store (D6): a note keyed by `keys[i]` keeps its slot and is
   * written only when its record changed; no keys = every record packed afresh (the oracle's form) — and the mat's block for
   * this slot's camera, its light (`light` the Sun or the Moon, `lit` the lamp it is seen by — MINIMAT.md §4): the dapple,
   * the lamp's shading and the shadow. Returns the count that will draw.
   */
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, instances: readonly PaperInstance[], present: Presentation | undefined, light: MatLight = DAY_LIGHT, select: RGB = [0, 0, 0], lit?: SlotLight, keys?: readonly number[]): number {
    const cap = MAX_PAPERS * 64;
    const list = instances.length > cap ? instances.slice(0, cap) : instances;
    const n = this.store.prepare(list, keys !== undefined && keys.length > cap ? keys.slice(0, cap) : keys);
    this.rebind();   // after: the store's buffers may have grown
    this.count = n;
    this.litElsewhere = !litByOwn(view, lit);
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, present, light, NO_GLYPHS, lit));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    this.knobs.set({ knobs: [this.chain ? 1 : 0, this.wipeSoft, this.law.caret.width, this.law.ring], select: [select[0], select[1], select[2], 1] });
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    return n;
  }

  /** The store's counters (a rig's witness): records written, bytes, draw-list writes, slots in use. */
  get records() { return this.store.stats(); }

  get drawn(): number { return this.count; }

  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, this.count); }

  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.litElsewhere ? this.shared.litPipeline : this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  /** This slot's buffers; the pages go with the last slot standing. */
  dispose(): void {
    this.matBuf.destroy(); this.knobBuf.destroy(); this.store.dispose();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) s.pages.destroy();
  }
}

/** A theme's select for the ring — the one colour the pass takes from the theme. */
export const selectOf = (theme: GroundTheme): RGB => theme.select;
