// The PAPER's law — pure: no GPU. A sticky note on the desk is a rect with a
// tilt; `resolvePaper` turns it and its motion (held · selected · fading)
// into the GEOMETRY the pass draws and the hit-test reads, in plain numbers,
// and the functions beside it are the CPU mirror of paper.wgsl — the local
// frame, the sheet's distance, its height off the mat — so what is clicked is
// what is drawn. The lamp is the mat's gobo projector (MAT.md), placed on the
// desk plane in world units by `lampOf`: one light for the dapple, the
// paper's shading and its shadow. The raster ladder (`rasterBand`) decides
// how many texels a note's ink is drawn with at a zoom, with hysteresis so a
// note re-rasters on a band crossing, never on a frame.

import { type Lamp, lampOf } from "../mat/lamp";
import { sdRoundBox } from "../sdf";
import { PAPER } from "./theme";
import { hashHand } from "../kit/text";

/** The paper's numbers (theme.ts `PAPER`) — the engine's unless a host tweaks them. */
export interface PaperLaw {
  readonly size: number;
  readonly radius: number;
  readonly tilt: number;
  readonly glue: number;
  readonly curl: number;
  readonly cornerCurl: number;
  readonly relief: number;
  readonly lift: { readonly height: number; readonly scale: number };
  readonly shadow: { readonly sigma: number; readonly alpha: number; readonly sigmaPerUnit: number; readonly alphaHeld: number; readonly slopeMax: number };
  readonly grain: number;
  readonly ring: number;
  readonly caret: { readonly width: number; readonly blinkMs: number };
}
export const DEFAULT_PAPER_LAW: PaperLaw = PAPER;

// The lamp is the MAT's (mat/lamp.ts — D7 #5): every kind's shadow falls from it; the paper keeps its door for its importers.
export { type Lamp, lampOf } from "../mat/lamp";

/** A note's tilt from its seed: within ± `maxDeg`, radians — never square, never the same twice. */
export const tiltOf = (seed: number, maxDeg: number): number => ((hashHand(seed, 11)[1] - 0.5) * 2 * maxDeg * Math.PI) / 180;

export interface PaperRect {
  /** World centre. */
  readonly cx: number; readonly cy: number;
  /** The sheet, world units. */
  readonly w: number; readonly h: number;
  /** Radians; positive turns clockwise on screen. */
  readonly angle: number;
}

/** What moves: the hold's lift (0..1), the selection ring's presence (0..1), the presence itself (1 … 0 gone). */
export interface PaperMotion { readonly held: number; readonly ring: number; readonly fade: number }
export const PAPER_REST: PaperMotion = { held: 0, ring: 0, fade: 1 };

