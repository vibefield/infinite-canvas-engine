// `@ice/objects` — the desk's six reference objects (design-015 §6), their own package since design-016 K4b and published as
// `@vibecook/ice/desk/objects`: the note and the mini mat (D2a-world), the notebook, the whiteboard, the calendar and the photo
// (D3), each a widget type through `defineObject` over its kind — built on the desk's public entries alone (`@ice/desk`,
// `@ice/desk/kit`, `@ice/desk/engine`), exactly as a plugin kind is. Importing this module DEFINES them (core's registry is
// process-global): an app lists them in `createCanvasEngine({ widgets })` (or spreads `DESK_ENGINE`) and the desk layer
// registers their kinds with the ground and builds the DOM halves they declare.
export { MINIMAT_TYPE, MiniMat, VINYL_ACT, VINYLS, type VinylName } from "./minimat/object";
export { NOTE_INK, NOTE_PROPS, NOTE_TYPE, Note, type PaperDriver, PAPERS, type PaperName, PENS, type PenName } from "./paper/object";
export { createNoteTyping, type NoteTyping, type NoteTypingOptions, type TypingDocs } from "./paper/typing";
// the whiteboard and its data children (D3w)
export { BOARD_TYPE, Board, MARKERS, type MarkerName, TIPS } from "./board/object";
// the desk calendar and its data children (D3w)
export { CALENDAR_TYPE, Calendar, type CalendarDriver, type CalendarInputDoors, TAPES, type TapeName } from "./calendar/object";
export { addEvent, calEventOf, CalendarEvent, dayOr, daySlot, EVENT_TYPE, EventPrefab, type EventRow, type EventSpec, monthKeyOf, monthOfKey, NotePin, PadSelection, PIN_TYPE, PinPrefab, pinnedNotes, pinNote, PinsNote } from "./calendar/data";
export { keyOf as keyOfDay } from "./calendar/month";
// the desk calendar at work (D3t-c): its writing sessions, its hand
export { type CalendarWriting, type CalendarWritingOptions, createCalendarWriting, type WritingTarget } from "./calendar/writing";
export { type CalendarHand, type CalendarHandOptions, createCalendarHand } from "./calendar/hand";
// the notebook (D3w)
export { COVERS, type CoverName, NOTEBOOK_TYPE, Notebook, RULING_NAMES } from "./notebook/object";
// the photo print and its carry (D3w)
export { PHOTO_TYPE, Photo, printExtent } from "./photo/object";
export { createPhotoCarry, type PhotoCarry, type PhotoCarryOptions, TWIST_PER_WHEEL } from "./photo/carry";
// the whiteboard in hand: its pen (D3t-a)
export { type BoardPen, type BoardPenOptions, createBoardPen } from "./board/board-pen";
// the notebook in hand: its pen and its leaves (D3t-b)
export { createNotebookHand, type NotebookHand, type NotebookHandOptions } from "./notebook/leaf";
export { addStroke, BoardStroke, boardOps, decodePoints, decodeTimes, encodePoints, encodeTimes, feedStroke, type MarkerInk, meanSpeed, seedOfRow, STROKE_TYPE, StrokePrefab, type StrokeRow, strokeRow, strokeSeed, type StrokeSpec } from "./board/data";
// the desk as a whole (D7, D-D7-C.1): the objects' list, the engine preset the README's quickstart spreads, and the complete default
// palette `deskLayer` mounts with — shipped, where until D7 only apps/desk and the oracle's fixture had them
export { DESK_ENGINE, DESK_OBJECTS, DESK_TOOLS, DeskCanvas, deskSelect } from "./preset";
export { type DeskPalette, deskPalette, deskTheme, PRESENCE_INKS } from "./palette";
// the kinds as the ground registers them — their programs, their world halves, their specs, `DESK_KINDS` (kinds.ts)
export * from "./kinds";
// the kinds' DOM halves — what their objects' `host` declarations make (K4b: the desk layer builds what the objects declare)
export { createNoteBody, NOTE_BODY, type NoteBody, type NoteBodyOptions } from "./paper/host/body";
export { printRaster, type PrintRasterOptions } from "./calendar/host/print";
export { CALENDAR_LINE, type CalendarInput, type CalendarInputOptions, caretIndexAt, createCalendarInput } from "./calendar/host/input";
// the kinds' shader text — each kind's WGSL from this package, the kit's from the desk (per-package generation, K4b)
export { shaderText } from "./shaders";
