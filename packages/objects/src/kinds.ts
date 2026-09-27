// The reference kinds as the ground registers them (kind.ts's `KindProgram`; design-015 §5.2's render half): the note, the mini
// mat, the whiteboard, the photo print, the desk calendar and the notebook, each a thin adapter over its pass (the last two
// LAYERED — the kit's `LayeredKind`: a target of their own, laid as one composite run; root only, D-D18). The desk never imports
// this module — a host hands `Ground.create` a registry, and the reference one is `DESK_KINDS`.
//
// And the kinds WHOLE (`ObjectKind`, D2a-world): `paperKind()`, `minimatKind()`, … — each a `KindProgram` with its world half
// (resolve · record · hit · reach · theme) — what `defineObject` binds a widget type to and the builder drives. Their own package
// since design-016 K4b (`@ice/objects`): each kind's folder imports the desk's public entries alone.
import type { KindProgram, ShaderText } from "@ice/desk";
import { shaderText } from "./shaders";
import { boardProgram } from "./board/kind";
import { calendarProgram } from "./calendar/kind";
import { miniMatProgram } from "./minimat/kind";
import { notebookProgram } from "./notebook/kind";
import { paperProgram } from "./paper/kind";
import { photoProgram } from "./photo/kind";

export { BOARD_KIND, BOARD_TOOLS, type BoardInk, boardInked, BoardKind, type BoardKindOptions, type BoardObjectLook, type BoardPalette, boardFrame, boardKind, boardPose, boardProgram, boardReach, boardRest, createBoardInk, ERASER_TOOL_ID, inking, inkOfTool, markerToolId, type PenHand, type PenPin } from "./board/kind";
export { CALENDAR_KIND, type CalendarAlpha, calendarFrame, type CalendarGeometry, CalendarKind, type CalendarKindOptions, calendarKind, type CalendarObjectLook, type CalendarPalette, calendarProgram, calendarReach, type CalendarPart, type CalendarPartName, createPads, DRAFT_ID, type PadDraft, type PadMarks, type PadPose, type Pads, partAt, sheetDayBox, sheetDraw, sheetOnScreen, sheetPoint } from "./calendar/kind";
export type { EventLine, PrintLook, SheetPrint } from "./calendar/print";
export type { PinnedSheet } from "./calendar/printing";
export { INSIDE_GRID, MINIMAT_KIND, MiniMatKind, type MiniMatKindOptions, type MiniMatLook, type MiniMatPalette, miniMatFrame, miniMatProgram, miniMatReach, minimatKind, SAGE } from "./minimat/kind";
export { INK_H, INK_W } from "./notebook/ink";
// the kinds' own specs — each kind's law as numbers, in its own folder since K4a (design-016 §5; the one physics they share is the kit's)
export { BOARD } from "./board/theme";
export { MINIMAT } from "./minimat/theme";
export { BOOK } from "./notebook/theme";
export { PAPER } from "./paper/theme";
export { askTurn, bookAngle, bookFrame, type BookPose, type Books, createBooks, DEFAULT_PEN, inTurnZone, NOTEBOOK_KIND, NOTEBOOK_PAGE, NOTEBOOK_PENS, NOTEBOOK_TOOLS, notebookFrame, type NotebookGeometry, NotebookKind, type NotebookKindOptions, notebookKind, type NotebookObjectLook, type NotebookPalette, notebookProgram, notebookReach, PageTurns, pageHitAt, partOf, penOfTool, penToolId } from "./notebook/kind";
export { PAPER_KIND, type PaperAsset, PaperKind, type PaperKindOptions, type PaperLook, type PaperPalette, paperFrame, paperProgram, paperReach, paperKind } from "./paper/kind";
export { createPrints, type FlickWitness, PHOTO_KIND, photoFrame, photoKind, PhotoKind, type PhotoKindOptions, type PhotoPose, photoProgram, photoReach, PRINT_RETURN_MS, printExtent, printRect, type PrintRest, type Prints } from "./photo/kind";
// the text stack's seam and the note's writing (D2c, design-015 §6.1)
export { createWriting, DEFAULT_BLEED, DEFAULT_FACE, DEFAULT_HAND_LAW, type InkPages, type NoteInk, type NoteRasterInfo, type Writing, type WritingStats } from "./paper/writing";

/**
 * The desk's kinds in the order they prepare — the prototype's (the notes, the mini mats, the whiteboards; its prints
 * after the ground, as its photo lab drew them; then its two layers in the order its lab rendered them: the calendar's
 * before the frame, the notebooks' after it) — each made from `text`: the generated module unless a host says (the Node
 * oracle hands the .wgsl files on disk).
 */
export function deskKinds(text: ShaderText = shaderText): readonly KindProgram[] {
  return [paperProgram(text), miniMatProgram(text), boardProgram(text), photoProgram(text), calendarProgram(text), notebookProgram(text)];
}

/** The desk's kinds on the generated shader text — what a browser host registers: `Ground.create({ device, canvas, mat, kinds: DESK_KINDS })`. */
export const DESK_KINDS: readonly KindProgram[] = deskKinds();
