// The mini mat pass (MINIMAT.md §6) — the desk's containers, instanced, drawn in
// paint order in ranges (a live inside is drawn between them, right after its
// mini mat — ground.ts `drawSlot`). Owns its copy of the mat's uniform block
// (filled for the slot's camera and light every frame, so a mini mat takes the
// dapple of the desk it lies on), its knobs, the per-mini-mat records and the
// chips — every mini mat's children drawn small on its face at the far LOD,
// packed back to back, each mini mat naming its range. Shares, with every slot
// spawned from the first, the pipeline and the samplers; reads its OWN slot's
// animated silhouette (the wind target), as every object pass does.

import { bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../engine/pipeline";
import { createRecordStore, type RecordStore } from "../engine/records";
import { compile, compose } from "../engine/shader";
import type { FadeIn, View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, type SlotLight, STILL_MAT_FRAME } from "../mat/layout";
import type { MatPass } from "../mat/mat-pass";
import { DAY_LIGHT, type MatLight } from "../mat/night";
import { MAT_COLORS, MAT_GRID, type RGB } from "../theme";
import { ChipRecord, chipValues, MAX_CHIPS, MAX_MINIMATS, MiniMat, type MiniMatInstance, MiniMatUniforms, miniMatUniformValues, miniMatValues } from "./layout";
import { DEFAULT_MINIMAT_LAW, type MiniMatLaw } from "./minimat";
import type { MiniMatShaders } from "./shaders";

/** Premultiplied "source over" — every desk object's blend. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

interface MiniMatShared {
  readonly layout: GPUBindGroupLayout;
  /** The mini mats (`fs`) — and their chips again, over a live inside that is fading in (`fs_chips`). */
  readonly pipeline: GPURenderPipeline;
  readonly chipsPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  slots: number;
}

/** Chips a mini mat's record may name — its BLOCK in the chips buffer (engine/records.ts; the law's `chips.max` caps within it). */
export const CHIPS_PER_MAT = MAX_CHIPS / MAX_MINIMATS;
/** Mini mat slots a pass starts with (a desk seldom shows more; the store doubles past it). */
const SLOTS_AT_START = 64;

