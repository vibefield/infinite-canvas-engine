/**
 * THE ENGINE'S DEVICE (design-012 §4 "Device"; kept as the device door at design-015 D5b, slimmed at D7): ONE device
 * per engine. An app that wants the device before the desk mounts — to read its uncaptured errors, to share it with
 * work of its own — acquires it here and passes it to `createCanvasEngine({ compositorDevice })`; the desk's layer then
 * DRAWS WITH IT (`createDeskHost` hands it through the layer context) instead of acquiring a device of its own, so
 * `errors()` sees the desk's uncaptured GPU errors. Absent — the common case, and every headless engine — the desk
 * acquires its own. The engine never destroys it: the app that acquired it owns its end of life.
 *
 * The error log subscribes with `addEventListener('uncapturederror')`, never the `onuncapturederror` property, so no
 * other holder of the device can disconnect it; it is armed HERE, before any consumer exists, so no error goes unseen.
 * (The three.js creation rules this module carried for the GL islands — no compatibility adapter, every advertised
 * feature — left with three at D7; `hasCoreFeatures`, three's compatibility-mode signal, with them.) ONE feature is asked
 * for whenever the adapter has it (design-016 §4, K2): `timestamp-query`, the GPU profiler's clock — a feature cannot be
 * added to a device once it is made, and one left unused costs nothing, so every engine's device can be profiled.
 *
 * Headless-safe: WebGPU is not DOM (it exists in workers), so naming it here does not breach core's wall. The only
 * environmental touch is reading `navigator.gpu`, and its absence is a clean typed failure, never a throw from deep
 * inside a layer. TYPES: `@webgpu/types` is the ONE entry in `tsconfig.base.json`'s `types` array, and a runtime-free
 * dependency of `@vibecook/ice`, so the published `.d.ts` resolves for consumers.
 */

export interface GpuUncapturedError {
  /** `performance.now()` at capture, or 0 where the clock is unavailable. */
  readonly at: number;
  readonly type: string;
  readonly message: string;
}

/** The engine's GPU facts. Reached as `engine.compositorDevice` — undefined unless the app passed one (the desk then acquires its own). */
export interface EngineGpu {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  /** Features actually enabled on the device (not merely adapter-advertised). */
  readonly enabled: readonly string[];
  /** `timestamp-query` is on the device — asked for whenever the adapter has it (the GPU profiler's clock, design-016 §4). */
  readonly hasTimestampQuery: boolean;
  /** Uncaptured GPU errors since acquisition, newest last. */
  errors(): readonly GpuUncapturedError[];
  /** Release the device. The ENGINE NEVER CALLS THIS — nor does the desk's layer that drew with it: the app that acquired it owns its end of life. */
  destroy(): void;
}

export interface AcquireDeviceOpts {
  /** Defaults to "high-performance" — the desk is the frame's fill cost. */
  readonly powerPreference?: GPUPowerPreference;
  /** Features to enable where the adapter has them, beside `timestamp-query` (always asked for where the adapter has it; the desk's drawing needs none). */
  readonly requiredFeatures?: readonly GPUFeatureName[];
  /** Cap the retained error log (defaults to 64). */
  readonly maxErrors?: number;
}

export class GpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuUnavailableError";
  }
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0;

/** The profiler's clock (design-016 §4, K2): asked for on every device the adapter can give it to. */
const PROFILER_FEATURES: readonly GPUFeatureName[] = ["timestamp-query"];

/** What a device is asked for: the caller's features and the profiler's, each once, where the adapter has them. */
function deviceFeatures(adapter: Pick<GPUAdapter, "features">, requested: readonly GPUFeatureName[] = []): GPUFeatureName[] {
  return [...new Set([...requested, ...PROFILER_FEATURES])].filter((f) => adapter.features.has(f));
}

/**
 * Acquire the engine's device. Called by the APP before `createCanvasEngine({ compositorDevice })`; the desk's layer
 * receives it from there. Throws {@link GpuUnavailableError} rather than returning a half-state.
 */
export async function acquireCompositorDevice(opts: AcquireDeviceOpts = {}): Promise<EngineGpu> {
  const gpu = (globalThis.navigator as { gpu?: GPU } | undefined)?.gpu;
  if (gpu == null) {
    throw new GpuUnavailableError("navigator.gpu is undefined — no WebGPU in this context");
  }

  const adapter = await gpu.requestAdapter({
    powerPreference: opts.powerPreference ?? "high-performance",
  });
  if (adapter === null) throw new GpuUnavailableError("requestAdapter returned null");
  const device = await adapter.requestDevice({
    label: "ice",
    requiredFeatures: deviceFeatures(adapter, opts.requiredFeatures),
  });

  // armed BEFORE any consumer, and via addEventListener so no later holder can disconnect it
  const maxErrors = opts.maxErrors ?? 64;
  const errors: GpuUncapturedError[] = [];
  device.addEventListener("uncapturederror", (event) => {
    const err = (event as GPUUncapturedErrorEvent).error as { message?: string } | undefined;
    const entry: GpuUncapturedError = {
      at: now(),
      type: err?.constructor?.name ?? "GPUError",
      message: err?.message ?? "unknown",
    };
    errors.push(entry);
    if (errors.length > maxErrors) errors.splice(0, errors.length - maxErrors);
    console.error("[ice] uncaptured GPU error", entry.type, entry.message);
  });

  return {
    adapter,
    device,
    enabled: [...device.features].sort(),
    hasTimestampQuery: device.features.has("timestamp-query"),
    errors: () => errors,
    destroy: () => device.destroy(),
  };
}
