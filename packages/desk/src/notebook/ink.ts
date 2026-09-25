// INK on the notebook's pages (NOTEBOOK.md §7) — the pure half: what a stroke is, how wide a
// pen writes, where a page's point lands in its raster. The host rasterises (lab/notebook-ink.ts,
// Canvas2D — the sticky note's own path, STICKY.md §3) into layers of one texture array; the
// pass samples a page's layer by its number, so the ink turns with the sheet it is on and
// crosses the gutter's curve, the dapple and the night like the paper under it.
//
// Page units: `s` along the page from the gutter (world units, 0 … the page's width), `y` down
// the page from the head (0 … its height). Recto and verso share them: a sheet's two faces
// are the same (s, y) seen from either side.

import type { RGB } from "../theme";

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
