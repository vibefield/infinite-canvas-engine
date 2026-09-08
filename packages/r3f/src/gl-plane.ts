import type { PresentationTransitionAdapter, PresentationTransitionCoordinator } from "@ice/core";

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

/**
 * `GLViews`' mount effect, as a function (D-C4.6). Claim the `gl` plane for
 * {@link GL_PLANE_ADAPTER} and return the unregister; answer `undefined` — no
 * claim, no cleanup — when there is no coordinator, or when the plane already
 * has an owner.
 *
 * THE GUARD IS THE POINT: `register` THROWS on an owned plane, and the caller
 * is a `useEffect`, so a second `<GLViews>` over one engine would take the
 * React tree down with it. A plane has exactly one owner; the second mount
 * stands down, and the first mount's unmount frees the plane for whichever
 * mount claims it next.
 *
 * It lives here rather than inline in `gl-root.tsx` because that component
 * calls `useThree` and is unmountable without a GL context — this is the seam
 * the behaviour can actually be pinned at.
 */
export function claimGlPlane(
  transitions: PresentationTransitionCoordinator | undefined,
): (() => void) | undefined {
  if (transitions === undefined) return undefined;
  if (transitions.ownerOf(GL_PLANE_ADAPTER.plane) !== undefined) return undefined;
  return transitions.register(GL_PLANE_ADAPTER);
}
