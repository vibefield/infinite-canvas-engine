// A GPU for the CPU half of the passes — never a pixel. Every object a pass asks the device for is a
// stub carrying its label (a texture makes views, a buffer duck-types as one through
// `getMappedRange`), every shader compiles, every pipeline resolves; the frame's render passes log
// what they are told, by label; the queue counts what reaches it. Enough for `Ground` itself (its
// registry, one frame through it, its stats and its dispose), the mat's pass and the whiteboard's
// lists and ranges to run in Node. The pixels stay the oracle's (Dawn) and the parity rig's (Chrome).

import type { Surface } from "../src/engine/device";

type Undo = () => void;

/** The WebGPU flag namespaces a Node host lacks (the engine reads them at call time, never at load): installed, with their undo. */
export function installGpuFlags(): Undo {
  const flags: Record<string, Record<string, number>> = {
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 },
    GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
  };
  const g = globalThis as Record<string, unknown>;
  const set = Object.keys(flags).filter((k) => !(k in g));
  for (const k of set) g[k] = flags[k];
  return () => { for (const k of set) Reflect.deleteProperty(g, k); };
}

/** `navigator.gpu` as far as `surface()` asks it (the preferred canvas format), with its undo. */
export function installNavigatorGpu(format: GPUTextureFormat): Undo {
  const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { gpu: { getPreferredCanvasFormat: () => format } }, configurable: true, writable: true });
  return () => { if (was) Object.defineProperty(globalThis, "navigator", was); else Reflect.deleteProperty(globalThis, "navigator"); };
}

/** A render pass that logs what it is told, by label: `pipeline <label>`, `group <i> <label>`, `draw <args>`, `scissor <x,y,w,h>` (and a mesh's `vertices <label>`, `indices <label>`, `drawIndexed <args>`). */
export function recordingPass(log: string[]): GPURenderPassEncoder {
  return {
    setPipeline: (p: { label: string }) => log.push(`pipeline ${p.label}`),
    setBindGroup: (i: number, g: { label: string }) => log.push(`group ${i} ${g.label}`),
    draw: (...a: number[]) => log.push(`draw ${a.join(",")}`),
    setVertexBuffer: (_slot: number, b: { label: string }) => log.push(`vertices ${b.label}`),
    setIndexBuffer: (b: { label: string }) => log.push(`indices ${b.label}`),
    drawIndexed: (...a: number[]) => log.push(`drawIndexed ${a.join(",")}`),
    setScissorRect: (x: number, y: number, w: number, h: number) => log.push(`scissor ${x},${y},${w},${h}`),
    setBlendConstant: () => {},
    end: () => log.push("end"),
  } as unknown as GPURenderPassEncoder;
}

export interface FakeGpu {
  readonly device: GPUDevice;
  /** What reached the queue. */
  readonly queue: { submits: number; writes: number };
}

/** A device of stubs; every render pass an encoder begins logs into `log` (after a `pass <label>` line). */
export function fakeDevice(log: string[] = []): FakeGpu {
  const queue = { submits: 0, writes: 0 };
  const labelled = (d?: { readonly label?: string }) => ({ label: d?.label ?? "" });
  const device = {
    createBindGroupLayout: labelled,
    createBindGroup: labelled,
    createPipelineLayout: labelled,
    createSampler: labelled,
    createShaderModule: (d: GPUShaderModuleDescriptor) => ({ ...labelled(d), getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipelineAsync: async (d: GPURenderPipelineDescriptor) => labelled(d),
    // (a texture's mips — photo/mips.ts, the notebook's and the calendar's paper — compile one synchronously)
    createRenderPipeline: (d: GPURenderPipelineDescriptor) => ({ ...labelled(d), getBindGroupLayout: () => ({ label: `${d.label ?? ""} group` }) }),
    createBuffer: (d: GPUBufferDescriptor) => ({ ...labelled(d), size: d.size, destroy: () => {}, getMappedRange: () => new ArrayBuffer(0) }),
    createTexture: (d: GPUTextureDescriptor) => ({ ...labelled(d), createView: () => ({ label: `${d.label ?? ""} view` }), destroy: () => {} }),
    createCommandEncoder: () => ({
      beginRenderPass: (d: GPURenderPassDescriptor) => { log.push(`pass ${d.label ?? ""}`); return recordingPass(log); },
      finish: () => ({}),
    }),
    queue: { writeBuffer: () => { queue.writes += 1; }, writeTexture: () => {}, submit: () => { queue.submits += 1; } },
  };
  return { device: device as unknown as GPUDevice, queue };
}

/** A canvas as `surface()` asks it: a webgpu context that configures and hands out a swap texture, and a drawing buffer size. */
export function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  const context = { configure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }) }) };
  return { width, height, clientWidth: width, clientHeight: height, getContext: () => context } as unknown as HTMLCanvasElement;
}

/** A swap chain as `Ground.create` takes it (D2a-world: the host makes it, the composition root never names a canvas) — a fixed device-px size, a `swap` view. */
export function fakeSurface(width: number, height: number, format: GPUTextureFormat = "bgra8unorm"): Surface {
  return {
    context: {} as GPUCanvasContext,
    format,
    fit: () => ({ changed: false, width, height, cssWidth: width, cssHeight: height, dpr: 1 }),
    view: () => ({ label: "swap" }) as unknown as GPUTextureView,
    size: () => ({ w: width, h: height }),
  };
}
