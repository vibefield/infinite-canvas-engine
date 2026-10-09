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
    GPUMapMode: { READ: 1, WRITE: 2 },
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

/**
 * A render pass that logs what it is told, by label: `pipeline <label>`, `group <i> <label>`, `draw <args>`, `scissor <x,y,w,h>`, `viewport <x,y,w,h>` (and a mesh's `vertices <label>`, `indices <label>`, `drawIndexed <args>`; a debug group's `debug <label>` … `debug end`).
 * Ended with a debug group still pushed it logs `invalid: …` as WebGPU refuses it (M24 LT3); `ended` is told its end.
 */
export function recordingPass(log: string[], ended?: () => void): GPURenderPassEncoder {
  let depth = 0;
  return {
    setPipeline: (p: { label: string }) => log.push(`pipeline ${p.label}`),
    setBindGroup: (i: number, g: { label: string }) => log.push(`group ${i} ${g.label}`),
    draw: (...a: number[]) => log.push(`draw ${a.join(",")}`),
    setVertexBuffer: (_slot: number, b: { label: string }) => log.push(`vertices ${b.label}`),
    setIndexBuffer: (b: { label: string }) => log.push(`indices ${b.label}`),
    drawIndexed: (...a: number[]) => log.push(`drawIndexed ${a.join(",")}`),
    setScissorRect: (x: number, y: number, w: number, h: number) => log.push(`scissor ${x},${y},${w},${h}`),
    // (K7a: a layered kind draws its layer through a viewport shifted by its box's origin — kit/layer.ts `BoxTargets`)
    setViewport: (x: number, y: number, w: number, h: number) => log.push(`viewport ${x},${y},${w},${h}`),
    setBlendConstant: () => {},
    pushDebugGroup: (label: string) => { depth += 1; log.push(`debug ${label}`); },
    popDebugGroup: () => { depth -= 1; log.push("debug end"); },
    end: () => {
      if (depth !== 0) log.push(`invalid: PushDebugGroup called ${depth} time(s) without a corresponding PopDebugGroup`);
      log.push("end");
      ended?.();
    },
  } as unknown as GPURenderPassEncoder;
}

export interface FakeGpu {
  readonly device: GPUDevice;
  /** What reached the queue. */
  readonly queue: { submits: number; writes: number };
  /** The errors no scope captured — what the device's `uncapturederror` listeners heard (petition I24's witness). */
  readonly uncaptured: { readonly message: string }[];
}

export interface FakeDeviceOptions {
  /**
   * A shader the device REFUSES (petition I24 — a WGSL that does not compile): the compiler's message for `code`, or undefined to
   * compile it. A refused module raises a GPUValidationError — into the innermost `validation` scope open when it was made, else
   * to the `uncapturederror` listeners — and its compilation info carries the message as an error, as WebGPU's does.
   */
  readonly refuse?: (code: string) => string | undefined;
}

