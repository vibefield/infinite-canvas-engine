// ONE PHYSICS (design-015 §6; BOOK.md, BOARD.md, MINIMAT.md): every desk object under the mat's one lamp lifts, casts and
// reads its face by the same law — the note's lift and penumbra, the slab's contact term at its base, the face's fill, the
// selection ring — so the note, the notebook, the whiteboard, the mini mat and the print agree by NAME, never by copy. The
// numbers stood in the engine's theme inside the note's and the notebook's specs until K4a (design-016 §5); each kind's
// own spec (paper/theme.ts, notebook/theme.ts, board/theme.ts, minimat/theme.ts) now takes them from here, and no kind
// reads another's. Lengths are world units (CSS px at zoom 1).

/** The shadow's penumbra, as the note casts it (theme.ts `PAPER.shadow` until K4a). */
const SHADOW = { sigma: 2.2, alpha: 0.36, sigmaPerUnit: 0.9, alphaHeld: 0.4, slopeMax: 2.2 } as const;

export const PHYSICS = {
  /** How far a HELD note rises (§7's lift, as a height), and the scale it reads at (§7's 1.05, kept). */
  lift: { height: 12, scale: 1.03 },
  /**
   * The contact shadow on the mat: Gaussian-blurred coverage of the sheet cast along the lamp's
   * ground direction by its height — σ and alpha at contact, σ growing per unit of height, the
   * alpha a held note casts, and the slope's cap (a note far from the lamp keeps a finite shadow).
   */
  shadow: SHADOW,
  /**
   * A SLAB's shadow (a notebook, a whiteboard, a mini mat): the note's penumbra swept down its height, with a contact
   * term at its base (the tree-shadow design system's paper elevation, mat.css `--lift-1`) — theme.ts `BOOK.shadow` until K4a.
   */
  slab: {
    penumbra: { sigma0: SHADOW.sigma, sigmaPerHeight: SHADOW.sigmaPerUnit, alpha: SHADOW.alpha },
    /** The contact term: σ, alpha, and the gap (world units) it has faded over once the object floats. */
    contact: { sigma: 1.1, alpha: 0.3, reach: 2.5 },
    slopeMax: SHADOW.slopeMax,
  },
  /** The lamp's fill on a face turned away from it; how far past a flat face one turned toward it may brighten. */
  light: { ambient: 0.5, cap: 1.35 },
  /** The sole-selection ring (DESIGN.md §7), CSS px, in `--vf-select`. */
  ring: 1.5,
} as const;
