// The notebook pass's GPU records, declared once (`defineStruct`: the WGSL text and the packer
// from one list). `NbUniforms` is the pass's knobs and the desk eye; `NbBook` is one book: its
// placement, its lamp and shadow map's frame, its dimensions and pose, its palette. The camera,
// the light and the gobo arrive through the mat's block (`MatUniforms`), filled by the pass as
// the paper and photo passes fill theirs — a notebook is lit like the mat beside it.

import type { RGB, RGBA } from "../theme";
import type { NotebookLaw } from "./law";

// the book's records are the kit's (K4a: the 3D kit's WGSL is written against them, and the desk calendar composes it too)
export { NbBook, NbUniforms } from "../kit/book";

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
