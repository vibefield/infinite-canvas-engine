// The types of ink.mjs, for its TypeScript hosts — apps/desk's world staging (src/rig/stage.ts) and its tests (petition I60).

/** A scene note as ink.mjs reads it: its words, its hand, its marks, its selection, its moment. */
export interface SceneInkNote {
  readonly text?: string;
  readonly seeds?: string;
  readonly seed?: number;
  readonly asset?: string;
  /** `[quote, change]` pairs: each the kit's `mark(…, change)` over the words the quote finds. */
  readonly marks?: readonly (readonly [string, Readonly<Record<string, unknown>>])[];
  /** A quote: the editor's selection over those words. */
  readonly wash?: string;
  /** Its marks made this many ms before the still (the oracle desk's clock). */
  readonly inked?: number;
}

export function quoteIn(n: SceneInkNote, quote: string): { readonly from: number; readonly to: number };
/** A scene note's `marks` cell — "" for none. */
export function sceneMarks(n: SceneInkNote): string;
/** A scene note's selection (its `wash`), or undefined. */
export function sceneWash(n: SceneInkNote): { readonly from: number; readonly to: number } | undefined;
/** Does the pen write this scene note: words, and no committed raster? */
export function writtenWithPen(n: SceneInkNote): boolean;
