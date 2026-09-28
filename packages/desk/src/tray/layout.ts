// The tray's own record (tray.wgsl `t`) — the block the pass writes beside its light block (tray/pass.ts) and the struct its
// program composes after the kit's (tray/shaders.ts): a pass's records in its layout.ts, as the marks and the kinds keep theirs.

import { defineStruct } from "../engine/struct";

/** The tray's own block (tray.wgsl `t`). */
export const TrayUniforms = defineStruct("TrayUniforms", [
  ["view", "vec4f"],     // the view: CSS width, height, dpr, the pitch (CSS px)
  ["rect", "vec4f"],     // the drawer as drawn (drawer.ts `drawerRect`): left, top, width, full height — CSS px
  ["rowBase", "i32"],    // THE CARRY (lattice.ts): the shown scroll's whole rows…
  ["frac", "f32"],       // …and the fraction of a row, the only part of the scroll in an f32
  ["fp", "f32"],         // pitches per device px — the footprint every band fades by
  ["dim", "f32"],        // the dim's alpha this frame
  ["shape", "vec4f"],    // the top corners' radius, the arris (the board's edge), —, — — CSS px
  ["hole", "vec4f"],     // the stadium's radius and straight half-length, the rim fillet k, the solid side border — pitches
  ["depth", "vec4f"],    // the board's thickness, the gap to the wall — pitches; the phase: columns, rows
  ["lamp", "vec4f"],     // the unit direction to the lamp (x right, y down, z toward the eye), its angular radius (rad)
  ["room", "vec4f"],     // the room's shadow round the outline: σ, α — CSS px; —, —
  ["shadow", "vec4f"],   // the lamp's shadow: σ, α, its push along the lamp's ground direction (x, y) — CSS px
  ["face", "vec4f"],     // the tempered face, linear
  ["faceSrgb", "vec4f"], // …and its configured byte (sRGB): the plain face's colour lit flat
  ["edge", "vec4f"],     // the punched fibre, linear
  ["wall", "vec4f"],     // the plaster, linear
  ["cavity", "vec4f"],   // the room's light on the wall in a hole: at its edge, at its heart, over what width (pitches)
  ["keepFace", "vec4f"], // each band's share at this footprint (tray.wgsl, the research's fade): the face's grain (≈ 19 a pitch), —, 85, 190…
  ["keepFine", "vec4f"], // …its 210 (bump) · 42 · 105 (flecks)…
  ["keepEdge", "vec4f"], // …and the punched fibre's 9 · 18 · 36
  ["accessory", "vec4f"], // K5a: the accessories' powder coat, linear, and their shadows' strength on the board
]);

/**
 * One specimen's ACCESSORY (K5a — tray.wgsl `tray_accessory`): drawn with the board, one instance each, its quad the accessory and its
 * shadow's reach. Screen CSS px throughout (the drawer's camera is zoom 1): the quad, the specimen's rect, up to four pegs' hole centres.
 */
export const TrayAccessoryStruct = defineStruct("TrayAccessory", [
  ["box", "vec4f"],   // the quad: x0, y0, x1, y1
  ["kind", "vec4f"],  // the accessory (0 hook · 1 shelf · 2 clip · 3 rail), its pegs, how far it stands off the board (px), —
  ["rect", "vec4f"],  // the specimen: x0, y0, x1, y1
  ["pegs0", "vec4f"], // pegs 0 and 1: x, y
  ["pegs1", "vec4f"], // pegs 2 and 3
]);
