/**
 * The ground-pass contract (design-004 §1, as-built 2026-07-16: P0 is ONE
 * WebGPU canvas; passes are its draw layers).
 *
 * A pass owns a scene `object` (mesh/group with a TSL node material), arms its
 * own dirty observers, and rebuilds its geometry/uniforms in `collect` — PURE
 * world reads in the layer's SCREEN-px coordinate space (the ortho camera maps
 * CSS px → clip; world→screen goes through the kernel `worldToScreen` seam,
 * Law 13). Heavy per-pass math (tessellation, triangle-soup emission) lives in
 * sibling `*-collect.ts` modules that import ONLY core/kernel, so collectors
 * unit-test under happy-dom with no GPU and no three import.
 */
import type { World } from "@ice/core";
import type { Object3D } from "three/webgpu";

/** Per-flush frame facts every pass collects against. */
export interface GroundFrame {
  /** CSS-px viewport size. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Engine camera: world top-left + zoom (grid.ts P0 contract). */
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
}

export interface GroundPass {
  readonly name: string;
  /** The pass's scene object; the layer adds it once and disposes with the pass. */
  readonly object: Object3D;
  /**
   * Arm dirty observers on the world; `wake()` marks this pass for a
   * re-collect on the next flush. Camera/resize dirt is LAYER-owned (it wakes
   * every pass) — arm only pass-specific sources here. Returns unsubscribers.
   */
  arm(world: World, wake: () => void): Array<() => void>;
  /** Rebuild geometry/uniforms from the world (read-only; screen-px space). */
  collect(world: World, frame: GroundFrame): void;
  dispose(): void;
}
