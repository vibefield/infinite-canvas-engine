// The mini mat pass's GPU records, declared once (MINIMAT.md §6). `MiniMat` is
// one mini mat as drawn — what `resolveMiniMat` returns, its vinyl, the inside's
// embedding and the lattice its face shows at the far LOD, the live inside's
// presence and its range of chips; `Chip` is one child as the face draws it
// small; `MiniMatUniforms` the pass's own knobs. The camera, the light, the gobo
// and the portal chain arrive through the mat's block (`MatUniforms`), which the
// pass fills for itself so a mini mat is lit exactly as the desk it lies on.

import { defineStruct } from "../engine/struct";
import type { PortalAffine } from "../nav/flight";
import type { RGB } from "../theme";
import type { GlyphAtlasMeta } from "../mat/layout";
import { CHIP_LINES, type Chip, type FaceLattice, type MiniMatGeometry, type MiniMatLaw, NAME_CHARS, nameGlyphs, type Numerals, packGlyphs } from "./minimat";

// vec2s first, then scalars, then vec4s: tight under the alignment rules.
export const MiniMat = defineStruct("MiniMat", [
  ["centre", "vec2f"], ["half", "vec2f"],
  ["slope", "vec2f"],     // the shadow's ground offset per unit of height, world axes
  ["lamp", "vec2f"],      // the lamp's ground direction (unit), world axes — what the cut edge catches
  ["radius", "f32"], ["margin", "f32"], ["lift", "f32"], ["thick", "f32"],
  ["alpha", "f32"], ["ring", "f32"],
  ["live", "f32"],        // the live inside over the face: −1 none (the face draws its far LOD), else its objects' presence — the chips fade over it by 1 − that
  ["lampZ", "f32"],       // the lamp's elevation (the unit direction's z)
  ["chipFirst", "u32"], ["chipCount", "u32"],
  ["nameLen", "f32"], ["pad0", "f32"],
  ["ground", "vec4f"],    // the vinyl's colour (sRGB), the grain's amplitude
  ["inside", "vec4f"],    // the inside's embedding M (host = o + inside · s): s, ox, oy; unused
  ["rungs", "vec4f"],     // the inside's lattice at this zoom: fine, mid, coarse spacing (inside units); unused
  ["weights", "vec4f"],   // each rung's line presence (fine, mid, coarse), dressed as the live inside dresses it; unused
  ["widths", "vec4f"],    // each rung's line half-width, DEVICE px; unused
  ["numerals", "vec4f"],  // the ruler's numbered rung (minimat.ts `numeralsOf`): spacing (inside units), mult, exp, the fade of its own sites — spacing 0 = none
  ["name", `array<vec4f, ${NAME_CHARS / 16}>`],   // the NAME's glyph indices, four to a float (minimat.ts `packGlyphs`)
] as const);

export const ChipRecord = defineStruct("Chip", [
  ["centre", "vec2f"], ["half", "vec2f"],
  ["rot", "vec2f"],       // cos, sin of the tilt
  ["radius", "f32"], ["kind", "f32"],   // the corner; 0 a sheet of paper, 1 a mini mat
  ["colour", "vec4f"],    // the chip's colour (sRGB), its height off the face (host units)
  ["ink", "vec4f"],       // the writing's ink (sRGB), the greeked stroke's half-thickness (host units)
  ["frame", "vec4f"],     // a mini mat chip's border (host units), the line count, unused ×2
  ["lines", `array<vec4f, ${CHIP_LINES}>`],   // per greeked line, in the chip's frame (host units): x from, x to, the stroke's y, unused
] as const);

export const MiniMatUniforms = defineStruct("MiniMatUniforms", [
  ["print", "vec4f"],     // presences: the frame round the face, the ticks and the words; unused; the print's line width (world units)
  ["ticks", "vec4f"],     // the ticks' lengths — minor, medium, major (world units); unused
  ["edge", "vec4f"],      // the cut edge's bevel: width (world units), light, dark; the ring's width (CSS px)
  ["shadow", "vec4f"],    // the penumbra: σ at contact, σ per unit of height, alpha; the contact term's alpha
  ["shadow2", "vec4f"],   // the contact term's σ and the gap it fades over (world); the greeked lines' presence; the chips' least size (CSS px)
  ["cream", "vec4f"],     // the print's ink (MAT.line, sRGB); the greeking's onset (CSS px of chip height)
  ["castTint", "vec4f"],  // what a shadow is made of by day (MAT.cast, sRGB), unused — `cast` is a WGSL reserved word
  ["select", "vec4f"],    // --vf-select (the ring), unused
  ["digits", "vec4f"],    // the numerals: cap (world units), gap after the tick, the cap's top in from the sheet's edge; unused
  ["text", "vec4f"],      // the name's cap, its tracking (em), legible from · to (CSS px of cap)
  ["atlas", "vec4f"],     // the glyph atlas (RULER.md): cell width, cell height, advance, baseline (texels)
  ["atlas2", "vec4f"],    // its cap (texels), width, height (texels), glyph count
] as const);

