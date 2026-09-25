// The notebook pass's GPU records, declared once (`defineStruct`: the WGSL text and the packer
// from one list). `NbUniforms` is the pass's knobs and the desk eye; `NbBook` is one book: its
// placement, its lamp and shadow map's frame, its dimensions and pose, its palette. The camera,
// the light and the gobo arrive through the mat's block (`MatUniforms`), filled by the pass as
// the paper and photo passes fill theirs — a notebook is lit like the mat beside it.

import { defineStruct } from "../engine/struct";
import type { RGB, RGBA } from "../theme";
import type { NotebookLaw } from "./law";

export const NbUniforms = defineStruct("NbUniforms", [
  ["eye", "vec4f"],      // the desk eye: foot x, y (world), height (world), zoom
  ["view", "vec4f"],     // viewport w, h (CSS px), the depth range's near and far (distance from the eye)
  ["light", "vec4f"],    // the sky's share, the lambert's cap, the dapple's share on paper, on cloth
  ["shadow", "vec4f"],   // σ at contact, σ per unit of height, the shadow's alpha on the mat, the contact's alpha
  ["shadow2", "vec4f"],  // the contact's σ, the height it lets go by, the shadow map's size (texels), dpr
  ["paper", "vec4f"],    // fibre, mottle, tooth, cockle
  ["rule", "vec4f"],     // pitch, dot radius, margin, unused
  ["cloth", "vec4f"],    // the weave's pitch, its relief, the sheen's exponent and strength
  ["castCol", "vec4f"],  // what a shadow is made of on this ground
  ["select", "vec4f"],   // the ring's colour, its width (CSS px)
  ["ruleInk", "vec4f"],  // the ruling's ink, alpha
  ["ring", "vec4f"],     // the ring's offset from the footprint (CSS px), unused ×3
] as const);

export const NbBook = defineStruct("NbBook", [
  ["model", "mat4x4f"],  // book → world
  ["inv", "mat4x4f"],    // world → book
  ["light", "mat4x4f"],  // world → the shadow map's clip space
  ["lamp", "vec4f"],     // the unit direction to the lamp (world), the shadow map's layer
  ["sh", "vec4f"],       // a shadow texel (world), the map's depth range (world), mapped (0/1), the book's tallest point
  ["size", "vec4f"],     // cover width, height, board, fore-edge radius
  ["page", "vec4f"],     // unused, page height, page corner radius, the spine band's width
  ["open", "vec4f"],     // the swing θ, the gutter's relax, the spine's width, the squares
  ["look", "vec4f"],     // design, ruling, the ring's presence, a seed
  ["foot", "vec4f"],     // the front board lies on the desk (0/1), the cover is paper (0/1), a sheet's thickness, the book shades itself (0/1)
  ["recv", "vec4f"],     // the mat's rect this book darkens: x0, y0, x1, y1 (world)
  ["inkPage", "array<vec4f, 2>"],   // the pages with ink on the device (−1 = none), eight
  ["inkLayer", "array<vec4f, 2>"],  // … and the raster layer each is in
  ["col0", "vec4f"], ["col1", "vec4f"], ["col2", "vec4f"], ["col3", "vec4f"],
  ["col4", "vec4f"], ["col5", "vec4f"], ["col6", "vec4f"], ["col7", "vec4f"],
] as const);

export const MAX_NOTEBOOKS = 32;
/** Books with a shadow map of their own (the rest cast the contact only). */
export const MAX_SHADOWED = 8;
export const SHADOW_RES = 1024;

export type Ruling = "plain" | "dots" | "rules" | "grid";
export const RULINGS: readonly Ruling[] = ["plain", "dots", "rules", "grid"];
const RULING_CODE: Record<Ruling, number> = { plain: 0, dots: 1, rules: 2, grid: 3 };

export type Design = "plain" | "orbit" | "tiles" | "label" | "bordered";
export const DESIGNS: readonly Design[] = ["plain", "orbit", "tiles", "label", "bordered"];
const DESIGN_CODE: Record<Design, number> = { plain: 0, orbit: 1, tiles: 2, label: 3, bordered: 4 };

/**
 * A notebook's LOOK — the host's colours (lab/theme.ts `NOTEBOOK_LOOK`) and its choices: the
 * cloth, the band, three accents the design prints with, the endpaper, the page, the print's
 * ink; the design; whether the cover is paper rather than cloth.
 */
export interface NotebookLook {
  readonly cloth: RGB; readonly band: RGB;
  readonly accents: readonly [RGB, RGB, RGB];
  readonly endpaper: RGB; readonly paper: RGB; readonly ink: RGB;
  readonly design: Design;
  readonly paperCover: boolean;
}

export const rulingCode = (r: Ruling): number => RULING_CODE[r];
export const designCode = (d: Design): number => DESIGN_CODE[d];

/** The pass's knobs by name, from the law and the host's colours. */
export function nbUniformValues(law: NotebookLaw, eye: { eye: number[]; view: number[] }, dpr: number, cast: RGB, select: RGB, ruleInk: RGBA) {
  return {
    eye: eye.eye, view: eye.view,
    light: [law.light.ambient, law.light.cap, law.dapple.page, law.dapple.cover],
    shadow: [law.shadow.sigma0, law.shadow.perUnit, law.shadow.alpha, law.shadow.contact.alpha],
    shadow2: [law.shadow.contact.sigma, law.shadow.contact.reach, SHADOW_RES, dpr],
    paper: [law.paper.fibre, law.paper.mottle, law.paper.tooth, law.paper.cockle],
    rule: [law.paper.pitch, law.paper.dot, law.paper.margin, 0],
    cloth: [law.cloth.pitch, law.cloth.relief, law.cloth.sheen[0], law.cloth.sheen[1]],
    castCol: [...cast, 1],
    select: [...select, law.ring.width],
    ruleInk: [...ruleInk],
    ring: [law.ring.offset, 0, 0, 0],
  };
}
