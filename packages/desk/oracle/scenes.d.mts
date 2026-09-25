// The types of scenes.mjs, for its TypeScript host — apps/desk's parity page (design-015 D1b).
// Only what a host reads: every scene's name and its spec (frame.mjs's to interpret), and the view.

export interface OracleScene {
  readonly name: string;
  /** The still: its camera, theme, clocks, notes, mini mats, flight — frame.mjs `encode` reads it. */
  readonly scene: unknown;
}

/** Every oracle scene, in the order the oracle renders them (its saved renders come from one pass in this order). */
export const ORACLE_SCENES: readonly OracleScene[];

/** The view every scene is drawn at: CSS px and the device pixel ratio. */
export const VIEW: { readonly cssW: number; readonly cssH: number; readonly dpr: number };
