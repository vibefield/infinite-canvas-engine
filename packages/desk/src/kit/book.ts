// The 3D KIT's records (design-016 §5; the notebook's, moved here at K4a): what kit/book.wgsl — the desk eye's
// projection, the shadow (PCSS on a book's own shadow map, the penumbra growing with the gap by the desk's law), the
// materials (bookcloth and its weave, the printed cover, the ivory page and its ruling, the board, the edge) — is written
// against, declared once (`defineStruct`: the WGSL text and the packer from one list). `NbUniforms` is a 3D pass's knobs
// and the desk eye; `NbBook` is one book-shaped object: its placement, its lamp and shadow map's frame, its dimensions
// and pose, its palette. The notebook draws books with them, and the desk calendar's pad is the notebook's paper and cloth
// under the same colour chain, so its program composes them too (`kitWgsl([..., "book"])`). The camera, the light and the
// gobo arrive through the slot's view block (`MatUniforms`) — a book is lit like the mat beside it.

import { defineStruct } from "../engine/struct";

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
