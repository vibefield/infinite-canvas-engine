// The WHITEBOARD (BOARD.md) as an OBJECT (design-015 §6; D3w): a melamine board in an aluminium frame,
// lying square to the desk among its things. Durable props: the capped marker lying on it — its ink
// (`cap`: the last marker it was written with, by name; the inks are the host's palette) and its tip.
// What is WRITTEN on it is not a prop: its strokes and wipes are DATA CHILDREN, entities `ChildOf` the
// board (board/data.ts, D-D5), and the raster the pass draws is a cache replayed from them (kinds/board.ts).
// Things, movable, selectable, snapping both ways; RESIZABLE — the knobs the desk's marks draw on it (*Marks on the Mat*
// Q-a/b: knobs only on the photo and the whiteboard) are core's resize handles, and its world half is drawn from its
// rect, so a resized board is drawn at its new size and its ink replays into a raster of that size; a ROOT object (D-D18:
// `interaction.drop: "never"` — no container takes it, whatever it accepts; let go over a mini mat's face it lies there).
// Its held tools (D3t-a — the kind's `open.tools`): the four markers and the eraser (the tool in hand), undo and redo over its
// strokes (the document's history), the tip and the wipe on keys; the prototype's tray is the held bar (Q-o).

import { p } from "@ice/core";
import { MARKERS, StrokePrefab } from "./data";
import { type BoardInk, type BoardObjectLook, boardKind } from "./kind";
import { DESK_OBJECT, defineObject } from "@ice/desk";
import { BOARD } from "./theme";
import { createBoardPen } from "./board-pen";

/** The dry-erase markers a board is written with (BOARD.md §3) — names; the inks are the host's (board/data.ts). */
export { MARKERS, type MarkerName } from "./data";
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
  // on the pegboard tray (design-017 §8): the whiteboard on a rail
  tray: { label: "Whiteboard", category: "surface", order: 1, hang: { w: 240, h: 160, accessory: "rail", pegs: [[-2.5, -0.5], [2.5, -0.5]] } },
  interaction: { selectable: true, movable: true, resizable: true, snap: "both", drop: "never" },
  // it lies on the desk by what it provides (K8a — `DESK_OBJECT`, the desk canvas's one key), as a plugin kind does
  provides: [DESK_OBJECT],
  // its strokes and wipes are its DATA (D3t-a): the catalog stamps, gates and migrates their prefab with the board's own
  data: [StrokePrefab],
  // the whiteboard in hand (D3t-a): its PEN — the hand onto the board kind's state, each stroke ONE transaction out of the frame (D-D7-A.3)
  drivers: (h) => createBoardPen({
    world: h.world, docs: h.docs, ink: () => h.local as BoardInk | undefined, look: () => h.look() as BoardObjectLook | undefined, isBoard: h.isKind,
    heldToWorld: h.heldToWorld, geometryOf: h.geometryOf, props: Board.groups[0]?.component,
  }),
});
