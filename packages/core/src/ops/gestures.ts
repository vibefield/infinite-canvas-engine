/**
 * Gesture ops — app-handler write paths (design-003 §2/§8).
 *
 * `cancelActiveGestures` sets the ONE-TICK CancelRequest resource: escape, tool
 * switch, and doc detach all converge here; the ctl:spawn sweep transitions
 * every non-terminal recognizer → Cancelled next tick, behaviors restore from
 * riders, and cleanup clears the flag.
 */
import type { World } from "@vibecook/strata-ecs";
import { CancelRequest } from "../catalog";

export function cancelActiveGestures(world: World): void {
  world.setResource(CancelRequest, { active: true });
}
