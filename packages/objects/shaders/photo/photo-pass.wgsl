// The photo pass — one quad per print over the world rect `resolvePhoto`
// measured (the sheet as seen and its shadow), one `shade_photo` per covered
// fragment, premultiplied output through the presentation's opacity and the
// portal clip. The pictures are SHARED (group 1 — K6a, K-L4): a print's record
// names its thumbnail's layer in one array and, while it is large on screen, the
// pool slot of its detail — so a run of prints is ONE instanced draw; the paint
// order is the instance order.

// The slot is lit from elsewhere (MINIMAT.md §4): the pass's second pipeline — a pipeline constant, never a uniform flag.
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: PhotoUniforms;
@group(0) @binding(2) var<storage, read> photos: array<Photo>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var pic_samp: sampler;              // trilinear, clamped
@group(0) @binding(8) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot (persistent records, D6)
@group(1) @binding(0) var thumbs: texture_2d_array<f32>;  // every picture's chain from its first level ≤ THUMB² (rgba8unorm-srgb), a layer each
@group(1) @binding(1) var detail0: texture_2d<f32>;       // the pool: a large print's chain from the finest level it samples
@group(1) @binding(2) var detail1: texture_2d<f32>;
@group(1) @binding(3) var detail2: texture_2d<f32>;
@group(1) @binding(4) var detail3: texture_2d<f32>;
@group(1) @binding(5) var detail4: texture_2d<f32>;
@group(1) @binding(6) var detail5: texture_2d<f32>;
@group(1) @binding(7) var detail6: texture_2d<f32>;
@group(1) @binding(8) var detail7: texture_2d<f32>;

// The thumbnail array's layer side (pictures.ts `THUMB`).
const THUMB = 512.0;

// A picture's texel at (uv, lod) — lod in its WHOLE chain's levels. `tier`: its thumbnail's layer, the chain level that layer
// starts at (k), the pool slot of its detail (−1: none) and the level the detail starts at (j). Both are cuts of one chain: the
// detail at lod − j, else the layer — the picture at its origin, its edge carried to the layer's — at lod − k (a print larger than
// the layer serves, before its detail comes, magnifies the layer's first level).
fn photo_texel(P: Photo, uv: vec2f, lod: f32) -> vec4f {
  let slot = i32(P.tier.z);
  let l = max(lod - P.tier.w, 0.0);
  switch slot {
    case 0: { return textureSampleLevel(detail0, pic_samp, uv, l); }
    case 1: { return textureSampleLevel(detail1, pic_samp, uv, l); }
    case 2: { return textureSampleLevel(detail2, pic_samp, uv, l); }
    case 3: { return textureSampleLevel(detail3, pic_samp, uv, l); }
    case 4: { return textureSampleLevel(detail4, pic_samp, uv, l); }
    case 5: { return textureSampleLevel(detail5, pic_samp, uv, l); }
    case 6: { return textureSampleLevel(detail6, pic_samp, uv, l); }
    case 7: { return textureSampleLevel(detail7, pic_samp, uv, l); }
    default: {}
  }
  let k = P.tier.y;
  let size = max(floor(P.image.xy / exp2(k)), vec2f(1.0));   // the layer's picture at its level 0, texels
  return textureSampleLevel(thumbs, pic_samp, uv * size / THUMB, i32(P.tier.x), max(lod - k, 0.0));
}

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: a culled instance collapses
  let slot = order[iid];
  out.idx = slot;
  let P = photos[slot];
  let zoom = mat_zoom(u);
  let lo = (P.bounds.xy - u.cam.xy) * zoom;   // CSS px
  let hi = (P.bounds.zw - u.cam.xy) * zoom;
  if (P.centre.w <= 0.0 || hi.x < 0.0 || hi.y < 0.0 || lo.x > u.view.x || lo.y > u.view.y) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let P = photos[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let s = in.clip.xy * px + u.cam.xy;   // device px → world
  let c = shade_photo(P, u, k, s, px, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp, LIT_ELSEWHERE);
  if (c.a < 0.002) { discard; }
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
