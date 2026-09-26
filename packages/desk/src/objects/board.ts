// The WHITEBOARD (BOARD.md) as an OBJECT (design-015 §6; D3w): a melamine board in an aluminium frame,
// lying square to the desk among its things. Durable props: the capped marker lying on it — its ink
// (`cap`: the last marker it was written with, by name; the inks are the host's palette) and its tip.
// What is WRITTEN on it is not a prop: its strokes and wipes are DATA CHILDREN, entities `ChildOf` the
// board (board/data.ts, D-D5), and the raster the pass draws is a cache replayed from them (kinds/board.ts).
// Things, movable, selectable, snapping both ways; RESIZABLE — the knobs the desk's marks draw on it (*Marks on the Mat*
// Q-a/b: knobs only on the photo and the whiteboard) are core's resize handles, and its world half is drawn from its
// rect, so a resized board is drawn at its new size and its ink replays into a raster of that size; a ROOT object (D-D18
// — never offered to a mini mat).
// Its held tools — the markers, the eraser, the tray, undo over its strokes — are D3t's, after the opening.

import { p } from "@ice/core";
import { boardKind } from "../kinds/board";
import { defineObject } from "../object";
import { BOARD } from "../theme";

/** The dry-erase markers a board is written with (BOARD.md §3) — names; the inks are the host's. */
export const MARKERS = ["black", "blue", "red", "green"] as const;
export type MarkerName = (typeof MARKERS)[number];
/** The marker's tips (board/stroke.ts `TIPS`). */
export const TIPS = ["fine", "bullet", "chisel"] as const;

/** The board's durable type id. */
export const BOARD_TYPE = "desk.board";

export const Board = defineObject({
  type: BOARD_TYPE,
  version: 1,
  props: {
    cap: p.enum(MARKERS, { default: "black" }),
    tip: p.enum(TIPS, { default: "bullet" }),
  },
  size: { w: BOARD.spec.width, h: BOARD.spec.height },
  kind: boardKind(),
  interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
});
