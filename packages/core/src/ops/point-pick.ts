/**
 * THE point-pick (Law 15: the spatial index is the only hit path; this
 * function is its only narrow-phase). Shared verbatim by the in-tick
 * `picking` system (L1, via SystemCtx) and the pointer router's synchronous
 * event-time pick (design-004 §4 GL path, via World — world reads outside
 * the tick are verified-unrestricted). One implementation so the two can
 * never disagree on ordering.
 *
 * Priority: HandleSpec chrome first (nearest edge), then widgets topmost by
 * SIBLING ORDER (petition 8: the frame parent's ChildOf sequence, legacy
 * (StackZ, entity) fallback for edge-less entities — compareStackOrder is the
 * ONE comparator paint and pick share). Deliberately NOT plane-stratified:
 * cross-plane z is stratified visually (P2 GL composites above P1 DOM), but
 * pick order is sibling order across all surfaces — design-004 §1 names the
 * mixed-overlap consequence and accepts it; do not "fix" it here.
 */
import type { Component, Entity } from "@vibecook/strata-ecs";
import type { Cubic, SpatialIndex } from "@ice/kernel";
import { distanceToCubic } from "@ice/kernel";
import { HandleSpec, Port, Position, Wire } from "../catalog";
import { compareStackOrder } from "./sibling-order";

/** Structural reads both `World` and `SystemCtx` provide. */
export interface PickReader {
  isAlive(e: Entity): boolean;
  has(e: Entity, c: Component): boolean;
  hasTag(e: Entity, t: import("@vibecook/strata-ecs").Tag): boolean;
  get<S>(e: Entity, c: Component<S>): S | undefined;
}

/** Wire narrow-phase source: cached cubics from wireSync (M8). */
export interface WirePickSource {
  cubicOf(e: Entity): Cubic | undefined;
  /** Pick slop in WORLD units (screen slop / zoom, caller-converted). */
  readonly slopWorld: number;
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

/** No frame parent (legacy world) — every widget compares by the fallback. */
const NO_ORDINALS: ReadonlyMap<Entity, number> = new Map();

/**
 * Top pick under a world point within `rWorld` (point-in-box when 0).
 * Tier order (design-003 §3, amended for M8): HandleSpec chrome → PORT
 * entities (interaction affordances sit atop their widget edge) → widgets by
 * sibling order (topmost = compareStackOrder max; `ordinals` is the caller's
 * frame ordinal map — SiblingOrderIndex — so paint and pick share one order)
 * → WIRES (render in P0 under content; pick below widgets, above
 * canvas — render order and pick order agree). The canvas fallback stays the
 * caller's. Wires narrow-phase against their cached cubic (`wires` source;
 * without one, wire entries are skipped — coarse AABB hits would make fat
 * bounding boxes steal canvas taps).
 */
export function pickTopAt(
  reader: PickReader,
  index: SpatialIndex<Entity>,
  wx: number,
  wy: number,
  rWorld: number,
  wires?: WirePickSource,
  ordinals: ReadonlyMap<Entity, number> = NO_ORDINALS,
): Entity | undefined {
  let bestHandle: Entity | undefined;
  let bestHandleD = Number.POSITIVE_INFINITY;
  let bestPort: Entity | undefined;
  let bestPortD = Number.POSITIVE_INFINITY;
  let bestWidget: Entity | undefined;
  let bestWire: Entity | undefined;
  let bestWireD = Number.POSITIVE_INFINITY;
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
    } else if (reader.has(e, Port)) {
      if (d < bestPortD) {
        bestPortD = d;
        bestPort = e;
      }
    } else if (reader.hasTag(e, Wire)) {
      if (wires === undefined) continue;
      const cubic = wires.cubicOf(e);
      if (cubic === undefined) continue;
      const wd = distanceToCubic(wx, wy, cubic);
      if (wd <= rWorld + wires.slopWorld && wd < bestWireD) {
        bestWireD = wd;
        bestWire = e;
      }
    } else if (reader.has(e, Position)) {
      if (bestWidget === undefined || compareStackOrder(reader, ordinals, e, bestWidget) > 0) {
        bestWidget = e;
      }
    }
  }
  return bestHandle ?? bestPort ?? bestWidget ?? bestWire;
}
