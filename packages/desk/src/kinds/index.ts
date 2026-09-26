// The desk's kinds as the ground registers them (kind.ts; design-015 §5.2's render half): the
// note, the mini mat and the whiteboard, each a thin adapter over its pass. The composition root
// (ground.ts) never imports this module — a host hands `Ground.create` a registry, and the desk's
// own is `DESK_KINDS`. The notebook, the calendar and the photo still draw outside the ground
// (their fold is D3).

import type { KindProgram } from "../kind";
import { type ShaderText, shaderText } from "../shaders";
import { boardProgram } from "./board";
import { miniMatProgram } from "./minimat";
import { paperProgram } from "./paper";

export { BOARD_KIND, BoardKind, boardProgram } from "./board";
export { MINIMAT_KIND, MiniMatKind, miniMatProgram } from "./minimat";
export { PAPER_KIND, PaperKind, paperProgram } from "./paper";

/**
 * The desk's kinds in the order they prepare — the prototype's (the notes, the mini mats, the whiteboards) — each
 * made from `text`: the generated module unless a host says (the Node oracle hands the .wgsl files on disk).
 */
export function deskKinds(text: ShaderText = shaderText): readonly KindProgram[] {
  return [paperProgram(text), miniMatProgram(text), boardProgram(text)];
}

/** The desk's kinds on the generated shader text — what a browser host registers: `Ground.create({ device, canvas, mat, kinds: DESK_KINDS })`. */
export const DESK_KINDS: readonly KindProgram[] = deskKinds();
