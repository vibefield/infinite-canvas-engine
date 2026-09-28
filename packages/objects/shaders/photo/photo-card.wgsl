// The print as the photo pass AND the flat-card pipeline draw it (K7b, design-016 §6 K7): the corner's clip position, the
// fragment and the THUMBNAIL's texel, over the print's bindings by their own names — `photos`, `photo_k`, `photo_thumbs` … —
// beside the slot's `u`, `gobo_tex`, `noise_tex` and the pipeline's `LIT_ELSEWHERE`, which whichever entry composes them
// declares. `shade_photo` reads a picture through `photo_texel`: the pass's entry reads the detail pool there, else the
// thumbnail; the card binds no pool and reads the thumbnail alone (a print with a detail bound is the pass's to draw).

// The thumbnail array's layer side (pictures.ts `THUMB`).
const PHOTO_THUMB = 512.0;

const PHOTO_CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

// A picture's texel at (uv, lod) from its THUMBNAIL — lod in its whole chain's levels: the layer (its `tier.x`), which starts at
// the chain's level k (`tier.y`) — the picture at its origin, its edge carried to the layer's — at lod − k (a print larger than
// the layer serves, before its detail comes, magnifies the layer's first level).
fn photo_thumb(P: Photo, uv: vec2f, lod: f32) -> vec4f {
  let k = P.tier.y;
  let size = max(floor(P.image.xy / exp2(k)), vec2f(1.0));   // the layer's picture at its level 0, texels
  return textureSampleLevel(photo_thumbs, photo_pic_samp, uv * size / PHOTO_THUMB, i32(P.tier.x), max(lod - k, 0.0));
}

fn photo_quad(slot: u32, vid: u32) -> vec4f {
  let P = photos[slot];
  let zoom = mat_zoom(u);
  let lo = (P.bounds.xy - u.cam.xy) * zoom;   // CSS px
  let hi = (P.bounds.zw - u.cam.xy) * zoom;
  if (P.centre.w <= 0.0 || hi.x < 0.0 || hi.y < 0.0 || lo.x > u.view.x || lo.y > u.view.y) { return vec4f(2.0, 2.0, 2.0, 1.0); }   // degenerate: a culled instance collapses
  let pos = mix(lo, hi, PHOTO_CORNERS[vid] * 0.5 + 0.5);
  return vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
}

fn photo_frag(slot: u32, clip: vec4f) -> vec4f {
  let P = photos[slot];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let s = clip.xy * px + u.cam.xy;   // device px → world
  let c = shade_photo(P, u, photo_k, s, px, clip.xy, gobo_tex, photo_gobo_samp, noise_tex, photo_noise_samp, LIT_ELSEWHERE);
  if (c.a < 0.002) { return vec4f(-1.0); }
  return c * (u.view.w * portal_cover(clip.xy / dpr, u.portals, u.clips, dpr));
}
