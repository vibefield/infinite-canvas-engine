/**
 * @ice/react — the React face of the desk (design-015 §3): `<Desk>` (wraps `@ice/dom`'s
 * `createDeskHost`), EngineProvider + the Tier-3 hooks, the keymap, the screen-space selection
 * menu and held bar. Renderer-free: the desk arrives as an opaque layer factory.
 * Import wall: @ice/dom → @ice/core down only — never three/desk (enforced). react/react-dom are peers.
 *
 * GONE at D5b (design-015 §1): `<InfiniteCanvas>` (→ `<Desk>`), `WidgetRoot` and the portals,
 * `WidgetPreview` + the preview snapshots, the surface content seam, the two presentation
 * profiles, `ChromeOwnerContext` and `WidgetHiddenContext`. One presentation (DK-D8).
 */
export const REACT_VERSION = "0.0.0";

export { useBreakpoint, useSelected, useBehavior, useWidgetProps, useWorldComponent } from "./hooks";

// M10 React facade (design-005 §5): engine context, commit seam, hooks, keymap,
// and the <Desk> mount.
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
export { attachKeymap, type KeymapEntry, nudgeSelection, toggleTape, unlessInert } from "./keymap";
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
  type SelectionGlyph,
  type SelectionMenuAct,
  type SelectionMenuTool,
  type SelectionState,
  selectionTaped,
} from "./selection-menu";
export { Desk, type DeskHandle, type DeskProps } from "./desk";
// The layer seam, re-exported so an app types its factory wrapper without naming @ice/dom.
export type { LayerContext, LayerFactory, LayerHandle } from "@ice/dom";
