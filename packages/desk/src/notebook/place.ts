// Where a notebook IS on the desk, and the light on it (NOTEBOOK.md §5). Pure.
//
// A book's mesh is built in its own coordinates; this places it: a centre on the mat, a turn
// in the mat's plane, a lift off it and a tilt about its own middle while held. One rigid
// matrix does it on the GPU (`model`), and its inverse brings the pointer's ray back into the
// book for the hit test. The lamp is the desk's one light (paper.ts `lampOf`): per book, the
// unit direction toward it with the shadow's ground slope capped — the note's, the photo's
// and the notebook's shadows fall the same way from the same lamp — and the orthographic
// frame its shadow map is drawn in, fitted to the book's bounds as it stands this frame.

import type { Lamp } from "../kit/light";

export interface Placement {
  readonly cx: number; readonly cy: number;
  /** Radians in the mat's plane; positive turns clockwise on screen. */
  readonly angle: number;
  /** Units off the mat. */
  readonly lift: number;
  /** Radians about the book's own x (its head dips for +) and y (its fore-edge dips for +) axes, through its middle `zc` up. */
  readonly tiltX: number; readonly tiltY: number;
  readonly zc: number;
}

/** A rigid transform: 3×3 rotation (row-major) and a translation. */
export interface Rigid { readonly r: readonly number[]; readonly t: readonly [number, number, number] }

export function rigidOf(p: Placement): Rigid {
  const cz = Math.cos(p.angle);
  const sz = Math.sin(p.angle);
  const cx = Math.cos(p.tiltX);
  const sx = Math.sin(p.tiltX);
  const cy = Math.cos(p.tiltY);
  const sy = Math.sin(p.tiltY);
  // Rz · Rx · Ry
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (a: readonly number[], b: readonly number[]) => { const o: number[] = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push((a[i * 3] as number) * (b[j] as number) + (a[i * 3 + 1] as number) * (b[3 + j] as number) + (a[i * 3 + 2] as number) * (b[6 + j] as number)); return o; };
  const r = mul(rz, mul(rx, ry));
  // pivot the tilt about the book's middle: t = (cx, cy, lift + zc) − R·(0, 0, zc)
  const t: [number, number, number] = [p.cx - (r[2] as number) * p.zc, p.cy - (r[5] as number) * p.zc, p.lift + p.zc - (r[8] as number) * p.zc];
  return { r, t };
}

export function toWorld(g: Rigid, x: number, y: number, z: number): [number, number, number] {
  const r = g.r;
  return [(r[0] as number) * x + (r[1] as number) * y + (r[2] as number) * z + g.t[0], (r[3] as number) * x + (r[4] as number) * y + (r[5] as number) * z + g.t[1], (r[6] as number) * x + (r[7] as number) * y + (r[8] as number) * z + g.t[2]];
}
export function dirToWorld(g: Rigid, x: number, y: number, z: number): [number, number, number] {
  const r = g.r;
  return [(r[0] as number) * x + (r[1] as number) * y + (r[2] as number) * z, (r[3] as number) * x + (r[4] as number) * y + (r[5] as number) * z, (r[6] as number) * x + (r[7] as number) * y + (r[8] as number) * z];
}
export function toLocal(g: Rigid, x: number, y: number, z: number): [number, number, number] {
  const r = g.r;
  const dx = x - g.t[0];
  const dy = y - g.t[1];
  const dz = z - g.t[2];
  return [(r[0] as number) * dx + (r[3] as number) * dy + (r[6] as number) * dz, (r[1] as number) * dx + (r[4] as number) * dy + (r[7] as number) * dz, (r[2] as number) * dx + (r[5] as number) * dy + (r[8] as number) * dz];
}
export function dirToLocal(g: Rigid, x: number, y: number, z: number): [number, number, number] {
  const r = g.r;
  return [(r[0] as number) * x + (r[3] as number) * y + (r[6] as number) * z, (r[1] as number) * x + (r[4] as number) * y + (r[7] as number) * z, (r[2] as number) * x + (r[5] as number) * y + (r[8] as number) * z];
}

/** Column-major 4×4 (WGSL's mat4x4f) of a rigid transform. */
export function matrixOf(g: Rigid): Float32Array {
  const r = g.r;
  const m = new Float32Array(16);
  m[0] = r[0] as number; m[1] = r[3] as number; m[2] = r[6] as number;
  m[4] = r[1] as number; m[5] = r[4] as number; m[6] = r[7] as number;
  m[8] = r[2] as number; m[9] = r[5] as number; m[10] = r[8] as number;
  m[12] = g.t[0]; m[13] = g.t[1]; m[14] = g.t[2]; m[15] = 1;
  return m;
}

