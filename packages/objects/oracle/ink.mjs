// A still's INK (petition I60) as both routes stage it — the oracle's own desk (frame.mjs) and the world's (apps/desk
// src/rig/stage.ts, rig:world): ONE reading of a scene note's `marks`, `wash` and `inked`, so the two can never hand the note two
// different inks. A note spec's `marks` are `[quote, change]` pairs, each the kit's `mark` over the words its `findQuote` finds;
// `wash` a quote — the editor's selection over those words; `inked` — its marks made that many ms before the still (the oracle desk's
// own clock: a still mid-marking). And which notes the PEN writes in a still (`writtenWithPen`): words and no committed raster — the
// ones whose far-LOD greek is their own layout's, never a still's stated lines.
import { encodeMarks, findQuote, inkOf, mark } from "../../desk/src/kit/ink.ts";

/** Where `quote` lies in a scene note's words: its range — or a throw, naming the note (a scene's typo is never a silent mark). */
export function quoteIn(n, quote) {
  const r = findQuote(n.text ?? "", quote);
  if ("error" in r) throw new Error(`oracle: the note "${n.text}" holds no single "${quote}" (${r.error})`);
  return r;
}

/** A scene note's `marks` cell: each `[quote, change]` laid in order by the kit's `mark` — "" for none. */
export function sceneMarks(n) {
  if (!n.marks || n.marks.length === 0) return "";
  let ink = inkOf({ text: n.text ?? "", seeds: n.seeds ?? "" }, n.seed ?? 1);
  for (const [q, change] of n.marks) { const r = quoteIn(n, q); ink = mark(ink, r.from, r.to, change); }
  return encodeMarks(ink.marks);
}

/** A scene note's selection (its `wash`): the range of its quote, or undefined. */
export const sceneWash = (n) => (n.wash === undefined ? undefined : quoteIn(n, n.wash));

/** Does the PEN write this scene note (petition I59)? Words, and no committed raster pinned on it. */
export const writtenWithPen = (n) => n.asset === undefined && typeof n.text === "string" && n.text.length > 0;
