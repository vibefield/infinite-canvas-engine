/**
 * Wires pass — the three-side wrapper over the pure `collectWires` (renders
 * above the grid, below the guides, matching the old P0 canvas order).
 * Dirt mirrors the old 2D reflector's observers; the connect preview rides
 * `[RoutedConnect, Drag]` value dirt (the buffer updates exactly when the
 * connect recognizer's Drag advances) instead of a per-frame value diff.
 */
import {
  DEFAULT_WIRES_CONFIG,
  Drag,
  MeasuredSize,
  PortAnchor,
  Position,
  Size,
  type WirePreviewBuffer,
  type WiresConfig,
  type World,
} from "@ice/core";
import type { GroundFrame, GroundPass } from "../pass";
import { createSoupMesh } from "./soup-mesh";
import {
  collectWires,
  connectDragQ,
  geometryQ,
  measuredQ,
  portQ,
  routedConnectQ,
  selectedQ,
  wireQ,
} from "./wires-collect";

export function createWiresPass(
  initial: Partial<WiresConfig> = {},
  readPreview?: () => WirePreviewBuffer,
): GroundPass {
  const config: WiresConfig = { ...DEFAULT_WIRES_CONFIG, ...initial };
  const soup = createSoupMesh(1);

  return {
    name: "wires",
    object: soup.mesh,
    arm(world: World, wake: () => void) {
      return [
        world.reactive.observeQuery(wireQ, wake, { cols: [] }),
        world.reactive.observeQuery(geometryQ, wake, { cols: [Position, Size] }),
        // MeasuredSize rides its own observer (readRect prefers it over Size):
        // in geometryQ's cols it would REQUIRE the rider and drop plain widgets.
        world.reactive.observeQuery(measuredQ, wake, { cols: [MeasuredSize] }),
        world.reactive.observeQuery(selectedQ, wake, { cols: [] }),
        world.reactive.observeQuery(portQ, wake, { cols: [PortAnchor] }),
        world.reactive.observeQuery(routedConnectQ, wake, { cols: [] }),
        world.reactive.observeQuery(connectDragQ, wake, { cols: [Drag] }),
      ];
    },
    collect(world: World, frame: GroundFrame) {
      soup.update(collectWires(world, frame, config, readPreview?.()));
    },
    dispose() {
      soup.dispose();
    },
  };
}
