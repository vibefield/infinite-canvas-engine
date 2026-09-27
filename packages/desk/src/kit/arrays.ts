// SHARED TEXTURE ARRAYS (design-016 §6, K-L4; K6a) — what a kind keeps per object as pixels, kept as LAYERS of one array so
// a run of its objects binds one texture and draws as one instanced draw: a picture's thumbnail (the print), a board's far
// ink (the whiteboard). An object's layer holds the TAIL of its own mip chain — the levels from the first whose sides fit the
// layer — copied texel for texel at the layer's origin, its last row and column carried to the layer's edge at every level
// (so a clamped sampler reads it exactly as it read the object's own texture); the array grows by doubling (the old layers
// copied); a layer given back is taken again first. The copy passes through the plain view of an `-srgb` format, so the
// bytes pass unchanged. A kind's record carries the layer and the chain level it starts at; its WGSL samples
// `uv · size_k / side` at `lod − k` (photo-pass.wgsl `photo_texel`, board-pass.wgsl `board_ink`).

/** The level of a `w × h` chain whose both sides first fit `side` (0 when the whole chain does). */
export function tailBase(w: number, h: number, side: number): number {
  let k = 0;
  while (Math.max(w >> k, 1) > side || Math.max(h >> k, 1) > side) k += 1;
  return k;
}

/** Bytes of `levels` of a chain from `w × h` at `texel` bytes a texel. */
export function chainBytes(w: number, h: number, levels: number, texel = 4): number {
  let b = 0;
  for (let l = 0; l < levels; l++) b += Math.max(w >> l, 1) * Math.max(h >> l, 1) * texel;
  return b;
}

/**
 * THE LAYER ALLOCATOR: an array's layers handed out lowest first and taken back; `take` says the capacity the array must hold
 * for the layer it hands out (doubling, from `first`, to the device's `max`) — null when it holds no more.
 */
export class Layers {
  private readonly free: number[] = [];
  private next = 0;
  capacity = 0;
  constructor(readonly first = 4, readonly max = 256) {}
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

/** The plain format an `-srgb` one is viewed as for a copy (the bytes pass unchanged); a plain format is its own. */
export const plainFormat = (f: GPUTextureFormat): GPUTextureFormat => (f.endsWith("-srgb") ? (f.slice(0, -5) as GPUTextureFormat) : f);

export interface LayerArrayOptions {
  /** The label every array is made with (`photo/thumbnails`) — the memory ledger's row. */
  readonly label: string;
  readonly format: GPUTextureFormat;
  /** The layers' side, texels (square); every layer holds its full mip chain. */
  readonly side: number;
  /** Layers at the first growth (then doubling). */
  readonly first?: number;
}

/** One kind's array of layers on one device: its texture (null before the first layer), the allocator, the fill. */
export class LayerArray {
  readonly side: number;
  readonly mips: number;
  readonly format: GPUTextureFormat;
  private readonly device: GPUDevice;
  private readonly label: string;
  private readonly layers: Layers;
  private tex: GPUTexture | null = null;
  /** The texture's layers (kept here: a fake device's texture has no count of its own). */
  private cap = 0;
  /** Bumped whenever the texture is remade (a bind group holding its view must be made again). */
  version = 0;
  /** The fill's pipeline, made on the first fill — labelled with the array's own name, so the profiler counts its passes as the kind's. */
  private fillPipe: GPURenderPipeline | null = null;

  constructor(device: GPUDevice, opts: LayerArrayOptions) {
    this.device = device;
    this.label = opts.label;
    this.format = opts.format;
    this.side = opts.side;
    this.mips = Math.floor(Math.log2(opts.side)) + 1;
    const max = (device as { limits?: { maxTextureArrayLayers?: number } }).limits?.maxTextureArrayLayers ?? 256;
    this.layers = new Layers(opts.first ?? 4, max);
  }

  /** The array (null before its first layer). */
  get texture(): GPUTexture | null { return this.tex; }
  /** Layers in use; the array's capacity. */
  get used(): number { return this.layers.used; }
  get capacity(): number { return this.tex === null ? 0 : this.layers.capacity; }
  /** What the array weighs, every layer with its chain. */
  get bytes(): number { return this.capacity * chainBytes(this.side, this.side, this.mips); }

  /** A layer for a new object (the array grown — its old layers copied — when it must be); null when the device holds no more. */
  take(): number | null {
    const t = this.layers.take();
    if (t === null) return null;
    if (this.tex === null || t.capacity > this.cap) this.grow(t.capacity);
    return t.layer;
  }

  give(layer: number): void { this.layers.give(layer); }

  /**
   * Layer `layer`'s every level from `src`'s chain: level `base + m` at the origin, its edge carried to the layer's; a level past
   * the chain's end takes its last. `src` must allow the plain view of its format (`viewFormats`) when that format is `-srgb`.
   */
  fill(src: GPUTexture, srcMips: number, layer: number, base: number, encoder?: GPUCommandEncoder): void {
    const tex = this.tex;
    if (tex === null) return;
    const plain = plainFormat(this.format);
    const pipe = this.pipeline(plain);
    const enc = encoder ?? this.device.createCommandEncoder({ label: `${this.label} fill` });
    for (let m = 0; m < this.mips; m++) {
      const from = src.createView({ format: plainFormat(src.format ?? this.format), dimension: "2d", baseMipLevel: Math.min(base + m, srcMips - 1), mipLevelCount: 1 });
      const to = tex.createView({ format: plain, dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: m, mipLevelCount: 1 });
      const group = this.device.createBindGroup({ label: `${this.label} fill`, layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: from }] });
      const pass = enc.beginRenderPass({ label: `${this.label} fill`, colorAttachments: [{ view: to, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }
    if (encoder === undefined) this.device.queue.submit([enc.finish()]);
  }

  /** A `2d-array` view of the whole array — or of `blank` (a 1 × 1 × 1 stand-in the caller keeps) before its first layer. */
  view(blank: GPUTexture): GPUTextureView { return (this.tex ?? blank).createView({ dimension: "2d-array" }); }

  destroy(): void { this.tex?.destroy(); this.tex = null; this.cap = 0; }

  private grow(capacity: number): void {
    const next = this.device.createTexture({
      label: this.label, size: [this.side, this.side, capacity], format: this.format, mipLevelCount: this.mips,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      ...(plainFormat(this.format) !== this.format ? { viewFormats: [plainFormat(this.format)] } : {}),
    });
    const old = this.tex;
    if (old !== null) {
      const enc = this.device.createCommandEncoder({ label: `${this.label} grow` });
      for (let m = 0; m < this.mips; m++) {
        const s = Math.max(this.side >> m, 1);
        enc.copyTextureToTexture({ texture: old, mipLevel: m }, { texture: next, mipLevel: m }, [s, s, this.cap]);
      }
      this.device.queue.submit([enc.finish()]);
      old.destroy();
    }
    this.tex = next;
    this.cap = capacity;
    this.version += 1;
  }

  private pipeline(format: GPUTextureFormat): GPURenderPipeline {
    if (this.fillPipe === null) {
      const module = this.device.createShaderModule({ label: `${this.label} fill`, code: FILL });
      this.fillPipe = this.device.createRenderPipeline({ label: `${this.label} fill`, layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] } });
    }
    return this.fillPipe;
  }
}
