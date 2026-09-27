// The NOTE's own theme — its law as numbers (design-015 §4.1: beside the engine's src/theme.ts, a kind's own theme.ts is
// the one other literal home; moved out of the engine's at K4a, design-016 §5). What it shares with every desk object —
// the lift, the shadow, the selection ring — is the kit's ONE PHYSICS (kit/physics.ts), by name.

import { PHYSICS } from "../kit/physics";

/**
 * PAPER — the desk's first object (STICKY.md): a sticky note as a MATERIAL under the
 * mat's one light. A square of thin paper pressed flat under its adhesive strip and
 * free below it, where it rises a little off the mat and its corners rise most; stuck
 * a degree or two off square, as a hand leaves it; lit by the lamp that casts the
 * palm's shadow (the gobo projector — `paper.ts` `lampOf`), so the dapple crosses it
 * and its shadow falls away from that lamp; by night, under the Moon like the mat.
 * Lengths are world units (CSS px at zoom 1). The paper's colour is the product's
 * (`--vf-note-surface`, lab/theme.ts); the pen's ink is the host's too.
 */
export const PAPER = {
  /** The note's side — a 3″ square read at about the card grid's scale (DESIGN.md §4: small 155). */
  size: 200,
  /** The die-cut corner. */
  radius: 1.5,
  /** Never stuck square: each note takes its own tilt within ± this, degrees. */
  tilt: 2.5,
  /** The fraction of the height pressed flat under the adhesive strip. */
  glue: 0.3,
  /** How far the free edge rises off the mat, and how much more its corners rise than its middle. */
  curl: 3, cornerCurl: 0.6,
  /** How far a HELD note rises and the scale it reads at: the one physics's (kit/physics.ts). */
  lift: PHYSICS.lift,
  /** The contact shadow on the mat: the one physics's penumbra (kit/physics.ts). */
  shadow: PHYSICS.shadow,
  /** How much the sheet's slope is exaggerated for the lamp's shading: a curl of a few px over a hundred is invisible at 1; at this it reads as paper. */
  relief: 3.5,
  /** The paper's fibre: ±/255 on the albedo. */
  grain: 2.5 / 255,
  /** The sole-selection ring (DESIGN.md §7), CSS px, in `--vf-select`: the one physics's. */
  ring: PHYSICS.ring,
  /** The caret: CSS px wide, the platform's blink. */
  caret: { width: 1.5, blinkMs: 530 },
} as const;
