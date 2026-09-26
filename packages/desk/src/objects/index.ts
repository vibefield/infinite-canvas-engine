// `@ice/desk/objects` — the desk's reference objects (design-015 §6), each a widget type through
// `defineObject`: the note and the mini mat (D2a-world); the notebook, the whiteboard, the
// calendar and the photo arrive with D3. Importing this module DEFINES them (core's registry is
// process-global): an app lists them in `createCanvasEngine({ widgets })` and the desk layer
// registers their kinds with the ground.
export { MINIMAT_TYPE, MiniMat, VINYLS, type VinylName } from "./minimat";
export { NOTE_INK, NOTE_PROPS, NOTE_TYPE, Note, PAPERS, type PaperName, PENS, type PenName } from "./note";
export { createNoteTyping, type NoteTyping, type NoteTypingOptions, type TypingDocs } from "./typing";
// the whiteboard and its data children (D3w)
export { BOARD_TYPE, Board, MARKERS, type MarkerName, TIPS } from "./board";
export { addStroke, BoardStroke, boardOps, decodePoints, encodePoints, type MarkerInk, STROKE_TYPE, StrokePrefab, type StrokeRow, strokeRow, type StrokeSpec } from "../board/data";

import { Board } from "./board";
import { MiniMat } from "./minimat";
import { Note } from "./note";

/** The desk's reference objects, in the order an app registers them. */
export const DESK_OBJECTS = [Note, MiniMat, Board] as const;
