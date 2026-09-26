// The photo pass — the prints, one draw each in paint order. Owns its copy of
// the mat's uniform block (filled for the camera and the light every frame,
// the gobo on only when the mat is the grid), its knobs and the record buffer;
// shares — with every slot spawned from the first — the pipeline, the samplers
// and the PICTURES: each an `rgba8unorm-srgb` texture with its mip chain,
// uploaded from whatever the host decoded (a pasted image, a dropped file) and
// bound as the print's own group 1, so a picture made once draws in any slot.
// A slot reads its OWN mat's animated silhouette and blue noise, so a print is
// dappled by the same palm as the mat under it — and a slot lit from elsewhere
// (a mini mat's inside: MINIMAT.md §4) takes the lamp of the desk it lies on,
// through a second pipeline (`LIT_ELSEWHERE`, the note's precedent). The pass
// draws in RANGES of the prints it was handed (design-015 §4.2): the desk's runs.

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import type { FadeIn, View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { litByOwn, type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, type SlotLight, STILL_MAT_FRAME } from "../mat/layout";
import type { MatPass } from "../mat/mat-pass";
import { DAY_LIGHT, type MatLight } from "../mat/night";
import { MAT_GRID } from "../theme";
import { MAX_PHOTOS, Photo, type PhotoPicture, PhotoUniforms, photoUniformValues, photoValues } from "./layout";
import { generateMips, mipCount } from "./mips";
import { PHOTO, type PhotoGeometry, type PhotoLaw } from "./photo";
import type { PhotoShaders } from "./shaders";

/** Premultiplied "source over". */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** The largest side a picture keeps on the device — a 6×4 print at zoom 5 on a 2× screen. */
export const PICTURE_MAX = 4096;

/** A picture on the device: its texture, the group that binds it, its texel facts. */
export interface Picture extends PhotoPicture {
  readonly texture: GPUTexture;
  readonly group: GPUBindGroup;
}

/** One print for the pass: its resolved pose, its border's width, its picture. */
export interface PhotoInstance {
  readonly geometry: PhotoGeometry;
  readonly border: number;
  readonly picture: Picture | null;
}

/** What every slot's pass shares with the root's: the layouts, the pipeline, the samplers — and the pictures, whose groups are made on `layout1`. */
interface PhotoShared {
  readonly layout0: GPUBindGroupLayout;
  readonly layout1: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  /** The same, for a slot lit from elsewhere — a mini mat's inside, a handover (MINIMAT.md §4): `LIT_ELSEWHERE` is a pipeline constant. */
  readonly litPipeline: GPURenderPipeline;
  readonly goboSampler: GPUSampler;
  readonly noiseSampler: GPUSampler;
  readonly picSampler: GPUSampler;
  /** One white texel: what a print whose picture has not come binds (its record says "no picture" — it draws its paper alone). */
  readonly blank: Picture;
  slots: number;
}

/** A picture's texture, its mip chain to come: every level down to 1×1 (mips.ts). */
function makePicture(device: GPUDevice, width: number, height: number): { texture: GPUTexture; mips: number } {
  const mips = mipCount(width, height);
  const texture = device.createTexture({
    label: `photo/picture ${width}×${height}`, size: [width, height], format: "rgba8unorm-srgb", mipLevelCount: mips,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  return { texture, mips };
}

/** Level 0 uploaded: the mips drawn from it, the group made on the shared layout — so any slot's pass binds it. */
function finishPicture(device: GPUDevice, layout1: GPUBindGroupLayout, texture: GPUTexture, width: number, height: number, mips: number): Picture {
  if (mips > 1) generateMips(device, texture);
  const group = bindGroup(device, layout1, [texture.createView()], "photo/picture");
  return { texture, group, width, height, mips };
}

/** A picture from raw sRGB rgba8 bytes (row 0 = top, straight alpha). */
function rawPicture(device: GPUDevice, layout1: GPUBindGroupLayout, bytes: Uint8Array<ArrayBuffer>, width: number, height: number): Picture {
  const { texture, mips } = makePicture(device, width, height);
  device.queue.writeTexture({ texture }, bytes, { bytesPerRow: width * 4 }, [width, height, 1]);
  return finishPicture(device, layout1, texture, width, height, mips);
}

export class PhotoPass {
  readonly name = "photo/prints";
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = PhotoUniforms.alloc(1);
  private readonly records = Photo.alloc(MAX_PHOTOS);
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private readonly recordBuf: GPUBuffer;
  private group!: GPUBindGroup;
  private bound = -1;
  /** This frame's prints' pictures, in the order `prepare` was handed them — what `drawRange` counts in. */
  private list: (Picture | null)[] = [];
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
    this.matBuf = uniformBuffer(device, MatUniforms.size, "photo/mat uniforms");
    this.knobBuf = uniformBuffer(device, PhotoUniforms.size, "photo/knobs");
    this.recordBuf = storageBuffer(device, Photo.size * MAX_PHOTOS, "photo/prints");
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
    ], "photo/prints");
    const layout1 = bindLayout(device, [{ binding: 0, stages: ["fragment"], texture: "float" }], "photo/picture");
    const module = await compile(device, compose({ structs: [MatUniforms, PhotoUniforms, Photo], modules: src.modules, entry: src.entry }));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, { label: "photo/prints", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "photo/prints, lit from elsewhere", layout: pl, module, format, blend: BLEND_PREMUL, constants: { LIT_ELSEWHERE: 1 } }),
    ]);
    const shared: PhotoShared = {
      layout0, layout1, pipeline, litPipeline,
      goboSampler: device.createSampler({ label: "photo/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      noiseSampler: device.createSampler({ label: "photo/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" }),
      picSampler: device.createSampler({ label: "photo/picture", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      blank: rawPicture(device, layout1, new Uint8Array([255, 255, 255, 255]), 1, 1), slots: 0,
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
    if (this.bound === this.mat.assetVersion) return;
    const s = this.shared;
    this.group = bindGroup(this.device, s.layout0, [this.matBuf, this.knobBuf, this.recordBuf, this.mat.silhouette, s.goboSampler, this.mat.noiseTexture.createView(), s.noiseSampler, s.picSampler], "photo/prints");
    this.bound = this.mat.assetVersion;
  }

  /**
   * A picture from raw sRGB rgba8 bytes (row 0 = top, straight alpha) — what a Node host or a test hands in. A picture is
   * the PASS's resource, shared by every slot: a print's record names it by this handle (`PhotoInstance.picture`), and it
   * lives until the host drops it (`dropPicture`).
   */
  picture(bytes: Uint8Array<ArrayBuffer>, width: number, height: number): Picture {
    return rawPicture(this.device, this.shared.layout1, bytes, width, height);
  }

  /** A picture from a decoded image (a pasted or dropped file, an `<img>`, a canvas) — the browser's path. */
  pictureFrom(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement, width: number, height: number): Picture {
    const { texture, mips } = makePicture(this.device, width, height);
    this.device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: false }, [width, height]);
    return finishPicture(this.device, this.shared.layout1, texture, width, height, mips);
  }

  /** A picture no print names any more: its texture destroyed (the blank texel is the pass's own and stays). */
  dropPicture(p: Picture): void { if (p !== this.shared.blank) p.texture.destroy(); }

  /**
   * Upload this frame's prints in paint order (first = lowest) and the mat's block for this slot's camera,
   * its light (`light` the Sun or the Moon, `lit` the lamp it is seen by — MINIMAT.md §4): the dapple falls
   * on the prints. Returns the count that will draw.
   */
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, prints: readonly PhotoInstance[], present?: Presentation, light: MatLight = DAY_LIGHT, lit?: SlotLight): number {
    this.rebind();
    const n = Math.min(prints.length, MAX_PHOTOS);
    for (let i = 0; i < n; i++) {
      const p = prints[i] as PhotoInstance;
      this.records.set(photoValues(p.geometry, p.border, p.picture), i);
    }
    this.list = prints.slice(0, n).map((p) => p.picture);
    this.litElsewhere = !litByOwn(view, lit);
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, present, light, NO_GLYPHS, lit));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    this.knobs.set(photoUniformValues(this.law));
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    if (n > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(n));
    return n;
  }

  get drawn(): number { return this.list.length; }

  /** Every print prepared this frame, into a pass the caller opened: `drawRange` over the whole list — the same commands the lab's second pass recorded. */
  draw(pass: GPURenderPassEncoder): void { this.drawRange(pass, 0, this.list.length); }

  /**
   * The prints `prepare` was handed at [first, end) — indices into ITS list, as the ground's runs count a kind's records —
   * one quad each with its picture bound (the blank texel where it has none), the slot's group bound once before the
   * first, on the pipeline for the slot's light. An empty range records nothing, not even the pipeline.
   */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.list.length);
    if (first >= hi) return;
    pass.setPipeline(this.litElsewhere ? this.shared.litPipeline : this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    for (let i = first; i < hi; i++) {
      pass.setBindGroup(1, (this.list[i] ?? this.shared.blank).group);
      pass.draw(6, 1, 0, i);
    }
  }

  /** This slot's buffers; the blank texel goes with the last slot standing (a host's pictures are the host's to drop). */
  dispose(): void {
    this.matBuf.destroy(); this.knobBuf.destroy(); this.recordBuf.destroy();
    const s = this.shared;
    s.slots -= 1;
    if (s.slots === 0) s.blank.texture.destroy();
  }
}
