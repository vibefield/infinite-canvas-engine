// A texture you render into and then read from another pass — the field atlas
// is one. Resizing recreates the texture; the caller rebinds and re-fills.

export interface TargetOptions {
  readonly format: GPUTextureFormat;
  readonly label?: string;
  /** Add COPY_SRC when a host wants to read the pixels back (the oracle does). */
  readonly readable?: boolean;
}

export class Target {
  texture: GPUTexture;
  view: GPUTextureView;
  width = 0;
  height = 0;
  readonly format: GPUTextureFormat;
  private readonly usage: number;
  private readonly device: GPUDevice;
  private readonly opts: TargetOptions;

  constructor(device: GPUDevice, opts: TargetOptions, width = 1, height = 1) {
    this.device = device;
    this.opts = opts;
    this.format = opts.format;
    this.usage =
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | (opts.readable ? GPUTextureUsage.COPY_SRC : 0);
    this.texture = this.make(width, height);
    this.view = this.texture.createView();
    this.width = width; this.height = height;
  }

  private make(w: number, h: number): GPUTexture {
    const label = this.opts.label;
    return this.device.createTexture({
      ...(label === undefined ? {} : { label }),
      size: [w, h], format: this.format, usage: this.usage,
    });
  }

  /** True when the texture was recreated (and therefore holds nothing). */
  resize(w0: number, h0: number): boolean {
    const width = Math.max(1, w0 | 0);
    const height = Math.max(1, h0 | 0);
    if (width === this.width && height === this.height) return false;
    this.texture.destroy();
    this.texture = this.make(width, height);
    this.view = this.texture.createView();
    this.width = width; this.height = height;
    return true;
  }

  dispose(): void { this.texture.destroy(); }
}

export type Clear = readonly [number, number, number, number];

/** Begin a colour-only render pass; `clear` omitted loads the existing contents. */
export function beginPass(
  encoder: GPUCommandEncoder,
  view: GPUTextureView,
  clear?: Clear,
  label?: string,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    ...(label === undefined ? {} : { label }),
    colorAttachments: [
      clear
        ? { view, clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] }, loadOp: "clear", storeOp: "store" }
        : { view, loadOp: "load", storeOp: "store" },
    ],
  });
}

/** Read a texture back as raw bytes with row padding removed (oracle / tests). */
export async function readback(device: GPUDevice, texture: GPUTexture, bytesPerTexel: number): Promise<Uint8Array> {
  const w = texture.width;
  const h = texture.height;
  const rowBytes = Math.ceil((w * bytesPerTexel) / 256) * 256;
  const buf = device.createBuffer({ size: rowBytes * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer: buf, bytesPerRow: rowBytes }, [w, h]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(buf.getMappedRange());
  const out = new Uint8Array(w * h * bytesPerTexel);
  for (let y = 0; y < h; y++) out.set(padded.subarray(y * rowBytes, y * rowBytes + w * bytesPerTexel), y * w * bytesPerTexel);
  buf.unmap(); buf.destroy();
  return out;
}
