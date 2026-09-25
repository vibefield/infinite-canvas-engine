// The decade lattice — pure maths, no GPU, no DOM. Everything the mat and its
// rulers (and a mini mat's face) need to know about WHERE the lattice's sites
// are comes from here, and this file is what the unit tests pin.
//
// One identity spacing (20 world units) whose screen size picks a decade:
//   logc = log10(20·zoom / 20px)   k0 = −floor(logc)   fade = fract(logc)
//   mid = 20·10^k0   fine = mid/10 (alpha·fade)   coarse = mid·10
// Zoom is unbounded; the host wraps the camera to the coarse period so
// round(world/spacing) stays exact on the GPU. (The magnet field's atlas and
// instance grids lived here too until the dot and the needle retired, 2026-09-25.)

export const BASE_SPACING = 20;
export const LOD_TARGET = 20;
export const ZOOM_MIN = 1e-8;
export const ZOOM_MAX = 1e8;

export interface View {
  readonly camX: number;
  readonly camY: number;
  readonly zoom: number;
  /** CSS px — the attachment. */
  readonly width: number;
  readonly height: number;
  /**
   * The slot's BOX on the attachment, CSS px (PORTAL.md §2.3): what is
   * culled — a mini mat's face for a nested slot.
   * Absent = the whole attachment. Positions never change with it: a site
   * lands where it lands under the camera; the box only decides which sites
   * exist. A root slot's box is the attachment and every number is what it
   * always was.
   */
  readonly box?: Box;
}

export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** The effective box: the view's own, or the attachment. */
export const boxOf = (v: View): Box => v.box ?? { x: 0, y: 0, w: v.width, h: v.height };
/** The `box` record the uniform blocks carry: x, y, w, h. */
export const boxValues = (v: View): number[] => { const b = boxOf(v); return [b.x, b.y, b.w, b.h]; };

export interface Lod {
  readonly k0: number;
  readonly fade: number;
  readonly fine: number;
  readonly mid: number;
  readonly coarse: number;
  readonly wrapPeriod: number;
}

export const wrap = (v: number, p: number): number => ((v % p) + p) % p;

/**
 * How a rung presents itself: ONE size for every rung, and a rung's alpha is
 * `smoothstep(fadeIn, cellPx)` of its OWN cell — so a decade wrap (the fine rung
 * becoming the mid rung at the same cell) is continuous by construction, and
 * nothing is drawn below `fadeIn[0]` px of pitch: the product's classic-grid law
 * (`worldGrid.fadeIn`). The prototype's size LADDER (fine 0.55× · mid 0.85→1.25×
 * · coarse 1.55×, the fine rung's alpha the decade fade — every tenth site bigger,
 * a size pop at every wrap) was retired on 2026-09-04; nothing of it remains.
 */
export type FadeIn = readonly [number, number];

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / Math.max(b - a, 1e-3), 0), 1);
  return t * t * (3 - 2 * t);
};

export function lod(v: View): Lod {
  const screenCell = BASE_SPACING * v.zoom;
  const logc = Math.log(Math.max(screenCell, 1e-20) / LOD_TARGET) / Math.LN10;
  const floorLog = Math.floor(logc);
  // `0 - floorLog`, not `-floorLog`: at zoom 1 the latter is -0, which is a
  // different value to Object.is and to anything keyed on it.
  const k0 = Math.min(12, Math.max(-12, 0 - floorLog));
  const fade = logc - floorLog;
  const mid = BASE_SPACING * 10 ** k0;
  return { k0, fade, fine: mid / 10, mid, coarse: mid * 10, wrapPeriod: mid * 10 };
}
