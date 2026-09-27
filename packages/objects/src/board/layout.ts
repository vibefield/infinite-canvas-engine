// The board pass's GPU records, declared once (README §2 rule 2). `Board` is one whiteboard
// as drawn — what `resolveBoard` returns, its two materials, where its raster is, the stroke
// in progress, the pen in the hand and the capped marker lying on it. `BoardUniforms` is the
// pass's own knobs; the camera, the light, the gobo and the portal chain arrive through the
// mat's block (`MatUniforms`), which the pass fills for itself, as the note's and the
// notebook's passes do. `Stamp` is one footprint of the pen (stroke.ts), `StampUniforms` the
// tip it is stamped with, `InkUniforms` the colour a finished stroke is laid in.

import { defineStruct } from "@ice/desk/engine";
import type { RGB } from "@ice/desk";
import type { BoardGeometry, WorldBox } from "./board";

// vec2s first, then scalars, then vec4s: tight under the alignment rules.
export const Board = defineStruct("Board", [
  ["centre", "vec2f"], ["half", "vec2f"],
  ["inner", "vec2f"],    // the melamine's half extents
  ["slope", "vec2f"],    // the shadow's ground offset per unit of height, world axes
  ["sheen", "vec2f"],    // where the eye is over the board, × its half extents — the pointer's parallax
  ["texels", "vec2f"],   // the raster's size in texels
  ["frame", "f32"], ["radius", "f32"], ["innerR", "f32"], ["thick", "f32"],
  ["recess", "f32"], ["lift", "f32"], ["alpha", "f32"], ["ring", "f32"],
  ["density", "f32"],    // texels per world unit
  ["wet", "f32"],        // 1 = the wet layer holds something (else it is not sampled)
  ["laying", "f32"],     // 1 = a stroke is being laid on this board (the stroke layer is read)
  ["scale", "f32"],      // the hold's scale (the raster is the melamine at scale 1)
  ["lamp", "vec4f"],     // the unit direction to the lamp, world axes; unused
  ["quad", "vec4f"],     // the world rect the fragment may paint: x0 y0 x1 y1
  ["surface", "vec4f"],  // the melamine (sRGB), unused
  ["metal", "vec4f"],    // the aluminium (sRGB), unused
  ["tool", "vec4f"],     // the stroke in progress: its ink (LINEAR), mode (0 marker · 1 eraser)
  ["pen", "vec4f"],      // THE marker, in whatever pose: its nib's end (world x y), its angle (rad), its presence
  ["penPose", "vec4f"],  // its axis' height over the melamine at the nib's end, its rise (height per unit of length), its cap (0 on the nib … 1 posted), the nib's half-width
  ["penInk", "vec4f"],   // its colour (sRGB), unused
  ["eraser", "vec4f"],   // the eraser in the hand: world x y, its height over the melamine, its presence
  ["tier", "vec4f"],     // where its ink is (K6a): its thumbnail's layer, the level of its source's chain the layer starts at, its pool slot (−1: the thumbnail), live (1: its stroke and wet are bound)
] as const);

export const BoardUniforms = defineStruct("BoardUniforms", [
  ["light", "vec4f"],    // the lamp's fill on a face turned from it, the cap past flat, the day's chain (0 = a lit byte is the token's byte), the glints' strength by night
  ["shadow", "vec4f"],   // penumbra σ at contact, σ per unit of height, alpha, the contact term's alpha
  ["shadow2", "vec4f"],  // contact σ, the gap it fades over (world), the ring's width (CSS px), unused
  ["castTint", "vec4f"], // what a shadow is made of on this ground (sRGB)
  ["select", "vec4f"],   // --vf-select, the ring
  ["mel", "vec4f"],      // the melamine: tone (±), grain (±), the ghost, the ink film's relief
  ["sheen", "vec4f"],    // the window's reflection: strength, its angular half-size (rad), the eye's height (× the board's height), wet ink's darkening
  ["lip", "vec4f"],      // the frame's lip on the melamine: its shadow's alpha, σ; the frame: brushed (±), its roll at the rims (rad)
  ["glint", "vec4f"],    // the metal's glint, unused ×3
  ["barrel", "vec4f"],   // a marker's barrel (sRGB)
  ["felt", "vec4f"],     // the eraser's felt (sRGB)
  ["wood", "vec4f"],     // the eraser's back (sRGB)
  ["pen", "vec4f"],      // a marker: length, barrel radius, the cap's length, rise (height per unit of length)
  ["pen2", "vec4f"],     // how high the pen hovers unpressed, unused ×3
  ["block", "vec4f"],    // the eraser: half extents x y, the felt's height, the back's height
  ["block2", "vec4f"],   // the eraser: its angle (rad), unused ×3
] as const);

/** One footprint of the pen (stroke.ts `STAMP_FLOATS` — the same eight floats, in the same order). */
export const Stamp = defineStruct("Stamp", [
  ["pos", "vec2f"], ["dir", "vec2f"], ["s", "f32"], ["flow", "f32"], ["size", "f32"], ["seed", "f32"],
] as const);

