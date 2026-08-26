/**
 * Classic analytic grid as a complete GridPass implementation.
 *
 * This module is intentionally not imported by the production wiring. It
 * remains independently typechecked and can replace the magnet factory by
 * changing the single re-export in `grid.ts`.
 */
import { createClassicGrid } from "./grid-classic";
import {
  mergeGridConfig,
  resolveInitialGridConfig,
  type GridPassFactory,
} from "./grid-contract";

export const createGridPass: GridPassFactory = (initial = {}, _deps = {}) => {
  let cfg = resolveInitialGridConfig(initial);
  const renderer = createClassicGrid(cfg);

  return {
    name: "grid",
    object: renderer.mesh,
    arm() {
      return [];
    },
    collect(_world, frame) {
      renderer.setCamera(frame);
    },
    configure(next) {
      cfg = mergeGridConfig(cfg, next);
      renderer.configure(cfg);
    },
    dispose() {
      renderer.dispose();
    },
  };
};
