// A STROKE — the data child of an object that takes ink (design-015 §5.1: a stroke is one transaction, so undo, sync,
// persistence and presence come from strata): the whiteboard's marker strokes and wipes, the notebook's pen strokes on a
// page. Its component and prefab, its row as a tolerant reader takes it, the spec a pen lays, the cell codecs (paths and
// times as base64 f32), and the fibre seed a replay walks. The whiteboard's until K4a (board/data.ts); the notebook
// borrowed it whole, so it is the kit's (design-016 §5), and both keep their doors. And `inking`: a stroke is in hand.

import { ChildOf, defineComponent, definePrefab, defineQuery, type Entity, field, type GuardedTx, HeldPress, init, LocalPointer, Pointer, type World } from "@ice/core";
import { decodeSeeds, encodeSeeds } from "./seeds";

/** A board's data child: a stroke (`marker`, with `erase` for the eraser) or a wipe. */
export const BoardStroke = defineComponent("desk.stroke", {
  tool: field("string", { default: "marker" }),
  ink: field("string", { default: "black" }),
  tip: field("string", { default: "bullet" }),
  erase: field("bool", { default: false }),
  points: field("string", { default: "" }),
  speed: field("f64", { default: 400 }),
  times: field("string", { default: "" }),
  page: field("u32", { default: 0 }),
  seed: field("f64", { default: -1 }),
});

/** A stroke's cell as the board reads it (a tolerant reader: a string field strata hands back as null reads as its default). */
export interface StrokeRow {
  readonly tool: string | null;
  readonly ink: string | null;
  readonly tip: string | null;
  readonly erase: boolean | null;
  readonly points: string | null;
  readonly speed: number | null;
  readonly times?: string | null;
  /** The notebook page it is on (D3t-b — v3): 2i + 1 a sheet's recto, 2i + 2 its verso; 0 (or absent, a v2 reader's) = none. */
  readonly page?: number | null;
  /** Its fibre seed (D7 #13 — v4): the one the live pen laid with; −1 (or absent, a v3 reader's) = the seed its position gives it. */
  readonly seed?: number | null;
}

/** The durable id a stroke entity carries (`PrefabId`) — a data child, never a widget. */
export const STROKE_TYPE = "desk.stroke";

/**
 * A stroke's durable prefab: its one cell and its `ChildOf` edge to the board (or the book) it is on. Version 2 (D3t-a) added
 * `times`; a v1 stroke migrates to an empty one — it keeps its `speed` (the replay spaces it as before). Version 3 (D3t-b) added
 * `page`; a v2 stroke — a board's — migrates to page 0. The Board and the Notebook declare it as their `data`, so the engine's
 * catalog stamps, gates and migrates it with them.
 */
export const StrokePrefab = definePrefab(STROKE_TYPE, {
  store: "durable",
  version: 4,
  components: [init(BoardStroke, { tool: "marker", ink: "black", tip: "bullet", erase: false, points: "", speed: 400, times: "", page: 0, seed: -1 })],
  relations: [ChildOf],
  // v4 (D7 #13): `seed` — the fibre seed the pen laid with; a v3 stroke keeps the seed its position gives it (−1), so nothing it drew changes
  migrate: { 1: (v) => ({ ...v, times: "" }), 2: (v) => ({ ...v, page: 0 }), 3: (v) => ({ ...v, seed: -1 }) },
});

/** A row's fibre seed: its own (v4, the pen's) — or, for a row from before or without one, the `n`-th op's positional seed. */
export const seedOfRow = (s: Pick<StrokeRow, "seed">, n: number): number => (s.seed !== null && s.seed !== undefined && s.seed >= 0 ? s.seed : strokeSeed(n));

/**
 * A stroke as an author states one: the path in melamine units (a notebook's: page units, on its `page`) and its pace — each
 * sample's time (ms from the first), or one speed; a wipe has no path.
 */
export interface StrokeSpec {
  readonly tool?: "marker" | "wipe" | "pen";
  readonly ink?: string;
  readonly tip?: string;
  readonly erase?: boolean;
  readonly points?: readonly (readonly [number, number])[];
  readonly times?: readonly number[];
  readonly speed?: number;
  /** The notebook page (D3t-b): 2i + 1 sheet i's recto, 2i + 2 its verso; absent = 0, a board's. */
  readonly page?: number;
  /** The fibre seed the pen laid with (D7 #13): stored, so the replay lays the same stamps whatever lands before it; absent = the position's. */
  readonly seed?: number;
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

/** The samples' times as the cell stores them (D3t-a): base64 (no padding) of LE f32 milliseconds from the first sample. */
export function encodeTimes(times: readonly number[]): string {
  return encodeSeeds(new Uint32Array(Float32Array.from(times).buffer));
}

/** A cell's times back (a tolerant reader: "" — an old stroke — is none). */
export function decodeTimes(s: string): number[] {
  return Array.from(new Float32Array(new Int32Array(decodeSeeds(s)).buffer));
}

/** A path's mean pace, world units/s — what a v2 stroke leaves in `speed` for a reader that knows no `times`; the default for a dot. */
export function meanSpeed(points: readonly (readonly [number, number])[], times: readonly number[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) { const a = points[i - 1] as readonly [number, number]; const b = points[i] as readonly [number, number]; length += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const ms = (times[times.length - 1] ?? 0) - (times[0] ?? 0);
  return length > 0 && ms > 0 ? (length / ms) * 1000 : 400;
}

/** The row a spec is — defaults as the prefab has them; timed, its `speed` is the path's mean pace unless the spec names one. */
export function strokeRow(s: StrokeSpec): { tool: string; ink: string; tip: string; erase: boolean; points: string; speed: number; times: string; page: number; seed: number } {
  const points = s.points ?? [];
  const timed = s.times !== undefined && s.times.length === points.length && points.length > 0;
  return {
    tool: s.tool ?? "marker", ink: s.ink ?? "black", tip: s.tip ?? "bullet", erase: s.erase === true,
    points: encodePoints(points), speed: s.speed ?? (timed ? meanSpeed(points, s.times ?? []) : 400),
    times: timed ? encodeTimes(s.times ?? []) : "",
    page: Math.max(0, Math.floor(s.page ?? 0)),
    seed: s.seed !== undefined && Number.isFinite(s.seed) && s.seed >= 0 ? s.seed : -1,
  };
}

/** Lay a stroke on a board (or a book's page) — one entity, the object's newest child — inside the caller's transaction (one stroke, one undo step). */
export function addStroke(tx: GuardedTx, board: Entity, s: StrokeSpec): Entity {
  const e = tx.spawnPrefab(StrokePrefab, [init(BoardStroke, strokeRow(s))]);
  tx.setRelation(e, ChildOf, board);   // placeless on the ordered ChildOf: appended last — the newest stroke
  return e;
}

/** The fibre seed of the `n`-th op a replay walks — the bench's `97.13 ×` the ops before it; the live pen seeds its stroke with the next. */
export const strokeSeed = (n: number): number => (n * 97.13) % 1000;

const heldPressesQ = defineQuery([Pointer, LocalPointer, HeldPress]);
/** A stroke is in hand (a local pointer's press is a tool's): a history waits for it to land (BOARD.md §5 — the bench's `!this.open?.stroke`). */
export function inking(world: World): boolean {
  let yes = false;
  world.query(heldPressesQ).each((b) => { for (const r of b) if (world.read(b.entity(r), HeldPress).kind === "tool") yes = true; });
  return yes;
}
