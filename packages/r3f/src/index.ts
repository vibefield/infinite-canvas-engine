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
export { GLViews, type GLViewsProps } from "./gl-root";
export { Island, type IslandProps } from "./island";
export {
  IslandContext,
  useIslandContext,
  useIslandFrame,
  useIslandInvalidate,
  useIslandLift,
  type IslandContextValue,
} from "./use-island-frame";
export { RenderTargetPool, type PoolEntryInfo } from "./pool";
export { ResourceRegistry } from "./resource-registry";
export { CompositeMaterial } from "./composite-material";
export { createRenderWriteTrap, type RenderWriteTrap } from "./dev-write-trap";
export {
  createGLPointerRouter,
  type GLPointerRouter,
  type GLPointerRouterDeps,
  type IslandPointerEvent,
} from "./gl-router";
