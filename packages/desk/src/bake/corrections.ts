// THE BAKE'S CORRECTIONS (petition I59): where the derivation (derive.ts) finds a pen no hand writes with, a correction per
// face — its family and weight — and glyph says what a hand does instead, by the strokes' indices in the derived order:
// `order` re-orders them, `flip` reverses the ones it names (after `order`). Each has an id the atlas records in its
// `corrections` when it is applied. A correction applies to its glyph and to the same glyph where a composite draws it as a
// part (Caveat's Ñ is its N and a tilde: N's correction holds there too). One that no longer fits what the derivation finds
// — an index past the strokes, an order that is not a permutation — is refused whole and reported, never half-applied: the
// derivation changed under it, and its glyph is to be looked at again.

export interface HandCorrection {
  /** Recorded in the atlas's `corrections` when applied. */
  readonly id: string;
  /** The face, as the bake reads it: the typographic family (name ID 16, else 1) and the OS/2 weight class. */
  readonly family: string;
  readonly weight: number;
  /** The glyph, by code point. */
  readonly code: number;
  /** The strokes in a hand's order: indices into the derived order (a permutation). */
  readonly order?: readonly number[];
  /** The strokes a hand draws the other way, by index (after `order`). */
  readonly flip?: readonly number[];
  /** What the derivation found, and what a hand does. */
  readonly why: string;
}

/** The corrections the desk's own faces need (apps/desk: Caveat 500 and 600, Kalam 400). */
export const HAND_CORRECTIONS: readonly HandCorrection[] = [
  {
    id: "caveat-500-N-flip-0", family: "Caveat", weight: 500, code: 0x004e, flip: [0],
    why: "N is one stroke, and the habit 'top first' starts it at its last stem's top; a hand starts N at the foot of its first stem",
  },
  {
    id: "caveat-600-N-flip-0", family: "Caveat", weight: 600, code: 0x004e, flip: [0],
    why: "N is one stroke, and the habit 'top first' starts it at its last stem's top; a hand starts N at the foot of its first stem",
  },
  {
    id: "kalam-400-Ccedilla-order-1-0", family: "Kalam", weight: 400, code: 0x00c7, order: [1, 0],
    why: "Kalam draws Ç whole and its cedilla touches the C, so it is no accent of its own and, left of the C's middle, comes first; a hand writes the C, then the cedilla",
  },
  {
    id: "kalam-400-ccedilla-order-1-0", family: "Kalam", weight: 400, code: 0x00e7, order: [1, 0],
    why: "Kalam draws ç whole and its cedilla touches the c, so it is no accent of its own and, left of the c's middle, comes first; a hand writes the c, then the cedilla",
  },
];

/** The corrections for one face. */
export const correctionsFor = (all: readonly HandCorrection[], family: string, weight: number): HandCorrection[] =>
  all.filter((c) => c.family === family && c.weight === weight);
