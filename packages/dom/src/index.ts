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
  type DomWidgetsOptions,
  type DomWidgetsReflector,
} from "./reflectors/dom-widgets";

// L1 — the composited profile's DOM interaction layer (design-012 §5). The
// source canvas takes its HiC calls by INJECTION: @ice/dom may not import
// @ice/ground, and @ice/ground's adapter is the only module allowed to name a
// HiC symbol. Both walls hold at once.
export {
  createSourceCanvas,
  type SourceCanvas,
  type SourceCanvasEffects,
  type SourceCanvasOptions,
} from "./source-canvas";
export {
  DEFAULT_PRESENTATION,
  createPresentationRegistry,
  type PresentationRegistry,
  type SurfacePresentation,
} from "./presentation-mode";
// The Q5 default as policy: live-dom at rest, composited on drag, with the
// demotion debounced by one settle window (design-012 §6.3, plan §2).
export {
  createPresentationPolicy,
  type PresentationPolicy,
  type PresentationPolicyOptions,
} from "./presentation-policy";
// The Widget Surface contract, answered once per presentation profile
// (design-012 §6; the S8 extraction).
export {
  compositedSurfaces,
  declaredPresentation,
  presentationPinned,
  stratifiedSurfaces,
  widgetPresentationPins,
  widgetSurfaceKind,
  type CompositedSurfacesOptions,
  type StratifiedSurfacesOptions,
  type WidgetSurfaceDemandSeam,
} from "./widget-surfaces";
export {
  createDomWritebackReflector,
  type DomWritebackHosts,
  type DomWritebackReflector,
} from "./reflectors/dom-writeback";

// The rAF frame loop (design-002 §1: the platform owns the loop).
export { startRafLoop } from "./loop";

// The L0 pointer adapter (design-003 §2–§3): DOM events → InputQueue, nothing more.
export { attachPointerAdapter, type GLRoute, type GLRouteVerdict, type PointerAdapterOpts } from "./pointer-adapter";

// Input-ownership predicates (design-007 §4, petitions I1/I4): the shared
// per-surface guard family — the keymap (@ice/react) reads these too.
export {
  CLAIM_OWNS_ESCAPE,
  KEYBOARD_CLAIM_ATTR,
  isEditableTarget,
  keyboardClaimOf,
  wheelCede,
  type KeyboardClaim,
} from "./input-ownership";

// The focus driver (design-007 §2.3–§2.5): click-to-focus acquisition for
// `keyboard: "exclusive"` widgets + the programmatic focusWidget/blurFocus
// handle. Focus is VIEW state (design-007 §2.6) — it lives here, not in core.
export {
  FOCUS_PROXY_ATTR,
  attachWidgetFocus,
  type FocusHostLookup,
  type WidgetFocusHandle,
} from "./widget-focus";

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
