// The card frame's parameter sheet — a STYLE, not a card. Geometry that belongs
// to one card (centre, content size) arrives at resolve() time; everything here
// is what all cards of a style share. (Lineage: research/sdf-card/src/params.js,
// whose numbers came from a least-squares fit against the reference image.)
//
//   frame = outer \ inner
//   outer = rounded rect
//   inner = rounded rect with a rounded-rect NOTCH cut flush into each corner
//
// Corners are TL TR BR BL. Notch height and the fillet against the horizontal
// edge were authored constants in the reference; width and the vertical fillet
// are what vary (BR's wide notch is the shelf).

import { LINES } from "../theme.ts";

export type Corner4 = readonly [number, number, number, number];

export interface ButtonSpec {
  /** Centre inset from the OUTER corner, in card units. */
  readonly insetX: number;
  readonly insetY: number;
  readonly radius: number;
  readonly glyphW: number;
  readonly glyphR: number;
}

export interface FrameStyle {
  readonly name: string;
  /** Border thickness — constant on all four edges. */
  readonly thickness: number;
  readonly nw: Corner4;
  readonly nh: Corner4;
  /** Concave fillet radius of the notch. */
  readonly rho: Corner4;
  /** Convex fillet against the horizontal / vertical inner edge. */
  readonly rfH: Corner4;
  readonly rfV: Corner4;
  /**
   * Default CONTENT corner radius per corner, used when a card does not carry
   * its own. The outer radius is always content radius + thickness — the
   * reference fit already satisfies that (44.25 + 23.06 = 67.31).
   */
  readonly baseR: Corner4;
  /**
   * The REVEALED outer corner radius. Absent = concentric with the content
   * (content radius + thickness), which is right when the corner is a plain
   * rounded corner. A composed corner sets it to the ear's radius instead — the
   * button's centre is the arc's centre, so the chrome around the button is a
   * ring of one width (see `composeStyle`).
   */
  readonly outerR?: number;
  readonly btn: ButtonSpec;
}

/** The fit, in reference pixels (a 1942.84 × 939.52 card). */
export const REFERENCE: FrameStyle = {
  name: "reference fit",
  thickness: 23.06,
  nw: [100.91, 93.11, 515.77, 100.92],
  nh: [92.19, 92.51, 92.26, 92.31],
  rho: [56.21, 53.82, 56.30, 56.41],
  rfH: [33.30, 33.00, 33.47, 33.36],
  rfV: [32.51, 27.67, 41.60, 32.36],
  baseR: [44.25, 44.25, 44.25, 44.25],
  btn: { insetX: 62.57, insetY: 64.07, radius: 35.20, glyphW: 25.0, glyphR: 2.5 },
};

/** Same card, authored numbers. Visually identical; what one would ship at that scale. */
export const CLEAN: FrameStyle = {
  ...REFERENCE, name: "clean",
  thickness: 23,
  nw: [101, 93, 516, 101], nh: [92, 92, 92, 92], rho: [56, 54, 56, 56],
  rfH: [33, 33, 33, 33], rfV: [33, 28, 42, 33], baseR: [44, 44, 44, 44],
};

/** No notches: a constant-width rounded frame. */
export const PLAIN: FrameStyle = { ...REFERENCE, name: "plain", nw: [0, 0, 0, 0], nh: [0, 0, 0, 0] };

/** Reference card size, for tests and the compare view. */
export const REFERENCE_CARD = { centre: [1000.147, 532.194] as const, outerHalf: [971.42, 469.76] as const };

/** Uniformly scale a style — every number is a length, so this is exact. */
export function scaleStyle(s: FrameStyle, k: number, name = `${s.name} ×${k}`): FrameStyle {
  const c = (v: Corner4): Corner4 => [v[0] * k, v[1] * k, v[2] * k, v[3] * k];
  return {
    name, thickness: s.thickness * k,
    nw: c(s.nw), nh: c(s.nh), rho: c(s.rho), rfH: c(s.rfH), rfV: c(s.rfV), baseR: c(s.baseR),
    ...(s.outerR === undefined ? {} : { outerR: s.outerR * k }),
    btn: { insetX: s.btn.insetX * k, insetY: s.btn.insetY * k, radius: s.btn.radius * k, glyphW: s.btn.glyphW * k, glyphR: s.btn.glyphR * k },
  };
}

/**
 * The corner COMPOSITION — how a corner that houses a control is built, in the
 * order a designer would draw it. The control is the centre of everything:
 *
 *   ear  = control/2 + clearance      the plate's outer corner arc, centred ON the control
 *   bay  = control/2 + bayClearance   the arc cut into the card, centred on the control too
 *   inset = ear                       so the button clears the outer edge by `clearance`
 *                                     in EVERY direction — along both edges and on the diagonal
 *   fillet = ear − thickness          the concave turn where the card's edge enters the bay,
 *                                     tangent to the bay's arc (no straight wall between them)
 *   notch  = ear + bay − thickness    the rounded-rect notch that realises the bay
 *
 * A control, a ring of chrome `clearance` wide, and the card shaped around it —
 * which is the reference image (its fit has the button 5 px off the arc's
 * centre and the bay 0.83× the ear; the composition makes both exact) and the
 * card-redesign v3 shell (control 26 · clearance 8 · fillet 10 · card 22). The
 * whole corner follows from three numbers; nothing can collide.
 */
