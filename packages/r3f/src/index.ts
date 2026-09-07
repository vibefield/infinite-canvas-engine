/**
 * @ice/r3f — R3F islands + the virtual-texture compositor (design-004 §3–4).
 * The ONLY package that touches three/@react-three (as peers). Top of the
 * chain: r3f → react → dom → core → kernel.
 */
export { createGLBridge, type GLBridge, type GLBridgeOpts, type IslandHandle, type IslandFrameCallback } from "./bridge";
export {
  createIslandStateStore,
  islandPaintable,
  type IslandPaintContext,
  type IslandPaintFacts,
  type IslandRenderState,
  type IslandStateStore,
  type PaintedAt,
} from "./island-state";
export {
  runCompositorPass,
  type CompCameraLike,
  type GlLike,
  type IslandCameraLike,
  type PassContext,
  type PassStats,
  type PoolLike,
  type QuadLike,
  type QuadsLike,
  type TargetLike,
} from "./compositor-pass";
// The composited profile's r3f half (design-012 §4 "island (gl)"). None of
// these import `three/webgpu` — they read three's backend structurally — so the
// barrel stays safe for stratified apps. THE INCANTATION itself
// (`WebGPURenderer({ device })`) is the one thing that does, and it lives
// behind the `@ice/r3f/webgpu` subpath instead. See src/webgpu/index.ts.
// The island TARGET (design-013 §8 B5): the pool that owned it — the old
// composited leg's `WebGpuRenderTargetPool` — is deleted at B8; a target is
// minted per handle by IslandRender now, and Residency owns its lifetime.
export { createIslandTarget, webGpuRenderTargetBytes, WEBGPU_ISLAND_SAMPLES } from "./island-target";
// design-013 §8 B5: the composited leg's island half — a reflector in the ground's
// `renders.island` slot, rendering into the PRIVATE target Residency named.
export {
  createIslandRender,
  type IslandGlLike,
  type IslandRender,
  type IslandRenderOpts,
  type IslandRenderStats,
} from "./island-render";
export {
  backendDevice,
  hasWebGpuBackend,
  islandFormat,
  islandIsMultisampled,
  islandIsSrgb,
  islandTexture,
  textureRecord,
  type BackendTextureRecord,
  type RenderTargetTexture,
  type WebGpuBackendLike,
  type WebGpuRendererLike,
} from "./webgpu-backend";
export { GLViews, type GLViewsProps, type GlFrameStats } from "./gl-root";
export { Island, type IslandProps } from "./island";
export {
  IslandContext,
  useIslandContext,
  useIslandFrame,
  useIslandInvalidate,
  useIslandLift,
  useIslandOpacity,
  type IslandContextValue,
} from "./use-island-frame";
export {
  RenderTargetPool,
  renderTargetBytes,
  type PoolEntryInfo,
  type PoolPin,
} from "./pool";
export { ResourceRegistry } from "./resource-registry";
export { CompositeMaterial } from "./composite-material";
export { createRenderWriteTrap, type RenderWriteTrap } from "./dev-write-trap";
export {
  createGLPointerRouter,
  type GLPointerRouter,
  type GLPointerRouterDeps,
  type IslandPointerEvent,
} from "./gl-router";
export { captureWidgetPreviews, type CapturePreviewOpts } from "./preview-capture";
