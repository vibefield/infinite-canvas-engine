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
// Its pace is ONE number, `speed` (world units/s): the replay spaces the points by distance/speed
// as the bench's `sketch` does. The tool is a NAME (`marker` | `wipe`), the ink and the tip are
// names (the colours are the host's palette, BOARD.md's markers), `erase` = the eraser's felt.

import { ChildOf, defineComponent, definePrefab, type Entity, field, type GuardedTx, init } from "@ice/core";
import { linear } from "../mat/night";
import { decodeSeeds, encodeSeeds } from "../paper/seeds";
import type { RGB } from "../theme";
import { type BoardOp, BoardHistory } from "./history";
import { ERASER_TOOL, markerTool, StrokeBuilder, type TipName, TIPS } from "./stroke";

/** The dry-erase markers a board is written with (BOARD.md §3) — names; the inks are the host's palette. */
export const MARKERS = ["black", "blue", "red", "green"] as const;
export type MarkerName = (typeof MARKERS)[number];

/** A board's data child: a stroke (`marker`, with `erase` for the eraser) or a wipe. */
export const BoardStroke = defineComponent("desk.stroke", {
  tool: field("string", { default: "marker" }),
  ink: field("string", { default: "black" }),
  tip: field("string", { default: "bullet" }),
  erase: field("bool", { default: false }),
  points: field("string", { default: "" }),
  speed: field("f64", { default: 400 }),
});

/** A stroke's cell as the board reads it (a tolerant reader: a string field strata hands back as null reads as its default). */
export interface StrokeRow {
  readonly tool: string | null;
  readonly ink: string | null;
  readonly tip: string | null;
  readonly erase: boolean | null;
  readonly points: string | null;
  readonly speed: number | null;
}

/** The durable id a stroke entity carries (`PrefabId`) — a data child, never a widget. */
export const STROKE_TYPE = "desk.stroke";

/** A stroke's durable prefab: its one cell and its `ChildOf` edge to the board it is on. */
export const StrokePrefab = definePrefab(STROKE_TYPE, {
  store: "durable",
  version: 1,
  components: [init(BoardStroke, { tool: "marker", ink: "black", tip: "bullet", erase: false, points: "", speed: 400 })],
  relations: [ChildOf],
});

/** A stroke as an author states one: the path in melamine units, the pace; a wipe has no path. */
export interface StrokeSpec {
  readonly tool?: "marker" | "wipe";
  readonly ink?: string;
  readonly tip?: TipName;
  readonly erase?: boolean;
  readonly points?: readonly (readonly [number, number])[];
  readonly speed?: number;
}

/** A path as the cell stores it: base64 (no padding) of LE f32 (x, y) pairs. */
export function encodePoints(points: readonly (readonly [number, number])[]): string {
  const f = new Float32Array(points.length * 2);
  points.forEach(([x, y], i) => { f[2 * i] = x; f[2 * i + 1] = y; });
  return encodeSeeds(new Uint32Array(f.buffer));
}

/** A cell's path back: whole points only (a tolerant reader — anything unreadable ends the path). */
export function decodePoints(s: string): Array<readonly [number, number]> {
  const words = decodeSeeds(s);
  const f = new Float32Array(new Int32Array(words).buffer);
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push([f[i] as number, f[i + 1] as number]);
  return out;
}

/** The row a spec is — defaults as the prefab has them. */
export function strokeRow(s: StrokeSpec): { tool: string; ink: string; tip: string; erase: boolean; points: string; speed: number } {
  return {
    tool: s.tool ?? "marker", ink: s.ink ?? "black", tip: s.tip ?? "bullet", erase: s.erase === true,
    points: encodePoints(s.points ?? []), speed: s.speed ?? 400,
  };
}

/** Lay a stroke on a board — one entity, the board's newest child — inside the caller's transaction (one stroke, one undo step). */
export function addStroke(tx: GuardedTx, board: Entity, s: StrokeSpec): Entity {
  const e = tx.spawnPrefab(StrokePrefab, [init(BoardStroke, strokeRow(s))]);
  tx.setRelation(e, ChildOf, board);   // placeless on the ordered ChildOf: appended last — the newest stroke
  return e;
}

/** A marker's ink as the palette gives it: the colour (sRGB) and the coverage one pass lays. */
export interface MarkerInk { readonly color: RGB; readonly opacity: number }

/**
 * A board's strokes as the history a replay walks — the bench's `sketch` (and the oracle's `opsOf`),
 * stroke for stroke: each through the StrokeBuilder at the bench's seed (`97.13 ×` the ops before it),
 * its points spaced by distance / speed, committed dry; a wipe clears what came before. An ink the
 * palette does not name draws in the first it does (never a blank); no ink at all draws no marker.
 */
export function boardOps(rows: readonly StrokeRow[], markers: Readonly<Record<string, MarkerInk>>): readonly BoardOp[] {
  const history = new BoardHistory();
  const fallback = Object.values(markers)[0];
  for (const s of rows) {
    if (s.tool === "wipe") { history.push({ kind: "wipe" }); continue; }
    const ink = s.ink ?? "black";
    const erase = s.erase === true;
    const m = markers[ink] ?? fallback;
    if (!erase && m === undefined) continue;
    const tip = TIPS[(s.tip ?? "bullet") as TipName] ?? TIPS.bullet;
    const tool = erase || m === undefined ? ERASER_TOOL : markerTool(linear(m.color), m.opacity, tip);
    const builder = new StrokeBuilder(tool, (history.done.length * 97.13) % 1000);
    const speed = s.speed !== null && s.speed > 0 ? s.speed : 400;
    const points = decodePoints(s.points ?? "");
    let t = 0;
    points.forEach(([x, y], i) => {
      if (i === 0) { builder.begin(x, y, t); return; }
      const [px, py] = points[i - 1] as readonly [number, number];
      t += (Math.hypot(x - px, y - py) / speed) * 1000;
      builder.move(x, y, t);
    });
    builder.end();
    history.push({ kind: "stroke", tool, stamps: builder.stamps(), ...(erase ? {} : { ink }) });
  }
  return history.replay;
}
