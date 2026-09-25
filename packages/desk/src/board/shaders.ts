// Assemble the board pass's shader parts from raw text — the browser with `?raw` imports, a
// Node host with readFileSync; byte-identical either way. Four programs: the BOARD on the
// desk (it composes the card's primitives, the mat's chain and the felt's noise, all pure),
// the STAMP that lays the pen's footprints into a stroke, the INK that lays a finished stroke
// into the raster (and keeps the wet layer), and the MIP that shrinks the raster for a
// board seen small.

import type { ShaderPart } from "../engine/shader";

export interface BoardProgram {
  readonly modules: readonly ShaderPart[];
  readonly entry: ShaderPart;
}

export interface BoardShaders {
  readonly board: BoardProgram;   // portal, primitives, mat, felt, board + board-pass
  readonly stamp: BoardProgram;   // primitives, felt + stamp
  readonly ink: BoardProgram;     // ink
  readonly mip: BoardProgram;     // mip
}

export interface BoardShaderText {
  readonly portal: string;
  readonly primitives: string;
  readonly mat: string;
  readonly felt: string;
  readonly board: string;
  readonly boardPass: string;
  readonly stamp: string;
  readonly ink: string;
  readonly mip: string;
}

export const BOARD_SHADER_FILES: Record<keyof BoardShaderText, string> = {
  portal: "portal.wgsl",
  primitives: "primitives.wgsl",
  mat: "mat/mat.wgsl",
  felt: "board/felt.wgsl",
  board: "board/board.wgsl",
  boardPass: "board/board-pass.wgsl",
  stamp: "board/stamp.wgsl",
  ink: "board/ink.wgsl",
  mip: "board/mip.wgsl",
};

export function boardShaders(t: BoardShaderText): BoardShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  const primitives = part("primitives.wgsl", t.primitives);
  const felt = part("board/felt.wgsl", t.felt);
  return {
    board: { modules: [part("portal.wgsl", t.portal), primitives, part("mat/mat.wgsl", t.mat), felt, part("board/board.wgsl", t.board)], entry: part("board/board-pass.wgsl", t.boardPass) },
    stamp: { modules: [primitives, felt], entry: part("board/stamp.wgsl", t.stamp) },
    ink: { modules: [], entry: part("board/ink.wgsl", t.ink) },
    mip: { modules: [], entry: part("board/mip.wgsl", t.mip) },
  };
}
