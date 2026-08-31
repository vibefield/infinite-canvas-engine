/**
 * The app-owned GPUDevice (design-012 §4 "Device", decision 2; plan §1 "Device
 * ownership").
 *
 * ONE device, owned ABOVE all layers, because the compositor's whole premise is
 * that ground programs, three-rendered islands and live surfaces write into one
 * pass — and textures are not shareable across devices, which is today's actual
 * problem. three ADOPTS this device (`new WebGPURenderer({ device })`) and
 * never destroys one it did not create (WebGPUBackend.js:2903 in three r185,
 * verified against the tree), so the device outlives any layer teardown: the
 * right shape for an engine that rebuilds layers per document.
 *
 * Three creation rules are load-bearing, and all three are about what three
 * would otherwise do to us:
 *
 *  1. **No `featureLevel: 'compatibility'`.** three's OWN adapter request asks
 *     for it (WebGPUBackend.js:213). A compatibility adapter lacks
 *     `core-features-and-limits`, and three reads exactly that to set
 *     `compatibilityMode`, which force-sets `renderer._samples = 0` (:254-258)
 *     — silently killing MSAA inside island render targets. Asking for a core
 *     adapter here is what keeps it.
 *  2. **All adapter features.** three requests every feature the adapter
 *     advertises for the device it makes itself, so an injected device that
 *     asked for less would be a downgrade rather than a like-for-like swap.
 *  3. **`addEventListener('uncapturederror')`, never the property.** three
 *     ASSIGNS `device.onuncapturederror` during init (:277) on whatever device
 *     it is handed, including one the app already owns. An app that set that
 *     property itself is silently disconnected from its own GPU errors the
 *     moment three initialises. A listener coexists with three's handler
 *     instead of racing it, and it is armed HERE — before any consumer exists
 *     — so there is no window in which errors go unseen.
 *
 * Headless-safe: WebGPU is not DOM (it exists in workers), so naming it here
 * does not breach core's wall. The only environmental touch is reading
 * `navigator.gpu`, and its absence is a clean typed failure, never a throw
 * from deep inside a layer.
 *
 * TYPES. WebGPU is absent from TypeScript's DOM lib, so `@webgpu/types` is the
 * ONE entry in `tsconfig.base.json`'s `types` array — which was deliberately
 * `[]`, to keep ambient @types from leaking in wholesale. It stays a list of
 * one; a hand-rolled structural mirror of GPUDevice would rot against the spec,
 * and this module plus `ground` name enough of the API to make that real. It is
 * also a runtime-free dependency of `@vibecook/ice`, so the published `.d.ts`
 * resolves for consumers.
 */

export interface GpuUncapturedError {
  /** `performance.now()` at capture, or 0 where the clock is unavailable. */
  readonly at: number;
  readonly type: string;
  readonly message: string;
}

/**
 * The engine's GPU facts. Reached as `engine.compositorDevice` (undefined on a stratified or
 * headless engine — the composited profile refuses at boot when it is absent,
 * design-012 §11 Q2).
 */
export interface EngineGpu {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  /** Features actually enabled on the device (not merely adapter-advertised). */
  readonly enabled: readonly string[];
  /**
   * False means three will run in compatibilityMode and drop island MSAA to 0.
   * True is the whole point of rule 1 above.
   */
  readonly hasCoreFeatures: boolean;
  readonly hasTimestampQuery: boolean;
  /** Uncaptured GPU errors since acquisition, newest last. */
  errors(): readonly GpuUncapturedError[];
  /**
   * Release the device. The ENGINE NEVER CALLS THIS: the device outlives
   * layers by design (§4), and `dispose()` on the engine tears down layers.
   * The app that acquired the device owns its end of life.
   */
  destroy(): void;
}

export interface AcquireDeviceOpts {
  /** Defaults to "high-performance" — the compositor is the frame's fill cost. */
  readonly powerPreference?: GPUPowerPreference;
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

/**
 * Acquire the app-owned device. Called by the APP at engine construction in the
 * composited profile, handed to `createCanvasEngine({ compositorDevice })`;
 * ground's factory and r3f's mount both receive it from there.
 *
 * Throws {@link GpuUnavailableError} rather than returning a half-state — a
 * composited build with no device has nothing honest to render, and the caller
 * turns this into the boot-time refusal.
 */
export async function acquireCompositorDevice(opts: AcquireDeviceOpts = {}): Promise<EngineGpu> {
  const gpu = (globalThis.navigator as { gpu?: GPU } | undefined)?.gpu;
  if (gpu == null) {
    throw new GpuUnavailableError("navigator.gpu is undefined — no WebGPU in this context");
  }

  // Rule 1: NO `featureLevel: 'compatibility'` (three asks for it; we must not).
  const adapter = await gpu.requestAdapter({
    powerPreference: opts.powerPreference ?? "high-performance",
  });
  if (adapter === null) throw new GpuUnavailableError("requestAdapter returned null");

  // Rule 2: everything the adapter advertises, matching what three would ask
  // for its own device. Falls back to a bare device rather than failing the
  // whole boot if the full-feature request is refused.
  const advertised = [...adapter.features].sort();
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredFeatures: advertised as GPUFeatureName[] });
  } catch (err) {
    console.warn("[ice] full-feature requestDevice failed, retrying bare:", err);
    device = await adapter.requestDevice();
  }

  // Rule 3: armed BEFORE any consumer, and via addEventListener so three's
  // later property assignment cannot disconnect us.
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
    hasCoreFeatures: device.features.has("core-features-and-limits"),
    hasTimestampQuery: device.features.has("timestamp-query"),
    errors: () => errors,
    destroy: () => device.destroy(),
  };
}
