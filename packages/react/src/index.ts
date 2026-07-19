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
  useWidgetProps,
  useWorldComponent,
} from "./hooks";
export { WidgetRoot, type WidgetComponentProps, type WidgetHosts, type WidgetRootProps } from "./widget-root";

// M10 React facade (design-005 §5): engine context, commit seam, hooks, keymap,
// and the <InfiniteCanvas> mount.
export {
  EngineProvider,
  useCanvasEngine,
  useOps,
  useStageHold,
  useWorld,
  type EngineProviderProps,
} from "./engine-context";
export { useCommit, useUndoStatus, type Commit, type UndoStatus } from "./use-commit";
export { useTool, useToolState } from "./use-tool";
export { usePresencePeers, type PresencePeerView } from "./use-presence";
export { attachKeymap, type KeymapEntry } from "./keymap";
export {
  InfiniteCanvas,
  type GroundLayerFactory,
  type GroundLayerHandle,
  type InfiniteCanvasHandle,
  type InfiniteCanvasProps,
} from "./infinite-canvas";
