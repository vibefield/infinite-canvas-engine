// The card frame's parameter sheet — a STYLE, not a card. Geometry that belongs
// to one card (centre, content size, its own radius) arrives at resolve() time;
// everything here is what all cards of a style share.
//
// THE SOCKET (2026-09-23, James's direction — the shell turned inside out):
//
//   frame = outer \ inner
//   inner = the content's own rounded rect — never cut, never covered
//   outer = the content grown by `thickness` on every side, its corner
//           concentric (radius + thickness)
//
// The ring between them is the space the card RISES into: the lift grows the
// content by `thickness`, so a lifted card is exactly the socket's outer
// silhouette and the ring is gone while the card moves (choreography.ts). The
// selection chrome and the lift's footprint are one shape, so a selected card
// never claims more of the board than a lifted one does.
//
// A control (the close, the lock) cannot live inside a ring the width of the
// lift — a 26 px button in an 8 px ring — so a style that wants them carries
// EARS: a lobe of chrome per corner, OUTSIDE the content, tangent to its
// corner arc, the control at its centre with `clearance` of chrome all round.
// The product's socket has none (DESIGN.md §8's card anatomy carries no
// corner controls); `EARS` is the style with them, for the lab and the rigs
// that exercise the part channel. (Lineage: research/sdf-card/src/params.js's
// notched frame, whose corner bays bit into the content — retired here.)

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
  /** The socket ring's width — and the lift's rise — constant on all four edges. */
  readonly thickness: number;
  /** The content's resting corner radius when a card carries none (`--vf-radius-card`). */
  readonly radius: number;
  /** Control DIAMETER at the ears; 0 = no ears and no controls. */
  readonly control: number;
  /** Control edge → the ear's edge, and → the content's edge: the ring of chrome around a control. */
  readonly clearance: number;
  /** The concave blend where an ear meets the ring's outer edge. */
  readonly fillet: number;
  readonly btn: ButtonSpec;
}

/** A socket, as a designer states it — the three numbers, and the controls if any. */
export interface SocketSpec {
  readonly name?: string;
  /** The ring = the lift's rise, CSS px at zoom 1. */
  readonly thickness: number;
  /** The card's RESTING radius (`--vf-radius-card`). */
  readonly radius: number;
  /** Control diameter (the v3 token: 26 at card scale); absent or 0 = no ears. */
  readonly control?: number;
  /** Chrome around a control, every direction; default 8 (v3's bay clearance). */
  readonly clearance?: number;
  /** The ear's blend into the ring; default = `clearance`. */
  readonly fillet?: number;
}

export function socketStyle(s: SocketSpec): FrameStyle {
  const control = Math.max(s.control ?? 0, 0);
  const clearance = s.clearance ?? 8;
  const rb = control / 2;
  return {
    name: s.name ?? "socket",
    thickness: s.thickness,
    radius: s.radius,
    control,
    clearance,
    fillet: s.fillet ?? clearance,
    // the × is 44% of the button across its box (the reference's 30/70), stroke 2 px at a 26 px control
    btn: { radius: rb, glyphW: rb * 0.72, glyphR: rb * 0.077 },
  };
}

/** An ear's radius: the control plus its ring of chrome; 0 without controls. */
export const earOf = (s: FrameStyle): number => (s.control > 0 ? s.control / 2 + s.clearance : 0);

/**
 * How far an ear reaches beyond the content rect, along an edge: the control's
 * centre sits on the corner's diagonal, `clearance` clear of the content's arc,
 * so its per-axis offset from the arc's centre is (radius + control/2 +
 * clearance)/√2, and the lobe extends `ear` past it. Negative when a large
 * radius tucks the whole ear inside the corner's pocket.
 */
export function earReachOf(s: FrameStyle, radius: number = s.radius): number {
  if (s.control <= 0) return 0;
  return (radius + s.control / 2 + s.clearance) / Math.SQRT2 - radius + earOf(s);
}

/** The farthest the chrome extends beyond the content rect at rest: the ring, or an ear past it. */
export const reachOf = (s: FrameStyle, radius: number = s.radius): number => Math.max(s.thickness, earReachOf(s, radius));

/**
 * The PRODUCT socket, CSS px at zoom 1: DESIGN.md's card radius and the
 * reference's plate proportion (8 of the old 42 px ear), which is also the
 * lift's rise — a card at rest and the same card held differ by this ring.
 */
export const PRODUCT_SOCKET: SocketSpec = { name: "product", thickness: 8, radius: 22 };
export const PRODUCT: FrameStyle = socketStyle(PRODUCT_SOCKET);

/** The socket with the two controls in ears — the v3 token (26) and clearance (8). */
export const EARS_SOCKET: SocketSpec = { ...PRODUCT_SOCKET, name: "ears", control: 26, clearance: 8 };
export const EARS: FrameStyle = socketStyle(EARS_SOCKET);

export const STYLES = { product: PRODUCT, ears: EARS } as const;

/**
 * The constraints that keep a style drawable. Returns the violations, empty
 * when valid.
 */
export function styleViolations(s: FrameStyle, contentHalf: readonly [number, number], lines: { readonly ring: number } = LINES): string[] {
  const out: string[] = [];
  const [hx, hy] = contentHalf;
  if (!(s.thickness > 0)) out.push(`thickness ${s.thickness} must be positive: the ring is the lift's rise`);
  if (s.thickness < lines.ring) out.push(`thickness ${s.thickness} is under the selection ring's width ${lines.ring}: the ring would sit on the content`);
  if (!(s.radius >= 0)) out.push(`radius ${s.radius} must not be negative`);
  if (s.radius > Math.min(hx, hy)) out.push(`radius ${s.radius} exceeds the content's half extent ${Math.min(hx, hy)}`);
  if (s.control > 0) {
    if (s.clearance < 0) out.push(`clearance ${s.clearance} must not be negative`);
    if (s.control / 2 < 12) out.push(`control radius ${s.control / 2} is under the 12 px pointer floor`);
    // two ears on one edge must not meet: their centres are 2·(half − radius + offset) apart, each `ear` wide
    const off = (s.radius + s.control / 2 + s.clearance) / Math.SQRT2;
    const ear = earOf(s);
    if (hx - s.radius + off < ear) out.push(`the top ears merge: half width ${hx} is under ${ear - off + s.radius}`);
    if (hy - s.radius + off < ear) out.push(`the left ears merge: half height ${hy} is under ${ear - off + s.radius}`);
  }
  return out;
}
