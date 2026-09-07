/**
 * The one unsupported read, in the one place both sides of the wall can reach.
 *
 * The unified compositor needs the raw `GPUTexture` three resolved a render
 * target into, and three exposes no public accessor for it. The supported
 * route is `renderer.backend.get(renderTarget.texture)`, which returns the
 * backend's per-object record.
 *
 * S5 quarantined that read inside `@ice/r3f` for islands, correctly: one file
 * to fix when three moves the record. S6b needed the SAME read for ground's
 * offscreen target — and `ground` may not import `r3f`, nor `r3f` `ground` —
 * so rather than duplicate an unsupported read into a second package it landed
 * here: `core` is the one package both import, this file names no three symbol
 * (the shapes below are structural), and `core` already names `GPUTexture` for
 * the source registry.
 *
 * CONVERGED AT S8 (the naming pass's second ruling): r3f's `webgpu-backend.ts`
 * kept its ISLAND VOCABULARY (`islandTexture`, `islandIsSrgb`,
 * `islandIsMultisampled`, `hasWebGpuBackend`, `backendDevice`) and delegates
 * every record read here. The probes separated cleanly because each is a
 * question about an ISLAND — can this renderer host one, did that target get
 * its MSAA — and none of them is a question core has any business answering.
 *
 * ERRATA, design-013 C3 (2026-09-07): "one file changes across BOTH packages"
 * is a ONE-COPY claim now. The ground's own reason for this read is gone —
 * design-013 B8 deleted the offscreen target and the blit, C2 deleted three's
 * renderer from `@ice/ground` altogether, and C3 struck `three` from that
 * package's dependencies — so `packages/r3f/src/webgpu-backend.ts` is the sole
 * consumer of everything below. It stays HERE rather than moving back into r3f
 * because the shapes are structural and core is where `GPUTexture` already
 * lives; if that ever stops paying, moving it is a one-file change and this
 * paragraph is the record of why it did not happen at the cut.
 *
 * Verified against three 0.185.1: `WebGPUTextureUtils.js:422` stamps
 * `textureData.textureDescriptorGPU` and `:376` sets its `.format` from
 * `getFormat(...)`, so the format reported is the one three ACTUALLY created —
 * which is what an sRGB guard must be read from. For a multisampled target
 * `WebGPUUtils.js:127-128` sets `primarySamples = 1`, so `.texture` is the
 * RESOLVED single-sample image and the multisampled surface is a separate
 * `msaaTexture`; the texture returned here is always directly samplable.
 */

/** three's per-texture backend record — every field optional, see below. */
export interface BackendTextureRecord {
  /** The resolved, single-sample, samplable image. */
  texture?: GPUTexture;
  /** Present only while the target is multisampled — the colour attachment. */
  msaaTexture?: GPUTexture;
  /** The descriptor three created `texture` from — the ACTUAL format. */
  textureDescriptorGPU?: { format?: GPUTextureFormat };
}

/** The slice of three's WebGPU backend this reads. Structural, not imported. */
export interface BackendLike {
  readonly device?: GPUDevice;
  get(obj: object): BackendTextureRecord | undefined;
}

/** The slice of a three renderer this reads. */
export interface RendererWithBackend {
  readonly backend?: BackendLike;
}

/**
 * The backend record for a render target's texture.
 *
 * Every field is optional because the record exists from the moment three
 * first sees the texture, while the GPU objects are allocated lazily on first
 * render — reading before the first paint is NORMAL, not an error, and callers
 * get `undefined` rather than a throw.
 */
export function backendTextureRecord(
  renderer: unknown,
  texture: object,
): BackendTextureRecord | undefined {
  return (renderer as RendererWithBackend | null)?.backend?.get(texture);
}

/**
 * The raw resolved `GPUTexture` for a render target's texture, or `undefined`
 * until three has rendered into it at least once.
 *
 * Consumers hold a GETTER over this rather than the value: a resize
 * reallocates the target, and a captured handle is then a frame of the wrong
 * pixels with nothing to catch it.
 */
export function backendTexture(renderer: unknown, texture: object): GPUTexture | undefined {
  return backendTextureRecord(renderer, texture)?.texture;
}

/**
 * Does this target's ACTUAL format carry an sRGB view — i.e. does sampling it
 * auto-decode to linear, so a non-sRGB swap chain needs the re-encode?
 *
 * Asked of the FORMAT, never of the colour space anyone requested: the two
 * agree today, and the guard exists for the day they do not.
 */
export function backendTextureIsSrgb(renderer: unknown, texture: object): boolean {
  return backendTextureRecord(renderer, texture)?.textureDescriptorGPU?.format?.endsWith("-srgb") ?? false;
}
