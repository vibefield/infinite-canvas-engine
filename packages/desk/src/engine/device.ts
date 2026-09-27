// The WebGPU boilerplate, and nothing else. Host-agnostic: pass `navigator.gpu`
// in a browser or Dawn's `create([])` in Node, and the rest of the engine never
// knows the difference — which is what lets the pixel oracle run without a
// browser. The swap chain (`surface()`, the one call that names a canvas, the
// window and `navigator.gpu`) lives in host/surface.ts since D2a-world: the
// `Surface` it returns is declared here, so the composition root can take one
// without touching the DOM (design-015 §3 `desk-dom-free`).

export interface GpuOptions {
  /** `navigator.gpu` in a browser; Dawn's `create([])` in Node. */
  readonly gpu: GPU;
  readonly label?: string;
  readonly powerPreference?: GPUPowerPreference;
  /** Features to enable where the adapter has them, beside `timestamp-query` — asked for whenever the adapter has it (the GPU profiler's clock, design-016 §4: a feature cannot be added to a device later, and one unused costs nothing). */
  readonly requiredFeatures?: readonly GPUFeatureName[];
  /** Device loss and uncaptured errors — the layer degrades, it does not throw. */
  readonly onLost?: (info: GPUDeviceLostInfo) => void;
  readonly onError?: (error: GPUError) => void;
}

export interface Gpu {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly info: { readonly vendor: string; readonly architecture: string; readonly description: string };
}

export async function acquire(opts: GpuOptions): Promise<Gpu> {
  const adapter = await opts.gpu.requestAdapter(
    opts.powerPreference ? { powerPreference: opts.powerPreference } : {},
  );
  if (!adapter) throw new Error("WebGPU: requestAdapter() returned null");
  const device = await adapter.requestDevice({
    label: opts.label ?? "ground",
    requiredFeatures: [...new Set<GPUFeatureName>([...(opts.requiredFeatures ?? []), "timestamp-query"])].filter((f) => adapter.features.has(f)),
  });
  return adopt(adapter, device, opts);
}

/**
 * A device the host already HAS — the engine's (design-015 D7: ONE device per engine) — wired as `acquire` wires one it
 * made: its loss and its uncaptured errors reach the handlers. The caller does not own it, so it never destroys it.
 */
export function adopt(adapter: GPUAdapter, device: GPUDevice, opts: Pick<GpuOptions, "onLost" | "onError"> = {}): Gpu {
  device.lost.then((info) => opts.onLost?.(info));
  // Subscribe, never assign: another holder of the device may ASSIGN `onuncapturederror`, and a listener coexists with that.
  if (opts.onError && typeof (device as unknown as { addEventListener?: unknown }).addEventListener === "function") {
    device.addEventListener("uncapturederror", (ev) => opts.onError?.((ev as GPUUncapturedErrorEvent).error));
  }
  const a = adapter.info ?? { vendor: "", architecture: "", description: "" };
  return { adapter, device, info: { vendor: a.vendor, architecture: a.architecture, description: a.description } };
}

/** A swap chain as the ground draws into it — made by `host/surface.ts` (a canvas) or a test's fake. */
export interface Surface {
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  /** Size the drawing buffer to the CSS box × dpr (clamped). True when it changed. */
  fit(maxDpr?: number): { changed: boolean; width: number; height: number; cssWidth: number; cssHeight: number; dpr: number };
  /** The swap-chain texture view for this frame. */
  view(): GPUTextureView;
  /** The drawing buffer's size in device px — whatever sized the canvas, `fit()` or the host. */
  size(): { readonly w: number; readonly h: number };
}
