// The NOTEBOOK's spec as BOOK.md set it (moved out of the engine's src/theme.ts at K4a, design-016 §5). The 3D notebook
// draws by its own law (notebook/law.ts); what the book shares with the note, the whiteboard and the mini mat — the lift,
// the slab's shadow, the face's light, the ring — is the kit's ONE PHYSICS (kit/physics.ts), by name.

import { PHYSICS } from "@ice/desk/kit";

/**
 * The NOTEBOOK (BOOK.md) — a desk object under the mat's lamp, ONE PHYSICS with the sticky
 * note: it lifts as the note lifts and casts as the note casts (`PAPER`'s numbers, by name),
 * plus what a slab has and a sheet has not — a CONTACT shadow at its base (the tree-shadow
 * design system's paper elevation, mat.css `--lift-1`: a tight `-1px 2px 0 cast/.22` under the
 * soft `-3px 5px 10px`), the lamp's fill on a face turned from it (the cover mid-swing), and
 * the materials: the page's fibre is the note's grain; the board wears a cloth, a rolled edge
 * and the spine's roll; a bound page dips into the gutter; a stack shows its sheets' edges.
 * Lengths are world units (CSS px at zoom 1); the colours are the product's (lab/theme.ts).
 */
export const BOOK = {
  lift: PHYSICS.lift,
  /** The slab's shadow: the note's penumbra with a contact term at its base — the one physics's (kit/physics.ts). */
  shadow: PHYSICS.slab,
  /** The lamp's fill on a face: the one physics's. */
  light: PHYSICS.light,
  /**
   * The leaves' dapple on the object, as a share of the mat's own (1 = the reference's shade, floor 0.5):
   * a PAGE takes it gently so writing under the palm stays legible (thinking-the-desk §6 guardrail 3),
   * a board takes it whole. BOOK.md Q-b — James's to rule.
   */
  dapple: { page: 0.55, board: 1 },
  /** The fibre (the note's grain, a touch more — a notebook's sheet is heavier than a Post-it's), the gutter's depth and width, the sheets' edge pitch (device px). */
  paper: { fibre: 3.5 / 255, gutterDepth: 0.35, gutterWidth: 14, edgeStep: 1.3 },
  /** The board: its cloth (±/255), the rolled edge's width and tilt (rad), the spine's roll. */
  cover: { cloth: 6 / 255, bevel: 2.2, bevelTilt: 0.96, roll: 5 },
  /** The ruling: the pitch (the fine lattice at zoom 1), a dot's radius, a rule's width. */
  rule: { pitch: 20, dot: 0.7, width: 0.6 },
  ring: PHYSICS.ring,
  /** A notebook as a host spawns one: A6 at the card grid's scale — 176 × 248, a 16 px tape, 9 px fore-edge corners, 1.8 px boards, 80 sheets of 0.12, 2.5 px squares. */
  spec: { width: 176, height: 248, spine: 16, radius: 9, board: 1.8, sheet: 0.12, sheets: 80, inset: 2.5 },
} as const;
