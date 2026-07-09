/**
 * @ice/dom — DOM planes, pointer adapters (events→queue ONLY), built-in DOM reflectors.
 * Import wall: @ice/core + @ice/kernel down only — never react/three (enforced).
 */
export const DOM_VERSION = "0.0.0";

// The canvas host (design-004 §1; M3: one content plane).
export { createCanvasHost, type CanvasHost } from "./host";

// Built-in DOM reflectors (design-002 §5, post-notify output only).
export { createPlaneTransformReflector } from "./reflectors/plane-transform";
export { createGrayboxReflector } from "./reflectors/graybox";

// The rAF frame loop (design-002 §1: the platform owns the loop).
export { startRafLoop } from "./loop";

// TEMPORARY M3-demo pan/zoom adapter — replaced by M4's L0 interaction stack.
export { attachDemoPanZoom } from "./demo-input";
