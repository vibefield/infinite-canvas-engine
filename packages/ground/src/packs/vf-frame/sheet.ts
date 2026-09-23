// The card frame's parameter sheet — a STYLE, not a card. Geometry that belongs
// to one card (centre, content size, its own radius) arrives at resolve() time;
// everything here is what all cards of a style share.
//
// THE SHELL (2026-09-23, James's mockup — the v3 plate, turned inside out):
//
//   plate   = outer \ well        a rim of solid chrome, `band` wide
//   well    = a recess in the card's own surface, `well` wide around the content,
//             its four corners NOTCHED into rounded bays that house the controls
//   content = the widget's own rounded rect — never cut, never covered
//
// The corner COMPOSITION is the reference's (research/sdf-card), moved from the
// content to the well — the control is the centre of everything:
//
//   ear    = control/2 + clearance      the plate's outer corner arc, centred ON the control
//   bay    = control/2 + bayClearance   the arc cut into the well, centred on the control too
//   inset  = ear                        so the button clears the outer edge by `clearance`
//   fillet = ear − band                 the concave turn where the well's edge enters the bay
//   notch  = ear + bay − band           the rounded-rect notch that realises the bay
//
// The whole shell follows from six numbers; the content clears the bays when
// `styleViolations` says so. The lift UN-REVEALS the shell (choreography.ts): it
// shrinks back into the card as the card scales up, so a lifted card's silhouette
// is the shell's outer edge at the end of the lift, and nothing shows while it moves.

import { LINES } from "../../theme";

export type Corner4 = readonly [number, number, number, number];

export interface ButtonSpec {
  /** The control's radius (half the spec's diameter). */
  readonly radius: number;
  readonly glyphW: number;
  readonly glyphR: number;
}

export interface FrameStyle {
  readonly name: string;
  /** The plate's rim, constant on all four edges. */
  readonly band: number;
  /** The well: from the content's edge to the plate's rim, constant on all four edges. */
  readonly well: number;
  /** The content's resting corner radius when a card carries none (`--vf-radius-card`). */
  readonly radius: number;
  /** Control DIAMETER in the bays; 0 = no bays and no controls. */
  readonly control: number;
  /** Control edge → the plate's outer edge, every direction. */
  readonly clearance: number;
  /** Control edge → the bay's arc. */
  readonly bayClearance: number;
  /** The concave fillet where the well's edge enters a bay; tangent when `ear − band`. */
  readonly fillet: number;
  readonly btn: ButtonSpec;
}

/** A shell, as a designer states it — the composition's numbers; the rest derives. */
export interface ShellSpec {
  readonly name?: string;
  /** The plate's rim, CSS px at zoom 1. */
  readonly band: number;
  /** The well's width around the content. */
  readonly well: number;
  /** The card's RESTING radius (`--vf-radius-card`). */
  readonly radius: number;
  /** Control diameter; absent or 0 = no bays. */
  readonly control?: number;
  /** Control edge → the plate's outer edge; default 10. */
  readonly clearance?: number;
  /** Control edge → the bay's arc; default 6. */
  readonly bayClearance?: number;
  /** The fillet; default tangent (`ear − band`). */
  readonly fillet?: number;
}

export function shellStyle(s: ShellSpec): FrameStyle {
  const control = Math.max(s.control ?? 0, 0);
  const clearance = s.clearance ?? 10;
  const bayClearance = s.bayClearance ?? 6;
  const rb = control / 2;
  const ear = rb + clearance;
  return {
    name: s.name ?? "shell",
    band: s.band,
    well: s.well,
    radius: s.radius,
    control,
    clearance,
    bayClearance,
    fillet: s.fillet ?? Math.max(ear - s.band, 0),
    // the × is 44% of the button across its box (the reference's 30/70), stroke 2 px at a 26 px control
    btn: { radius: rb, glyphW: rb * 0.72, glyphR: rb * 0.077 },
  };
}

/** The derived corner numbers: the ear (the outer radius and the button's inset), the bay, the notch. */
export function cornersOf(s: FrameStyle): { ear: number; bay: number; notch: number } {
  if (s.control <= 0) return { ear: 0, bay: 0, notch: 0 };
  const rb = s.control / 2;
  const ear = rb + s.clearance;
  const bay = rb + s.bayClearance;
  return { ear, bay, notch: Math.max(ear + bay - s.band, 0) };
}

