// The whiteboard's DATA (design-015 §5.1, D-D5; D3w) — what is on a board is not a raster: it is
// the list of what was done to it, and every item of that list is an ENTITY, a durable child of
// its board (`ChildOf`, never a member of the desk's paint order): a STROKE (a marker's ink and
// tip, or the eraser, along a path at a pace) or a WIPE (the board wiped clean). One stroke is one
// transaction, so undo, redo, sync, persistence and presence come from strata; the prototype's
// private `history.ts` stack survives only as what a REPLAY walks (`boardOps`): the raster on the
// GPU is a cache of the children, rebuilt when the set changes (kinds/board.ts).
//
// THE ENCODING (strata has no bytes field): a stroke's path is `points`, base64 without padding of
// its little-endian f32 (x, y) pairs — melamine world units from the board's top-left, the bench's
// `sketch` coordinates — 8 bytes a point, the seeds' codec (paper/seeds.ts) over the floats' bits.
// The tool is a NAME (`marker` | `wipe`), the ink and the tip are names (the colours are the host's
// palette, BOARD.md's markers), `erase` = the eraser's felt.
//
// ITS PACE (D3t-a — version 2): a stroke laid by hand keeps each sample's TIME, `times` — base64 of LE
// f32 millisecond offsets from its first, one per point, the same codec — so the replay feeds the pen
// exactly the samples the hand did (the felt runs dry as the hand speeds up; a pen held still bleeds:
// a sample that repeats its point exactly is the pen RESTING — `hold` — never a move). The live pen
// sees the samples through the same f32s, so a stroke's stamps are the same laid and replayed. `speed`
// (world units/s) stays: an old stroke (v1 — no `times`, the migration's empty string) spaces its
// points by distance / speed as the bench's `sketch` does, and a v2 stroke carries its mean pace there
// for a reader that knows no `times`.
//
// ITS PAGE (D3t-b — version 3): the notebook's strokes are the same data, children of a BOOK — each on one page, `page` (a
// sheet's recto is page 2i + 1, its verso 2i + 2; 0 = no page: a board's stroke, which is every stroke a v2 document holds),
// its path in PAGE units (`s` from the gutter, `y` from the head — the same on both faces of a sheet), its tool the `pen` and
// its ink the pen's name (the note's `PENS`; the colours are the host's). The pace is the same codec: the pen's nib law
// (notebook/ink.ts) reads each sample's time, so a page's replay lays the widths the hand did.
//
// ITS SEED (D7 #13 — version 4): the fibre seed the live pen laid with is the ROW's, `seed`, not the seed its position in
// the replay gives it — a peer's stroke landing before it, or an earlier one undone, moved every later stroke's stamps. A row
// from before (or one spawned without a seed) carries −1 and keeps the positional seed (`seedOfRow`), so nothing it drew changes.

import { ChildOf, defineComponent, definePrefab, type Entity, field, type GuardedTx, init } from "@ice/core";
import { linear, decodePoints, decodeTimes, seedOfRow, type StrokeRow, type StrokeSpec, strokeSeed } from "@ice/desk/kit";
import type { RGB } from "@ice/desk";
import { type BoardOp, BoardHistory } from "./history";

// the stroke model is the kit's since K4a (kit/strokes.ts — the notebook's pages take strokes too); the board keeps its door
export { addStroke, BoardStroke, decodePoints, decodeTimes, encodePoints, encodeTimes, meanSpeed, seedOfRow, STROKE_TYPE, StrokePrefab, type StrokeRow, strokeRow, strokeSeed, type StrokeSpec } from "@ice/desk/kit";
import { ERASER_TOOL, markerTool, StrokeBuilder, type TipName, TIPS } from "./stroke";

/** The dry-erase markers a board is written with (BOARD.md §3) — names; the inks are the host's palette. */
export const MARKERS = ["black", "blue", "red", "green"] as const;
export type MarkerName = (typeof MARKERS)[number];

