/**
 * @ice/dom — SCREEN SPACE ONLY (design-015 §3, D-D15; D5b): the canvas host, the pointer
 * adapter (events → queue ONLY), the rAF loop, input ownership + the editor's focus, the OS
 * cursor + the room's remote cursors, and `createDeskHost` — the vanilla mount that takes the
 * desk as an opaque layer factory.
 * Import wall: @ice/core + @ice/kernel down only — never react/three/desk (enforced).
 *
 * GONE at D5b — the WORLD-SPACE half (design-015 §1): the content and lifted planes, the
 * plane-transform reflector, the DOM widget hosts + writeback, the L1 source canvas
 * (`layoutsubtree`), the Widget Surface contract, measurement, the graybox and the P4 chrome
 * reflectors, and the pointer adapter's GL route. No DOM under the camera (DK-D2).
 */
export const DOM_VERSION = "0.0.0";

// The canvas host (design-004 §1): the styled container — no planes.
export { createCanvasHost, type CanvasHost } from "./host";

// The vanilla mount (design-015 §3): the desk's layer, the adapters, the reflectors, the loop.
export {
  createDeskHost,
  type DeskHost,
  type DeskHostOptions,
  type LayerContext,
  type LayerFactory,
  type LayerHandle,
} from "./desk-host";

// The rAF frame loop (design-002 §1: the platform owns the loop).
export { startRafLoop } from "./loop";

// The L0 pointer adapter (design-003 §2–§3): DOM events → InputQueue, nothing more.
export { attachPointerAdapter } from "./pointer-adapter";

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

// The focus driver (design-007 §2.3–§2.5): click-to-focus acquisition for a
// keyboard-claiming host + the programmatic blurFocus/focusWidget handle.
// Focus is VIEW state (design-007 §2.6) — it lives here, not in core.
export {
  FOCUS_PROXY_ATTR,
  attachWidgetFocus,
  type FocusHostLookup,
  type WidgetFocusHandle,
} from "./widget-focus";

// L4 cursor projection output (design-003 §7: local cursor = OS cursor, one write).
export { createCursorReflector } from "./reflectors/cursor";
// P5 remote cursors (design-004 §1: screen-space pooled nodes; M9 presence) — a room's other people.
export { createRemoteCursorsReflector, type RemoteCursorsReflector } from "./reflectors/remote-cursors";
