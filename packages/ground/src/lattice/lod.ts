// The decade lattice — pure maths, no GPU, no DOM. Everything the field passes
// need to know about WHERE sites are and how many there are comes from here,
// and this file is what the unit tests pin.
//
// One identity spacing (20 world units) whose screen size picks a decade:
//   logc = log10(20·zoom / 20px)   k0 = −floor(logc)   fade = fract(logc)
//   mid = 20·10^k0   fine = mid/10 (alpha·fade)   coarse = mid·10
// Zoom is unbounded; the host wraps the camera to the coarse period so
// round(world/spacing) stays exact on the GPU.

export const BASE_SPACING = 20;
export const LOD_TARGET = 20;
export const ZOOM_MIN = 1e-8;
export const ZOOM_MAX = 1e8;
/** Above this many on-screen fine sites, one fullscreen pass beats instancing. */
export const FINE_INSTANCE_LIMIT = 40_000;

export interface View {
  readonly camX: number;
  readonly camY: number;
  readonly zoom: number;
  /** CSS px — the attachment. */
  readonly width: number;
  readonly height: number;
  /**
   * The slot's BOX on the attachment, CSS px (PORTAL.md §2.3): what is
   * instanced, baked and culled — a container's face for a nested slot.
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

export interface AtlasGeom {
  /** World units per atlas texel: the finest live rung's spacing. */
  readonly step: number;
  readonly phaseX: number;
  readonly phaseY: number;
  readonly margin: number;
  readonly originI: number;
  readonly originJ: number;
  readonly w: number;
  readonly h: number;
}

export interface RungCount {
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
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

/** magnet.wgsl `rung_alpha`, for a rung whose on-screen cell is `cellPx`. */
export const rungAlpha = (cellPx: number, fadeIn: FadeIn): number => smoothstep(fadeIn[0], fadeIn[1], cellPx);

/** The fine rung's alpha this frame — what decides whether it draws at all and what the atlas steps at. */
export const fineAlpha = (l: Lod, zoom: number, fadeIn: FadeIn): number => rungAlpha(l.fine * zoom, fadeIn);

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

/**
 * Atlas geometry — one texel per site of the finest LIVE rung (`fineLive` is
 * the fine rung's alpha this frame). The margin is DERIVED from the widest
 * glyph's reach (`reachPx`, CSS px — `glyphReachPx` in field/layout.ts), so a
 * glyph that reaches back into the viewport from outside it always finds its
 * texel: a 67-million-site sweep cleared this with zero OOB fetches.
 */
export function atlasGeom(v: View, l: Lod, reachPx: number, fineLive: number): AtlasGeom {
  const step = fineLive > 0.01 ? l.fine : l.mid;
  const cell = Math.max(step * v.zoom, 1e-6);
  const phaseX = wrap(v.camX, l.wrapPeriod);
  const phaseY = wrap(v.camY, l.wrapPeriod);
  const margin = Math.ceil((reachPx + 1.4) / cell) + 2;
  const b = boxOf(v);
  // The atlas starts at the box's top-left (in phase world: the box origin over the zoom — 0 for the root, exactly).
  return {
    step, phaseX, phaseY, margin,
    originI: Math.floor((phaseX + b.x / v.zoom) / step) - margin,
    originJ: Math.floor((phaseY + b.y / v.zoom) / step) - margin,
    w: Math.max(1, Math.floor(b.w / cell) + 2 * margin + 2),
    h: Math.max(1, Math.floor(b.h / cell) + 2 * margin + 2),
  };
}

/**
 * Instance grid per rung. +3, not +2: the origin sits one cell before the
 * viewport, so two more cells are needed to guarantee a site at or past the far
 * edge whatever the phase — the edge-site bug the pixel oracle found.
 */
export function rungCounts(v: View, l: Lod): readonly [RungCount, RungCount, RungCount] {
  const b = boxOf(v);
  const one = (spacing: number): RungCount => {
    const cell = Math.max(spacing * v.zoom, 1e-6);
    const cols = Math.ceil(b.w / cell) + 3;
    const rows = Math.ceil(b.h / cell) + 3;
    return { cols, rows, count: cols * rows };
  };
  return [one(l.fine), one(l.mid), one(l.coarse)];
}

/** Which schedule the fine rung takes this frame. */
export function fineSchedule(l: Lod, counts: readonly [RungCount, RungCount, RungCount], force: "auto" | "instanced" | "fullscreen", fineLive: number): "off" | "instanced" | "fullscreen" {
  if (fineLive <= 0.01) return "off";
  if (force === "fullscreen") return "fullscreen";
  if (force === "instanced") return "instanced";
  return counts[0].count > FINE_INSTANCE_LIMIT ? "fullscreen" : "instanced";
}