/** The unit direction toward the lamp from a desk point, the ground slope capped (a book far from the lamp keeps a finite shadow). */
export function lampDir(lamp: Lamp, x: number, y: number, slopeMax: number): [number, number, number] {
  let dx = lamp.x - x;
  let dy = lamp.y - y;
  const h = Math.max(lamp.h, 1e-6);
  const s = Math.hypot(dx, dy) / h;
  if (s > slopeMax) { dx *= slopeMax / s; dy *= slopeMax / s; }
  const l = Math.hypot(dx, dy, h);
  return [dx / l, dy / l, h / l];
}

/**
 * The shadow map's frame for a book: an orthographic view along the light, square, fitted to
 * the book's world-space box (grown by `pad`). Out: the world → clip matrix (x, y in −1…1, z
 * 0 nearest the lamp … 1), the world size of one texel at `res`, and the depth range (world).
 */
export function lightFrame(L: readonly [number, number, number], lo: readonly [number, number, number], hi: readonly [number, number, number], res: number, pad = 6, receivers: readonly (readonly [number, number, number])[] = []): { matrix: Float32Array; texel: number; depth: number } {
  const f: [number, number, number] = [-L[0], -L[1], -L[2]];
  let r: [number, number, number] = Math.abs(f[2]) > 0.999 ? [1, 0, 0] : [f[1] * 1 - f[2] * 0, f[2] * 0 - f[0] * 1, 0];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1; r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u: [number, number, number] = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let d0 = Number.POSITIVE_INFINITY;
  let d1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 8; i++) {
    const P = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]] as const;
    const lx = P[0] * r[0] + P[1] * r[1] + P[2] * r[2];
    const ly = P[0] * u[0] + P[1] * u[1] + P[2] * u[2];
    const d = P[0] * f[0] + P[1] * f[1] + P[2] * f[2];
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
  }
  // the receivers only reach the depth range: a desk point behind the book must compare INSIDE it, or it reads as occluded by nothing at all
  for (const P of receivers) d1 = Math.max(d1, P[0] * f[0] + P[1] * f[1] + P[2] * f[2]);
  const half = Math.max(x1 - x0, y1 - y0) / 2 + pad;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  x0 = mx - half; x1 = mx + half; y0 = my - half; y1 = my + half; d0 -= pad; d1 += pad;
  const sx = 2 / (x1 - x0);
  const sy = 2 / (y1 - y0);
  const sd = 1 / (d1 - d0);
  const m = new Float32Array(16);
  // rows: clip.x = sx·(P·r) − sx·x0 − 1 ; clip.y = sy·(P·u) − sy·y0 − 1 ; clip.z = sd·(P·f) − sd·d0 ; w = 1
  m[0] = sx * r[0]; m[4] = sx * r[1]; m[8] = sx * r[2]; m[12] = -sx * x0 - 1;
  m[1] = sy * u[0]; m[5] = sy * u[1]; m[9] = sy * u[2]; m[13] = -sy * y0 - 1;
  m[2] = sd * f[0]; m[6] = sd * f[1]; m[10] = sd * f[2]; m[14] = -sd * d0;
  m[15] = 1;
  return { matrix: m, texel: (x1 - x0) / res, depth: d1 - d0 };
}

/** A local box through the rigid transform → its world-space bounds. */
export function worldBounds(g: Rigid, lo: readonly [number, number, number], hi: readonly [number, number, number]): { lo: [number, number, number]; hi: [number, number, number] } {
  const a: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const b: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < 8; i++) {
    const p = toWorld(g, i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
    for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k] as number, p[k] as number); b[k] = Math.max(b[k] as number, p[k] as number); }
  }
  return { lo: a, hi: b };
}

/** The inverse of a rigid transform. */
export function inverseOf(g: Rigid): Rigid {
  const r = g.r;
  const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]] as number[];
  const t = g.t;
  return { r: rt, t: [-((rt[0] as number) * t[0] + (rt[1] as number) * t[1] + (rt[2] as number) * t[2]), -((rt[3] as number) * t[0] + (rt[4] as number) * t[1] + (rt[5] as number) * t[2]), -((rt[6] as number) * t[0] + (rt[7] as number) * t[1] + (rt[8] as number) * t[2])] };
}
