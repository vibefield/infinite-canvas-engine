// The 3D KIT's records (design-016 §5; the notebook's, moved here at K4a): what kit/book.wgsl — the desk eye's
// projection, the shadow (PCSS on a book's own shadow map, the penumbra growing with the gap by the desk's law), the
// materials (bookcloth and its weave, the printed cover, the ivory page and its ruling, the board, the edge) — is written
// against, declared once (`defineStruct`: the WGSL text and the packer from one list). `NbUniforms` is a 3D pass's knobs
// and the desk eye; `NbBook` is one book-shaped object: its placement, its lamp and shadow map's frame, its dimensions
// and pose, its palette. The notebook draws books with them, and the desk calendar's pad is the notebook's paper and cloth
// under the same colour chain, so its program composes them too (`kitWgsl([..., "book"])`). The camera, the light and the
// gobo arrive through the slot's view block (`MatUniforms`) — a book is lit like the mat beside it.

import { defineStruct } from "../engine/struct";

/**
 * A 3D pass's KNOBS and the DESK EYE — the `book` piece's first record (`kitWgsl([..., "book"])`; bound as `k` beside the slot's
 * `u`). World units throughout (one is one CSS px at zoom 1; x right, y DOWN on the desk, z UP off it); colours sRGB 0..1. Every
 * field is a vec4f, so nothing is padded (petition I31). The fields, x · y · z · w:
 *
 * - `eye` — the desk eye (kit/eye.ts `eyeValues`): its foot, the view's centre (x, y — world units), its height (z — world
 *   units), the zoom (w — CSS px per world unit): `nb_clip`;
 * - `view` — the viewport (x, y — CSS px), the depth range's near and far (z, w — world units from the eye);
 * - `light` — the sky's share where the lamp is blocked (x — 0..1), the lambert's cap (y — a flat face lit straight on reads 1),
 *   the dapple's share on paper (z) and on cloth (w — 0..1);
 * - `shadow` — the penumbra law: σ at contact (x — world units) and σ per world unit of height (y), the shadow's alpha on the
 *   mat (z) and the contact's (w — 0..1): `nb_shadow`;
 * - `shadow2` — the contact's σ (x — world units), the height it lets go by (y — world units), the shadow map's size (z —
 *   texels), the dpr (w);
 * - `paper` — the paper's fibre, mottle, tooth and cockle (x, y, z, w — strengths, 0 = none): `nb_paper`;
 * - `rule` — the ruling's pitch, a dot's radius and the margin (x, y, z — world units); w unused: `nb_ruling`;
 * - `cloth` — the weave's pitch (x — world units) and relief (y), the sheen's exponent (z) and strength (w);
 * - `castCol` — what a shadow is made of on this ground (rgb — sRGB); a 1;
 * - `select` — the selection ring's colour (rgb — sRGB) and width (w — CSS px);
 * - `ruleInk` — the ruling's ink (rgb — sRGB) and alpha (a — 0..1);
 * - `ring` — the ring's offset from the footprint (x — CSS px), the pass's debug flags (y — & 1 no self-shadow, & 2 flat
 *   albedo, & 4 no dapple), the layer box's origin on the attachment (z, w — device px: a fragment's attachment pixel is its
 *   own plus these).
 */
export const NbUniforms = defineStruct("NbUniforms", [
  ["eye", "vec4f"],
  ["view", "vec4f"],
  ["light", "vec4f"],
  ["shadow", "vec4f"],
  ["shadow2", "vec4f"],
  ["paper", "vec4f"],
  ["rule", "vec4f"],
  ["cloth", "vec4f"],
  ["castCol", "vec4f"],
  ["select", "vec4f"],
  ["ruleInk", "vec4f"],
  ["ring", "vec4f"],
] as const);

/**
 * ONE book-shaped object — the `book` piece's second record (a storage array of them, one per object). World units throughout
 * (x, y on the desk with y DOWN, z UP off it); colours sRGB 0..1. Every field is a vec4f, a mat4x4f or a vec4f array, so nothing
 * is padded (petition I31). The fields:
 *
 * - `model` — book → world: the book's placement (column-major);
 * - `inv` — world → book (`model`'s inverse);
 * - `light` — world → its shadow map's clip space (the lamp's view-projection): `nb_shadow`;
 * - `lamp` — the unit direction to the lamp (xyz — world) and the book's layer in the shadow maps (w);
 * - `sh` — a shadow-map texel (x — world units), the map's depth range (y — world units), mapped (z — 0/1), the book's tallest
 *   point (w — world units);
 * - `size` — the cover's width and height (x, y), the board's thickness (z), the fore-edge corners' radius (w) — world units;
 * - `page` — unused (x), the page's height (y), its corner radius (z), the spine band's width (w) — world units;
 * - `open` — the cover's swing θ (x — radians, 0 shut … π open), the gutter's relax (y — 0..1), the spine's width (z — world
 *   units), the squares — the boards' overhang past the pages (w — world units);
 * - `look` — the design (x — `nb_design`'s 0 … 4), the ruling (y — `nb_ruling`'s 0 none, 1 dots, 2 lines, else a grid), the
 *   selection ring's presence (z — 0..1), a seed (w);
 * - `foot` — the front board lies on the desk (x — 0/1), the cover is paper (y — 0/1), a sheet's thickness (z — world units),
 *   the book shades itself (w — 0/1);
 * - `recv` — the mat's rect this book darkens: x0, y0, x1, y1 (world units);
 * - `inkPage` — the pages with ink on the device, eight (−1 = none);
 * - `inkLayer` — the raster layer each of those is in;
 * - `col0` the cloth · `col1` the band · `col2`, `col3`, `col4` the accents · `col5` the endpaper · `col6` the paper · `col7` the
 *   ink (rgb — sRGB; a 1).
 */
export const NbBook = defineStruct("NbBook", [
  ["model", "mat4x4f"],
  ["inv", "mat4x4f"],
  ["light", "mat4x4f"],
  ["lamp", "vec4f"],
  ["sh", "vec4f"],
  ["size", "vec4f"],
  ["page", "vec4f"],
  ["open", "vec4f"],
  ["look", "vec4f"],
  ["foot", "vec4f"],
  ["recv", "vec4f"],
  ["inkPage", "array<vec4f, 2>"],
  ["inkLayer", "array<vec4f, 2>"],
  ["col0", "vec4f"], ["col1", "vec4f"], ["col2", "vec4f"], ["col3", "vec4f"],
  ["col4", "vec4f"], ["col5", "vec4f"], ["col6", "vec4f"], ["col7", "vec4f"],
] as const);
