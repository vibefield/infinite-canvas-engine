/**
 * ONE island render target, and what it costs — the recipe both legs mint
 * from.
 *
 * Extracted from `webgpu-pool.ts` at B5 (design-013 §8) rather than imported
 * out of it: the pool is on §10.8's deletion list and IslandRender must not
 * hold an edge into something B8 deletes, while the target's shape — 4×
 * MSAA, a depth buffer, no stencil, an sRGB REQUEST — is exactly what the two
 * legs must agree on. So the recipe moves down here and the pool calls it.
 * Nothing else changes: the constants and the allocation model are the same
 * numbers, in one place.
 *
 * `RenderTarget` comes from the `three` ROOT entry (`Three.Core.js`), not from
 * `three/webgpu`: it is the backend-neutral base class, so this file adds no
 * `three/webgpu` edge to the module graph (three declares
 * `sideEffects: ["./src/nodes/**\/*"]`, so such an import is not tree-shaken
 * and would push the node material system into every stratified bundle).
 */
import { RenderTarget, SRGBColorSpace } from "three";

/**
 * MSAA sample count inside island targets — the same 4 the WebGL pool uses.
 *
 * design-012 §4: "MSAA lives inside island render targets only", and the
 * compositor target itself stays MSAA-free (its quad edges are analytic
 * rounded-rect AA, and the ground lattice is smoothstepped). So this number is
 * the ONLY MSAA in the composited profile — old leg and new — which is why
 * `acquireCompositorDevice`'s rule 1 (never ask for a compatibility adapter)
 * is load-bearing rather than defensive: on a compatibility device three sets
 * `renderer._samples = 0` and this 4 silently becomes 1.
 */
export const WEBGPU_ISLAND_SAMPLES = 4;

/**
 * GPU bytes for one WebGPU island target.
 *
 * Same three-surface allocation model as the WebGL pool, re-derived against
 * what three actually creates rather than carried over on faith:
 *   - the resolve texture, single-sample (`WebGPUTextureUtils.js:374` with
 *     `primarySamples = 1` from `WebGPUUtils.js:128`) — 4 bytes/px;
 *   - `msaaTexture` at `sampleCount = samples` (`:413-416`) — 4 × samples;
 *   - the depth texture, also multisampled — 4 × samples.
 * At 4 samples that is 4 + 16 + 16 = 36 bytes/px, identical to the WebGL
 * figure, so the two profiles are graded against the same budget and a
 * cross-profile memory comparison stays honest.
 */
export function webGpuRenderTargetBytes(pixelWidth: number, pixelHeight: number): number {
  const msaa = WEBGPU_ISLAND_SAMPLES > 1;
  const colorBytes = 4 * (msaa ? 1 + WEBGPU_ISLAND_SAMPLES : 1);
  const depthBytes = 4 * (msaa ? WEBGPU_ISLAND_SAMPLES : 1);
  return pixelWidth * pixelHeight * (colorBytes + depthBytes);
}

/**
 * Mint one island target at a size already in DEVICE px.
 *
 * Declaring the colour space is what makes three's materials sRGB-ENCODE on
 * write, so the target holds display-ready values. The consequence is the sRGB
 * law (design-012 §4): three backs an `SRGBColorSpace` target with an `-srgb`
 * GPU format, whose sampler DECODES to linear on read, while the surface being
 * composited onto cannot be `-srgb`. So the compose MUST re-encode — guarded
 * by the format a reader gets back (`islandIsSrgb`, or the ground residency's
 * own read of `GPUTexture.format`), never by this line, because THIS LINE IS A
 * REQUEST AND THAT ONE IS THE ANSWER.
 */
export function createIslandTarget(
  pixelWidth: number,
  pixelHeight: number,
  label: string,
): RenderTarget {
  const rt = new RenderTarget(pixelWidth, pixelHeight, {
    samples: WEBGPU_ISLAND_SAMPLES,
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = SRGBColorSpace;
  rt.texture.name = label;
  return rt;
}
