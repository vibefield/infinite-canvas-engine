// (The kit's since K4a, design-016 §5 — moved from notebook/eye.ts: the desk calendar projects through the same eye.)
//
// The DESK EYE — how a thing with height is seen from the top-down camera (NOTEBOOK.md §2).
//
// The camera is still the desk's: top-down, pan and zoom only. But a notebook is not flat, so
// what rises off the mat is seen from an eye standing above the VIEW's centre: a point h up
// lands at E + (p − E) · H / (H − h) on the desk plane. At h = 0 that is the identity — the mat,
// the cards and every flat thing map exactly as the ortho camera maps them — so the only
// things that move are the ones with height: a lifted book grows, a standing cover keystones,
// a closed book off to the side shows the edge of its pages. Pure: no GPU. `notebook.wgsl`'s
// `nb_clip` is the same arithmetic; `unproject` is its inverse for the hit test.

import type { CameraState, Viewport } from "./nav";

export interface DeskEye {
  /** The eye's foot on the desk: the view's centre, world units. */
  readonly ex: number;
  readonly ey: number;
  /** How far up it stands, world units. */
  readonly h: number;
  readonly zoom: number;
  /** The viewport, CSS px. */
  readonly vw: number;
  readonly vh: number;
}

/** The eye for a camera: over the view's centre, `k` view-diagonals up, never nearer than `min`. */
export function eyeOf(cam: CameraState, vp: Viewport, law: { readonly k: number; readonly min: number }): DeskEye {
  const zoom = Math.max(cam.zoom, 1e-9);
  const diag = Math.hypot(vp.width, vp.height) / zoom;
  return { ex: cam.x + vp.width / (2 * zoom), ey: cam.y + vp.height / (2 * zoom), h: Math.max(law.min, law.k * diag), zoom, vw: vp.width, vh: vp.height };
}

/** A world point (z up) → CSS px on the screen. */
export function project(e: DeskEye, x: number, y: number, z: number): readonly [number, number] {
  const k = e.h / Math.max(e.h - z, 1e-6);
  return [e.vw / 2 + (x - e.ex) * k * e.zoom, e.vh / 2 + (y - e.ey) * k * e.zoom];
}

/** CSS px → the desk point under it (z = 0): the ortho camera's own inverse. */
export function deskAt(e: DeskEye, sx: number, sy: number): readonly [number, number] {
  return [e.ex + (sx - e.vw / 2) / e.zoom, e.ey + (sy - e.vh / 2) / e.zoom];
}

/** The world point at height z that lands on the desk point (dx, dy) — along the eye's ray. */
export function unproject(e: DeskEye, dx: number, dy: number, z: number): readonly [number, number] {
  const f = (e.h - z) / e.h;
  return [e.ex + (dx - e.ex) * f, e.ey + (dy - e.ey) * f];
}

/** The eye's ray through a desk point: origin (the eye) and direction (toward the desk point, unnormalised). */
export function rayThrough(e: DeskEye, dx: number, dy: number): { readonly o: readonly [number, number, number]; readonly d: readonly [number, number, number] } {
  return { o: [e.ex, e.ey, e.h], d: [dx - e.ex, dy - e.ey, -e.h] };
}

/**
 * The clip-space numbers the shader's `nb_clip` reads: x, y are 2·zoom·(p − E)/viewport (y up),
 * w = (H − z)/H, and z is a perspective depth over distances from the eye in [near, far] —
 * `near` above the tallest thing a book can reach, `far` just under the desk.
 */
export function eyeValues(e: DeskEye, reach = 900): { eye: [number, number, number, number]; view: [number, number, number, number] } {
  const near = Math.max(e.h - reach, 1);
  const far = e.h + 40;
  return { eye: [e.ex, e.ey, e.h, e.zoom], view: [e.vw, e.vh, near, far] };
}
