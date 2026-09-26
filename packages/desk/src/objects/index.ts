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
// the desk calendar and its data children (D3w)
export { CALENDAR_TYPE, Calendar, TAPES, type TapeName } from "./calendar";
export { addEvent, CalendarEvent, daySlot, EVENT_TYPE, EventPrefab, type EventSpec, monthOfKey, NotePin, PIN_TYPE, PinPrefab, pinNote, PinsNote } from "../calendar/data";
// the notebook (D3w)
export { COVERS, type CoverName, NOTEBOOK_TYPE, Notebook, RULING_NAMES } from "./notebook";
// the photo print and its carry (D3w)
export { PHOTO_TYPE, Photo, printExtent } from "./photo";
export { createPhotoCarry, type PhotoCarry, type PhotoCarryOptions, TWIST_PER_WHEEL } from "./carry";
// the whiteboard in hand: its pen (D3t-a)
export { type BoardPen, type BoardPenOptions, createBoardPen } from "./pen";
// the notebook in hand: its pen and its leaves (D3t-b)
export { createNotebookHand, type NotebookHand, type NotebookHandOptions } from "./leaf";
export { addStroke, BoardStroke, boardOps, decodePoints, decodeTimes, encodePoints, encodeTimes, feedStroke, type MarkerInk, meanSpeed, STROKE_TYPE, StrokePrefab, type StrokeRow, strokeRow, strokeSeed, type StrokeSpec } from "../board/data";

import { Board } from "./board";
import { Calendar } from "./calendar";
import { MiniMat } from "./minimat";
import { Note } from "./note";
import { Notebook } from "./notebook";
import { Photo } from "./photo";

/** The desk's reference objects, in the order an app registers them. */
export const DESK_OBJECTS = [Note, MiniMat, Board, Photo, Notebook, Calendar] as const;
