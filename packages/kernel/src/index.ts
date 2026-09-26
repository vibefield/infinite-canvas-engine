/**
 * @ice/kernel — pure math. Plain structs in, plain structs out.
 * Import wall: nothing but `rbush` (named exception — zero-dep R-tree).
 */
export const KERNEL_VERSION = "0.0.0";

export * from "./shapes";
export * from "./coords";
export * from "./snap";
export * from "./spatial-index";
export * from "./anchors";
export * from "./bezier";
export * from "./easing";
export * from "./nav-flight";
export * from "./layout";
// PARKED (design-015 §1, D5b): the shelf packer's one reader was core's residency layer
// allocator, deleted with the surface infra. Kept, unread, for an image or text atlas.
export * from "./atlas-pack";

// Gone at design-015 D5b with the HiC/island sizing they served: `surface-geometry` (the copy
// size / slot size / uv numerator call), `zoom-bands` (island FBO bands), `eviction` (the island
// FBO pool), `lift` (the DOM/GL lift lockstep) and coords' island helpers (`worldToIsland`,
// `islandToWorld`, `compositeCameraFrustum`, `worldRectToComposite`).
