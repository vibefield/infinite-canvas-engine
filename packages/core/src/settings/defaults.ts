/**
 * Runtime default constants transcribed from the reviewed design docs.
 * Not exported from the package barrel yet (design-005 §4 engine facade wires these in later).
 */

/** Recognizer timing/slop defaults (design-003 §4.2 kind table; inertia constants from §5 item 9). */
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

/** Widget/FBO/port budgets (design-004 §2 host pipeline, §3 FBO pool, §6 port materialization; ported into design-005 §4 engine facade). */
export const RUNTIME_BUDGETS = {
  keepMountedWidgets: 256,
  fboBytes: 268_435_456,
  portSpawnPerFrame: 64,
  portLightUpRadiusPx: 600,
  portReapGraceMs: 1000,
  cullOverscanWorldPerZoom: 200,
} as const;
