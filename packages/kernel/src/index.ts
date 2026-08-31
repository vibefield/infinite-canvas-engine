/**
 * @ice/kernel — pure math. Plain structs in, plain structs out.
 * Import wall: nothing but `rbush` (named exception — zero-dep R-tree).
 */
export const KERNEL_VERSION = "0.0.0";

export * from "./shapes";
export * from "./coords";
export * from "./snap";
export * from "./spatial-index";
export * from "./zoom-bands";
export * from "./eviction";
export * from "./anchors";
export * from "./bezier";
export * from "./easing";
export * from "./nav-flight";
export * from "./layout";
export * from "./atlas-pack";

// The lift: ONE curve and ONE duration for every surface, so the composited
// profile cannot drift from the DOM transition it replaces (design-012 §7).
export { FADE_EASE, LIFT_DURATION_MS, LIFT_EASE, easedValue } from "./lift";
