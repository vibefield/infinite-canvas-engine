import type { PresentationTransitionAdapter } from "@ice/core";

/**
 * The `gl` presentation plane's adapter (design-006 §9): prepared the moment it is asked, with no
 * outgoing visual of its own. The facade requires the plane for every mounted GL widget, so a
 * cross-type enter with any island on the board is gated to a SNAP until someone owns it — B8
 * deleted the retained-quad adapter that did, on the stratified profile, and the composited
 * profile never had one (B9 review blocker 5). `GLViews` registers it on both profiles: under
 * `composited` the ground's departed slot draws the islands from the residency; under
 * `stratified` the islands cut at the switch (their outgoing-quad transition is owed).
 */
export const GL_PLANE_ADAPTER: PresentationTransitionAdapter = Object.freeze({
  id: "@ice/r3f/gl",
  plane: "gl",
  prepare: () => null,
});
