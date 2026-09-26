// The desk's kinds as the ground registers them (kind.ts; design-015 §5.2's render half): the
// note, the mini mat, the whiteboard, the photo print, the desk calendar and the notebook, each a thin
// adapter over its pass (the last two LAYERED — kinds/layer.ts: a target of their own, laid as one
// composite run; root only, D-D18). The composition root (ground.ts) never imports this module — a
// host hands `Ground.create` a registry, and the desk's own is `DESK_KINDS`.
//
// And the kinds WHOLE (kinds/world.ts; D2a-world): `paperKind()` and `minimatKind()` — each a
// `KindProgram` with its world half (resolve · record · hit · reach · theme) — what `defineObject`
// binds a widget type to and the builder drives. The whiteboard's world half is D3's.

import type { KindProgram } from "../kind";
import { type ShaderText, shaderText } from "../shaders";
import { boardProgram } from "./board";
import { calendarProgram } from "./calendar";
import { miniMatProgram } from "./minimat";
import { notebookProgram } from "./notebook";
import { paperProgram } from "./paper";
import { photoProgram } from "./photo";

export { BOARD_KIND, type BoardInk, BoardKind, type BoardKindOptions, type BoardObjectLook, type BoardPalette, boardFrame, boardKind, boardProgram, boardReach, boardRest, createBoardInk } from "./board";
export { CALENDAR_KIND, type CalendarAlpha, CalendarKind, calendarProgram } from "./calendar";
export { INSIDE_GRID, MINIMAT_KIND, MiniMatKind, type MiniMatKindOptions, type MiniMatLook, type MiniMatPalette, miniMatFrame, miniMatProgram, miniMatReach, minimatKind, SAGE } from "./minimat";
export { NOTEBOOK_KIND, NotebookKind, notebookProgram } from "./notebook";
export { PAPER_KIND, type PaperAsset, PaperKind, type PaperKindOptions, type PaperLook, type PaperPalette, paperFrame, paperProgram, paperReach, paperKind } from "./paper";
export { PHOTO_KIND, PhotoKind, photoFrame, photoProgram } from "./photo";
export { type DataChildren, FLUX_REST, isObjectKind, type KindHost, type KindLocal, numberProp, type ObjectContext, type ObjectFlux, type ObjectHit, type ObjectKind, type ObjectRect, rectFrame, rectOf, type StratumName, stringProp } from "./world";
// the text stack's seam and the note's writing (D2c, design-015 §6.1)
export { createWriting, DEFAULT_BLEED, DEFAULT_FACE, DEFAULT_HAND_LAW, type InkPages, type NoteInk, type NoteRasterInfo, type Writing, type WritingStats } from "../paper/writing";
export type { InkBitmap, TextRaster } from "../paper/raster";
export { type HandLayout, layoutText } from "../paper/text";

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
