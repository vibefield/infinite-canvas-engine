// The MARKS PASS — the desk's chrome on the GPU (design-015 §4.2 stratum 5, §7; D4a): one pipeline,
// one instanced draw of the frame's marks (marks/layout.ts) after every stratum of the ROOT slot, in
// screen px. It samples the rulers' glyph atlas off the root's mat (the pills' numerals are the rulers'
// face) and rebinds when the mat's assets change; its records grow by doubling. Premultiplied blend:
// a mark of light returns alpha 0 and is ADDED (Canvas2D's "lighter"), everything else is painted over.

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import type { StructBuffer } from "../engine/struct";
import type { MatPass } from "../kit/view";
import { layoutMarks, type MarkRecord, MarkStruct, type MarksInput, MarksUniformsStruct, tagMarks } from "./layout";
import type { MarksShaders } from "./shaders";

const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

type MarkField = "shape" | "centre" | "half" | "colour" | "aux" | "quad";

export class MarksPass {
  private readonly device: GPUDevice;
  private readonly mat: MatPass;
  private readonly pipeline: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly sampler: GPUSampler;
  private readonly uniformBuf: GPUBuffer;
  private readonly uniforms = MarksUniformsStruct.alloc();
  private records: StructBuffer<MarkField>;
  private recordBuf: GPUBuffer;
  private group: GPUBindGroup | null = null;
  private boundAssets = -1;
  private count = 0;
  private tags = 0;
  private last: readonly MarkRecord[] = [];
  private lastTags: readonly MarkRecord[] = [];

  private constructor(device: GPUDevice, mat: MatPass, pipeline: GPURenderPipeline, layout: GPUBindGroupLayout) {
    this.device = device;
    this.mat = mat;
    this.pipeline = pipeline;
    this.layout = layout;
    this.sampler = device.createSampler({ label: "marks/glyphs", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.uniformBuf = uniformBuffer(device, MarksUniformsStruct.size, "marks/uniforms");
    this.records = MarkStruct.alloc(64) as StructBuffer<MarkField>;
    this.recordBuf = storageBuffer(device, MarkStruct.size * 64, "marks/records");
  }

  /** The pipeline on `format`, sampling `mat`'s glyph atlas (the root's: its assets are every slot's). */
  static async create(device: GPUDevice, format: GPUTextureFormat, src: MarksShaders, mat: MatPass): Promise<MarksPass> {
    const module = await compile(device, compose({ structs: [MarksUniformsStruct, MarkStruct], modules: src.modules, entry: src.entry }));
    const layout = bindLayout(device, [
      { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
      { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
      { binding: 2, stages: ["fragment"], texture: "float" },
      { binding: 3, stages: ["fragment"], sampler: "filtering" },
    ], "marks");
    const pl = device.createPipelineLayout({ label: "marks", bindGroupLayouts: [layout] });
    const pipeline = await renderPipeline(device, { label: "marks", layout: pl, module, format, blend: BLEND_PREMUL });
    return new MarksPass(device, mat, pipeline, layout);
  }

  /**
   * Lay this frame's marks out and upload them (before the frame's pass begins); after them, the tray's NAME TAGS (K5a — drawn apart,
   * `drawTags`, where the tray says). Returns the count of the frame's marks that will draw (`draw`).
   */
  prepare(input: MarksInput | undefined, tray?: { readonly view: { readonly width: number; readonly height: number; readonly dpr: number }; readonly tags: readonly { readonly label: string; readonly x: number; readonly y: number }[]; readonly night?: number; readonly fade?: { readonly top: number; readonly band: number } | undefined }): number {
    const marks = input === undefined ? [] : layoutMarks(input, this.mat.glyphs);
    const view = input?.view ?? tray?.view;
    const tags = view === undefined ? [] : (tray?.tags ?? []).flatMap((t) => tagMarks(t.label, t.x, t.y, this.mat.glyphs, view.dpr, tray?.night ?? 0));
    this.last = marks;
    this.lastTags = tags;
    const total = marks.length + tags.length;
    if (total > this.records.count) {
      let n = this.records.count;
      while (n < total) n *= 2;
      this.records = MarkStruct.alloc(n) as StructBuffer<MarkField>;
      this.recordBuf.destroy();
      this.recordBuf = storageBuffer(this.device, MarkStruct.size * n, "marks/records");
      this.group = null;
    }
    for (let i = 0; i < marks.length; i++) this.records.set(marks[i] as MarkRecord, i);
    for (let i = 0; i < tags.length; i++) this.records.set(tags[i] as MarkRecord, marks.length + i);
    this.count = marks.length;
    this.tags = tags.length;
    if (view === undefined) return 0;
    const atlas = this.mat.glyphs;
    // the tags are gone in the drawer's header and fade in under it as its specimens do (design-018 §4, R4): from the band's top (the
    // header's foot), over its width, from the first tag on
    const fade = tray?.fade !== undefined && tags.length > 0 ? [tray.fade.top, tray.fade.band, marks.length, 0] : [0, 0, 0, 0];
    this.uniforms.set({ view: [view.width, view.height, view.dpr, 0], atlas: [atlas.width, atlas.height, atlas.scale, atlas.cellW], fade });
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniforms.view());
    if (total > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(total));
    return marks.length;
  }

  /** The pipeline and its group, bound (rebound when the mat's assets or the records' buffer changed). */
  private bind(pass: GPURenderPassEncoder): void {
    if (this.group === null || this.boundAssets !== this.mat.assetVersion) {
      this.group = bindGroup(this.device, this.layout, [this.uniformBuf, this.recordBuf, this.mat.glyphTexture.createView(), this.sampler], "marks");
      this.boundAssets = this.mat.assetVersion;
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
  }

  /** The marks into the open pass — over everything drawn so far (the caller resets the scissor to the view). */
  draw(pass: GPURenderPassEncoder): void {
    if (this.count === 0) return;
    this.bind(pass);
    pass.draw(6, this.count, 0, 0);
  }

  /** The tray's name tags (K5a) into the open pass, under the caller's scissor (the drawer's face). */
  drawTags(pass: GPURenderPassEncoder): void {
    if (this.tags === 0) return;
    this.bind(pass);
    pass.draw(6, this.tags, 0, this.count);
  }

  /** The tray's name tags laid by the last prepare. */
  get tagCount(): number { return this.tags; }
  /** …and their records (a rig's witness). */
  get tagsLaid(): readonly MarkRecord[] { return this.lastTags; }

  /** Marks drawn by the last prepare. */
  get drawn(): number { return this.count; }
  /** The last prepare's records — a rig's and a check's witness (what was drawn, where). */
  get laid(): readonly MarkRecord[] { return this.last; }

  dispose(): void { this.uniformBuf.destroy(); this.recordBuf.destroy(); }
}
