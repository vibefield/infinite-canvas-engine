// INK on the notebook's pages (NOTEBOOK.md §7–8) — the pure half: what a stroke is, how wide a
// pen writes, where a page's point lands in its raster, which pages are in view. The raster is
// pure arithmetic since D3t-b (notebook/raster.ts — the prototype drew it with Canvas2D, which
// neither the Node oracle nor the desk-dom-free wall has) into layers of one texture array; the
// pass samples a page's layer by its number, so the ink turns with the sheet it is on and
// crosses the gutter's curve, the dapple and the night like the paper under it.
//
// Page units: `s` along the page from the gutter (world units, 0 … the page's width), `y` down
// the page from the head (0 … its height). Recto and verso share them: a sheet's two faces
// are the same (s, y) seen from either side. A page's NUMBER: sheet i's recto is 2i + 1, its
// verso 2i + 2 (0 is the front endpaper, which takes no ink).

import type { RGB } from "@ice/desk";

export interface InkPoint { readonly s: number; readonly y: number; readonly w: number }
export interface InkStroke { readonly colour: RGB; readonly points: InkPoint[] }
/** A page's ink: its strokes, and a version that moves whenever they change (a raster's key). */
export interface PageInk { strokes: InkStroke[]; version: number }

/** One page's raster: 1024 texels across its width (5.5 per world unit on the law's page), its height in proportion. */
export const INK_W = 1024;
export const INK_H = 1360;
/** Page rasters on the device at once — the spread, a sheet or two in the air, a turn's neighbours. */
export const INK_LAYERS = 8;
/** Pages a book can name in its record's table (the spread and the sheets in the air). */
export const INK_TABLE = 8;

/**
 * The pen's law: a nib `width` wide at a writing pace, thinning as it hurries (a fountain pen
 * laying down less ink) and swelling slow — bounded both ways; a stylus's pressure, when the
 * device has one, leads instead.
 */
export interface PenLaw { readonly width: number; readonly thin: number; readonly thick: number; readonly pace: number }
export const PEN: PenLaw = { width: 1.25, thin: 0.55, thick: 1.3, pace: 900 };

/** The nib's width at a speed (world units per second) and, from a stylus, a pressure in 0 … 1. */
export function nibWidth(law: PenLaw, speed: number, pressure: number | null): number {
  if (pressure !== null) return law.width * (law.thin + (law.thick - law.thin) * Math.min(Math.max(pressure, 0), 1));
  const f = 1.15 - speed / law.pace;
  return law.width * Math.min(Math.max(f, law.thin), law.thick);
}

/** A page point → its raster's texel (the page is `len` wide and `height` tall in world units). */
export function texelOf(p: { readonly s: number; readonly y: number }, len: number, height: number): readonly [number, number] {
  return [(p.s / len) * INK_W, (p.y / height) * INK_H];
}

/** Texels per world unit across the page — a nib's width in the raster. */
export const texelsPerUnit = (len: number): number => INK_W / len;

/**
 * The nib's width at each sample (D3t-b) — the pen's law over the hand's pace, as the prototype's pen laid it (lab/notebook.ts
 * `penTo`): the first at rest; each sample that moved at least `still` from the last that did takes 0.6 of that one's width and
 * 0.4 of the law's at the pace between them; one nearer keeps the width it had (a resting pen neither swells nor thins — the
 * prototype dropped such a sample, the data keeps it). Timed samples (ms from the first) read their own clocks; untimed ones are
 * spaced by `speed` (world units/s) as the board's replay spaces an old stroke. Square roots and the four operations only: the
 * widths are bit-identical wherever they are computed (the oracle's Node, the desk's Chrome).
 */
export function nibWidths(points: readonly (readonly [number, number])[], times: readonly number[] | null, speed: number, law: PenLaw = PEN, still = 0.35): number[] {
  const n = points.length;
  const out: number[] = [];
  if (n === 0) return out;
  const timed = times !== null && times.length === n;
  const pace = speed > 0 ? speed : 400;
  let t = 0;
  let ref = points[0] as readonly [number, number];
  let refT = 0;
  let w = nibWidth(law, 0, null);
  out.push(w);
  for (let i = 1; i < n; i++) {
    const p = points[i] as readonly [number, number];
    const q = points[i - 1] as readonly [number, number];
    if (timed) t = times[i] as number;
    else t += (Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1])) / pace) * 1000;
    const d = Math.sqrt((p[0] - ref[0]) * (p[0] - ref[0]) + (p[1] - ref[1]) * (p[1] - ref[1]));
    if (d >= still) {
      const v = d / Math.max((t - refT) / 1000, 1e-3);
      w = w * 0.6 + nibWidth(law, v, null) * 0.4;
      ref = p;
      refT = t;
    }
    out.push(w);
  }
  return out;
}

/** A stroke's samples as the raster draws them: page units with the nib's width at each (`nibWidths`). */
export function inkPoints(points: readonly (readonly [number, number])[], times: readonly number[] | null, speed: number, law: PenLaw = PEN): InkPoint[] {
  const w = nibWidths(points, times, speed, law);
  return points.map(([s, y], i) => ({ s, y, w: w[i] as number }));
}

/** The page a side of the open spread shows (D3t-b): the right is its top sheet's recto (2i + 1), the left its top sheet's verso (2i + 2); null — an endpaper. */
export function pageOfSide(pose: { readonly rightTop: number; readonly leftTop: number }, side: 0 | 1): number | null {
  if (side === 0) return pose.rightTop >= 0 ? 2 * pose.rightTop + 1 : null;
  return pose.leftTop >= 0 ? 2 * pose.leftTop + 2 : null;
}

/**
 * The pages in view (the prototype's `drawBooks`): once the cover stands past the vertical, the spread — its left page, then its
 * right — and both faces of every sheet in the air (a turn, the peek); none while the book is shut.
 */
export function pagesInView(pose: { readonly rightTop: number; readonly leftTop: number; readonly airs: readonly { readonly index: number }[] }, swing: number): number[] {
  const pages: number[] = [];
  if (swing <= Math.PI / 2) return pages;
  if (pose.leftTop >= 0) pages.push(2 * pose.leftTop + 2);
  if (pose.rightTop >= 0) pages.push(2 * pose.rightTop + 1);
  for (const a of pose.airs) pages.push(2 * a.index + 1, 2 * a.index + 2);
  return pages;
}