export const MAX_MINIMATS = 256;
export const MAX_CHIPS = 4096;

/** One mini mat for the pass: its geometry, its vinyl, its inside's embedding and lattice, the live inside's presence, its chips. */
export interface MiniMatInstance {
  readonly geometry: MiniMatGeometry;
  /** The vinyl (sRGB) — the mat's own sage unless the host says. */
  readonly ground: RGB;
  /** The grain's amplitude on the vinyl (theme.ts `MAT_GRID.grain`). */
  readonly grain: number;
  /** The inside's embedding (host = o + inside · s) and the lattice the face shows on it. */
  readonly inside: { readonly M: PortalAffine; readonly lattice: FaceLattice };
  /** The live inside over the face: absent or −1 = none (the face is the mini mat's own drawing), else its objects' presence 0..1. */
  readonly live?: number | undefined;
  /** The children as the face draws them small (the far LOD), in the host's world. */
  readonly chips?: readonly Chip[] | undefined;
  /** The name printed in the foot of the border (capitals; minimat.ts `nameGlyphs`). */
  readonly name?: string | undefined;
  /** The rung the ruler numbers (minimat.ts `numeralsOf`); absent = none. */
  readonly numerals?: Numerals | null | undefined;
}

export function miniMatValues(m: MiniMatInstance, chipFirst: number, chipCount: number) {
  const G = m.geometry;
  const M = m.inside.M;
  const L = m.inside.lattice;
  const lz = G.lamp[2];
  const lxy = Math.hypot(G.lamp[0], G.lamp[1]);
  return {
    centre: G.centre, half: G.half, slope: G.slope,
    lamp: lxy > 1e-9 ? [G.lamp[0] / lxy, G.lamp[1] / lxy] : [0, 0],
    radius: G.radius, margin: G.margin, lift: G.lift, thick: G.thick,
    alpha: G.alpha, ring: G.ring, live: m.live === undefined || m.live < 0 ? -1 : Math.min(m.live, 1), lampZ: lz,
    chipFirst, chipCount,
    ground: [m.ground[0], m.ground[1], m.ground[2], m.grain],
    inside: [M.s, M.ox, M.oy, 0],
    rungs: [...L.rungs, 0], weights: [...L.weights, 0], widths: [...L.widths, 0],
    numerals: m.numerals ? [m.numerals.spacing, m.numerals.mult, m.numerals.exp, m.numerals.fade] : [0, 0, 0, 0],
    nameLen: m.name ? Math.min([...m.name].length, NAME_CHARS) : 0,
    name: m.name ? packGlyphs(nameGlyphs(m.name)) : new Array<number>(NAME_CHARS / 4).fill(0),
  };
}

export function chipValues(c: Chip) {
  const lines = new Array<number>(4 * CHIP_LINES).fill(0);
  c.lines.slice(0, CHIP_LINES).forEach((l, i) => { lines[4 * i] = l[0]; lines[4 * i + 1] = l[1]; lines[4 * i + 2] = l[2]; });
  return {
    centre: c.centre, half: c.half, rot: [c.cos, c.sin], radius: c.radius, kind: c.kind === "mat" ? 1 : 0,
    colour: [c.colour[0], c.colour[1], c.colour[2], c.height],
    ink: [c.ink[0], c.ink[1], c.ink[2], c.stroke],
    frame: [c.margin, Math.min(c.lines.length, CHIP_LINES), 0, 0],
    lines,
  };
}

/** The knobs from the law, the colours the pass is handed and the glyph atlas it prints with. */
export function miniMatUniformValues(law: MiniMatLaw, colours: { readonly cream: RGB; readonly cast: RGB; readonly select: RGB }, glyphs: GlyphAtlasMeta) {
  const p = law.print;
  const sh = law.shadow;
  return {
    print: [p.frame, p.tick, 0, p.width],
    ticks: [p.ticks[0], p.ticks[1], p.ticks[2], 0],
    edge: [law.edge.width, law.edge.light, law.edge.dark, law.ring],
    shadow: [sh.penumbra.sigma0, sh.penumbra.sigmaPerHeight, sh.penumbra.alpha, sh.contact.alpha],
    shadow2: [sh.contact.sigma, sh.contact.reach, law.chips.greekAlpha, law.chips.minPx],
    cream: [colours.cream[0], colours.cream[1], colours.cream[2], law.chips.greekPx],
    castTint: [colours.cast[0], colours.cast[1], colours.cast[2], 0],
    select: [colours.select[0], colours.select[1], colours.select[2], 0],
    digits: [p.digits.cap, p.digits.gap, p.digits.top, 0],
    text: [p.name.cap, p.name.tracking, p.legible[0], p.legible[1]],
    atlas: [glyphs.cellW, glyphs.cellH, glyphs.advance, glyphs.baseline],
    atlas2: [glyphs.cap, glyphs.width, glyphs.height, glyphs.count],
  };
}
