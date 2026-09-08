// A GPUDevice stand-in that gets as far as `Field.create` / `Ground.create`
// need: layouts, shader modules that compile clean, pipelines that remember
// their label, buffers and textures. Nothing renders — the branch taken is
// what a test measures (the line glyph's pass, the dot's bake, the pointer's
// analytic term). Shared by the field tests; the WebGPU enum globals a browser
// and Dawn provide for free are installed by `installGpuGlobals()`.
import { vi } from "vitest";

/** What a recording pass saw: the pipeline labels set, and the draws (`vertices×instances`). */
export interface Recorded {
  readonly pipelines: string[];
  readonly draws: string[];
}

export interface StubDevice {
  readonly device: GPUDevice;
  /** `queue.writeBuffer` calls so far. */
  readonly writes: number;
  /** `queue.submit` calls so far. */
  readonly submits: number;
  /** `destroy()` calls so far. */
  readonly destroyed: number;
  /** `createBuffer` calls so far — what a lazily-allocated pass is measured by. */
  readonly buffers: number;
  /** `createBindGroup` calls so far. */
  readonly bindGroups: number;
  /**
   * Lose the device: resolves `device.lost`, which is what a real driver reset does and what the
   * layer's end hangs off (D-C4.3). The returned promise settles after the handlers have run.
   */
  lose(reason?: string, message?: string): Promise<void>;
}

export function stubDevice(): StubDevice {
  const state = { writes: 0, submits: 0, destroyed: 0, buffers: 0, bindGroups: 0 };
  let loseDevice: (info: GPUDeviceLostInfo) => void = () => {};
  const device = {
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => ({ label: d.label }) as unknown as GPUBindGroupLayout,
    createPipelineLayout: () => ({}) as unknown as GPUPipelineLayout,
    createShaderModule: (d: GPUShaderModuleDescriptor) => ({
      label: d.label,
      getCompilationInfo: async () => ({ messages: [] }),
    }) as unknown as GPUShaderModule,
    createRenderPipelineAsync: async (d: GPURenderPipelineDescriptor) => ({ label: d.label }) as unknown as GPURenderPipeline,
    createBuffer: () => { state.buffers += 1; return { getMappedRange: () => new ArrayBuffer(0), destroy: () => {} } as unknown as GPUBuffer; },
    createBindGroup: (d: GPUBindGroupDescriptor) => { state.bindGroups += 1; return { label: d.label } as unknown as GPUBindGroup; },
    createTexture: (d: GPUTextureDescriptor) => {
      const size = d.size as number[];
      return { width: size[0] ?? 1, height: size[1] ?? 1, createView: () => ({}) as GPUTextureView, destroy: () => {} } as unknown as GPUTexture;
    },
    createCommandEncoder: () => ({ finish: () => ({}) as unknown as GPUCommandBuffer }) as unknown as GPUCommandEncoder,
    queue: { writeBuffer: () => { state.writes += 1; }, submit: () => { state.submits += 1; } },
    limits: { maxTextureDimension2D: 4096 },
    features: new Set<string>(),
    lost: new Promise<GPUDeviceLostInfo>((resolve) => { loseDevice = resolve; }),
    addEventListener: () => {},
    destroy: () => { state.destroyed += 1; },
  } as unknown as GPUDevice;
  return {
    device,
    get writes() { return state.writes; },
    get submits() { return state.submits; },
    get destroyed() { return state.destroyed; },
    get buffers() { return state.buffers; },
    get bindGroups() { return state.bindGroups; },
    lose(reason = "unknown", message = "the stub device was lost") {
      loseDevice({ reason, message } as unknown as GPUDeviceLostInfo);
      return new Promise<void>((r) => setTimeout(r, 0));
    },
  };
}

/** An encoder whose render passes record which pipeline drew what. */
export function stubEncoder(into: Recorded): GPUCommandEncoder {
  return {
    beginRenderPass: () => ({
      setPipeline: (p: GPURenderPipeline) => { into.pipelines.push(String(p.label)); },
      setBindGroup: () => {},
      draw: (v: number, n = 1) => { into.draws.push(`${v}×${n}`); },
      end: () => {},
    }) as unknown as GPURenderPassEncoder,
    finish: () => ({}) as unknown as GPUCommandBuffer,
  } as unknown as GPUCommandEncoder;
}

export const stubPass = (into: Recorded): GPURenderPassEncoder => ({
  setPipeline: (p: GPURenderPipeline) => { into.pipelines.push(String(p.label)); },
  setBindGroup: () => {},
  draw: (v: number, n = 1) => { into.draws.push(`${v}×${n}`); },
  setScissorRect: () => {},
  end: () => {},
}) as unknown as GPURenderPassEncoder;

/** A `GPU` (navigator.gpu's shape) whose adapter hands out `device` — or refuses, when `device` is null. */
export function stubGpu(device: GPUDevice | null): GPU {
  return {
    requestAdapter: async () =>
      device === null
        ? null
        : ({ features: new Set<string>(), info: { vendor: "stub", architecture: "", description: "stub adapter" }, requestDevice: async () => device } as unknown as GPUAdapter),
    getPreferredCanvasFormat: () => "rgba8unorm" as GPUTextureFormat,
  } as unknown as GPU;
}

/** The WebGPU enum globals a browser and Dawn both provide for free. */
export function installGpuGlobals(): void {
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, MAP_READ: 1 });
  vi.stubGlobal("GPUTextureUsage", { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1, COPY_DST: 2 });
}
