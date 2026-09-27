// The paper pass's GPU records, declared once. `Paper` is one note as drawn —
// what `resolvePaper` returns, the paper's and the pen's colours, where its
// ink lives in the pages, the writing head (the wipe) and the caret.
// `PaperUniforms` is the pass's own knobs; the camera, the light, the gobo
// and the portal chain arrive through the mat's block (`MatUniforms`), which
// the pass fills for itself so a note is lit like the mat whether or not the
// mat is the grid this frame.

import { defineStruct } from "@ice/desk/engine";
import type { RGB } from "@ice/desk";
import type { UvRect } from "./pages";
import type { PaperGeometry } from "./paper";

// vec2s first, then scalars, then vec4s: tight under the alignment rules.
export const Paper = defineStruct("Paper", [
  ["centre", "vec2f"], ["half", "vec2f"],
  ["rot", "vec2f"],     // cos, sin of the tilt
  ["slope", "vec2f"],   // the shadow's ground offset per unit of height, world axes
  ["lift", "f32"], ["curl", "f32"], ["cornerCurl", "f32"], ["glue", "f32"],
  ["radius", "f32"], ["ring", "f32"], ["alpha", "f32"],
  ["layer", "i32"],     // the ink page's layer; −1 = no ink
  ["lamp", "vec4f"],    // the unit direction to the lamp, world axes; unused
  ["paper", "vec4f"],   // the sheet's colour (sRGB), its fibre's amplitude
  ["ink", "vec4f"],     // the pen's colour (sRGB), its density
  ["shadow", "vec4f"],  // σ at contact, alpha, σ per unit of height, the relief (the slope's exaggeration for the shading)
  ["uv", "vec4f"],      // the raster's rect in its layer, normalised: u0 v0 u1 v1 — it covers the whole sheet
  ["wipe", "vec4f"],    // the newest glyph's box, note units from the sheet's top-left: x0 y0 x1 y1 (x1 < x0 = none)
  ["caret", "vec4f"],   // the caret: x, baseline y (note units), its reach above and below
  ["marks", "vec4f"],   // the wipe's progress, the caret on (0/1), unused ×2
] as const);

export const PaperUniforms = defineStruct("PaperUniforms", [
  ["knobs", "vec4f"],   // the mat's chain on the paper (0 = a lit byte is the token's byte, 1 = the mat's double gamma), the wipe's softness (note units), the caret's width (CSS px), the ring's width (CSS px)
  ["select", "vec4f"],  // --vf-select, the ring's colour
] as const);

export const MAX_PAPERS = 1024;

/** One note for the pass: its geometry, its two colours, its ink and its live marks. */
export interface PaperInstance {
  readonly geometry: PaperGeometry;
  /** The sheet's colour — the product's note surface (§2.2), or the host's. */
  readonly paper: RGB;
  /** The pen's colour and how dark it lays (1 = the colour itself where the raster is full). */
  readonly ink: RGB;
  readonly inkDensity?: number;
  /** The fibre's amplitude, ±/255 — theme.ts `PAPER.grain` unless the host says. */
  readonly grain?: number;
  /** Where the ink lives (pages.ts): absent = a blank sheet. */
  readonly raster?: { readonly layer: number; readonly uv: UvRect } | undefined;
  /** The newest glyph's box and how far the pen has got through it. */
  readonly wipe?: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly t: number } | undefined;
  /** The caret, when the note is being written. */
  readonly caret?: { readonly x: number; readonly y: number; readonly above: number; readonly below: number; readonly on: boolean } | undefined;
}

export function paperValues(p: PaperInstance, grain: number) {
  const G = p.geometry;
  const r = p.raster;
  const w = p.wipe;
  const c = p.caret;
  return {
    centre: G.centre, half: G.half, rot: [G.cos, G.sin], slope: G.slope,
    lift: G.lift, curl: G.curl, cornerCurl: G.cornerCurl, glue: G.glue, radius: G.radius, ring: G.ring, alpha: G.alpha,
    layer: r ? r.layer : -1,
    lamp: [G.lamp[0], G.lamp[1], G.lamp[2], 0],
    paper: [p.paper[0], p.paper[1], p.paper[2], p.grain ?? grain],
    ink: [p.ink[0], p.ink[1], p.ink[2], p.inkDensity ?? 1],
    shadow: [G.shadow.sigma, G.shadow.alpha, G.shadow.sigmaPerUnit, G.relief],
    uv: r ? [r.uv.u0, r.uv.v0, r.uv.u1, r.uv.v1] : [0, 0, 0, 0],
    wipe: w ? [w.x0, w.y0, w.x1, w.y1] : [0, 0, -1, -1],
    caret: c ? [c.x, c.y, c.above, c.below] : [0, 0, 0, 0],
    marks: [w ? w.t : 1, c?.on ? 1 : 0, 0, 0],
  };
}