export interface PaperGeometry {
  readonly centre: readonly [number, number];
  /** Half extents as drawn (the hold's scale applied). */
  readonly half: readonly [number, number];
  readonly cos: number; readonly sin: number; readonly angle: number;
  /** World units off the mat: the hold's rise; the free edge's curl over it; the corners' extra; the flat strip's share. */
  readonly lift: number; readonly curl: number; readonly cornerCurl: number; readonly glue: number;
  /** The slope's exaggeration for the shading. */
  readonly relief: number;
  readonly radius: number;
  readonly shadow: { readonly sigma: number; readonly alpha: number; readonly sigmaPerUnit: number };
  /** The shadow's ground offset per unit of height, world axes — away from the lamp, capped. */
  readonly slope: readonly [number, number];
  /** The unit direction to the lamp, world axes (x right, y down the screen, z off the desk). */
  readonly lamp: readonly [number, number, number];
  readonly ring: number;
  readonly alpha: number;
  readonly scale: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function resolvePaper(n: PaperRect, m: PaperMotion, law: PaperLaw, lamp: Lamp): PaperGeometry {
  const scale = 1 + (law.lift.scale - 1) * m.held;
  const dx = lamp.x - n.cx;
  const dy = lamp.y - n.cy;
  const h = Math.max(lamp.h, 1e-6);
  const len = Math.hypot(dx, dy, h);
  let sx = -dx / h;
  let sy = -dy / h;
  const s = Math.hypot(sx, sy);
  if (s > law.shadow.slopeMax) { sx *= law.shadow.slopeMax / s; sy *= law.shadow.slopeMax / s; }
  return {
    centre: [n.cx, n.cy], half: [(n.w / 2) * scale, (n.h / 2) * scale],
    cos: Math.cos(n.angle), sin: Math.sin(n.angle), angle: n.angle,
    lift: law.lift.height * m.held, curl: law.curl, cornerCurl: law.cornerCurl, glue: law.glue, relief: law.relief, radius: law.radius,
    shadow: { sigma: law.shadow.sigma, alpha: mix(law.shadow.alpha, law.shadow.alphaHeld, m.held), sigmaPerUnit: law.shadow.sigmaPerUnit },
    slope: [sx, sy], lamp: [dx / len, dy / len, h / len],
    ring: m.ring, alpha: m.fade, scale,
  };
}

/** World → the sheet's own frame (paper.wgsl `paper_local`). */
export function localOf(G: PaperGeometry, wx: number, wy: number): readonly [number, number] {
  const x = wx - G.centre[0];
  const y = wy - G.centre[1];
  return [G.cos * x + G.sin * y, -G.sin * x + G.cos * y];
}
/** The sheet's own frame → world. */
export function worldOf(G: PaperGeometry, qx: number, qy: number): readonly [number, number] {
  return [G.centre[0] + G.cos * qx - G.sin * qy, G.centre[1] + G.sin * qx + G.cos * qy];
}

/** The sheet's signed distance at a world point. */
export function sdPaper(G: PaperGeometry, wx: number, wy: number): number {
  const [qx, qy] = localOf(G, wx, wy);
  return sdRoundBox(qx, qy, G.half[0], G.half[1], G.radius);
}
export type PaperHit = "paper" | "outside";
export const pickPaper = (G: PaperGeometry, wx: number, wy: number): PaperHit => (sdPaper(G, wx, wy) < 0 ? "paper" : "outside");

/**
 * The sheet's height off the mat at a local point (paper.wgsl `paper_height`):
 * the hold's rise everywhere; flat under the strip; from the strip's lower edge
 * to the free edge the curl rises as t², the corners by `cornerCurl` more.
 */
export function heightAt(G: PaperGeometry, qx: number, qy: number): number {
  const hy = G.half[1];
  const hx = Math.max(G.half[0], 1e-6);
  const flat = -hy + G.glue * 2 * hy;
  const t = Math.min(Math.max((qy - flat) / Math.max(2 * hy * (1 - G.glue), 1e-6), 0), 1);
  const corner = Math.min(Math.abs(qx) / hx, 1) ** 6;
  return G.lift + G.curl * t * t * (1 + G.cornerCurl * corner);
}

/** How far the shadow can reach past the sheet, world units — the vertex quad's pad. */
export function shadowReach(G: PaperGeometry): number {
  const hmax = G.lift + G.curl * (1 + G.cornerCurl);
  return Math.hypot(G.slope[0], G.slope[1]) * hmax + 2.5 * (G.shadow.sigma + G.shadow.sigmaPerUnit * hmax);
}

/** The sheet's axis-aligned bounds in world units, grown by `pad`. */
export function boundsOf(G: PaperGeometry, pad = 0): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const ex = Math.abs(G.cos) * G.half[0] + Math.abs(G.sin) * G.half[1] + pad;
  const ey = Math.abs(G.sin) * G.half[0] + Math.abs(G.cos) * G.half[1] + pad;
  return { x: G.centre[0] - ex, y: G.centre[1] - ey, w: 2 * ex, h: 2 * ey };
}

// ---------------------------------------------------------------- the raster ladder

/** Texels per world unit a note's ink is drawn with: the bands are powers of two between these. */
export const BAND_MIN = 0.25;
export const BAND_MAX = 8;

/**
 * The band for a zoom: the smallest power of two at or above the screen's own
 * density (`zoom × dpr`), so the ink is never magnified — and, given the band
 * in use, that band stays while it is still at or above the density and under
 * 2.3× it (a hysteresis that crosses no band on a frame's wobble). `cap` is the
 * most the note's raster may take (the page's side over the note's).
 */
export function rasterBand(zoom: number, dpr: number, current = 0, cap = BAND_MAX): number {
  const target = zoom * dpr;
  const hi = Math.min(BAND_MAX, cap);
  if (current > 0 && (target <= current * 1.0001 || current >= hi) && target >= current / 2.3) return current;
  // the rungs are √2 apart: the ink is never magnified, and never drawn with more than √2 the texels it shows
  const b = 2 ** (Math.ceil(2 * Math.log2(Math.max(target, 1e-9)) - 1e-9) / 2);
  return Math.min(Math.max(b, BAND_MIN), hi);
}
