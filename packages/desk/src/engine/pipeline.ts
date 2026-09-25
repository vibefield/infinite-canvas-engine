// Pipelines and bind groups without the ceremony. Layouts are EXPLICIT, never
// 'auto': two passes that read the same buffers share one layout object, so a
// bind group built for one binds to the other.

export type Visibility = "vertex" | "fragment" | "compute";
// Looked up at call time, never at module load: a Node host installs the GPU
// globals AFTER importing the engine.
const stageBits = (v: Visibility): number =>
  v === "vertex" ? GPUShaderStage.VERTEX : v === "fragment" ? GPUShaderStage.FRAGMENT : GPUShaderStage.COMPUTE;

/** `exactOptionalPropertyTypes`: an absent label must be absent, not `undefined`. */
const labelled = (label: string | undefined) => (label === undefined ? {} : { label });

export type BindEntry =
  | { readonly binding: number; readonly stages: readonly Visibility[]; readonly buffer: GPUBufferBindingType }
  | { readonly binding: number; readonly stages: readonly Visibility[]; readonly texture: GPUTextureSampleType; readonly dimension?: GPUTextureViewDimension }
  | { readonly binding: number; readonly stages: readonly Visibility[]; readonly sampler: GPUSamplerBindingType };

export function bindLayout(device: GPUDevice, entries: readonly BindEntry[], label?: string): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    ...labelled(label),
    entries: entries.map((e) => {
      const visibility = e.stages.reduce((m, s) => m | stageBits(s), 0);
      if ("buffer" in e) return { binding: e.binding, visibility, buffer: { type: e.buffer } };
      if ("texture" in e) return { binding: e.binding, visibility, texture: { sampleType: e.texture, ...(e.dimension ? { viewDimension: e.dimension } : {}) } };
      return { binding: e.binding, visibility, sampler: { type: e.sampler } };
    }),
  });
}

export function bindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  resources: ReadonlyArray<GPUBuffer | GPUTextureView | GPUSampler>,
  label?: string,
): GPUBindGroup {
  return device.createBindGroup({
    ...labelled(label),
    layout,
    // Duck-typed, not `instanceof GPUBuffer`: under Dawn-in-Node the class
    // globals are optional, and a buffer is the one resource that can be mapped.
    entries: resources.map((r, binding) => ({
      binding,
      resource: typeof (r as GPUBuffer).getMappedRange === "function" ? { buffer: r as GPUBuffer } : (r as GPUTextureView | GPUSampler),
    })),
  });
}

/** Straight-alpha "source over": colour by src-alpha, alpha accumulates. */
export const BLEND_OVER: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export interface RenderPipelineOptions {
  readonly label?: string;
  readonly layout: GPUPipelineLayout;
  readonly module: GPUShaderModule;
  readonly vertex?: string;
  readonly fragment?: string;
  readonly format: GPUTextureFormat;
  readonly blend?: GPUBlendState;
  /** WGSL `override` values, fixed at creation — how one file becomes N specialised pipelines. */
  readonly constants?: Record<string, number>;
  readonly topology?: GPUPrimitiveTopology;
}

export function renderPipeline(device: GPUDevice, o: RenderPipelineOptions): Promise<GPURenderPipeline> {
  const constants = o.constants ?? {};
  return device.createRenderPipelineAsync({
    ...labelled(o.label),
    layout: o.layout,
    vertex: { module: o.module, entryPoint: o.vertex ?? "vs", constants },
    fragment: {
      module: o.module, entryPoint: o.fragment ?? "fs", constants,
      targets: [o.blend ? { format: o.format, blend: o.blend } : { format: o.format }],
    },
    primitive: { topology: o.topology ?? "triangle-list" },
  });
}

export function uniformBuffer(device: GPUDevice, size: number, label?: string): GPUBuffer {
  return device.createBuffer({ ...labelled(label), size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
}

export function storageBuffer(device: GPUDevice, size: number, label?: string): GPUBuffer {
  return device.createBuffer({ ...labelled(label), size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
}
