/**
 * Snap-guides pass — the three-side wrapper over the pure `collectGuides`
 * (renders ABOVE grid and wires within the ground canvas, matching the old
 * P0 stacking order).
 */
import { GuideLine, SpacingBar, type World } from "@ice/core";
import { DEFAULT_SNAP_GUIDES_CONFIG, type SnapGuidesConfig } from "@ice/core";
import type { GroundFrame, GroundPass } from "../pass";
import { barQ, collectGuides, guideQ } from "./guides-collect";
import { createSoupMesh } from "./soup-mesh";

export function createGuidesPass(initial: Partial<SnapGuidesConfig> = {}): GroundPass {
  const config: SnapGuidesConfig = { ...DEFAULT_SNAP_GUIDES_CONFIG, ...initial };
  const soup = createSoupMesh(2);

  return {
    name: "snap-guides",
    object: soup.mesh,
    arm(world: World, wake: () => void) {
      return [
        world.reactive.observeQuery(guideQ, wake, { cols: [GuideLine] }),
        world.reactive.observeQuery(barQ, wake, { cols: [SpacingBar] }),
      ];
    },
    collect(world: World, frame: GroundFrame) {
      soup.update(collectGuides(world, frame, config));
    },
    dispose() {
      soup.dispose();
    },
  };
}
