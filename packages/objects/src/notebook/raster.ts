// A PAGE'S RASTER (NOTEBOOK.md §8; D3t-b) — the pen's ink on one page as bytes, drawn by pure arithmetic. The prototype drew
// it with Canvas2D (lab/notebook-ink.ts, the sticky note's path); neither the Node oracle nor the desk-dom-free wall has a
// canvas, and a canvas's antialiasing is its browser's — so the stroke is drawn here the way the prototype's canvas stroked
// it, the same everywhere to the bit: each segment the MIDPOINT QUADRATIC (from the midpoint before a sample, through it, to
// the midpoint after — the first segment from the first sample, the last to the last: a stroke with no corners), its width
// the mean of its two ends', round-capped; a stroke of one sample is a dot. A segment is laid ONCE, as a canvas's `stroke()`
// lays one path: its coverage is the most any piece of it gives a texel (the quadratic flattened into short capsules, each
// texel's distance to the nearest), then laid over the page source-over in the pen's colour, straight alpha — the texture the
// pass samples (`ink.rgb`, `ink.a` into the paper's albedo before the light). Square roots and the four operations only.
//
// A stroke drawn a segment at a time as the samples come (the pen in hand) lays exactly what the stroke drawn whole lays:
// segment k needs sample k + 1 (its end is the midpoint after k), so it is drawn once that sample is known — the last at the lift.

import type { RGB } from "@ice/desk";
import { INK_H, INK_W, type InkPoint } from "./ink";

/** A texel rectangle of a page's raster (x, y its top-left; w, h ≥ 0), clipped to the raster. */
export interface InkRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One page's ink: RGBA8, straight alpha, `INK_W × INK_H` texels, row by row — the layer the pass holds is a copy of these bytes. */
export class PageRaster {
  readonly bytes: Uint8Array<ArrayBuffer> = new Uint8Array(INK_W * INK_H * 4);
  clear(): void { this.bytes.fill(0); }
}

/** The union of two rects (either may be null — nothing touched). */
export function unionRect(a: InkRect | null, b: InkRect | null): InkRect | null {
  if (a === null) return b;
  if (b === null) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** How many segments a stroke of `n` samples is drawn as, and how many of them are FINAL — known whole (all of them once lifted). */
export function segmentsOf(n: number, lifted: boolean): number {
  if (n <= 0) return 0;
  if (n === 1) return lifted ? 1 : 0;   // a dot, laid at the lift
  return lifted ? n - 1 : n - 2;
}

/** The coverage scratch a segment is gathered in before it is laid (grown as needed, never shrunk). */
let scratch = new Float32Array(4096);

/** A capsule's coverage into the scratch over the box (bx, by, bw): the most of what each texel had and this piece gives it. */
function capsule(x0: number, y0: number, x1: number, y1: number, rad: number, bx: number, by: number, bw: number, bh: number): void {
  const lo = rad + 1;
  const tx0 = Math.max(Math.floor(Math.min(x0, x1) - lo), bx);
  const ty0 = Math.max(Math.floor(Math.min(y0, y1) - lo), by);
  const tx1 = Math.min(Math.ceil(Math.max(x0, x1) + lo), bx + bw);
  const ty1 = Math.min(Math.ceil(Math.max(y0, y1) + lo), by + bh);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let ty = ty0; ty < ty1; ty++) {
    const py = ty + 0.5;
    const row = (ty - by) * bw;
    for (let tx = tx0; tx < tx1; tx++) {
      const px = tx + 0.5;
      let u = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
      if (u < 0) u = 0;
      else if (u > 1) u = 1;
      const ex = px - (x0 + dx * u);
      const ey = py - (y0 + dy * u);
      const c = rad + 0.5 - Math.sqrt(ex * ex + ey * ey);
      if (c <= 0) continue;
      const k = row + (tx - bx);
      const v = c >= 1 ? 1 : c;
      if (v > (scratch[k] as number)) scratch[k] = v;
    }
  }
}

/** Lay the scratch's coverage over the raster in `colour` (sRGB 0 … 1), source-over, straight alpha. */
function lay(r: PageRaster, colour: RGB, bx: number, by: number, bw: number, bh: number): void {
  const b = r.bytes;
  const cr = Math.round(colour[0] * 255);
  const cg = Math.round(colour[1] * 255);
  const cb = Math.round(colour[2] * 255);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const c = scratch[y * bw + x] as number;
      if (c <= 0) continue;
      const i = ((by + y) * INK_W + (bx + x)) * 4;
      const a0 = (b[i + 3] as number) / 255;
      const ao = c + a0 * (1 - c);
      const k0 = a0 * (1 - c);
      b[i] = Math.round((cr * c + (b[i] as number) * k0) / ao);
      b[i + 1] = Math.round((cg * c + (b[i + 1] as number) * k0) / ao);
      b[i + 2] = Math.round((cb * c + (b[i + 2] as number) * k0) / ao);
      b[i + 3] = Math.round(ao * 255);
    }
  }
}

