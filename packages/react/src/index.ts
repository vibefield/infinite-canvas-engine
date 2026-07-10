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
