// The MINI MAT's own theme — the container's law as numbers (moved out of the engine's src/theme.ts at K4a, design-016
// §5). Its shadow and ring are the kit's ONE PHYSICS (kit/physics.ts); its gate is the portal's (theme.ts `PORTAL`), by name.

import { PHYSICS } from "@ice/desk/kit";
import { PORTAL } from "@ice/desk";

/**
 * The MINI MAT (MINIMAT.md) — the desk's CONTAINER: a smaller self-healing cutting mat lying on
 * the big one, and inside it another desk (a nested canvas: double-click it, or zoom into it, and
 * it becomes the desk). Its sheet is the mat's own vinyl — the sage and the cream print (`MAT`),
 * the mat's chain by day and the Moon by night — so it is told from the desk by what a real small
 * mat has: its cut edge and its shadow, the printed BORDER round its cutting area (a frame line,
 * a ruler along the top and left edges — its ticks on the very lattice the face shows, numbered
 * in the inside's own units — and its NAME in the foot, as a mat's maker prints its own), and the
 * finer grid of the miniature desk inside. It is thin, so it lies flat and lifts as little as a
 * sheet does, casting the desk's one shadow (`BOOK.shadow`: the note's penumbra with a contact
 * term at the base). World units (CSS px at zoom 1).
 */
export const MINIMAT = {
  /** A new mini mat: 8 × 6 of the tree-shadow design's 80-unit modules (mat.css `--module`). */
  size: { w: 640, h: 480 },
  /** The die-cut corner; the printed border's width (the FACE is the sheet inset by it); the vinyl's thickness. */
  radius: 10, margin: 32, thick: 3,
  /** Held it rises and reads a touch larger — a thin sheet lifts less than a note (PAPER.lift 12 · 1.03); hovered it rises a fifth of that (Marks on the Mat: hover is a rise, never an outline). */
  lift: { height: 10, scale: 1.02 }, hover: 0.2,
  /** The shadow: the desk's one law. */
  shadow: PHYSICS.slab,
  /** The cut edge: a bevel this wide, catching the lamp on its near side (× 1 + light) and falling away on the far (× 1 − dark). */
  edge: { width: 1.5, light: 0.1, dark: 0.18 },
  /**
   * The print, in the mat's cream at the tree-shadow design's print-strong (55 %): the frame round the
   * face, the ruler's ticks, its numerals and the name. Its lines this wide (world units: a print
   * scales with the sheet — but never under a device px, the ink thinning instead); the ticks' lengths
   * — minor, medium, major, for the lattice's fine, mid and coarse rungs. The NUMERALS: the rulers' own
   * mono digits (RULER.md), this tall (cap, world units), after their tick by `gap`, their cap's top
   * `top` in from the sheet's edge; a rung is numbered once its sites are `labelsFrom` CSS px apart on
   * screen (its every tenth site, the next rung's, stays numbered). The NAME: the design's print label
   * (mono capitals, tracked 0.16 em) this tall, in the foot of the border from the face's left edge.
   * Text fades in as its cap grows from 4 to 6 CSS px (smaller is a smudge, never a word).
   */
  print: {
    frame: 0.55, tick: 0.55, width: 1, ticks: [5, 9, 14] as const,
    digits: { cap: 6, gap: 2.5, top: 4 }, labelsFrom: [48, 64] as const,
    name: { cap: 8, tracking: 0.16 }, legible: [4, 6] as const,
  },
  /** The sole-selection ring (DESIGN.md §7), CSS px, in `--vf-select`. */
  ring: PHYSICS.ring,
  /**
   * The face's far LOD (MINIMAT.md §5): its children drawn as CHIPS — at most this many (ICE's preview
   * record keeps 128), none smaller than this many CSS px; a note's writing GREEKED as lines of ink once
   * its chip is this tall (CSS px), at this presence, its lines this thick (× the line pitch).
   */
  chips: { max: 64, minPx: 1, greekPx: 18, greekAlpha: 0.42, greekWeight: 0.3 },
  /**
   * The face's corner (MINIMAT.md §5; D2b): the inside is clipped SQUARE — the live inside, the far LOD and a flight through it
   * (`faceClip`; its `faceLaw.radius`, K8a — the mini mat's own number, which the kit held as `FACE_RADIUS` until then).
   */
  faceRadius: 0,
  /** The live inside's GATE (CSS px of the face's short side): the portal's law (theme.ts `PORTAL`), by name. */
  gate: PORTAL.gate,
} as const;
