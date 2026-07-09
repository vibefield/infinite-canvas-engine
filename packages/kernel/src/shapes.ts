/** Plain geometric structs shared across the kernel. Ported from v1 `ecs/math.ts`. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function rectToAABB(r: Rect): AABB {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

export function aabbToRect(a: AABB): Rect {
  return { x: a.minX, y: a.minY, width: a.maxX - a.minX, height: a.maxY - a.minY };
}

export function intersectsAABB(a: AABB, b: AABB): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

export function pointInAABB(px: number, py: number, a: AABB): boolean {
  return px >= a.minX && px <= a.maxX && py >= a.minY && py <= a.maxY;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
