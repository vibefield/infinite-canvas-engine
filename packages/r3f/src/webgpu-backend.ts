/**
 * The island half of the private-ish backend read (design-012 plan §1).
 *
 * three exposes no public accessor for the raw `GPUTexture` it resolved a
 * render target into; the one supported route is
 * `renderer.backend.get(renderTarget.texture)`, which returns the backend's
 * per-object record. S5 quarantined that read here, correctly — one file to fix
 * when three moves the record. S6b then needed the SAME read for ground's
 * offscreen target, and since `ground` may not import `r3f` (nor the reverse),
 * it landed in `core/surface/backend-texture.ts` — the one package both import.
 *
 * TWO COPIES EXISTED FROM S6B TO S8, deliberately parked ("not a reason to
 * churn a landed slice"). S8's naming pass resolves it: THE READ LIVES IN CORE,
 * and this module is the ISLAND VOCABULARY over it. Everything below now goes
 * through `backendTextureRecord`, so "one file changes when three moves the
 * record" is true across both packages instead of aspirational in each.
 *
 * What stays here, and why it is not core's business: the probes below ask
 * ISLAND questions. Whether a renderer can host islands at all, which device
 * three settled on, whether a target actually got its MSAA — none of those are
 * things ground asks, and answering them in core would put island policy in a
 * package that has no islands.
 *
 * STRUCTURAL, NOT IMPORTED. Nothing here imports `three/webgpu` — core's types
 * describe a shape — so the stratified profile never pulls the node material
 * system into its bundle just because the composited profile exists (three's
 * `sideEffects: ["./src/nodes/**\/*"]` means a `three/webgpu` import anywhere in
 * the graph is NOT tree-shaken away). The one file that does import it is
 * `webgpu/island-renderer.ts`, behind the `@ice/r3f/webgpu` subpath.
 *
 * Verified against three 0.185.1 in this worktree, not from the spike's notes.
 * The record's own shape is verified at core's module; what is island-specific:
 *
 *  - MSAA: `WebGPUUtils.js:127-128` sets `primarySamples = 1` for a multisampled
 *    render target, so `textureData.texture` is created single-sample (`:374`)
 *    and the multisampled surface is a SEPARATE `msaaTexture` (`:413-416`).
 *    `WebGPUBackend.js:672-688` then names the single-sample view as the pass's
 *    `resolveTarget`. The texture returned here is therefore always the
 *    resolved, directly-samplable image — never the multisampled one.
 *  - Usage (`:352-364`) always includes `COPY_SRC`, which is what lets a witness
 *    read an island target back with `copyTextureToBuffer` and no quad pass.
 */
import {
  backendTexture,
  backendTextureIsSrgb,
  backendTextureRecord,
  type BackendLike,
  type BackendTextureRecord,
  type RendererWithBackend,
} from "@ice/core";

/**
 * three's per-texture backend record. Core's type, re-exported under the name
 * this package's consumers already import — the same record, read in one place.
 */
export type { BackendTextureRecord };

/** The slice of `WebGPUBackend` this package reads. Core's `BackendLike`. */
export type WebGpuBackendLike = BackendLike;

/**
 * The slice of `WebGPURenderer` this package reads. Structural so that
 * `gl-root` and the pool can be typed against a WebGPU renderer without
 * importing one — and so headless tests can hand in a plain object.
 */
export type WebGpuRendererLike = RendererWithBackend;

/** A three `RenderTarget`'s `.texture` — opaque here; only three interprets it. */
export type RenderTargetTexture = object;

/**
 * Is this renderer a WebGPU one sitting on a real backend? Used to refuse
 * loudly rather than register sources that can never resolve (a WebGL renderer
 * under the composited profile would silently publish `undefined` textures
 * forever, and an empty compositor looks exactly like a working one).
 */
export function hasWebGpuBackend(renderer: unknown): renderer is WebGpuRendererLike {
  const backend = (renderer as WebGpuRendererLike | null)?.backend;
  return backend != null && typeof backend.get === "function";
}

/** The device three actually ended up on — `undefined` before `init()` resolves. */
export function backendDevice(renderer: unknown): GPUDevice | undefined {
  return (renderer as WebGpuRendererLike | null)?.backend?.device;
}

/** The backend record for a render target's texture, or undefined pre-allocation. */
export function textureRecord(
  renderer: unknown,
  texture: RenderTargetTexture,
): BackendTextureRecord | undefined {
  return backendTextureRecord(renderer, texture);
}

/**
 * The raw resolved `GPUTexture` for a render target's texture.
 *
 * `undefined` until three has rendered into the target at least once — the
 * getter shape in `CompositorSourceGl` exists precisely so a compositor asking
 * early gets nothing to draw instead of a stale or wrong handle.
 */
export function islandTexture(
  renderer: unknown,
  texture: RenderTargetTexture,
): GPUTexture | undefined {
  return backendTexture(renderer, texture);
}

/** The ACTUAL GPU format three created the resolve texture with. */
export function islandFormat(
  renderer: unknown,
  texture: RenderTargetTexture,
): GPUTextureFormat | undefined {
  return backendTextureRecord(renderer, texture)?.textureDescriptorGPU?.format;
}

/**
 * Does this target's actual format carry an sRGB view, i.e. must the compositor
 * re-encode linear→sRGB when writing to a non-sRGB swap chain?
 *
 * Asked of the FORMAT, never of the three-side `colorSpace` we requested: the
 * two agree today, and the whole point of the guard is that the shader stays
 * correct on the day they do not. Unallocated ⇒ `false`, which pairs with
 * `islandTexture()` returning `undefined` — there is nothing to sample yet, so
 * there is nothing to mis-encode.
 */
export function islandIsSrgb(renderer: unknown, texture: RenderTargetTexture): boolean {
  return backendTextureIsSrgb(renderer, texture);
}

/**
 * Is this target genuinely multisampled on the GPU?
 *
 * The honest question, because the way MSAA dies here is silent: three's own
 * adapter request asks for `featureLevel: 'compatibility'`
 * (`WebGPUBackend.js:213`), a compatibility device lacks
 * `core-features-and-limits`, and three then force-sets `renderer._samples = 0`
 * (`:254-258`) — every island target quietly becomes single-sample. Asking the
 * backend for the separate `msaaTexture` turns "we passed `samples: 4`" into a
 * measurement of what the GPU actually holds.
 */
export function islandIsMultisampled(renderer: unknown, texture: RenderTargetTexture): boolean {
  return backendTextureRecord(renderer, texture)?.msaaTexture !== undefined;
}
