// The photo pass — one quad per print over the world rect `resolvePhoto`
// measured (the sheet as seen and its shadow), one `shade_photo` per covered
// fragment, premultiplied output through the presentation's opacity and the
// portal clip. The pictures are SHARED (group 1 — K6a, K-L4): a print's record
// names its thumbnail's layer in one array and, while it is large on screen, the
// pool slot of its detail — so a run of prints is ONE instanced draw; the paint
// order is the instance order. The quad, the fragment and the thumbnail's texel are
// photo-card.wgsl's — the flat-card pipeline draws a print with the same three (K7b).

// The slot is lit from elsewhere (MINIMAT.md §4): the pass's second pipeline — a pipeline constant, never a uniform flag.
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> photo_k: PhotoUniforms;
@group(0) @binding(2) var<storage, read> photos: array<Photo>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var photo_gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var photo_noise_samp: sampler;
@group(0) @binding(7) var photo_pic_samp: sampler;        // trilinear, clamped
@group(0) @binding(8) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot (persistent records, D6)
@group(1) @binding(0) var photo_thumbs: texture_2d_array<f32>;  // every picture's chain from its first level ≤ THUMB² (rgba8unorm-srgb), a layer each
@group(1) @binding(1) var detail0: texture_2d<f32>;       // the pool: a large print's chain from the finest level it samples
@group(1) @binding(2) var detail1: texture_2d<f32>;
@group(1) @binding(3) var detail2: texture_2d<f32>;
@group(1) @binding(4) var detail3: texture_2d<f32>;
@group(1) @binding(5) var detail4: texture_2d<f32>;
@group(1) @binding(6) var detail5: texture_2d<f32>;
@group(1) @binding(7) var detail6: texture_2d<f32>;
@group(1) @binding(8) var detail7: texture_2d<f32>;

// A picture's texel at (uv, lod) — lod in its WHOLE chain's levels. `tier`: its thumbnail's layer, the chain level that layer
// starts at (k), the pool slot of its detail (−1: none) and the level the detail starts at (j). Both are cuts of one chain: the
// detail at lod − j, else the layer (photo-card.wgsl `photo_thumb`).
fn photo_texel(P: Photo, uv: vec2f, lod: f32) -> vec4f {
  let slot = i32(P.tier.z);
  let l = max(lod - P.tier.w, 0.0);
  switch slot {
    case 0: { return textureSampleLevel(detail0, photo_pic_samp, uv, l); }
    case 1: { return textureSampleLevel(detail1, photo_pic_samp, uv, l); }
    case 2: { return textureSampleLevel(detail2, photo_pic_samp, uv, l); }
    case 3: { return textureSampleLevel(detail3, photo_pic_samp, uv, l); }
    case 4: { return textureSampleLevel(detail4, photo_pic_samp, uv, l); }
    case 5: { return textureSampleLevel(detail5, photo_pic_samp, uv, l); }
    case 6: { return textureSampleLevel(detail6, photo_pic_samp, uv, l); }
    case 7: { return textureSampleLevel(detail7, photo_pic_samp, uv, l); }
    default: {}
  }
  return photo_thumb(P, uv, lod);
}

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.idx = order[iid];
  out.clip = photo_quad(out.idx, vid);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let c = photo_frag(in.idx, in.clip);
  if (c.a < 0.0) { discard; }
  return c;
}