export class MiniMatPass {
  readonly name = "minimat/mats";
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = MiniMatUniforms.alloc(1);
  /** The mini mats' PERSISTENT records and their chips (engine/records.ts, design-015 §4.3; D6): a slot per mini mat while drawn, its chips a fixed block, written when it changed. */
  private readonly store: RecordStore<MiniMatInstance>;
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private group!: GPUBindGroup;
  private boundAssets = -1;
  private boundStore = -1;
  private count = 0;
  private chipsUsed = 0;
  private lawNow: MiniMatLaw = DEFAULT_MINIMAT_LAW;
  /** The mini mat's numbers (theme.ts `MINIMAT`) — the print, the edge, the shadow, the chips. A host tweaks the root's; every slot copies it. A new law repacks every record (the chips' cap is packed). */
  get law(): MiniMatLaw { return this.lawNow; }
  set law(next: MiniMatLaw) { if (next !== this.lawNow) { this.lawNow = next; this.store.invalidate(); } }
  private readonly device: GPUDevice;
  private readonly shared: MiniMatShared;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, shared: MiniMatShared, mat: MatPass) {
    this.device = device; this.shared = shared; this.mat = mat;
    shared.slots += 1;
    this.matBuf = uniformBuffer(device, MatUniforms.size, "minimat/mat uniforms");
    this.knobBuf = uniformBuffer(device, MiniMatUniforms.size, "minimat/knobs");
    // a mini mat's chips are its block: the law's cap within `CHIPS_PER_MAT`; the live inside's presence is the `aux` folded in
    this.store = createRecordStore<MiniMatInstance, keyof typeof MiniMat.slots, keyof typeof ChipRecord.slots>({
      device, def: MiniMat, capacity: SLOTS_AT_START, max: MAX_MINIMATS * 64, label: "minimat/mats",
      blocks: { def: ChipRecord, per: CHIPS_PER_MAT, label: "minimat/chips" },
      pack: (m, live, into, slot, blocks, base) => {
        const chips = m.chips ?? [];
        const take = Math.max(0, Math.min(chips.length, this.lawNow.chips.max, CHIPS_PER_MAT));
        if (blocks !== null) for (let j = 0; j < take; j++) blocks.set(chipValues(chips[j] as (typeof chips)[number]), base + j);
        into.set(miniMatValues({ ...m, live }, base, take), slot);
        return take;
      },
    });
    this.rebind();
  }

  /** The root's pass, on the root's mat. */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: MiniMatShaders, mat: MatPass): Promise<MiniMatPass> {
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 2, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 3, stages: ["fragment"], buffer: "read-only-storage" },
      { binding: 4, stages: ["fragment"], texture: "float" },
      { binding: 5, stages: ["fragment"], sampler: "filtering" },
      { binding: 6, stages: ["fragment"], texture: "float" },
      { binding: 7, stages: ["fragment"], sampler: "filtering" },
      { binding: 8, stages: ["fragment"], texture: "float" },
      { binding: 9, stages: ["vertex"], buffer: "read-only-storage" },   // the draw list: paint index → record slot (D6)
    ], "minimat/mats");
    const module = await compile(device, compose({ structs: [MatUniforms, MiniMatUniforms, MiniMat, ChipRecord], modules: src.modules, entry: src.entry }));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [pipeline, chipsPipeline] = await Promise.all([
      renderPipeline(device, { label: "minimat/mats", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "minimat/chips over", layout: pl, module, fragment: "fs_chips", format, blend: BLEND_PREMUL }),
    ]);
    const shared: MiniMatShared = {
      layout, pipeline, chipsPipeline,
      goboSampler: device.createSampler({ label: "minimat/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      noiseSampler: device.createSampler({ label: "minimat/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      slots: 0,
    };
    return new MiniMatPass(device, shared, mat);
  }

  /** A second slot on the same pipeline, reading ITS mat's silhouette — a flight's departed desk, a mini mat's inside. */
  spawn(mat: MatPass): MiniMatPass { const p = new MiniMatPass(this.device, this.shared, mat); p.law = this.law; return p; }

  /** Copy the root's tuning — what every slot takes each frame. */
  tune(from: MiniMatPass): void { this.law = from.law; }

  private rebind(): void {
    if (this.boundAssets === this.mat.assetVersion && this.boundStore === this.store.version) return;
    const s = this.shared;
    // the glyph atlas the rulers print with (RULER.md) — the numerals and the name are the same mono face; sampled with the gobo's clamp
    this.group = bindGroup(this.device, s.layout, [this.matBuf, this.knobBuf, this.store.records, this.store.blocks as GPUBuffer, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, this.mat.glyphTexture.createView(), this.store.order], "minimat/mats");
    this.boundAssets = this.mat.assetVersion;
    this.boundStore = this.store.version;
  }

  /**
   * Upload this frame's mini mats in paint order, their chips back to back (a mini mat's
   * beyond the law's cap, or past the buffer, are dropped — the face shows fewer, honestly),
   * and the mat's block for this slot's camera and light (`light` the Sun or the Moon, `lit`
   * the lamp it is seen by — MINIMAT.md §4). `live` is the ground's word on each one's live
   * inside — −1 where none is drawn this frame, else its objects' presence — overriding the
   * instance's own (a portal the ground could not draw leaves the face to the far LOD).
   * Returns the count that will draw.
   */
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, instances: readonly MiniMatInstance[], present: Presentation | undefined, light: MatLight = DAY_LIGHT, select: RGB = [0, 0, 0], lit?: SlotLight, live?: (index: number) => number, keys?: readonly number[]): number {
    const cap = MAX_MINIMATS * 64;
    const list = instances.length > cap ? instances.slice(0, cap) : instances;
    // the store (D6): a mini mat keyed by `keys[i]` keeps its slot (and its chips' block) and is written only when its record or its
    // live inside's presence changed; no keys = every one packed afresh. The ground's word on the live inside overrides the instance's.
    const n = this.store.prepare(list, keys !== undefined && keys.length > cap ? keys.slice(0, cap) : keys, (i) => { const m = list[i] as MiniMatInstance; const pres = live ? live(i) : (m.live ?? -1); return pres < 0 ? -1 : Math.min(pres, 1); });
    this.rebind();   // after: the store's buffers may have grown
    let used = 0;
    for (let i = 0; i < n; i++) used += this.store.entryAt(i).blockN;
    this.count = n; this.chipsUsed = used;
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, present, light, NO_GLYPHS, lit));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    this.knobs.set(miniMatUniformValues(this.law, { cream: MAT_COLORS.line, cast: MAT_COLORS.cast, select }, this.mat.glyphs));
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    return n;
  }

  get drawn(): number { return this.count; }
  /** The chips drawn this frame, every mini mat's together. */
  get chips(): number { return this.chipsUsed; }
  /** The store's counters (a rig's witness): records written, bytes, draw-list writes, slots in use. */
  get records() { return this.store.stats(); }

  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, this.count); }

  /** Mini mat `at`'s chips OVER its live inside, fading out as the inside's objects fade in — only while the objects are not whole (MINIMAT.md §5). */
  drawChips(pass: GPURenderPassEncoder, at: number): void {
    const ent = this.store.entryAt(at);
    const live = at < this.count ? ent.aux : -1;
    const n = ent.blockN;
    if (at >= this.count || !(live >= 0 && live < 1) || n === 0) return;
    pass.setPipeline(this.shared.chipsPipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, 1, 0, at);
  }

  /** Mini mats [first, end) — paint order is the list's; `drawSlot` cuts the range where a live inside goes. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  dispose(): void {
    this.matBuf.destroy(); this.knobBuf.destroy(); this.store.dispose();
    this.shared.slots -= 1;
  }
}
