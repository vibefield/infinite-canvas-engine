// The cutting mat's line law — pure maths beside lod.ts. A rung's LINES fade in
// over the same `fadeIn` window every glyph uses (by the rung's OWN cell, so a
// decade wrap is continuous by construction), and then thicken and darken over
// the NEXT decade: thin/faint at the window's top, thick/strong ten times
// coarser. That is the reference's ladder (research/tree-shadow hero:
// fine 0.14·fade · mid 0.14→0.28, 0.5→0.75 px · coarse 0.28, 0.75 px) written
// as one function of the cell, anchored on the engine's window instead of its
// own 6 px. At a wrap the old fine rung IS the new mid rung at the same cell,
// so it draws the same line; the old coarse rung's lines are every tenth of the
// new coarse rung's and already carry the saturated weight — nothing pops.

import { type FadeIn, smoothstep } from "./lod";

export interface LineLaw {
  /** Half-widths at the window's top and a decade above it, DEVICE px (the reference's hairlines). */
  readonly thin: number;
  readonly thick: number;
  /** Coverage alphas at the same two points. */
  readonly alphaThin: number;
  readonly alphaThick: number;
}

export interface LineWeight {
  readonly halfWidth: number;   // device px
  readonly alpha: number;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** mat.wgsl `line_weight`, for a rung whose on-screen cell is `cellPx` (CSS px). */
export function lineWeight(cellPx: number, fadeIn: FadeIn, law: LineLaw): LineWeight {
  const s = smoothstep(fadeIn[0], fadeIn[1], cellPx);
  const t = clamp01(Math.log10(Math.max(cellPx, 1e-9) / Math.max(fadeIn[1], 1e-9)));
  return {
    halfWidth: law.thin + (law.thick - law.thin) * t,
    alpha: law.alphaThin * s + (law.alphaThick - law.alphaThin) * t,
  };
}
