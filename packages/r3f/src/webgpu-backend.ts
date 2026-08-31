/**
 * The private-ish read, quarantined (design-012 plan §1 "the registry seam").
 *
 * The unified compositor needs the raw `GPUTexture` three resolved an island
 * into, and three exposes no public accessor for it. The one supported route is
 * `renderer.backend.get(renderTarget.texture)`, which returns the backend's
 * per-object record. That read is the ONLY unsupported thing in this slice, so
 * it lives here alone rather than being sprinkled through the pass: `ground`
 * never learns it exists (it receives a `texture()` getter through core's
 * registry), and if three moves the record, exactly one file changes.
 *
 * STRUCTURAL, NOT IMPORTED. Nothing here imports `three/webgpu` — these are
 * interfaces describing a shape, so the stratified profile never pulls the node
 * material system into its bundle just because the composited profile exists
 * (three's `sideEffects: ["./src/nodes/**\/*"]` means a `three/webgpu` import
 * anywhere in the graph is NOT tree-shaken away). The one file that does import
 * it is `webgpu/island-renderer.ts`, behind the `@ice/r3f/webgpu` subpath.
 *
 * Verified against three 0.185.1 in this worktree, not from the spike's notes:
 *
 *  - `WebGPUTextureUtils.js:422` stamps `textureData.textureDescriptorGPU`, and
 *    `:376` sets its `.format` from `getFormat(texture, device)` — so the format
 *    reported here is the format three ACTUALLY created, which is what the sRGB
 *    re-encode must be guarded on (design-012 §4 sRGB law). An `SRGBColorSpace`
 *    render target comes back `rgba8unorm-srgb`; the swap chain cannot be an
 *    `-srgb` format, so a compositor that assumes instead of asking reads
 *    washed out.
 *  - MSAA: `WebGPUUtils.js:127-128` sets `primarySamples = 1` for a multisampled
 *    render target, so `textureData.texture` is created single-sample (`:374`)
 *    and the multisampled surface is a SEPARATE `msaaTexture` (`:413-416`).
 *    `WebGPUBackend.js:672-688` then names the single-sample view as the pass's
 *    `resolveTarget`. The texture returned here is therefore always the
 *    resolved, directly-samplable image — never the multisampled one.
 *  - Usage (`:352-364`) always includes `COPY_SRC`, which is what lets a witness
 *    read an island target back with `copyTextureToBuffer` and no quad pass.
 */

/**
 * three's per-texture backend record. Every field is optional because the
 * record exists from the moment three first sees the texture, while the GPU
 * objects are allocated lazily on first render — reading before the first paint
 * is normal, not an error, and callers get `undefined` rather than a throw.
 */
export interface BackendTextureRecord {
  /** The resolved, single-sample, samplable image. See the header. */
  texture?: GPUTexture;
  /** Present only while the target is multisampled — the colour attachment. */
  msaaTexture?: GPUTexture;
  /** The descriptor three created `texture` from — the ACTUAL format lives here. */
  textureDescriptorGPU?: GPUTextureDescriptor;
  initialized?: boolean;
}

/** The slice of `WebGPUBackend` this module reads. */
export interface WebGpuBackendLike {
  readonly device?: GPUDevice;
  get(obj: object): BackendTextureRecord | undefined;
}

/**
 * The slice of `WebGPURenderer` this package reads. Structural so that
 * `gl-root` and the pool can be typed against a WebGPU renderer without
 * importing one — and so headless tests can hand in a plain object.
 */
export interface WebGpuRendererLike {
  readonly backend?: WebGpuBackendLike;
}

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
  return (renderer as WebGpuRendererLike | null)?.backend?.get(texture);
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
  return textureRecord(renderer, texture)?.texture;
}

/** The ACTUAL GPU format three created the resolve texture with. */
export function islandFormat(
  renderer: unknown,
  texture: RenderTargetTexture,
): GPUTextureFormat | undefined {
  return textureRecord(renderer, texture)?.textureDescriptorGPU?.format;
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
  return islandFormat(renderer, texture)?.endsWith("-srgb") ?? false;
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
  return textureRecord(renderer, texture)?.msaaTexture !== undefined;
}
