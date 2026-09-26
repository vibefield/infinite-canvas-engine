/**
 * @ice/react — widget content layer: portals from one root + Tier-3 hooks.
 * Import wall: @ice/dom → @ice/core down only — never three/@react-three
 * (enforced). react/react-dom are peers.
 */
export const REACT_VERSION = "0.0.0";

export {
  WidgetHiddenContext,
  useBreakpoint,
  useSelected,
  useBehavior,
  useWidgetProps,
  useWorldComponent, ChromeOwnerContext, type ChromeOwner, useChromeOwner } from "./hooks";
export { WidgetRoot, type WidgetComponentProps, type WidgetHosts, type WidgetRootProps } from "./widget-root";

// M10 React facade (design-005 §5): engine context, commit seam, hooks, keymap,
// and the <InfiniteCanvas> mount.
export {
  EngineProvider,
  useCanvasEngine,
  useFrameFreeze,
  useOps,
  useStageHold,
  useWorld,
  type EngineProviderProps,
} from "./engine-context";
export { useCommit, useUndoStatus, type Commit, type UndoStatus } from "./use-commit";
export { WidgetPreview, type WidgetPreviewProps } from "./widget-preview";
export {
  getPreviewSnapshot,
  hasPreviewSnapshot,
  setPreviewSnapshot,
  subscribePreviewSnapshots,
  type PreviewImage,
} from "./preview-snapshots";
export { useTool, useToolState } from "./use-tool";
export {
  useCanvasCatalog,
  useCanvasDiagnostics,
  useCanvasTools,
  useCurrentCanvas,
  useFramePreview,
} from "./canvas-hooks";
export {
  FramePreviewBoundary,
  type FramePreviewBoundaryProps,
} from "./frame-preview-boundary";
export { usePresencePeers, type PresencePeerView } from "./use-presence";
export { attachKeymap, type KeymapEntry, nudgeSelection, toggleTape } from "./keymap";
export {
  defaultSelectionActions,
  placeSelectionMenu,
  SELECTION_GLYPHS,
  SELECTION_MENU,
  type SelectionAction,
  SelectionMenu,
  type SelectionMenuAnchor,
  type SelectionMenuBox,
  type SelectionMenuProps,
  type SelectionMenuSource,
  type SelectionState,
  selectionTaped,
} from "./selection-menu";
export {
  InfiniteCanvas,
  type GroundLayerFactory,
  type GroundLayerHandle,
  type InfiniteCanvasHandle,
  type InfiniteCanvasProps,
} from "./infinite-canvas";
// The mounted ground's CONTENT seam (design-013 §5/§6, B5): the residency a render
// reflector realises handles into, and the three render slots the composited profile
// forwards. Structural mirrors of `@ice/ground/compose` — react may not import ground, and
// `@ice/r3f` imports these rather than restating them.
export {
  SurfaceContentContext,
  surfaceContentOf,
  useSurfaceContent,
  type ContentRenderSlot,
  type ContentRenderSlots,
  type ContentSink,
  type SurfaceContent,
  type TextureDescription,
} from "./surface-content";

// Presentation profiles (design-012 §3). An app imports exactly ONE of these
// and passes it to <InfiniteCanvas profile={...}>; the other tree-shakes out of
// that app's bundle. Absent ⇒ stratified, so every existing app is untouched.
export type {
  PresentationProfile,
  PresentationProfileName,
  ProfileBootContext,
} from "./profiles/contract";
export { stratifiedProfile } from "./profiles/stratified";
export { compositedProfile } from "./profiles/composited";
