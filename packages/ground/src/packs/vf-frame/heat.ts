// The §7 overlap HEAT's pure parts (GLOW.md): the LIGHT a lifted card casts on
// the card under it, and the frame uniforms' knobs from the theme.
//
// The lifted card is an emitting surface floating `height` above the target.
// What the target receives at a point is the half-plane irradiance with the
// SOURCE's own distance field as the edge distance:
//
//     lit(d) = ½ · (1 − d / √(d² + h²))
//
// 1 deep under the card, ½ at its silhouette, h²/4d² far away — the exact
// answer for a straight edge, and the source's rounded corners follow its
// field. One sqrt per fragment. The record carries the source's silhouette
// (centre, half extents, radius — its resolved, lifted geometry); the shader
// reads nothing but its own record (never a uniform of the picked card: N
// drags, and the fade-out after a drop has no dragged card left to read).

import type { Rect } from "../../nav/flight";
import { type RGB, SHADOW } from "../../theme";
import type { Geometry } from "./choreography";

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * §7 the overlap glow and rim — a drop target's HEAT (GLOW.md): the LIFTED card is
 * an emitting surface floating `height` above the target, and the target receives
 * its light through the source's own distance field. `height` is the §5 lift
 * recipe's own number — the lifted shadow's 30 px offset is how far the card
 * floats. The colours and the tier alphas [reject `c`, accept `t`] and the rim's
 * width are the CardShell's `--ic-glow-*` / `--ic-rim-*` tokens by name; the
 * CardShell's blur, offset and radial (a hot-POINT anatomy, what CSS could do)
 * are retired by the light. Card units: they ride the card's transform, as LINES do.
 */
export interface Heat {
  readonly height: number;
  readonly alpha: readonly [number, number];
  readonly rim: { readonly width: number; readonly alpha: readonly [number, number] };
}
export const HEAT: Heat = { height: SHADOW.lifted.offset, alpha: [0.25, 0.5], rim: { width: 1.5, alpha: [0.55, 0.85] } };

/** A light source: a rounded rect in card units — the lifted card's silhouette. */
export interface LightSource { readonly x: number; readonly y: number; readonly hx: number; readonly hy: number; readonly r: number }

/** The source a resolved card makes — its OUTER silhouette as drawn, lift scale included. */
export const sourceOf = (G: Geometry): LightSource => ({ x: G.centre[0], y: G.centre[1], hx: G.half[0], hy: G.half[1], r: G.outerR });

/** The irradiance from an emitting surface `h` above the receiver, at signed distance `d` from its silhouette (negative inside). */
export const irradiance = (d: number, h: number): number => 0.5 * (1 - d / Math.sqrt(d * d + Math.max(h, 1e-3) ** 2));

/** The uniform block's heat: the two colours and the two knob vectors the fragment reads (`glowK`, `rimK`). */
export function heatValues(theme: { readonly glow: RGB; readonly rim: RGB }, h: Heat = HEAT): { colGlow: number[]; colRim: number[]; glowK: number[]; rimK: number[] } {
  return {
    colGlow: [theme.glow[0], theme.glow[1], theme.glow[2], 1],
    colRim: [theme.rim[0], theme.rim[1], theme.rim[2], 1],
    glowK: [h.height, h.alpha[0], h.alpha[1], 0],
    rimK: [h.rim.width, h.rim.alpha[0], h.rim.alpha[1], 0],
  };
}
