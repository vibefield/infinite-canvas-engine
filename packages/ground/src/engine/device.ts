// The WebGPU boilerplate, and nothing else. Host-agnostic: pass `navigator.gpu`
// in a browser or Dawn's `create([])` in Node, and the rest of the engine never
// knows the difference — which is what lets the pixel oracle run without a
// browser.

export interface GpuOptions {
  /** `navigator.gpu` in a browser; Dawn's `create([])` in Node. */
  readonly gpu: GPU;
  readonly label?: string;
  readonly powerPreference?: GPUPowerPreference;
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
    requiredFeatures: (opts.requiredFeatures ?? []).filter((f) => adapter.features.has(f)),
  });
  device.lost.then((info) => opts.onLost?.(info));
  // Subscribe, never assign: a co-hosted renderer (three adopts a device this
  // way) ASSIGNS `onuncapturederror`, and a listener coexists with that.
  if (opts.onError && typeof (device as unknown as { addEventListener?: unknown }).addEventListener === "function") {
    device.addEventListener("uncapturederror", (ev) => opts.onError?.((ev as GPUUncapturedErrorEvent).error));
  }
  const a = adapter.info ?? { vendor: "", architecture: "", description: "" };
  return { adapter, device, info: { vendor: a.vendor, architecture: a.architecture, description: a.description } };
}

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

export function surface(device: GPUDevice, canvas: HTMLCanvasElement, opts: { alphaMode?: GPUCanvasAlphaMode } = {}): Surface {
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("canvas.getContext('webgpu') returned null");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: opts.alphaMode ?? "opaque" });
  let last = { w: 0, h: 0 };
  return {
    context, format,
    fit(maxDpr = 2) {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const cssWidth = Math.max(1, canvas.clientWidth);
      const cssHeight = Math.max(1, canvas.clientHeight);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      const changed = width !== last.w || height !== last.h;
      if (changed) { canvas.width = width; canvas.height = height; last = { w: width, h: height }; }
      return { changed, width, height, cssWidth, cssHeight, dpr };
    },
    view() { return context.getCurrentTexture().createView(); },
    size() { return { w: Math.max(1, canvas.width), h: Math.max(1, canvas.height) }; },
  };
}
