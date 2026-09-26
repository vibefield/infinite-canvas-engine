// `@ice/desk/objects` — the desk's reference objects (design-015 §6), each a widget type through
// `defineObject`: the note and the mini mat (D2a-world); the notebook, the whiteboard, the
// calendar and the photo arrive with D3. Importing this module DEFINES them (core's registry is
// process-global): an app lists them in `createCanvasEngine({ widgets })` and the desk layer
// registers their kinds with the ground.
export { MINIMAT_TYPE, MiniMat, VINYLS, type VinylName } from "./minimat";
export { NOTE_INK, NOTE_PROPS, NOTE_TYPE, Note, type PaperDriver, PAPERS, type PaperName, PENS, type PenName } from "./note";
export { createNoteTyping, type NoteTyping, type NoteTypingOptions, type TypingDocs } from "./typing";
// the whiteboard and its data children (D3w)
export { BOARD_TYPE, Board, MARKERS, type MarkerName, TIPS } from "./board";
// the desk calendar and its data children (D3w)
export { CALENDAR_TYPE, Calendar, type CalendarDriver, type CalendarInputDoors, TAPES, type TapeName } from "./calendar";
export { addEvent, calEventOf, CalendarEvent, dayOr, daySlot, EVENT_TYPE, EventPrefab, type EventRow, type EventSpec, monthKeyOf, monthOfKey, NotePin, PadSelection, PIN_TYPE, PinPrefab, pinnedNotes, pinNote, PinsNote } from "../calendar/data";
export { keyOf as keyOfDay } from "../calendar/month";
// the desk calendar at work (D3t-c): its writing sessions, its hand
export { type CalendarWriting, type CalendarWritingOptions, createCalendarWriting, type WritingTarget } from "./calendar-writing";
export { type CalendarHand, type CalendarHandOptions, createCalendarHand } from "./calendar-hand";
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
// the desk as a whole (D7, D-D7-C.1): the objects' list, the engine preset the README's quickstart spreads, and the complete default
// palette `deskLayer` mounts with — shipped, where until D7 only apps/desk and the oracle's fixture had them
export { DESK_ENGINE, DESK_OBJECTS, DESK_TOOLS, DeskCanvas, deskSelect } from "./preset";
export { type DeskPalette, deskPalette, deskTheme, PRESENCE_INKS } from "./palette";
