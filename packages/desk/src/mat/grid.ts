// A slot's GRID — the cutting mat, the one grid the ground draws since the dot
// and the needle retired (2026-09-25; MINIMAT.md §1). What a slot says about its
// ground each frame (`SlotFrame`: its view, the zoom its lattice is dressed for,
// the mat's clocks, its presentation, its light) and the grid's config (the
// fade-in window every rung reads, and the mat's own tuning).

import { type FadeIn, lod, type View } from "../lattice/lod";
import type { Presentation } from "../nav/portal";
import { GRID } from "../theme";
import { DEFAULT_MAT_CONFIG, type MatConfig, type MatFrame, type SlotLight } from "./layout";

export interface GridConfig {
  /** A rung fades in between these cell sizes, CSS px (lod.ts `FadeIn`) — the mat's lines, the rulers' ticks, a mini mat's face. */
  readonly fadeIn: FadeIn;
  /** The cutting mat's tuning (mat/layout.ts) — theme.ts's numbers unless a host tweaks them. */
  readonly mat: MatConfig;
}

/** The engine's grid: the fade-in law and the mat as theme.ts has them. */
export const DEFAULT_GRID: GridConfig = { fadeIn: GRID.fadeIn, mat: DEFAULT_MAT_CONFIG };

/** One slot's frame: the root's, a flight's departed one, or a mini mat's inside. */
export interface SlotFrame {
  readonly view: View & { readonly dpr: number };
  /**
   * The zoom this slot's lattice is DRESSED for (PORTAL.md §9): its fade-in window scales by
   * `view.zoom / lodZoom`, so the grid looks like the grid at `lodZoom`, scaled — a mini mat's
   * face shows its inside as it will look at the arrival, an arriving slot lands on its own
   * dressing, a departed one keeps the cut's. Absent = the view's zoom: the root at rest.
   */
  readonly lodZoom?: number;
  /** The mat's clocks and tilt for this frame; absent = a still (STILL_MAT_FRAME). */
  readonly mat?: MatFrame;
  /** Opacity and the portal clip (nav/portal.ts); absent = everything, at full strength. */
  readonly present?: Presentation;
  /**
   * The lamp this slot is lit by (MINIMAT.md §4; mat/layout.ts `SlotLight`). Absent = the
   * host's: a mini mat's inside lies under the lamp of the desk the mini mat lies on, so the
   * ground hands every nested slot its parent's light, and the root its own camera.
   */
  readonly light?: SlotLight;
}

/**
 * The scale a lattice is dressed by for `lodZoom` (PORTAL.md §9): `σ = zoom / lodZoom` — the
 * lattice at `lodZoom` scaled whole — floored at `GRID.dressFloor` (a miniature's grid is never
 * finer than that share of the desk's). 1 = the identity: the object itself, not a copy.
 */
export function dressScale(zoom: number, lodZoom?: number): number {
  if (lodZoom === undefined || !(lodZoom > 0) || lodZoom === zoom) return 1;
  return Math.max(zoom / lodZoom, GRID.dressFloor);
}

/** The grid a slot renders with when dressed for `lodZoom`: its fade-in window scaled by `dressScale`. */
export function dressGrid(cfg: GridConfig, zoom: number, lodZoom?: number): GridConfig {
  const s = dressScale(zoom, lodZoom);
  if (s === 1) return cfg;
  return { ...cfg, fadeIn: [cfg.fadeIn[0] * s, cfg.fadeIn[1] * s] };
}

/** What a slot's grid did this frame: the lattice's decade and its fade, and whether the wind blew. */
export interface GridStats { readonly k0: number; readonly fade: number; readonly wind: boolean }

/** The stats of a view's lattice (the wind the pass reports). */
export const gridStats = (view: View, wind: boolean): GridStats => { const l = lod(view); return { k0: l.k0, fade: l.fade, wind }; };
