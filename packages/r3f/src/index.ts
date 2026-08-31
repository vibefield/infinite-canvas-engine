/**
 * @ice/r3f — R3F islands + the virtual-texture compositor (design-004 §3–4).
 * The ONLY package that touches three/@react-three (as peers). Top of the
 * chain: r3f → react → dom → core → kernel.
 */
export { createGLBridge, type GLBridge, type GLBridgeOpts, type IslandHandle, type IslandFrameCallback } from "./bridge";
export { createIslandStateStore, type IslandRenderState, type IslandStateStore, type PaintedAt } from "./island-state";
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
export {
  WebGpuRenderTargetPool,
  webGpuRenderTargetBytes,
  WEBGPU_ISLAND_SAMPLES,
  type WebGpuRenderTargetPoolOpts,
} from "./webgpu-pool";
export {
  createIslandSourceBinder,
  type GlSourcePoolLike,
  type IslandSourceBinder,
  type IslandSourceBinderOpts,
  type SourcesLike,
} from "./webgpu-sources";
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
export { GLViews, type CompositorBinding, type GLViewsProps, type GlFrameStats } from "./gl-root";
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
export {
  createRetainedQuadTransitionAdapter,
  type RetainedQuadPool,
  type RetainedQuadTransitionOptions,
} from "./retained-quads";
export { createRenderWriteTrap, type RenderWriteTrap } from "./dev-write-trap";
export {
  createGLPointerRouter,
  type GLPointerRouter,
  type GLPointerRouterDeps,
  type IslandPointerEvent,
} from "./gl-router";
export { captureWidgetPreviews, type CapturePreviewOpts } from "./preview-capture";
