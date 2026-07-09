/**
 * Cubic-bezier wire geometry: construction from port anchors, conservative
 * AABB (for the spatial index), and sampled distance (for picking — wires rank
 * below widgets, design-003 §3).
 */
import { sideDirection, type PortSide } from "./anchors";
import type { AABB, Vec2 } from "./shapes";

export interface Cubic {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/**
 * Wire curve between two anchors: tangent stubs leave each port along its
 * side's outward direction, scaled with distance (min stub keeps short wires
 * readable).
 */
export function wireCubic(
  from: Vec2,
  fromSide: PortSide,
  to: Vec2,
  toSide: PortSide,
  stubScale = 0.4,
  minStub = 24,
): Cubic {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const stub = Math.max(minStub, dist * stubScale);
  const df = sideDirection(fromSide);
  const dt = sideDirection(toSide);
  return {
    x0: from.x,
    y0: from.y,
    x1: from.x + df.x * stub,
    y1: from.y + df.y * stub,
    x2: to.x + dt.x * stub,
    y2: to.y + dt.y * stub,
    x3: to.x,
    y3: to.y,
  };
}

/** Point on the curve at t ∈ [0, 1] (Bernstein form). */
export function cubicPoint(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * c.x0 + b1 * c.x1 + b2 * c.x2 + b3 * c.x3,
    y: b0 * c.y0 + b1 * c.y1 + b2 * c.y2 + b3 * c.y3,
  };
}

/**
 * Conservative bounds: the control-point hull contains the curve (convex-hull
 * property). Cheap and index-friendly; exact extrema are unnecessary for
 * culling/picking prefilters.
 */
export function cubicAABB(c: Cubic): AABB {
  return {
    minX: Math.min(c.x0, c.x1, c.x2, c.x3),
    minY: Math.min(c.y0, c.y1, c.y2, c.y3),
    maxX: Math.max(c.x0, c.x1, c.x2, c.x3),
    maxY: Math.max(c.y0, c.y1, c.y2, c.y3),
  };
}

/** Distance from a point to a line segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Min distance from a point to the curve via polyline sampling. 32 samples is
 * ample for hit thresholds of a few px; error shrinks with curve flatness.
 */
export function distanceToCubic(px: number, py: number, c: Cubic, samples = 32): number {
  let best = Number.POSITIVE_INFINITY;
  let prev = cubicPoint(c, 0);
  for (let i = 1; i <= samples; i++) {
    const cur = cubicPoint(c, i / samples);
    const d = distanceToSegment(px, py, prev.x, prev.y, cur.x, cur.y);
    if (d < best) best = d;
    prev = cur;
  }
  return best;
}