export interface CornerSpec {
  readonly name?: string;
  /** The plate band, all four edges. Must not exceed `ear` (the fillet would go negative). */
  readonly thickness: number;
  /** Control DIAMETER (the v3 token: 26 at card scale; §8's 40 is window chrome). */
  readonly control: number;
  /** Control edge → the plate's outer edge, every direction. */
  readonly clearance: number;
  /** Control edge → the bay's arc; default = `clearance` (a uniform ring). */
  readonly bayClearance?: number;
  /** The concave fillet; default = tangent (`ear − thickness`). Smaller leaves a straight wall. */
  readonly fillet?: number;
  /** BR: extra straight run — the capsule that holds more controls. 0 = a round bay like the others. */
  readonly shelf?: number;
  /** The card's RESTING radius (`--vf-radius-card`); the content's corner where no bay is cut. */
  readonly radius: number;
}

export function composeStyle(c: CornerSpec): FrameStyle {
  const rb = c.control / 2;
  const ear = rb + c.clearance;
  const bay = rb + (c.bayClearance ?? c.clearance);
  const fillet = c.fillet ?? ear - c.thickness;
  const notch = ear + bay - c.thickness;
  const shelf = c.shelf ?? 0;
  return {
    name: c.name ?? "composed",
    thickness: c.thickness,
    outerR: ear,
    nw: [notch, notch, notch + shelf, notch],
    nh: [notch, notch, notch, notch],
    rho: [bay, bay, bay, bay],
    rfH: [fillet, fillet, fillet, fillet],
    rfV: [fillet, fillet, fillet, fillet],
    baseR: [c.radius, c.radius, c.radius, c.radius],
    // the × is 44% of the button across its box (the reference's 30/70), stroke 2 px at a 26 px control
    btn: { insetX: ear, insetY: ear, radius: rb, glyphW: rb * 0.72, glyphR: rb * 0.077 },
  };
}

/**
 * The PRODUCT corner, CSS px at zoom 1: DESIGN.md's card radius, the v3 shell's
 * control and clearance, and a plate the reference's proportion of the ear
 * (23 : 124 ≈ 0.19 → 8 of 42). NOT a pure scale of the reference — at the
 * product's card size its 12 px button is under the pointer floor.
 */
export const PRODUCT_CORNER: CornerSpec = {
  name: "product",
  thickness: 8,
  control: 26,
  clearance: 8,
  radius: 22,
};
export const PRODUCT: FrameStyle = composeStyle(PRODUCT_CORNER);

export const STYLES = { reference: REFERENCE, clean: CLEAN, plain: PLAIN, product: PRODUCT } as const;

/**
 * The constraints that keep a style from self-intersecting (README §8 of the
 * study). Returns the violations, empty when valid.
 */
export function styleViolations(s: FrameStyle, contentHalf: readonly [number, number], lines: { readonly ring: number } = LINES): string[] {
  const out: string[] = [];
  const [hx, hy] = contentHalf;
  const eps = 1e-6;   // a composed corner is tangent by construction: rf + rho == nw to the last bit
  if (!(s.thickness < Math.min(hx, hy))) out.push(`thickness ${s.thickness} ≥ min content half ${Math.min(hx, hy)}`);
  for (const i of [0, 1, 2, 3] as const) {
    if (s.nw[i] <= 0 || s.nh[i] <= 0) continue;
    if (s.nw[i] > hx) out.push(`corner ${i}: nw ${s.nw[i]} > content half ${hx}`);
    if (s.nh[i] > hy) out.push(`corner ${i}: nh ${s.nh[i]} > content half ${hy}`);
    if (s.rfH[i] + s.rho[i] > s.nh[i] + eps) out.push(`corner ${i}: rfH + rho ${s.rfH[i] + s.rho[i]} > nh ${s.nh[i]}`);
    if (s.rfV[i] + s.rho[i] > s.nw[i] + eps) out.push(`corner ${i}: rfV + rho ${s.rfV[i] + s.rho[i]} > nw ${s.nw[i]}`);
  }
  if (s.nw[0] + s.nw[1] >= 2 * hx) out.push(`top notches merge: ${s.nw[0]} + ${s.nw[1]} ≥ ${2 * hx}`);
  if (s.nw[3] + s.nw[2] >= 2 * hx) out.push(`bottom notches merge: ${s.nw[3]} + ${s.nw[2]} ≥ ${2 * hx}`);
  // The button must clear the OUTER edge by at least the §7 selection ring's
  // width — along both edges and across the corner arc. (The old product
  // style failed this: card radius 22 + 3.5 put the arc's centre 10 px from
  // the button's, leaving 0.65 px on the diagonal, and the 1.5 px ring cut
  // straight through the button.)
  const Ro = s.outerR ?? s.baseR[0] + s.thickness;
  const { insetX, insetY, radius } = s.btn;
  const straight = Math.min(insetX, insetY) - radius;
  const arc = Ro - Math.hypot(Math.max(Ro - insetX, 0), Math.max(Ro - insetY, 0)) - radius;
  const need = lines.ring;
  if (straight < need - eps) out.push(`button within the ring's width of the outer edge: ${straight.toFixed(2)} < ${need}`);
  if (arc < need - eps) out.push(`button within the ring's width of the outer corner arc: ${arc.toFixed(2)} < ${need} (outer radius ${Ro}, inset ${insetX}×${insetY})`);
  return out;
}
