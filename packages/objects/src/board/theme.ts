// The WHITEBOARD's own theme — its law as numbers (moved out of the engine's src/theme.ts at K4a, design-016 §5). What it
// shares with the note and the notebook — the lift, the slab's shadow, the face's light, the ring — is the kit's ONE
// PHYSICS (kit/physics.ts), by name.

import { PHYSICS } from "@ice/desk/kit";

/**
 * The WHITEBOARD (BOARD.md) — a desk dry-erase board under the mat's one lamp, ONE PHYSICS with
 * the note and the notebook: it lifts as they lift (`PAPER.lift`), its slab casts the note's
 * penumbra swept down its height with the notebook's contact term at its base (`BOOK.shadow`),
 * and a face reads by the notebook's light (`BOOK.light`). What a board has of its own is the
 * research whiteboard (research/whiteboard): melamine with an orange-peel grain and a sheen that
 * slides with the eye, felt-tip ink laid by max-blended stamps — streaky when fast, bleeding when
 * held, glossy while wet — and an eraser that leaves a ghost. The board is 3:2 like every
 * whiteboard, on the tree-shadow design's 80-unit module, at the notebook's scale: 480 × 320
 * beside the A6 notebook's 176 × 248 is a ~29 × 19 cm desk board. World units throughout; the
 * research's tip and stroke numbers were CSS px on a full-screen board and are scaled into them.
 * The colours are the product's (lab/theme.ts `BOARD_LOOK`, `MARKERS`).
 */
export const BOARD = {
  /** A board as a host spawns one: its outer size, the aluminium frame's width, the frame's outer radius, the slab's height, the melamine's recess below the frame's top. */
  spec: { width: 480, height: 320, frame: 9, radius: 7, thick: 8, recess: 1.2 },
  lift: PHYSICS.lift,
  shadow: PHYSICS.slab,
  light: PHYSICS.light,
  /**
   * The melamine: its tone's drift (±), its orange-peel grain (±/255), the ghost old erasures
   * leave; the SHEEN — the window's reflection — its strength, its spread, the eye's height over
   * the board (× the board's height) and how far it slides with the pointer; the frame's lip on
   * the surface: its shadow's alpha and σ.
   */
  surface: { tone: 0.012, grain: 1.5 / 255, ghost: 0.012, sheen: 0.16, spread: 0.35, eye: 1.6, parallax: 0.12, lip: { alpha: 0.2, sigma: 0.9 } },
  /** The frame: brushed along its length (±/255), its profile's roll at the rims (rad), the metal's glint. */
  frame: { brushed: 9 / 255, roll: 0.85, glint: 0.35 },
  /** The ink raster (texels per world unit — the open board fills the view at ~1.8× on a 2× display), how long fresh ink stays wet (s) and how dark it lays wet, the film's edge relief. */
  ink: { density: 4, wetSeconds: 1.2, wetDarken: 0.8, film: 0.04 },
  /** The tips, world units: half extents (along, across the tip), corner radius, edge softness, the angle it is held at (deg). The research's, scaled to the desk board. */
  tips: {
    fine: { half: [0.75, 0.75], radius: 0.75, softness: 0.3, angle: 0 },
    bullet: { half: [1.35, 1.35], radius: 1.35, softness: 0.35, angle: 0 },
    chisel: { half: [2.4, 0.9], radius: 0.5, softness: 0.35, angle: -50 },
  },
  eraser: { half: [16, 7], radius: 2.5, softness: 1.6, angle: 8 },
  /**
   * The felt: its streaks (strength, lanes per world unit across, drift along ×2), how fast a
   * stroke runs dry (world units/s: from, full) and how much flow it loses, a held pen's bleed
   * (after ms, growth, its time constant ms), and the stamps' pitch (× the tip's narrow half, clamped).
   */
  felt: { streak: 0.45, lanes: 0.75, along: [0.058, 0.145], dry: [200, 1450], dryLoss: 0.16, bleed: { after: 150, grow: 0.35, tau: 700 }, pitch: { k: 0.3, min: 0.12, max: 0.5 } },
  /** The pen in the hand and on the board: its length, barrel radius, the cap's length, how steeply it rises from the tip (height per unit of length), how high it hovers unpressed, its lean with speed (rad). */
  pen: { length: 150, radius: 6.5, cap: 42, rise: 0.18, hover: 6, lean: 0.16 },
  /** The eraser in the hand: the felt block's half extents, the felt's and the wooden back's heights. */
  block: { half: [18, 8], felt: 4, wood: 10 },
  ring: PHYSICS.ring,
  /** The open board: CSS px kept clear round it and for the tray under it, the zoom band, and the pinch-out that closes it (× the framing's zoom). */
  focus: { pad: 48, tray: 92, minZoom: 0.5, maxZoom: 3, close: 0.72 },
} as const;
