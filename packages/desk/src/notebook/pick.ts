// The HIT TEST — the pointer's ray into the notebook (NOTEBOOK.md §5). Pure. The ray runs from
// the desk eye through the desk point under the pointer, is carried into the book's own
// coordinates by its placement, and meets the same surfaces the mesh draws: the closed case,
// or, open, each stack's top page (a height field over its resting curve) and the case's
// margins. A page hit says where on the page — the arc length from the gutter and the height
// down the page — which is what a turn needs (and a pen will).

import type { DeskEye } from "./eye";
import type { NotebookLaw } from "./law";
import { type Rigid, dirToLocal, toLocal } from "./place";
import { coverFrame, type Frame, type NotebookPose, relaxOf, restSheet, sampleRest, sheetSamples, swingOf } from "./shape";

export type NotebookHit =
  | { readonly part: "case"; readonly t: number }
  | { readonly part: "page"; readonly side: 0 | 1; readonly s: number; readonly y: number; readonly len: number; readonly t: number };

/** The ray from the eye through a desk point, in the book's own coordinates. */
export function localRay(e: DeskEye, g: Rigid, dx: number, dy: number): { o: [number, number, number]; d: [number, number, number] } {
  return { o: toLocal(g, e.ex, e.ey, e.h), d: dirToLocal(g, dx - e.ex, dy - e.ey, -e.h) };
}

/** Where a ray meets a box, if it does (t along the ray). */
function slab(o: readonly number[], d: readonly number[], lo: readonly number[], hi: readonly number[]): number | null {
  let t0 = Number.NEGATIVE_INFINITY;
  let t1 = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const ok = o[k] as number;
    const dk = d[k] as number;
    const a = lo[k] as number;
    const b = hi[k] as number;
    if (Math.abs(dk) < 1e-12) { if (ok < a || ok > b) return null; continue; }
    let ta = (a - ok) / dk;
    let tb = (b - ok) / dk;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t1 >= 0 ? Math.max(t0, 0) : null;
}

/**
 * A stack's top page as a height field: the curve's x and z tabulated along its arc length.
 * `hit` walks the ray down onto it (a few fixed-point steps: the curve is gentle and the ray
 * nearly vertical) and answers the arc length there.
 */
function pageHit(F: Frame, k: number, gamma: number, law: NotebookLaw, o: readonly number[], d: readonly number[]): { s: number; y: number; len: number; t: number } | null {
  if (k <= 0) return null;
  const top = restSheet(F, F.b + (k - 0.5) * F.spec.sheet, gamma, law.gutter);
  const ss = sheetSamples(top.len, 48);
  const c = sampleRest(top, ss);
  const n = ss.length;
  const zAt = (x: number): { z: number; s: number } | null => {
    if (x < (c[0] as number) || x > (c[(n - 1) * 4] as number)) return null;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((c[mid * 4] as number) <= x) lo = mid; else hi = mid; }
    const x0 = c[lo * 4] as number;
    const x1 = c[hi * 4] as number;
    const f = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
    return { z: (c[lo * 4 + 1] as number) + ((c[hi * 4 + 1] as number) - (c[lo * 4 + 1] as number)) * f + F.spec.sheet * 0.5, s: (ss[lo] as number) + ((ss[hi] as number) - (ss[lo] as number)) * f };
  };
  let z = F.b + k * F.spec.sheet;
  let t = 0;
  let hit: { z: number; s: number } | null = null;
  for (let it = 0; it < 6; it++) {
    if (Math.abs(d[2] as number) < 1e-9) return null;
    t = (z - (o[2] as number)) / (d[2] as number);
    const x = (o[0] as number) + (d[0] as number) * t;
    hit = zAt(x);
    if (!hit) return null;
    if (Math.abs(hit.z - z) < 1e-3) break;
    z = hit.z;
  }
  if (!hit) return null;
  const y = (o[1] as number) + (d[1] as number) * t;
  if (Math.abs(y) > F.Hp / 2) return null;
  return { s: hit.s, y, len: top.len, t };
}

/**
 * The notebook under a desk point, and where. Closed (or mostly), the whole case is one hit;
 * open, a page on either side (the left one found in the right model, through the mirror the
 * cover's full swing is), else the case's margins. Null when the ray misses the book.
 */
export function pickNotebook(F: Frame, pose: NotebookPose, law: NotebookLaw, g: Rigid, e: DeskEye, dx: number, dy: number, bounds: { readonly min: readonly number[]; readonly max: readonly number[] }): NotebookHit | null {
  const { o, d } = localRay(e, g, dx, dy);
  const tBox = slab(o, d, bounds.min, bounds.max);
  if (tBox === null) return null;
  const sw = swingOf(pose.theta);
  if (sw < 0.9 * Math.PI) return { part: "case", t: tBox };
  const gamma = relaxOf(pose.theta);
  const R = pageHit(F, pose.right, gamma, law, o, d);
  // the left stack: the ray mirrored about the gutter into the right model (the cover lies flat, so the ride IS the mirror)
  const C = coverFrame(F, pose.theta);
  const mirrorX = 2 * F.xg;
  const oL = [mirrorX - (o[0] as number), o[1] as number, o[2] as number + (F.b - C.oz)];
  const dL = [-(d[0] as number), d[1] as number, d[2] as number];
  const L = pageHit(F, pose.left, gamma, law, oL, dL);
  const best = R && (!L || R.t <= L.t) ? { side: 0 as const, h: R } : L ? { side: 1 as const, h: L } : null;
  if (best) return { part: "page", side: best.side, s: best.h.s, y: best.h.y, len: best.h.len, t: best.h.t };
  return { part: "case", t: tBox };
}

/** The x a pointer's ray reaches at height z in the book's own coordinates (the right model's x for a drag). */
export function localXAt(e: DeskEye, g: Rigid, dx: number, dy: number, z: number): number {
  const { o, d } = localRay(e, g, dx, dy);
  if (Math.abs(d[2]) < 1e-9) return o[0];
  return o[0] + d[0] * ((z - o[2]) / d[2]);
}
