// A picture's mip chain, made on the device: each level drawn from the one
// above it through a linear sampler (a 2×2 box at exactly half size). Sampled
// from an `-srgb` view the filtering happens in linear light, so a zoomed-out
// print keeps its brightness. One pipeline per format, made on first use.
// Two forms: `generateMips` makes a whole chain in a submit of its own (the
// photo's one-shot pictures); `mipsInto` makes some of its levels into the
// caller's encoder (a live face's chain, as deep as it is read — M24 LT1).

const WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[i];
  var o: VO; o.pos = vec4f(p, 0.0, 1.0); o.uv = vec2f(0.5 * p.x + 0.5, 0.5 - 0.5 * p.y); return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(src, samp, v.uv, 0.0); }
`;

const cache = new WeakMap<GPUDevice, { module: GPUShaderModule; sampler: GPUSampler; pipes: Map<GPUTextureFormat, GPURenderPipeline> }>();

export const mipCount = (w: number, h: number): number => Math.floor(Math.log2(Math.max(w, h, 1))) + 1;

/** The device's mip sampler and its pipeline for `format`, made on first use — one per device and format, both forms'. */
function pipeOf(device: GPUDevice, format: GPUTextureFormat): { readonly pipe: GPURenderPipeline; readonly sampler: GPUSampler } {
  let c = cache.get(device);
  if (!c) {
    c = { module: device.createShaderModule({ label: "photo/mips", code: WGSL }), sampler: device.createSampler({ minFilter: "linear", magFilter: "linear" }), pipes: new Map() };
    cache.set(device, c);
  }
  let pipe = c.pipes.get(format);
  if (!pipe) {
    pipe = device.createRenderPipeline({
      label: `photo/mips ${format}`, layout: "auto",
      vertex: { module: c.module, entryPoint: "vs" },
      fragment: { module: c.module, entryPoint: "fs", targets: [{ format }] },
    });
    c.pipes.set(format, pipe);
  }
  return { pipe, sampler: c.sampler };
}

export function generateMips(device: GPUDevice, texture: GPUTexture): void {
  const { pipe, sampler } = pipeOf(device, texture.format);
  const encoder = device.createCommandEncoder({ label: "photo/mips" });
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const src = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
    const dst = texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
    const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: sampler }] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}

/** What `mipsInto` keeps per texture: its format's pipeline, each level's own view, and the group that reads level l − 1 for level l. */
interface Chain {
  readonly pipe: GPURenderPipeline;
  readonly sampler: GPUSampler;
  readonly views: GPUTextureView[];
  readonly groups: GPUBindGroup[];
}
const chains = new WeakMap<GPUTexture, Chain>();

/**
 * A chain's levels `from` … `to` made INTO `encoder` (design-019 §3.1, M24 LT1 — a live face's chain, made only as deep as it is read,
 * in the frame's own encoder: no submit of its own), each level drawn from the one above it as `generateMips` draws it (a 2×2 box
 * through a linear sampler; from an `-srgb` texture, in linear light). The pipeline is the device's per format (`generateMips`' own);
 * each level's view and the bind group that reads the level above it are kept per TEXTURE, made the first time that level is asked —
 * a face made again at a producer's 60 a second makes no view or group per call. `from` is at least 1; `to` is clamped to the chain's
 * last level; `to` below `from` records nothing. The texture needs RENDER_ATTACHMENT (a level is drawn) and TEXTURE_BINDING (the one
 * above is read). The DEVICE comes first, as `generateMips`' does: a WebGPU encoder and texture carry none, and the views and groups
 * are made on it.
 */
export function mipsInto(device: GPUDevice, encoder: GPUCommandEncoder, texture: GPUTexture, from: number, to: number): void {
  const first = Math.max(1, Math.floor(from));
  const last = Math.min(Math.floor(to), texture.mipLevelCount - 1);
  if (last < first) return;
  let chain = chains.get(texture);
  if (chain === undefined) {
    const { pipe, sampler } = pipeOf(device, texture.format);
    chain = { pipe, sampler, views: [], groups: [] };
    chains.set(texture, chain);
  }
  const c = chain;
  const view = (level: number): GPUTextureView => {
    let v = c.views[level];
    if (v === undefined) { v = texture.createView({ baseMipLevel: level, mipLevelCount: 1 }); c.views[level] = v; }
    return v;
  };
  for (let level = first; level <= last; level++) {
    let group = c.groups[level];
    if (group === undefined) {
      group = device.createBindGroup({ layout: c.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(level - 1) }, { binding: 1, resource: c.sampler }] });
      c.groups[level] = group;
    }
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(level), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(c.pipe);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
}
