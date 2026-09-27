// A picture's mip chain, made on the device: each level drawn from the one
// above it through a linear sampler (a 2×2 box at exactly half size). Sampled
// from an `-srgb` view the filtering happens in linear light, so a zoomed-out
// print keeps its brightness. One pipeline per format, made on first use.

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

export function generateMips(device: GPUDevice, texture: GPUTexture): void {
  let c = cache.get(device);
  if (!c) {
    c = { module: device.createShaderModule({ label: "photo/mips", code: WGSL }), sampler: device.createSampler({ minFilter: "linear", magFilter: "linear" }), pipes: new Map() };
    cache.set(device, c);
  }
  let pipe = c.pipes.get(texture.format);
  if (!pipe) {
    pipe = device.createRenderPipeline({
      label: `photo/mips ${texture.format}`, layout: "auto",
      vertex: { module: c.module, entryPoint: "vs" },
      fragment: { module: c.module, entryPoint: "fs", targets: [{ format: texture.format }] },
    });
    c.pipes.set(texture.format, pipe);
  }
  const encoder = device.createCommandEncoder({ label: "photo/mips" });
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const src = texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 });
    const dst = texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
    const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: c.sampler }] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
