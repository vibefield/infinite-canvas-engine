// The WHITEBOARD (BOARD.md) as a kind (kind.ts): the board pass behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`: a board lies among the
// desk's other things in the desk's own order (a note can sit on a board). Its `prepare` still
// sends the queued stamps and the drying in submits of its own BEFORE the frame's (BOARD.md), and
// takes no lamp — as the ground always called it. A spawned slot's pass copies the root's look
// every frame (`tune` → the pass's `copy`).

import { BoardPass } from "../board/board-pass";
import type { BoardGeometry } from "../board/board";
import type { BoardInstance } from "../board/layout";
import { BOARD_SHADER_FILES, boardShaders } from "../board/shaders";
import type { KindPass, KindProgram, SlotContext } from "../kind";
import type { MarkFrame } from "../marks/layout";
import type { MatPass } from "../mat/mat-pass";
import type { ShaderText } from "../shaders";

/** The whiteboard's kind name — its key in the registry and in every slot's `objects`. */
export const BOARD_KIND = "board";

export class BoardKind implements KindPass<BoardInstance> {
  /** The board pass itself: a host's door to the rasters (`ensure`, `lay`, `commit`, `replay`, `dry`) and the look (`look`, `chain`). */
  readonly pass: BoardPass;
  constructor(pass: BoardPass) { this.pass = pass; }

  spawn(mat: MatPass): BoardKind { return new BoardKind(this.pass.spawn(mat)); }

  tune(root: KindPass<BoardInstance>): void { if (root instanceof BoardKind) this.pass.copy(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light and the theme (its ring's colour). */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly BoardInstance[]): number {
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.theme);
  }

  /** Records [first, end) — a board whose raster is missing draws nothing (the pass counts in the list it was handed). */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }

  dispose(): void { this.pass.dispose(); }
}

/** The whiteboard's program for a host's shader text: its passes made on the root's mat. */
export function boardProgram(text: ShaderText): KindProgram<BoardInstance> {
  return {
    name: BOARD_KIND,
    stratum: "things",
    create: async (device, format, mat) => new BoardKind(await BoardPass.create(device, format, boardShaders(text(BOARD_SHADER_FILES)), mat)),
  };
}

/** The whiteboard's silhouette for the desk's marks (D4a): its aluminium frame's outside as drawn, square to the mat. */
export function boardFrame(G: BoardGeometry): MarkFrame {
  return { cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: 0, r: G.radius };
}
