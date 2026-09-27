// Assemble the board pass's programs from the host's shader text — the browser's generated module, a Node host's files
// on disk; byte-identical either way. Four programs: the BOARD on the desk (the kit's view block, portal chain, card
// primitives and mat light — kit/wgsl.ts, by name — then the felt's noise and the board's own), the STAMP that lays
// the pen's footprints into a stroke, the INK that lays a finished stroke into the raster (and keeps the wet layer),
// and the MIP that shrinks the raster for a board seen small.

import type { ComposeOptions } from "../engine/shader";
import { kitWgsl, type ShaderText } from "../kit/wgsl";
import { Board, BoardUniforms, InkUniforms, Stamp, StampUniforms } from "./layout";

export interface BoardShaders {
  readonly board: ComposeOptions;   // the kit's view, portal, sdf, light + felt, board + board-pass
  readonly stamp: ComposeOptions;   // the kit's sdf + felt + stamp
  readonly ink: ComposeOptions;     // ink
  readonly mip: ComposeOptions;     // mip
}

/** The board's own shader files (the kit's pieces come by name). */
export const BOARD_SHADER_FILES = {
  felt: "board/felt.wgsl",
  board: "board/board.wgsl",
  boardPass: "board/board-pass.wgsl",
  stamp: "board/stamp.wgsl",
  ink: "board/ink.wgsl",
  mip: "board/mip.wgsl",
} as const;

export function boardShaders(text: ShaderText): BoardShaders {
  const t = text(BOARD_SHADER_FILES);
  const felt = { label: "board/felt.wgsl", text: t.felt };
  return {
    board: kitWgsl(["view", "portal", "sdf", "light"], { structs: [BoardUniforms, Board], modules: [felt, { label: "board/board.wgsl", text: t.board }], entry: { label: "board/board-pass.wgsl", text: t.boardPass } }, text),
    stamp: kitWgsl(["sdf"], { structs: [StampUniforms, Stamp], modules: [felt], entry: { label: "board/stamp.wgsl", text: t.stamp } }, text),
    ink: { structs: [InkUniforms], entry: { label: "board/ink.wgsl", text: t.ink } },
    mip: { entry: { label: "board/mip.wgsl", text: t.mip } },
  };
}
