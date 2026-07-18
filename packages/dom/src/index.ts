/**
 * @ice/dom — DOM planes, pointer adapters (events→queue ONLY), built-in DOM reflectors.
 * Import wall: @ice/core + @ice/kernel down only — never react/three (enforced).
 */
export const DOM_VERSION = "0.0.0";

// The canvas host (design-004 §1; M3: one content plane).
export { createCanvasHost, type CanvasHost } from "./host";

// The lifted plane (design-004 §1, P3 — M6): host + lifted for drag-promote.
export { createPlanes, type Planes } from "./planes";

// Built-in DOM reflectors (design-002 §5, post-notify output only).
export { createPlaneTransformReflector, type CameraPlanes } from "./reflectors/plane-transform";
export { createGrayboxReflector } from "./reflectors/graybox";

// The DOM widget host layer (design-004 §2): host divs reconciled against the
// engine mount store; React portals target each host's content element.
export {
  createDomWidgetsReflector,
  type DomWidgetsHost,
  type DomWidgetsReflector,
} from "./reflectors/dom-widgets";

// The rAF frame loop (design-002 §1: the platform owns the loop).
export { startRafLoop } from "./loop";

// The L0 pointer adapter (design-003 §2–§3): DOM events → InputQueue, nothing more.
export { attachPointerAdapter, type GLRoute, type GLRouteVerdict, type PointerAdapterOpts } from "./pointer-adapter";

// L4 cursor projection output (design-003 §7: local cursor = OS cursor, one write).
export { createCursorReflector } from "./reflectors/cursor";
// P5 remote cursors (design-004 §1: screen-space pooled nodes; M9 presence).
export { createRemoteCursorsReflector, type RemoteCursorsReflector } from "./reflectors/remote-cursors";

// The P0 ground layer (grid, wires, snap guides) moved to @ice/ground
// (2026-07-16: one WebGPU canvas, TSL passes — design-004 §1 as-built
// amendment). @ice/dom has no ground code; configs live in @ice/core.

// M6 chrome plane reflector (P4) + measurement adapter (design-004 §2 measure, §5 chrome).
export { createChromeReflector } from "./reflectors/chrome";
export { attachMeasureAdapter, type MeasureAdapter } from "./measure-adapter";
// M6 measurement wiring: mount-store → observe/unobserve + reconnect-on-show (design-004 §2).
export { wireMeasurement, type MeasureWiringHosts, type MeasureWiringOpts } from "./measure-wiring";