export const StampUniforms = defineStruct("StampUniforms", [
  ["tex", "vec4f"],    // the raster's size (texels), texels per world unit, unused
  ["tip", "vec4f"],    // half along, half across (world), angle (rad), corner radius
  ["felt", "vec4f"],   // softness (world), mode (0 ink · 1 erase), opacity, streak
  ["lanes", "vec4f"],  // lanes per world unit across, drift along ×2, unused
] as const);

export const InkUniforms = defineStruct("InkUniforms", [
  ["color", "vec4f"],  // the finished stroke's ink (LINEAR), unused
] as const);

export const MAX_BOARDS = 64;

/**
 * THE marker of a board, in whatever pose it is in: lying capped on the melamine, in the hand at
 * the pointer with its cap posted, or anywhere between as it is picked up or put down (lab/board.ts
 * moves it; the shader draws it). Heights are over the melamine.
 */
export interface BoardPen {
  /** The nib's end, world units. */
  readonly x: number;
  readonly y: number;
  /** Radians: the direction from the nib along the barrel. */
  readonly angle: number;
  /** The axis' height over the melamine at the nib's end, and how steeply it rises along the barrel. */
  readonly height: number;
  readonly rise: number;
  /** Where the cap is: 0 on the nib … 1 posted on the back. */
  readonly cap: number;
  /** The nib's half-width (the tip in use). */
  readonly nib: number;
  readonly presence: number;
  /** Its colour as it looks (sRGB). */
  readonly ink: RGB;
}

/** The eraser in the hand of an open board. */
export interface BoardEraser { readonly x: number; readonly y: number; readonly height: number; readonly presence: number }

/** One board for the pass: its geometry, its materials, its raster, and what is on and over it this frame. */
export interface BoardInstance {
  /** Its raster (BoardPass.ensure) — the ink the melamine shows. */
  readonly id: number;
  readonly geometry: BoardGeometry;
  readonly surface: RGB;
  readonly metal: RGB;
  /** The world rect it may paint (board.ts `quadOf`). */
  readonly quad: WorldBox;
  /** The eye's offset over the board, −1..1 each way (the pointer's parallax); absent = straight over its centre. */
  readonly sheen?: readonly [number, number] | undefined;
  /** The stroke being laid: its ink (LINEAR) and whether it erases. */
  readonly stroke?: { readonly color: RGB; readonly erase: boolean } | undefined;
  readonly pen?: BoardPen | undefined;
  readonly eraser?: BoardEraser | undefined;
  /**
   * The pen's MATERIALS (a marker's barrel, the eraser's felt and back) when the record was made WITHOUT the desk's local — a tray
   * specimen (K5b): nobody else sets them on the pass that draws it (the local's raster sets the root's, and only for a desk board
   * drawn), so the specimen carries its look's; else the one its slot's pass copied from the root showed whatever the last desk board
   * left there — black before any was drawn (an order-dependent still). Absent: the pass's own.
   */
  readonly materials?: { readonly barrel: RGB; readonly felt: RGB; readonly wood: RGB } | undefined;
}

export function boardValues(b: BoardInstance, raster: { readonly size: readonly [number, number]; readonly density: number; readonly wet: boolean }, tier: readonly [number, number, number, number] = [0, 0, 0, 1]) {
  const G = b.geometry;
  const pn = b.pen;
  const er = b.eraser;
  const s = b.stroke;
  return {
    centre: G.centre, half: G.half, inner: G.inner, slope: G.slope,
    sheen: b.sheen ?? [0, 0], texels: raster.size,
    frame: G.frame, radius: G.radius, innerR: G.innerR, thick: G.thick,
    recess: G.recess, lift: G.lift, alpha: G.alpha, ring: G.ring,
    density: raster.density, wet: raster.wet ? 1 : 0, laying: s ? 1 : 0, scale: G.scale,
    lamp: [G.lamp[0], G.lamp[1], G.lamp[2], 0],
    quad: [b.quad.x0, b.quad.y0, b.quad.x1, b.quad.y1],
    surface: [b.surface[0], b.surface[1], b.surface[2], 0],
    metal: [b.metal[0], b.metal[1], b.metal[2], 0],
    tool: s ? [s.color[0], s.color[1], s.color[2], s.erase ? 1 : 0] : [0, 0, 0, 0],
    pen: pn ? [pn.x, pn.y, pn.angle, pn.presence] : [0, 0, 0, 0],
    penPose: pn ? [pn.height, pn.rise, pn.cap, pn.nib] : [0, 0, 0, 0],
    penInk: pn ? [pn.ink[0], pn.ink[1], pn.ink[2], 0] : [0, 0, 0, 0],
    eraser: er ? [er.x, er.y, er.height, er.presence] : [0, 0, 0, 0],
    tier: [tier[0], tier[1], tier[2], tier[3]],
  };
}
