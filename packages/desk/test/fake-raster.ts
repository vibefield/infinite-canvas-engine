// A RASTER on the fake device (petition I30 — `createStill` on the desk's own test device): fake-gpu.ts's stubs, plus the least a
// still needs to carry PIXELS. An `rgba8unorm` or `bgra8unorm` texture keeps its texels on the CPU, in its own channel order; a
// render pass that clears fills its attachment; a DRAW under a pipeline whose label the test names in `paints` fills the pass's
// scissor (the whole attachment until one is set) with that colour, flat — any other draw paints nothing; a texture-to-buffer copy
// copies the rows at the buffer's `bytesPerRow`, and a MAP_READ buffer maps what was copied into it. Commands run as they are
// recorded (a frame's commands are recorded in the order a queue would run them). Never WebGPU's raster: no vertex reaches a
// fragment, so no kind's SHADING is here — only where its draws land, in which texture, through which copy and in which channel
// order. A kind's own pixels are Dawn's (the Node oracle, the desk clock's still) and Chrome's (the rigs).
import { type FakeDeviceOptions, type FakeGpu, fakeDevice } from "./fake-gpu";

/** A flat colour, RGBA bytes. */
export type Paint = readonly [number, number, number, number];

interface Texels {
  readonly width: number;
  readonly height: number;
  /** Stored B, G, R, A (`bgra8unorm`) rather than R, G, B, A. */
  readonly bgra: boolean;
  readonly bytes: Uint8Array;
}

export interface RasterGpu extends FakeGpu {
  /** What a draw under a pipeline of this LABEL paints over its scissor. A pipeline not named here paints nothing. */
  readonly paints: Map<string, Paint>;
  /** The texels of a texture this device made (undefined: not a colour texture it keeps). */
  texelsOf(texture: GPUTexture): Uint8Array | undefined;
}

const extent = (size: GPUExtent3DStrict): [number, number] => {
  if (Symbol.iterator in Object(size)) {
    const [w = 1, h = 1] = [...(size as Iterable<number>)];
    return [w, h];
  }
  const s = size as GPUExtent3DDictStrict;
  return [s.width, s.height ?? 1];
};
const origin2 = (o: GPUOrigin3D | undefined): [number, number] => {
  if (o === undefined) return [0, 0];
  if (Symbol.iterator in Object(o)) {
    const [x = 0, y = 0] = [...(o as Iterable<number>)];
    return [x, y];
  }
  const d = o as GPUOrigin3DDict;
  return [d.x ?? 0, d.y ?? 0];
};
const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Fill `[x, y, w, h]` ∩ the texture with `c` (RGBA), in the texture's channel order. */
function fill(t: Texels, x: number, y: number, w: number, h: number, c: Paint): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(t.width, x + w);
  const y1 = Math.min(t.height, y + h);
  const px = t.bgra ? [c[2], c[1], c[0], c[3]] : [c[0], c[1], c[2], c[3]];
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) t.bytes.set(px, (j * t.width + i) * 4);
}

/** The fake device (fake-gpu.ts — its `refuse` option too) with a raster: what `createStill`'s unit draws a still on. */
export function rasterDevice(opts: FakeDeviceOptions = {}): RasterGpu {
  const gpu = fakeDevice([], opts);
  const dev = gpu.device as unknown as {
    createTexture(d: GPUTextureDescriptor): GPUTexture;
    createBuffer(d: GPUBufferDescriptor): GPUBuffer;
    createCommandEncoder(d?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  };
  const paints = new Map<string, Paint>();
  const texels = new WeakMap<object, Texels>();
  const views = new WeakMap<object, Texels>();
  const memory = new WeakMap<object, Uint8Array>();

  const makeTexture = dev.createTexture.bind(dev);
  dev.createTexture = (d) => {
    const t = makeTexture(d);
    if (d.format !== "rgba8unorm" && d.format !== "bgra8unorm") return t;
    const [w, h] = extent(d.size);
    const kept: Texels = { width: w, height: h, bgra: d.format === "bgra8unorm", bytes: new Uint8Array(w * h * 4) };
    texels.set(t, kept);
    (t as unknown as { createView: () => GPUTextureView }).createView = () => {
      const v = { label: `${d.label ?? ""} view` };
      views.set(v, kept);
      return v as unknown as GPUTextureView;
    };
    return t;
  };

  const makeBuffer = dev.createBuffer.bind(dev);
  dev.createBuffer = (d) => {
    const b = makeBuffer(d);
    if ((d.usage & GPUBufferUsage.MAP_READ) === 0) return b;
    const bytes = new Uint8Array(d.size);
    memory.set(b, bytes);
    (b as unknown as { getMappedRange: () => ArrayBuffer }).getMappedRange = () => bytes.buffer;
    return b;
  };

  const makeEncoder = dev.createCommandEncoder.bind(dev);
  dev.createCommandEncoder = (d) => {
    const e = makeEncoder(d) as unknown as Record<string, unknown>;
    e.beginRenderPass = (pd: GPURenderPassDescriptor): GPURenderPassEncoder => {
      const att = [...pd.colorAttachments][0];
      const target = att === null || att === undefined ? undefined : views.get(att.view as object);
      if (target !== undefined && att?.loadOp === "clear") {
        const c = (att.clearValue ?? { r: 0, g: 0, b: 0, a: 0 }) as GPUColorDict;
        fill(target, 0, 0, target.width, target.height, [byte(c.r), byte(c.g), byte(c.b), byte(c.a)]);
      }
      let pipeline = "";
      let scissor: [number, number, number, number] = [0, 0, target?.width ?? 0, target?.height ?? 0];
      const paint = (): void => {
        const c = paints.get(pipeline);
        if (c !== undefined && target !== undefined) fill(target, scissor[0], scissor[1], scissor[2], scissor[3], c);
      };
      const none = (): void => {};
      return {
        setPipeline: (p: { readonly label: string }) => { pipeline = p.label; },
        setScissorRect: (x: number, y: number, w: number, h: number) => { scissor = [x, y, w, h]; },
        draw: paint,
        drawIndexed: paint,
        setBindGroup: none, setViewport: none, setVertexBuffer: none, setIndexBuffer: none, setBlendConstant: none,
        pushDebugGroup: none, popDebugGroup: none, end: none,
      } as unknown as GPURenderPassEncoder;
    };
    e.copyTextureToBuffer = (src: GPUTexelCopyTextureInfo, dst: GPUTexelCopyBufferInfo, size: GPUExtent3DStrict) => {
      const t = texels.get(src.texture);
      const to = memory.get(dst.buffer);
      if (t === undefined || to === undefined) return;
      const [ox, oy] = origin2(src.origin);
      const [w, h] = extent(size);
      const row = dst.bytesPerRow ?? w * 4;
      for (let j = 0; j < h; j++) to.set(t.bytes.subarray(((oy + j) * t.width + ox) * 4, ((oy + j) * t.width + ox + w) * 4), (dst.offset ?? 0) + j * row);
    };
    return e as unknown as GPUCommandEncoder;
  };

  return { ...gpu, paints, texelsOf: (t) => texels.get(t)?.bytes };
}
