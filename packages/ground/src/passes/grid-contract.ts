/**
 * Shared contract for build-time-selectable grid implementations.
 *
 * Both classic and magnet factories accept the same config and dependency
 * shape. `grid.ts` wires exactly one factory into the production entry graph,
 * so selecting an implementation is an import change, never a runtime mode.
 */
import { DEFAULT_GRID_CONFIG, type GridConfig } from "@ice/core";
import type { GroundPass } from "../pass";
import type { PoleSource } from "../poles";
import type { ReadSpatial } from "./magnet-collect";

export interface GridPass extends GroundPass {
  /** Live re-tune (the react `grid` prop seam) — partial merge over current values. */
  configure(cfg: Partial<GridConfig>): void;
}

/**
 * Superset of implementation dependencies. Classic deliberately ignores
 * these; magnet consumes them. Keeping one signature makes the wired factory
 * interchangeable without changing its parent.
 */
export interface GridPassDeps {
  readonly poles?: readonly PoleSource[];
  readonly readSpatial?: ReadSpatial;
}

export type GridPassFactory = (initial?: Partial<GridConfig>, deps?: GridPassDeps) => GridPass;

/** Shallow grid merge + one-level merge of the optional magnet tuning block. */
export function mergeGridConfig(base: GridConfig, next: Partial<GridConfig>): GridConfig {
  const merged: GridConfig = { ...base, ...next };
  if (next.magnet !== undefined) merged.magnet = { ...base.magnet, ...next.magnet };
  return merged;
}

export function resolveInitialGridConfig(initial: Partial<GridConfig>): GridConfig {
  return mergeGridConfig(DEFAULT_GRID_CONFIG, initial);
}