/** The box a segment may touch, clipped to the raster; null when it lies off it. */
function boxOf(xs: readonly number[], ys: readonly number[], rad: number): InkRect | null {
  const x0 = Math.max(Math.floor(Math.min(...xs) - rad - 1), 0);
  const y0 = Math.max(Math.floor(Math.min(...ys) - rad - 1), 0);
  const x1 = Math.min(Math.ceil(Math.max(...xs) + rad + 1), INK_W);
  const y1 = Math.min(Math.ceil(Math.max(...ys) + rad + 1), INK_H);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Make room in the scratch for a box and zero it. */
function ready(box: InkRect): void {
  const need = box.w * box.h;
  if (scratch.length < need) scratch = new Float32Array(Math.max(need, scratch.length * 2));
  scratch.fill(0, 0, need);
}

/**
 * Segment `k` of a stroke into a raster (1 ≤ k < n; for a stroke of one sample, k = 1 is its dot): the midpoint quadratic from
 * the midpoint before sample k (sample 0 itself for k = 1) through sample k to the midpoint after it (sample k itself when it is
 * the last), `sx`/`sy` texels per page unit. Returns the rect it touched, or null.
 */
export function drawSegment(r: PageRaster, colour: RGB, p: readonly InkPoint[], k: number, sx: number, sy: number): InkRect | null {
  const n = p.length;
  if (n === 0 || k < 1) return null;
  if (n === 1) {
    const q = p[0] as InkPoint;
    const rad = (q.w * sx) / 2;
    const x = q.s * sx;
    const y = q.y * sy;
    const box = boxOf([x], [y], rad);
    if (box === null) return null;
    ready(box);
    capsule(x, y, x, y, rad, box.x, box.y, box.w, box.h);
    lay(r, colour, box.x, box.y, box.w, box.h);
    return box;
  }
  if (k >= n) return null;
  const a = p[k - 1] as InkPoint;
  const b = p[k] as InkPoint;
  const c = k + 1 < n ? (p[k + 1] as InkPoint) : null;
  const m0x = k === 1 ? a.s * sx : ((a.s + b.s) / 2) * sx;
  const m0y = k === 1 ? a.y * sy : ((a.y + b.y) / 2) * sy;
  const m1x = c !== null ? ((b.s + c.s) / 2) * sx : b.s * sx;
  const m1y = c !== null ? ((b.y + c.y) / 2) * sy : b.y * sy;
  const bx = b.s * sx;
  const by = b.y * sy;
  const rad = (((a.w + b.w) / 2) * sx) / 2;
  const box = boxOf([m0x, bx, m1x], [m0y, by, m1y], rad);
  if (box === null) return null;
  ready(box);
  // flattened: pieces of about 3 texels along the control polygon (at least one, at most 48)
  const reach = Math.sqrt((bx - m0x) * (bx - m0x) + (by - m0y) * (by - m0y)) + Math.sqrt((m1x - bx) * (m1x - bx) + (m1y - by) * (m1y - by));
  const pieces = Math.min(Math.max(Math.ceil(reach / 3), 1), 48);
  let px = m0x;
  let py = m0y;
  for (let i = 1; i <= pieces; i++) {
    const t = i / pieces;
    const u = 1 - t;
    const qx = u * u * m0x + 2 * u * t * bx + t * t * m1x;
    const qy = u * u * m0y + 2 * u * t * by + t * t * m1y;
    capsule(px, py, qx, qy, rad, box.x, box.y, box.w, box.h);
    px = qx;
    py = qy;
  }
  lay(r, colour, box.x, box.y, box.w, box.h);
  return box;
}

/** A page's texels per page unit across and down (the raster spans the page's open width `len` and its height). */
export const scaleOf = (len: number, height: number): readonly [number, number] => [INK_W / len, INK_H / height];

/** A whole stroke into a raster — every segment, as the pen laid them; the rect it touched. */
export function drawStroke(r: PageRaster, colour: RGB, p: readonly InkPoint[], sx: number, sy: number): InkRect | null {
  let rect: InkRect | null = null;
  const segs = segmentsOf(p.length, true);
  for (let k = 1; k <= segs; k++) rect = unionRect(rect, drawSegment(r, colour, p, k, sx, sy));
  return rect;
}
