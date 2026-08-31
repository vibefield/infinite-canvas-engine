/** Explicitly imported procedural dot-grid GroundProgram. */
import type { GridConfig } from "@ice/core";
import type { ClassicGridRenderer } from "../passes/grid-classic";
import { createClassicGrid } from "../passes/grid-classic";
import { mergeGridConfig, resolveInitialGridConfig } from "../passes/grid-contract";
import type { GroundProgramDefinition } from "../program";

export interface DotGridGroundProgramOptions {
  readonly id: string;
  readonly grid?: Partial<GridConfig>;
}

export function dotGridGroundProgram(
  opts: DotGridGroundProgramOptions,
): GroundProgramDefinition {
  let config = resolveInitialGridConfig(opts.grid ?? {});
  const live = new Set<ClassicGridRenderer>();
  return {
    id: opts.id,
    transition: "procedural",
    sources: [],
    configureGrid(next) {
      config = mergeGridConfig(config, next);
      for (const renderer of live) renderer.configure(config);
    },
    create() {
      const renderer = createClassicGrid(config);
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
