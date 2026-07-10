/**
 * THE point-pick (Law 15: the spatial index is the only hit path; this
 * function is its only narrow-phase). Shared verbatim by the in-tick
 * `picking` system (L1, via SystemCtx) and the pointer router's synchronous
 * event-time pick (design-004 §4 GL path, via World — world reads outside
 * the tick are verified-unrestricted). One implementation so the two can
 * never disagree on ordering.
 *
 * Priority: HandleSpec chrome first (nearest edge), then widgets by StackZ
 * descending. Deliberately NOT plane-stratified: cross-plane z is stratified
 * visually (P2 GL composites above P1 DOM), but pick order is StackZ across
 * all surfaces — design-004 §1 names the mixed-overlap consequence and
 * accepts it; do not "fix" it here.
 */
import type { Component, Entity } from "@vibecook/strata-ecs";
import type { SpatialIndex } from "@ice/kernel";
import { HandleSpec, Position, StackZ } from "../catalog";

/** Structural reads both `World` and `SystemCtx` provide. */
export interface PickReader {
  isAlive(e: Entity): boolean;
  has(e: Entity, c: Component): boolean;
  get<S>(e: Entity, c: Component<S>): S | undefined;
}

/** Distance from a point to the nearest edge of an AABB (0 iff inside). */
export function distPointToBox(
  px: number,
  py: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dy = Math.max(minY - py, 0, py - maxY);
  return Math.hypot(dx, dy);
}

/** Top pick under a world point within `rWorld` (point-in-box when 0). */
export function pickTopAt(
  reader: PickReader,
  index: SpatialIndex<Entity>,
  wx: number,
  wy: number,
  rWorld: number,
): Entity | undefined {
  let bestHandle: Entity | undefined;
  let bestHandleD = Number.POSITIVE_INFINITY;
  let bestWidget: Entity | undefined;
  let bestWidgetZ = Number.NEGATIVE_INFINITY;
  for (const entry of index.searchPoint(wx, wy, rWorld)) {
    const e = entry.id;
    if (!reader.isAlive(e)) continue;
    const d = distPointToBox(wx, wy, entry.minX, entry.minY, entry.maxX, entry.maxY);
    if (d > rWorld) continue; // narrow: disc-vs-box
    if (reader.has(e, HandleSpec)) {
      if (d < bestHandleD) {
        bestHandleD = d;
        bestHandle = e;
      }
    } else if (reader.has(e, Position)) {
      const z = reader.get(e, StackZ)?.z ?? 0;
      if (z > bestWidgetZ) {
        bestWidgetZ = z;
        bestWidget = e;
      }
    }
  }
  return bestHandle ?? bestWidget;
}
