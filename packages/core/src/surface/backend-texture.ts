/**
 * The one unsupported read, in the one place both sides of the wall can reach.
 *
 * The unified compositor needs the raw `GPUTexture` three resolved a render
 * target into, and three exposes no public accessor for it. The supported
 * route is `renderer.backend.get(renderTarget.texture)`, which returns the
 * backend's per-object record.
 *
 * S5 quarantined that read inside `@ice/r3f` for islands, correctly: one file
 * to fix when three moves the record. S6b needs the SAME read for ground's
 * offscreen target — and `ground` may not import `r3f`, nor `r3f` `ground`.
 * Duplicating an unsupported read into a second package is how it becomes
 * three copies, so it lands here instead: `core` is the one package both
 * import, this file names no three symbol (the shapes below are structural),
 * and `core` already names `GPUTexture` for the source registry.
 *
 * r3f's `webgpu-backend.ts` still carries its own copy from S5, with the
 * island-specific probes (MSAA, sRGB) built on it. Converging the two is a
 * naming-pass question for S8, not a reason to churn a landed slice now.
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
