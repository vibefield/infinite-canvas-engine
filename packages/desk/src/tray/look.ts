// THE PEGBOARD'S LOOK (design-017 §6.5–§6.6) — theme.ts's `TRAY` law as the pass reads it: the three materials linear, the
// punched edge derived from the face by the research's edge/face albedo ratio.

import { linear } from "../mat/night";
import { type RGB, rgb, TRAY } from "../theme";

const faceSrgb = rgb(TRAY.face.css);
const face = linear(faceSrgb);
const { research } = TRAY;

export const TRAY_LOOK = {
  /** The tempered hardboard face — and the byte it is configured as (a flat, lit face is drawn at exactly this). */
  face,
  faceSrgb,
  /** The paler, fuzzier punched edge: the face scaled by the research's edge/face ratio. */
  edge: [0, 1, 2].map((i) => (face[i] as number) * ((research.edge[i] as number) / (research.face[i] as number))) as unknown as RGB,
  /** The painted plaster wall behind the board. */
  wall: research.wall as unknown as RGB,
  /** The room's light on the wall in a hole: at its edge, at its heart, over what width (pitches). */
  cavity: TRAY.cavity,
  /** The lamp's angular radius, rad. */
  lampSize: TRAY.lampSize,
} as const;
