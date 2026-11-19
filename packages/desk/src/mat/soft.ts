// SOFT LIGHT — the gobo's second model (petition I56; mat.wgsl `soft_gobo`). A PURE module, no GPU: the numbers a
// host states, the values the mat's block carries for them, and the grade's one piece of arithmetic.
//
// The cone (the reference's projector) throws the plate from a point, in perspective, and blurs it by depth. Soft
// light lays the plate FLAT over the lamp's frame — the view in viewport space — as a plant between a window and a
// wall is seen: twice, a near layer and a larger, turned, paler far one, each read through a disc the size of the
// Sun's, so a gap smaller than the disc prints round and an edge ramps as a penumbra does. The shade is what the sky
// alone lights (cooler, never black), and a lit pixel is its albedo exactly, as under the cone.
//
// Both layers read the slot's ONE silhouette (the wind target). The mat makes that target's short mip chain only
// under this model (mat-pass.ts), because the disc's taps read the level their share of the disc covers.

import type { RGB } from "../theme";

/** One layer of soft light: where the plate lies over the view, and how it is read. */
export interface SoftLayer {
  /** The plate's centre, as fractions of the view (x right, y down; it may lie outside 0..1). */
  readonly at: readonly [number, number];
  /** The plate's side, × the view's longer side. */
  readonly span: number;
  /** The plate's turn, radians. */
  readonly turn: number;
  /** The blur disc's radius, plate texels (it grows 0.7× … 1.4× across the plate). */
  readonly disc: number;
  /** How much of the layer's shade is laid, 0..1; at 0 the layer is not sampled. */
  readonly opacity: number;
  /** CSS px the layer travels per unit of the pointer's tilt — the far layer further, which is what depth looks like. */
  readonly parallax: number;
}

/** Soft light's numbers (`MatConfig.gobo.softLight`); `SOFT_LIGHT` unless a host states its own. */
export interface SoftLight {
  readonly near: SoftLayer;
  readonly far: SoftLayer;
  /** The light comes from the other side: both layers mirrored left to right across the view. */
  readonly mirror: boolean;
  /** A whole layer's slow drift on the gobo clock, plate texels (0 = none). */
  readonly sway: number;
  /** The shade at its deepest, a LINEAR factor per channel on the albedo's light (`softShade` makes one). */
  readonly shade: RGB;
  /** The discs × this as the night comes on: the rods pool their signal over more of the retina than the cones do. */
  readonly nightDisc: number;
}

/** The sky's colour the shade is pulled toward, and the Sun's the lit ground is not lifted by (see `softShade`). */
const SKY: RGB = [0.8, 1, 1.3];
const SUN: RGB = [1, 0.74, 0.34];

/**
 * The shade's linear factor from three choices: `depth` — how deep the shade is on the display, as a share of lit
 * (0.74 is the cone's half); `sky` — how far it is pulled toward the sky's blue at equal luminance, 0..1; `sun` — the
 * Sun's warmth. A sunlit ground is warmer and a little brighter than its albedo; drawn that way every lit colour on
 * the desk would move, so the lift is divided out here instead: lit stays the albedo and the shade is deeper and
 * cooler by the same ratio.
 */
export function softShade(depth: number, sky: number, sun: number): RGB {
  const tint: RGB = [1 + (SKY[0] - 1) * sky, 1 + (SKY[1] - 1) * sky, 1 + (SKY[2] - 1) * sky];
  const y = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2];
  const d = Math.max(depth, 0) ** 2.2;
  return [(d * tint[0]) / y / (1 + sun * SUN[0]), (d * tint[1]) / y / (1 + sun * SUN[1]), (d * tint[2]) / y / (1 + sun * SUN[2])];
}

/**
 * Soft light's numbers, as VibeField tuned them for petition I56 (2026-11-19): a plant at the view's right edge and
 * the same plant again, larger and turned, from the far top corner.
 */
export const SOFT_LIGHT: SoftLight = {
  near: { at: [0.84, 0.36], span: 1.15, turn: 0, disc: 7.5, opacity: 0.9, parallax: 5 },
  far: { at: [0.1, 0.05], span: 1.5, turn: 2.5, disc: 12, opacity: 0.5, parallax: 14 },
  mirror: false,
  sway: 1.6,
  shade: softShade(0.7, 0.2, 0.12),
  nightDisc: 1.15,
};

/** The six soft records of the mat's block, by name (MatUniforms): all zero under the cone, where none is read. */
export function softValues(on: boolean, s: SoftLight, tilt: readonly [number, number] | undefined): {
  soft: number[]; softNear: number[]; softFar: number[]; softDisc: number[]; softShade: number[]; softTilt: number[];
} {
  if (!on) return { soft: [0, 0, 0, 0], softNear: [0, 0, 0, 0], softFar: [0, 0, 0, 0], softDisc: [0, 0, 0, 0], softShade: [0, 0, 0, 0], softTilt: [0, 0, 0, 0] };
  return {
    soft: [1, s.mirror ? 1 : 0, s.sway, s.nightDisc],
    softNear: [s.near.at[0], s.near.at[1], s.near.span, s.near.turn],
    softFar: [s.far.at[0], s.far.at[1], s.far.span, s.far.turn],
    softDisc: [s.near.disc, s.far.disc, s.near.opacity, s.far.opacity],
    softShade: [s.shade[0], s.shade[1], s.shade[2], 0],
    softTilt: [tilt?.[0] ?? 0, tilt?.[1] ?? 0, s.near.parallax, s.far.parallax],
  };
}
