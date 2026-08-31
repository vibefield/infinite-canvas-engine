/** Explicitly imported procedural line-grid GroundProgram. */
import type { GridConfig } from "@ice/core";
import { mergeGridConfig, resolveInitialGridConfig } from "../passes/grid-contract";
import type { GroundProgramDefinition } from "../program";
import { createLineGrid, type LineGridRenderer } from "./line-grid-renderer";

export interface LineGridGroundProgramOptions {
  readonly id: string;
  readonly grid?: Partial<GridConfig>;
}

export function lineGridGroundProgram(
  opts: LineGridGroundProgramOptions,
): GroundProgramDefinition {
  let config = resolveInitialGridConfig(opts.grid ?? {});
  const live = new Set<LineGridRenderer>();
  return {
    id: opts.id,
    transition: "procedural",
    sources: [],
    configureGrid(next) {
      config = mergeGridConfig(config, next);
      for (const renderer of live) renderer.configure(config);
    },
    create() {
      const renderer = createLineGrid(config);
      live.add(renderer);
      let disposed = false;
      return {
        object: renderer.mesh,
        activate: () => [],
        collect: (_input, frame, presentation) =>
          renderer.setCamera(frame, presentation.opacity),
        deactivate: () => {},
        estimateBytes: () => 4 * 1024,
        dispose() {
          if (disposed) return;
          disposed = true;
          live.delete(renderer);
          renderer.dispose();
        },
      };
    },
  };
}
