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

export interface Tessellation {
  /** Flattened polyline, interleaved [x0,y0, x1,y1, …] in the cubic's own space. */
  points: Float32Array;
  /** Cumulative arc length at each polyline point (same unit; [0] = 0). */
  arcLength: Float32Array;
}

/**
 * Anti-Grain-Geometry flatness: the control points' summed deviation from the
 * chord, squared, against tolerance² × chord² (degenerate chords fall back to
 * raw control-point distance from p0).
 */
function flatEnough(c: Cubic, tolSq: number): boolean {
  const dx = c.x3 - c.x0;
  const dy = c.y3 - c.y0;
  const chordSq = dx * dx + dy * dy;
  if (chordSq <= 1e-12) {
    const d1 = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
    const d2 = Math.hypot(c.x2 - c.x0, c.y2 - c.y0);
    return (d1 + d2) * (d1 + d2) <= tolSq;
  }
  const d1 = Math.abs((c.x1 - c.x0) * dy - (c.y1 - c.y0) * dx);
  const d2 = Math.abs((c.x2 - c.x0) * dy - (c.y2 - c.y0) * dx);
  return (d1 + d2) * (d1 + d2) <= tolSq * chordSq;
}

/** De Casteljau split at t = 0.5 → [left, right]. */
function splitCubic(c: Cubic): [Cubic, Cubic] {
  const ax = (c.x0 + c.x1) / 2;
  const ay = (c.y0 + c.y1) / 2;
  const bx = (c.x1 + c.x2) / 2;
  const by = (c.y1 + c.y2) / 2;
  const cx = (c.x2 + c.x3) / 2;
  const cy = (c.y2 + c.y3) / 2;
  const abx = (ax + bx) / 2;
  const aby = (ay + by) / 2;
  const bcx = (bx + cx) / 2;
  const bcy = (by + cy) / 2;
  const mx = (abx + bcx) / 2;
  const my = (aby + bcy) / 2;
  return [
    { x0: c.x0, y0: c.y0, x1: ax, y1: ay, x2: abx, y2: aby, x3: mx, y3: my },
    { x0: mx, y0: my, x1: bcx, y1: bcy, x2: cx, y2: cy, x3: c.x3, y3: c.y3 },
  ];
}

/**
 * Adaptive cubic flattening + prefix arc length (2026-07-16, the @ice/ground
 * wires pass: stroke tessellation and dash placement both ride this). Emit
 * density follows curvature — flat spans emit one segment regardless of
 * length; tolerance is in the cubic's OWN space (the ground renderer passes
 * screen-px cubics with ~0.25 px tolerance, so density tracks zoom for free).
 * `maxDepth` bounds pathological inputs (2^depth segments worst case).
 */
export function tessellateCubic(c: Cubic, tolerance = 0.25, maxDepth = 16): Tessellation {
  const pts: number[] = [c.x0, c.y0];
  const tolSq = tolerance * tolerance;
  const walk = (cur: Cubic, depth: number): void => {
    if (depth >= maxDepth || flatEnough(cur, tolSq)) {
      pts.push(cur.x3, cur.y3);
      return;
    }
    const [l, r] = splitCubic(cur);
    walk(l, depth + 1);
    walk(r, depth + 1);
  };
  walk(c, 0);

  const n = pts.length / 2;
  const points = new Float32Array(pts);
  const arcLength = new Float32Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const dx = (pts[i * 2] as number) - (pts[i * 2 - 2] as number);
    const dy = (pts[i * 2 + 1] as number) - (pts[i * 2 - 1] as number);
    acc += Math.hypot(dx, dy);
    arcLength[i] = acc;
  }
  return { points, arcLength };
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