/** A device of stubs; every render pass an encoder begins logs into `log` (after a `pass <label>` line). */
export function fakeDevice(log: string[] = [], opts: FakeDeviceOptions = {}): FakeGpu {
  const queue = { submits: 0, writes: 0 };
  const labelled = (d?: { readonly label?: string }) => ({ label: d?.label ?? "" });
  // THE ERROR SCOPES as WebGPU keeps them: a stack; an error goes to the innermost scope of its filter (kept only if it holds none
  // yet), else to the `uncapturederror` listeners
  const scopes: { readonly filter: GPUErrorFilter; error: { readonly message: string } | null }[] = [];
  const listeners: ((ev: { readonly error: unknown }) => void)[] = [];
  const uncaptured: { readonly message: string }[] = [];
  const raise = (filter: GPUErrorFilter, message: string, name: string): void => {
    const error = { message, constructor: { name } };
    for (let i = scopes.length - 1; i >= 0; i--) {
      const s = scopes[i] as (typeof scopes)[number];
      if (s.filter !== filter) continue;
      s.error ??= error;
      return;
    }
    uncaptured.push(error);
    for (const l of listeners) l({ error });
  };
  const device = {
    // WebGPU's default limits — what the flat-card pipeline's plan counts its bindings against (K7b, card/card.ts `planCards`)
    limits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxUniformBuffersPerShaderStage: 12, maxBindingsPerBindGroup: 1000 },
    createBindGroupLayout: labelled,
    createBindGroup: labelled,
    createPipelineLayout: labelled,
    createSampler: labelled,
    createShaderModule: (d: GPUShaderModuleDescriptor) => {
      const refused = opts.refuse?.(d.code);
      if (refused !== undefined) raise("validation", `Error while parsing WGSL: ${refused}`, "GPUValidationError");
      return { ...labelled(d), getCompilationInfo: async () => ({ messages: refused === undefined ? [] : [{ type: "error", lineNum: 1, linePos: 1, message: refused }] }) };
    },
    createRenderPipelineAsync: async (d: GPURenderPipelineDescriptor) => labelled(d),
    // (a texture's mips — photo/mips.ts, the notebook's and the calendar's paper — compile one synchronously)
    createRenderPipeline: (d: GPURenderPipelineDescriptor) => ({ ...labelled(d), getBindGroupLayout: () => ({ label: `${d.label ?? ""} group` }) }),
    // a MAP_READ buffer (a capture's readback — ground.ts `captureFrame`) maps its whole size, every byte its own index (so a reader's
    // row unpadding and channel order are checkable); any other an empty range, as before; its map resolves at once
    createBuffer: (d: GPUBufferDescriptor) => ({ ...labelled(d), size: d.size, destroy: () => {}, mapAsync: async () => {}, unmap: () => {}, getMappedRange: () => ((d.usage & 1) !== 0 ? new Uint8Array(d.size).map((_, i) => i & 255).buffer : new ArrayBuffer(0)) }),
    createTexture: (d: GPUTextureDescriptor) => ({ ...labelled(d), createView: () => ({ label: `${d.label ?? ""} view` }), destroy: () => {} }),
    // an encoder as WebGPU validates it (M24 LT3): LOCKED while a pass it began is open, and refused at its finish with a pass open or a
    // debug group pushed — each logged `invalid: …` (Chrome's words), the command buffer the submit would drop
    createCommandEncoder: () => {
      let open: string | null = null;
      let depth = 0;
      const locked = (): void => { if (open !== null) log.push(`invalid: Recording in [CommandEncoder] which is locked while [RenderPassEncoder "${open}"] is open`); };
      return {
        beginRenderPass: (d: GPURenderPassDescriptor) => {
          const label = d.label ?? "";
          const busy = open !== null;
          locked();
          log.push(`pass ${label}`);
          if (busy) return recordingPass(log);   // (an error pass: the encoder stays locked by the one open)
          open = label;
          return recordingPass(log, () => { if (open === label) open = null; });
        },
        pushDebugGroup: (label: string) => { locked(); depth += 1; log.push(`encoder debug ${label}`); },
        popDebugGroup: () => { locked(); depth -= 1; log.push("encoder debug end"); },
        copyTextureToTexture: locked,
        copyTextureToBuffer: locked,
        finish: () => {
          if (open !== null) log.push(`invalid: Command buffer recording ended before [RenderPassEncoder "${open}"] was ended`);
          if (depth !== 0) log.push(`invalid: PushDebugGroup called ${depth} time(s) without a corresponding PopDebugGroup prior to calling Finish`);
          return {};
        },
      };
    },
    // (the work a submit carries is done at once — the layer's first frame "presented", petition I25)
    queue: { writeBuffer: () => { queue.writes += 1; }, writeTexture: () => {}, submit: () => { queue.submits += 1; }, onSubmittedWorkDone: async () => {} },
    // a pass that watches its first frames (the notebook's `render`, the calendar's `renderLayer`) finds nothing wrong here — unless
    // something raised an error into its scope (a refused shader, petition I24)
    pushErrorScope: (filter: GPUErrorFilter) => { scopes.push({ filter, error: null }); },
    popErrorScope: async () => scopes.pop()?.error ?? null,
    addEventListener: (type: string, fn: (ev: { readonly error: unknown }) => void) => { if (type === "uncapturederror") listeners.push(fn); },
  };
  return { device: device as unknown as GPUDevice, queue, uncaptured };
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