/** The plate's outer corner radius at rest: the ear when the style composes one, concentric otherwise. */
export const outerRadiusOf = (s: FrameStyle, radius: number = s.radius): number => (s.control > 0 ? cornersOf(s).ear : radius + s.well + s.band);

/** How far the shell reaches beyond the content rect at rest: the well and the rim. */
export const reachOf = (s: FrameStyle): number => s.well + s.band;

/**
 * The PRODUCT shell, CSS px at zoom 1 — James's mockup (2026-09-23), measured:
 * a 10 px rim, a 34 px well, a 32 px control inset 26 from the outer corner
 * (so the outer radius is 26), a 6 px bay clearance (the notch reaches 48 from
 * the outer corner), DESIGN.md's 22 px card radius. The rim wears §2.2's solid
 * chrome, the well the card's own surface (`--vf-card`).
 */
export const PRODUCT_SHELL: ShellSpec = { name: "product", band: 10, well: 34, radius: 22, control: 32, clearance: 10, bayClearance: 6 };
export const PRODUCT: FrameStyle = shellStyle(PRODUCT_SHELL);

/** The same plate and well with no controls — no bays, plain corners. */
export const PLAIN_SHELL: ShellSpec = { ...PRODUCT_SHELL, name: "plain", control: 0 };
export const PLAIN: FrameStyle = shellStyle(PLAIN_SHELL);

export const STYLES = { product: PRODUCT, plain: PLAIN } as const;

/**
 * The constraints that keep a style drawable and honest. Returns the violations,
 * empty when valid.
 */
export function styleViolations(s: FrameStyle, contentHalf: readonly [number, number], lines: { readonly ring: number } = LINES): string[] {
  const out: string[] = [];
  const [hx, hy] = contentHalf;
  if (!(s.band > 0)) out.push(`band ${s.band} must be positive: the plate's rim`);
  if (s.band < lines.ring) out.push(`band ${s.band} is under the selection ring's width ${lines.ring}: the ring would sit on the well`);
  if (!(s.well >= 0)) out.push(`well ${s.well} must not be negative`);
  if (!(s.radius >= 0)) out.push(`radius ${s.radius} must not be negative`);
  if (s.radius > Math.min(hx, hy)) out.push(`radius ${s.radius} exceeds the content's half extent ${Math.min(hx, hy)}`);
  if (s.control > 0) {
    const { ear, bay, notch } = cornersOf(s);
    const rb = s.control / 2;
    if (rb < 12) out.push(`control radius ${rb} is under the 12 px pointer floor`);
    if (s.clearance < 0 || s.bayClearance < 0) out.push("a clearance must not be negative");
    if (ear < s.band) out.push(`ear ${ear} is under the band ${s.band}: the fillet goes negative`);
    if (s.fillet + bay > notch + 1e-9) out.push(`fillet ${s.fillet} + bay ${bay} exceed the notch ${notch}: the corner self-intersects`);
    // the bay must not bite the content: the control's centre sits `ear` from the outer corner; a
    // card may carry ANY content radius (the style's is only the resting default), and the nearest
    // content point to the control is the corner itself at radius 0 — a rounder corner only
    // recedes from it by R(√2 − 1) — so the clearance is judged at radius 0 (review, 2026-09-23:
    // judged at the style's 22 it passed a well of 26 that bit a radius-8 card by 4.5 px)
    const M = s.well + s.band;
    const clear = (M - ear) * Math.SQRT2 - bay;
    if (clear < 0) out.push(`the bay bites the content's corner by ${(-clear).toFixed(1)} px: widen the well or shrink the bay`);
    // two notches on one edge must not meet
    const wx = hx + s.well; const wy = hy + s.well;
    if (2 * notch >= 2 * wx) out.push(`the top notches merge: well half width ${wx} is under the notch ${notch}`);
    if (2 * notch >= 2 * wy) out.push(`the left notches merge: well half height ${wy} is under the notch ${notch}`);
  }
  return out;
}
