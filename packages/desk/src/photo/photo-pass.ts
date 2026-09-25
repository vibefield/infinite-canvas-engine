// The photo pass — the prints, one draw each in paint order. Owns its copy of
// the mat's uniform block (filled for the camera and the light every frame,
// the gobo on only when the mat is the grid), its knobs, the record buffer and
// the pictures: each an `rgba8unorm-srgb` texture with its mip chain, uploaded
// from whatever the host decoded (a pasted image, a dropped file) and bound as
// the print's own group 1. Reads the mat's animated silhouette and blue noise,
// so a print is dappled by the same palm as the mat under it.

import { bindGroup, bindLayout, renderPipeline, storageBuffer, uniformBuffer } from "../engine/pipeline";
import { compile, compose } from "../engine/shader";
import type { FadeIn, View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { type MatConfig, type MatFrame, MatUniforms, matUniformValues, NO_GLYPHS, STILL_MAT_FRAME } from "../mat/layout";
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

export class PhotoPass {
  readonly name = "photo/prints";
  private readonly matU = MatUniforms.alloc(1);
  private readonly knobs = PhotoUniforms.alloc(1);
  private readonly records = Photo.alloc(MAX_PHOTOS);
  private readonly matBuf: GPUBuffer;
  private readonly knobBuf: GPUBuffer;
  private readonly recordBuf: GPUBuffer;
  private readonly layout0: GPUBindGroupLayout;
  private readonly layout1: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly goboSampler: GPUSampler;
  private readonly noiseSampler: GPUSampler;
  private readonly picSampler: GPUSampler;
  private readonly blank: Picture;
  private group!: GPUBindGroup;
  private bound = -1;
  private list: (Picture | null)[] = [];
  /** The print's numbers (photo.ts `PHOTO`) — a host tunes its own copy. */
  law: PhotoLaw = PHOTO;
  private readonly device: GPUDevice;
  private readonly mat: MatPass;

  private constructor(device: GPUDevice, mat: MatPass, layout0: GPUBindGroupLayout, layout1: GPUBindGroupLayout, pipeline: GPURenderPipeline) {
    this.device = device; this.mat = mat; this.layout0 = layout0; this.layout1 = layout1; this.pipeline = pipeline;
    this.matBuf = uniformBuffer(device, MatUniforms.size, "photo/mat uniforms");
    this.knobBuf = uniformBuffer(device, PhotoUniforms.size, "photo/knobs");
    this.recordBuf = storageBuffer(device, Photo.size * MAX_PHOTOS, "photo/prints");
    this.goboSampler = device.createSampler({ label: "photo/gobo", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.noiseSampler = device.createSampler({ label: "photo/noise", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    this.picSampler = device.createSampler({ label: "photo/picture", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.blank = this.picture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.rebind();
  }

  /** The pass on the root's mat (its silhouette and noise). */
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
    const pipeline = await renderPipeline(device, { label: "photo/prints", layout: device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] }), module, format, blend: BLEND_PREMUL });
    return new PhotoPass(device, mat, layout0, layout1, pipeline);
  }

  private rebind(): void {
    if (this.bound === this.mat.assetVersion) return;
    this.group = bindGroup(this.device, this.layout0, [this.matBuf, this.knobBuf, this.recordBuf, this.mat.silhouette, this.goboSampler, this.mat.noiseTexture.createView(), this.noiseSampler, this.picSampler], "photo/prints");
    this.bound = this.mat.assetVersion;
  }

  private make(width: number, height: number): { texture: GPUTexture; mips: number } {
    const mips = mipCount(width, height);
    const texture = this.device.createTexture({
      label: `photo/picture ${width}×${height}`, size: [width, height], format: "rgba8unorm-srgb", mipLevelCount: mips,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return { texture, mips };
  }

  private finish(texture: GPUTexture, width: number, height: number, mips: number): Picture {
    if (mips > 1) generateMips(this.device, texture);
    const group = bindGroup(this.device, this.layout1, [texture.createView()], "photo/picture");
    return { texture, group, width, height, mips };
  }

  /** A picture from raw sRGB rgba8 bytes (row 0 = top, straight alpha) — what a Node host or a test hands in. */
  picture(bytes: Uint8Array<ArrayBuffer>, width: number, height: number): Picture {
    const { texture, mips } = this.make(width, height);
    this.device.queue.writeTexture({ texture }, bytes, { bytesPerRow: width * 4 }, [width, height, 1]);
    return this.finish(texture, width, height, mips);
  }

  /** A picture from a decoded image (a pasted or dropped file, an `<img>`, a canvas) — the browser's path. */
  pictureFrom(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement, width: number, height: number): Picture {
    const { texture, mips } = this.make(width, height);
    this.device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: false }, [width, height]);
    return this.finish(texture, width, height, mips);
  }

  dropPicture(p: Picture): void { if (p !== this.blank) p.texture.destroy(); }

  /**
   * Upload this frame's prints in paint order (first = lowest) and the mat's block for the
   * camera and light: the dapple falls on the prints. Returns the count that will draw.
   */
  prepare(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, frame: MatFrame | undefined, prints: readonly PhotoInstance[], present?: Presentation, light: MatLight = DAY_LIGHT): number {
    this.rebind();
    const n = Math.min(prints.length, MAX_PHOTOS);
    for (let i = 0; i < n; i++) {
      const p = prints[i] as PhotoInstance;
      this.records.set(photoValues(p.geometry, p.border, p.picture), i);
    }
    this.list = prints.slice(0, n).map((p) => p.picture);
    const strength = MAT_GRID.gobo.plates[cfg.gobo.plate === "b" ? "b" : "c"].strength;
    this.matU.set(matUniformValues(view, fadeIn, cfg, frame ?? STILL_MAT_FRAME, strength, present, light, NO_GLYPHS));
    this.device.queue.writeBuffer(this.matBuf, 0, this.matU.view());
    this.knobs.set(photoUniformValues(this.law));
    this.device.queue.writeBuffer(this.knobBuf, 0, this.knobs.view());
    if (n > 0) this.device.queue.writeBuffer(this.recordBuf, 0, this.records.view(n));
    return n;
  }

  get drawn(): number { return this.list.length; }

  /** Record the prints into a pass the caller opened (loading what the ground drew). */
  draw(pass: GPURenderPassEncoder): void {
    if (this.list.length === 0) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    this.list.forEach((pic, i) => {
      pass.setBindGroup(1, (pic ?? this.blank).group);
      pass.draw(6, 1, 0, i);
    });
  }

  dispose(): void {
    this.matBuf.destroy(); this.knobBuf.destroy(); this.recordBuf.destroy(); this.blank.texture.destroy();
  }
}
