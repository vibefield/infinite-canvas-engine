// The photo pass's GPU records, declared once. `Photo` is one print as drawn
// — `resolvePhoto`'s pose in 3D (its centre, its axes, its normal, the local
// eye), its bend, the quad's world rect and its picture's texel facts.
// `PhotoUniforms` is the pass's knobs: the cast colour, the paper, the two
// shadow terms and the gloss; the lamp's direction and slope are per print. The camera, the gobo and the
// Moon arrive through the mat's block (`MatUniforms`), which the pass fills for
// itself, as the paper pass does.

import { defineStruct } from "../engine/struct";
import { CAST, PHOTO, type PhotoGeometry, type PhotoLaw } from "./photo";

export const Photo = defineStruct("Photo", [
  ["centre", "vec4f"],  // xyz (world, z = height), presence
  ["ex", "vec4f"],      // the sheet's x axis (unit, 3D), half width
  ["ey", "vec4f"],      // the sheet's y axis (unit, 3D), half height
  ["n", "vec4f"],       // the normal, the corner radius
  ["eye", "vec4f"],     // the local eye (world), the border's width (world)
  ["bend", "vec4f"],    // the droop, the rest curl, the grab point u, v (the sheet's frame)
  ["bounds", "vec4f"],  // the quad: x0 y0 x1 y1 (world)
  ["image", "vec4f"],   // the picture: texels wide, high, mip levels, on (0/1)
  ["light", "vec4f"],   // toward the lamp from the print (unit; x right, y down, z up), the penumbra's alpha
  ["slope", "vec4f"],   // the shadow's offset on the mat per unit of height xy, unused ×2
] as const);

export const PhotoUniforms = defineStruct("PhotoUniforms", [
  ["shade", "vec4f"],     // the shadow's colour (sRGB), unused
  ["paper", "vec4f"],     // the print's paper (sRGB), its fibre ±
  ["penumbra", "vec4f"],  // unused (the alpha is the print's), σ at contact, σ per unit of height, unused
  ["contact", "vec4f"],   // alpha, σ, the height it is gone by, unused
  ["gloss", "vec4f"],     // the lamp's highlight, its shininess, the room's sheen, unused
  ["night", "vec4f"],     // by night: the level (moonlit / day luminance), the picture's foveal keep (1 = its hue exactly), unused ×2
] as const);

export const MAX_PHOTOS = 256;

export interface PhotoPicture { readonly width: number; readonly height: number; readonly mips: number }

export function photoValues(G: PhotoGeometry, border: number, pic: PhotoPicture | null) {
  return {
    centre: [G.centre[0], G.centre[1], G.centre[2], G.alpha],
    ex: [G.ex[0], G.ex[1], G.ex[2], G.half[0]],
    ey: [G.ey[0], G.ey[1], G.ey[2], G.half[1]],
    n: [G.n[0], G.n[1], G.n[2], G.radius],
    eye: [G.eye[0], G.eye[1], G.eye[2], border],
    bend: [G.droop, G.curl, G.grab[0], G.grab[1]],
    bounds: [G.bounds.x0, G.bounds.y0, G.bounds.x1, G.bounds.y1],
    image: pic ? [pic.width, pic.height, pic.mips, 1] : [1, 1, 1, 0],
    light: [G.light[0], G.light[1], G.light[2], G.shadowAlpha],
    slope: [G.slope[0], G.slope[1], 0, 0],
  };
}

export function photoUniformValues(law: PhotoLaw = PHOTO) {
  const sh = law.shadow;
  return {
    shade: [CAST[0], CAST[1], CAST[2], 0],
    paper: [law.paper[0], law.paper[1], law.paper[2], law.grain],
    penumbra: [0, sh.penumbra.sigma0, sh.penumbra.sigmaPerHeight, 0],
    contact: [sh.contact.alpha, sh.contact.sigma, sh.contact.reach, 0],
    gloss: [law.gloss.spec, law.gloss.shininess, law.gloss.sheen, 0],
    night: [law.night.level, law.night.keep, 0, 0],
  };
}

/** The border's width in world units for a print of half extents `hx × hy`. */
export const borderOf = (hx: number, hy: number, law: PhotoLaw = PHOTO): number => law.border * 2 * Math.min(hx, hy);