/** A marker's ink as the palette gives it: the colour (sRGB) and the coverage one pass lays. */
export interface MarkerInk { readonly color: RGB; readonly opacity: number }


/**
 * Feed a stroke's samples to the pen, as the hand did: the first is the press (`begin`), a sample that repeats its point exactly is
 * the pen RESTING (`hold` — its bleed), any other a move, the last the lift (`end`). Timed (`times`, one per point), the samples keep
 * their own clocks; else they are spaced by distance / `speed` (an old stroke — the bench's `sketch`, which never rests).
 */
export function feedStroke(builder: StrokeBuilder, points: readonly (readonly [number, number])[], times: readonly number[] | null, speed: number, upto: number = points.length): void {
  const timed = times !== null && times.length === points.length;
  // `upto` < the samples: the stroke MID-DRAW (a still's) — its first `upto` samples fed, never lifted
  const n = Math.min(Math.max(upto, 0), points.length);
  const lifts = n === points.length;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = points[i] as readonly [number, number];
    if (timed) t = times[i] as number;
    else if (i > 0) { const [px, py] = points[i - 1] as readonly [number, number]; t += (Math.hypot(x - px, y - py) / speed) * 1000; }
    if (i === 0) { builder.begin(x, y, t); continue; }
    const [px, py] = points[i - 1] as readonly [number, number];
    if (lifts && i === points.length - 1) { builder.end(x, y, t); continue; }
    if (timed && x === px && y === py) builder.hold(t);
    else builder.move(x, y, t);
  }
  if (lifts && points.length === 1) builder.end();
}

/**
 * The pen a spec is drawn with and its builder at seed `seed` — the replay's own choice (`boardOps`): the eraser's felt, or the
 * marker in the palette's ink (the first it names when it names not this one) at the spec's tip; undefined = no ink to draw with.
 */
export function strokePen(s: StrokeSpec, markers: Readonly<Record<string, MarkerInk>>, seed: number): StrokeBuilder | undefined {
  const erase = s.erase === true;
  const m = markers[s.ink ?? "black"] ?? Object.values(markers)[0];
  if (!erase && m === undefined) return undefined;
  const tip = TIPS[(s.tip ?? "bullet") as TipName] ?? TIPS.bullet;   // a tip the board does not know draws with the bullet
  return new StrokeBuilder(erase || m === undefined ? ERASER_TOOL : markerTool(linear(m.color), m.opacity, tip), seed);
}

/**
 * A board's strokes as the history a replay walks — the bench's `sketch` (and the oracle's `opsOf`), stroke for stroke: each
 * through the StrokeBuilder at the bench's seed (`strokeSeed` of the ops before it), its samples fed as the hand laid them
 * (`feedStroke`), committed dry; a wipe clears what came before. An ink the palette does not name draws in the first it does
 * (never a blank); no ink at all draws no marker.
 */
export function boardOps(rows: readonly StrokeRow[], markers: Readonly<Record<string, MarkerInk>>): readonly BoardOp[] {
  const history = new BoardHistory();
  const fallback = Object.values(markers)[0];
  for (const s of rows) {
    if (s.tool === "wipe") { history.push({ kind: "wipe" }); continue; }
    const ink = s.ink ?? "black";
    const erase = s.erase === true;
    if (!erase && fallback === undefined) continue;
    const builder = strokePen({ ink, tip: (s.tip ?? "bullet") as TipName, erase }, markers, seedOfRow(s, history.done.length));
    if (builder === undefined) continue;
    const speed = s.speed !== null && s.speed > 0 ? s.speed : 400;
    const times = s.times !== null && s.times !== undefined && s.times !== "" ? decodeTimes(s.times) : null;
    feedStroke(builder, decodePoints(s.points ?? ""), times, speed);
    history.push({ kind: "stroke", tool: builder.tool, stamps: builder.stamps(), ...(erase ? {} : { ink }) });
  }
  return history.replay;
}
