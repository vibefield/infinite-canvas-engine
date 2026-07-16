/**
 * Runtime default constants transcribed from the reviewed design docs.
 * Not exported from the package barrel yet (design-005 §4 engine facade wires these in later).
 */

/** Recognizer timing/slop defaults (design-003 §4.2 kind table; inertia constants from §5 item 9; multi-tap from v2 gesture.ts). */
export const GESTURE_DEFAULTS = {
  tapMaxMs: 250,
  tapSlopPx: 8,
  longPressMs: 500,
  longPressSlopPx: 10,
  dragSlopPx: 10,
  pinchSlopPx: 6,
  wheelEndSilenceMs: 150,
  inertiaMinVelocityPxPerS: 120,
  inertiaDecayMs: 325,
  multiTapWindowMs: 280,
  multiTapSlopPx: 20,
  // Wheel/pinch zoom speed — the v2 prototype curve (gesture.ts:444-449),
  // adopted 2026-07-13: factor = 2^(−clamp(Δ, ±maxStep) · sensitivity).
  // The CLAMP is the load-bearing half: a trackpad pinch sends tiny frequent
  // deltas (~0.5–3) while a mouse notch sends ~100 — capping the per-frame
  // step at ±10 makes one notch ≈ one strong pinch frame (×2^0.1 ≈ 1.07),
  // so both devices share one feel.
  wheelZoomSensitivity: 0.01,
  wheelZoomMaxStep: 10,
} as const;

/** Pick radii + retarget dead-band (design-003 §3 L1 targeting). */
export const POINTER_DEFAULTS = {
  radiusMousePx: 0,
  radiusTouchPx: 12,
  radiusPenPx: 4,
  hoverReleaseDeadBandPx: 4,
} as const;

/**
 * Wire/port picking geometry (design-003 §3 wires-below-widgets; design-004 §6).
 * `wirePickSlopPx` is added to the pointer radius (screen px, `/zoom` at use) so a
 * thin bezier stays grab-able; `portIndexHalfWorld` is the half-extent of the tiny
 * world AABB a materialized port occupies in the spatial index (design-004 §6 —
 * ports are pickable but carry no Position/Size, so spatialSync never sees them).
 */
export const GRAPH_PICK_DEFAULTS = {
  wirePickSlopPx: 8,
  portIndexHalfWorld: 6,
} as const;

/** SnapConfig resource defaults (design-005 §4 engine facade). */
export const SNAP_DEFAULTS = {
  enabled: true,
  thresholdPx: 5,
} as const;

/** Zoom clamp (design-003 §5 item 9 cameraControl) and frame dt clamp (design-002 §1). */
export const CAMERA_DEFAULTS = {
  minZoom: 0.1,
  maxZoom: 5,
  dtClampMs: 64,
} as const;

/**
 * Nav-transition motion constants (design-006 §4/§5, tuned in the approved
 * 2026-07-15 mock). `responseMs` is the critically-damped spring response for
 * ENTER; exit runs at `exitResponseFactor ×` (returning is lighter). Response
 * scales `durationPerOctave` per zoom-octave beyond `baseOctaves` (Apple's
 * duration-with-distance). Beyond `freezeOctaves` a flight cannot be presented
 * geometrically (Chromium raster-scale swing — design-006 §5): the start depth
 * caps at `capFactor ×` arrival and the transition presents as a crossfade.
 */
export const NAV_TRANSITION_DEFAULTS = {
  responseMs: 420,
  exitResponseFactor: 0.8,
  durationPerOctave: 0.12,
  baseOctaves: 3.5,
  freezeOctaves: 4.2,
  capFactor: 10,
  settleP: 0.999,
  settleV: 0.02,
} as const;

/** Widget/FBO/port budgets (design-004 §2 host pipeline, §3 FBO pool, §6 port materialization; ported into design-005 §4 engine facade). */
export const RUNTIME_BUDGETS = {
  keepMountedWidgets: 256,
  fboBytes: 268_435_456,
  portSpawnPerFrame: 64,
  portLightUpRadiusPx: 600,
  portReapGraceMs: 1000,
  cullOverscanWorldPerZoom: 200,
} as const;
