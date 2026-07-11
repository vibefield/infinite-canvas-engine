/**
 * Live-tunable settings resources (design-005 §4 engine facade surface;
 * design-003 §4.2 kind table + §3 L1 targeting).
 *
 * These are the live-tunable mirrors of the compile-time defaults in
 * `../settings/defaults` — systems read the RESOURCE first, falling back to
 * the constant, but that read-path wiring happens at integration, not here.
 * Defaults are sourced from `GESTURE_DEFAULTS`/`POINTER_DEFAULTS`, never
 * inlined (the `SnapConfig`-reads-`SNAP_DEFAULTS` pattern in camera-derived.ts
 * exists because an inline-number drift bug shipped once).
 */
import { field } from "@vibecook/strata-ecs";
import { defineResource } from "../schema/meta";
import { CAMERA_DEFAULTS, GESTURE_DEFAULTS, POINTER_DEFAULTS } from "../settings/defaults";

/** Recognizer timing/slop live mirror (design-003 §4.2 kind table; inertia constants §5 item 9). */
export const GestureSettings = defineResource("GestureSettings", {
  tapMaxMs: field("f32", { default: GESTURE_DEFAULTS.tapMaxMs }),
  tapSlopPx: field("f32", { default: GESTURE_DEFAULTS.tapSlopPx }),
  longPressMs: field("f32", { default: GESTURE_DEFAULTS.longPressMs }),
  longPressSlopPx: field("f32", { default: GESTURE_DEFAULTS.longPressSlopPx }),
  dragSlopPx: field("f32", { default: GESTURE_DEFAULTS.dragSlopPx }),
  pinchSlopPx: field("f32", { default: GESTURE_DEFAULTS.pinchSlopPx }),
  wheelEndSilenceMs: field("f32", { default: GESTURE_DEFAULTS.wheelEndSilenceMs }),
  inertiaMinVelocityPxPerS: field("f32", { default: GESTURE_DEFAULTS.inertiaMinVelocityPxPerS }),
  inertiaDecayMs: field("f32", { default: GESTURE_DEFAULTS.inertiaDecayMs }),
  multiTapWindowMs: field("f32", { default: GESTURE_DEFAULTS.multiTapWindowMs }),
  multiTapSlopPx: field("f32", { default: GESTURE_DEFAULTS.multiTapSlopPx }),
});

/** Pick radii + retarget dead-band live mirror (design-003 §3 L1 targeting). */
export const PointerSettings = defineResource("PointerSettings", {
  radiusMousePx: field("f32", { default: POINTER_DEFAULTS.radiusMousePx }),
  radiusTouchPx: field("f32", { default: POINTER_DEFAULTS.radiusTouchPx }),
  radiusPenPx: field("f32", { default: POINTER_DEFAULTS.radiusPenPx }),
  hoverReleaseDeadBandPx: field("f32", { default: POINTER_DEFAULTS.hoverReleaseDeadBandPx }),
});

/** Zoom clamp live mirror (design-005 §4 `settings.zoom`; camera-sim consumes). */
export const CameraLimits = defineResource("CameraLimits", {
  minZoom: field("f32", { default: CAMERA_DEFAULTS.minZoom }),
  maxZoom: field("f32", { default: CAMERA_DEFAULTS.maxZoom }),
});
