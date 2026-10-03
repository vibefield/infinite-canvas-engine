// Assemble the board pass's programs from the host's shader text — the browser's generated module, a Node host's files
// on disk; byte-identical either way. Four programs: the BOARD on the desk (the kit's view block, portal chain, card
// primitives and mat light — kit/wgsl.ts, by name — then the felt's noise and the board's own), the STAMP that lays
// the pen's footprints into a stroke, the INK that lays a finished stroke into the raster (and keeps the wet layer),
// and the MIP that shrinks the raster for a board seen small.

import type { CardMaterial } from "@ice/desk";
import type { ComposeOptions } from "@ice/desk/engine";
import { kitWgsl, type ShaderText } from "@ice/desk/kit";
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
  boardCard: "board/board-card.wgsl",
  boardPass: "board/board-pass.wgsl",
  stamp: "board/stamp.wgsl",
  ink: "board/ink.wgsl",
  mip: "board/mip.wgsl",
} as const;

export function boardShaders(text: ShaderText): BoardShaders {
  const t = text(BOARD_SHADER_FILES);
  const felt = { label: "board/felt.wgsl", text: t.felt };
  return {
    board: kitWgsl(["view", "portal", "sdf", "light"], { structs: [BoardUniforms, Board], modules: [felt, { label: "board/board.wgsl", text: t.board }, { label: "board/board-card.wgsl", text: t.boardCard }], entry: { label: "board/board-pass.wgsl", text: t.boardPass } }, text),
    stamp: kitWgsl(["sdf"], { structs: [StampUniforms, Stamp], modules: [felt], entry: { label: "board/stamp.wgsl", text: t.stamp } }, text),
    ink: { structs: [InkUniforms], entry: { label: "board/ink.wgsl", text: t.ink } },
    mip: { entry: { label: "board/mip.wgsl", text: t.mip } },
  };
}

/**
 * The whiteboard's CARD MATERIAL (K7b, design-016 §6 K7): the flat-card pipeline draws a board with board-card.wgsl's quad and
 * fragment over the board pass's own records, knobs, samplers and thumbnail array (`BoardPass.cardResources`, in this order) —
 * every board drawn from its thumbnail (the card binds no pool and no live layers: its `board_ink` is the thumbnail's, its
 * stroke and wet none).
 */
export function boardCard(text: ShaderText): CardMaterial {
  return {
    shaders: () => {
      const t = text(BOARD_SHADER_FILES);
      return kitWgsl(["view", "portal", "sdf", "light"], { structs: [BoardUniforms, Board], modules: [{ label: "board/felt.wgsl", text: t.felt }, { label: "board/board.wgsl", text: t.board }], entry: { label: "board/board-card.wgsl", text: t.boardCard } }, text);
    },
    only: [
      "fn board_ink(B: Board, uv: vec2f, lod: f32) -> vec4f { return board_thumb(B, uv, lod); }   // the card binds no pool",
      "fn board_stroke(B: Board, uv: vec2f) -> f32 { return 0.0; }   // …and no live layers: a board being written on is the pass's",
      "fn board_wet(B: Board, uv: vec2f) -> f32 { return 0.0; }",
    ].join("\n"),
    bindings: [
      { wgsl: "var<uniform> board_k: BoardUniforms", entry: { stages: ["fragment"], buffer: "uniform" } },
      { wgsl: "var<storage, read> boards: array<Board>", entry: { stages: ["vertex", "fragment"], buffer: "read-only-storage" } },
      { wgsl: "var board_gobo_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var board_noise_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var board_ink_samp: sampler", entry: { stages: ["fragment"], sampler: "filtering" } },
      { wgsl: "var board_thumbs: texture_2d_array<f32>", entry: { stages: ["fragment"], texture: "float", dimension: "2d-array" } },
    ],
    quad: "board_quad",
    fragInline: BOARD_FRAGMENT,
  };
}

/**
 * The board's fragment as the flat-card pipeline splices it (K7b): board-pass.wgsl's `fs`, statement for statement — its `in.idx`
 * the card's `slot`, its shade `cb`, its return the card's `c` — because shade_board reached through one more function compiles to
 * one LSB off on a pixel a scene (measured on the oracle): the card runs the very code the pass runs. `boardFsOf` is the pass's `fs`
 * the same statements make (test/card.test.ts holds board-pass.wgsl to it).
 */
export const BOARD_FRAGMENT = [
  "      let B = boards[slot];",
  "      let zoom = max(u.cam.z, 1.0e-12);",
  "      let dpr = max(u.cam.w, 1.0e-6);",
  "      let px = 1.0 / (zoom * dpr);           // world per device px",
  "      let css = 1.0 / zoom;                  // world per CSS px",
  "      let p = in.clip.xy * px + u.cam.xy;    // device px → world",
  "      let cb = shade_board(B, u, board_k, p, px, css, in.clip.xy, gobo_tex, board_gobo_samp, noise_tex, board_noise_samp);",
  "      if (cb.a < 0.002) { discard; }",
  "      // Premultiplied: the presentation's opacity through the portal clip scales every channel.",
  "      c = cb * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));",
].join("\n");

/** The pass's `fs` body BOARD_FRAGMENT's statements make — as board-pass.wgsl writes it (a test holds the two equal). */
export const boardFsOf = (fragment: string): string =>
  fragment.split("\n").map((l) => l.slice(4)
    .replace("let B = boards[slot];", "let B = boards[in.idx];")
    .replace("let cb = shade_board(", "let c = shade_board(")
    .replace("if (cb.a < 0.002)", "if (c.a < 0.002)")
    .replace("c = cb * (", "return c * (")).join("\n");
