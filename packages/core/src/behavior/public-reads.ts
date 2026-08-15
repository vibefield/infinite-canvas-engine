/**
 * The CURATED public read surface for behaviors (design-009 §9).
 *
 * The engine catalog is exposed to behaviors DELIBERATELY, not accidentally.
 * Every name on this list is a published contract: it is what a behavior may
 * declare in `reads:` and expect to keep working across engine versions. Adding
 * a name here is a product decision — it is a promise about a shape, not a
 * convenience.
 *
 * Everything else in the catalog is ENGINE VOCABULARY: recognizers, claims,
 * gesture bookkeeping, one-tick markers. Reading it from a behavior is not
 * forbidden (the escape hatch stays open for engine-grade code), but it
 * dev-WARNS, because those shapes change whenever the interaction stack does
 * and no one will think to tell a plugin author.
 *
 * Two notes authors need and will not guess:
 *   - One-tick markers (`WentDown`, the `Just*` family) are already CLEARED by
 *     the time the publish slot runs, so an ephemeral behavior can never see
 *     them. That is not a bug to route around; it is what "one tick" means.
 *   - `Grab` and the claim relations are deliberately OFF the list. A behavior
 *     that wants to know "is this being dragged right now" is usually asking
 *     for claim-scoped suppression, which it already gets for free.
 */
import type { Component, Relation, Resource, Tag } from "@vibecook/strata-ecs";
import { CameraLimits } from "../catalog/settings-resources";
import { Camera, Culled, MeasuredSize, Viewport, Visible } from "../catalog/camera-derived";
import { ChildOf, Opacity, Position, Size } from "../catalog/scene";
import { Accepts, Container, Provides } from "../catalog/graph";
import { Movable, Resizable, Selectable, Selected } from "../catalog/selection-presence";
import { Solid } from "../catalog/gesture";
import { PrefabId } from "../schema/prefab";

/**
 * The published set. Ordered by what an author reaches for first: geometry,
 * then structure, then state, then the view.
 */
export const PUBLIC_READS: ReadonlySet<Component | Tag | Relation | Resource> = new Set<
  Component | Tag | Relation | Resource
>([
  // Geometry — the whole reason most behaviors exist.
  Position as Component,
  Size as Component,
  MeasuredSize as Component,
  Opacity as Component,
  // Structure.
  ChildOf as Relation,
  PrefabId as Component,
  Accepts as Component,
  Provides as Component,
  // Interaction STATE (never the machinery that produces it).
  Selected as Tag,
  Selectable as Tag,
  Movable as Tag,
  Resizable as Tag,
  Solid as Tag,
  Container as Tag,
  // The view.
  Visible as Tag,
  Culled as Tag,
  Camera as Resource,
  CameraLimits as Resource,
  Viewport as Resource,
]);

/** Is this handle part of the published behavior read surface? */
export function isPublicRead(handle: Component | Tag | Relation | Resource): boolean {
  return PUBLIC_READS.has(handle);
}
