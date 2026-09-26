// The D3w kinds in a STILL — the oracle's scenes (packages/desk/oracle/scenes.mjs) spawned INTO THE WORLD:
// the whiteboards with their strokes as DATA CHILDREN (entities `ChildOf` the board, laid in one
// non-undoable transaction after the spawn), the prints, the notebooks, the desk calendars — in the
// ORACLE'S paint order (frame.mjs `deskInputs`: the mini mats, then the pads, then the things — the scene's
// own `things` list where it gives one, else the whiteboards, the notes, the prints, the notebooks). The
// poses a still pins (a print held, a book open or tilted, a pad mid-roll) are FLUX PINS on the kinds' own
// state (D-D2a-world.5: never a Grab), set by setScene after the spawn.

import { type CanvasEngine, type Entity, guardedTransaction } from "@ice/core";
import { addStroke, BOARD_TYPE, type StrokeSpec } from "@ice/desk/objects";
import { BOARD } from "@ice/desk/theme";
import type { OracleNote, SpawnSpec } from "./scene";

export interface OracleStroke {
  readonly ink?: string;
  readonly tip?: string;
  readonly erase?: boolean;
  readonly points: readonly (readonly [number, number])[];
  readonly speed?: number;
}
export interface OracleBoard {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly cap?: string;
  readonly tip?: string;
  readonly selected?: boolean;
  readonly held?: boolean;
  readonly strokes?: readonly OracleStroke[];
}

/** A desk's thing as the oracle lists it (frame.mjs `thingsOf`). */
export type OracleThing = ({ readonly kind: "note" } & OracleNote) | ({ readonly kind: "board" } & OracleBoard) | { readonly kind: "print" | "book"; readonly [k: string]: unknown };

/** The scene fields the D3w kinds read. */
export interface KindScene {
  readonly boards?: readonly OracleBoard[];
  readonly notes?: readonly OracleNote[];
  readonly things?: readonly OracleThing[];
}

/** The scene's things in the oracle's paint order: its own list, else the whiteboards, the notes (and, as their slices land, the prints, the notebooks). */
export function thingsOf(s: KindScene): OracleThing[] {
  if (s.things !== undefined) return [...s.things];
  return [...(s.boards ?? []).map((b) => ({ ...b, kind: "board" as const })), ...(s.notes ?? []).map((n) => ({ ...n, kind: "note" as const }))];
}

/** A whiteboard as a spawn: the bench's size, its capped marker black and bullet unless the scene says. */
export const boardSpec = (b: OracleBoard): SpawnSpec => ({ type: BOARD_TYPE, cx: b.x, cy: b.y, w: b.w ?? BOARD.spec.width, h: b.h ?? BOARD.spec.height, props: { cap: b.cap ?? "black", tip: b.tip ?? "bullet" } });

/** The boards' strokes laid as their children — the bench's `sketch` order — in ONE non-undoable transaction (a scene is not an edit). */
export function layStrokes(engine: CanvasEngine, boards: readonly { readonly entity: Entity; readonly spec: OracleBoard }[]): number {
  const session = engine.docs.current();
  if (session === undefined) throw new Error("desk: no document");
  let n = 0;
  const inked = boards.filter((b) => (b.spec.strokes ?? []).length > 0);
  if (inked.length === 0) return 0;
  guardedTransaction(session.store, engine.world, (tx) => {
    for (const { entity, spec } of inked) {
      for (const s of spec.strokes ?? []) {
        const stroke: StrokeSpec = { points: s.points, ...(s.ink !== undefined ? { ink: s.ink } : {}), ...(s.tip !== undefined ? { tip: s.tip as "bullet" } : {}), ...(s.erase ? { erase: true } : {}), ...(s.speed !== undefined ? { speed: s.speed } : {}) };
        addStroke(tx, entity, stroke);
        n += 1;
      }
    }
  }, { undoable: false });
  return n;
}
