// The board pass — the whiteboards: one quad per board (its extent the record's own: the slab,
// its shadow, the tool in the hand — resolved on the CPU), one `shade_board` per covered
// fragment, premultiplied output over the mat. Group 0 is the slot's (the mat's block, the
// knobs, the records, the gobo, the noise, the samplers); group 1 is the SAME for every board
// (K6a, K-L4 — a run of boards is one instanced draw): the far-LOD thumbnails' array, the pool's
// rasters' ink (with mips), the live board's stroke and wet layers; a board's record says where
// its ink is (`tier`). The camera, the box and the portal chain come through the mat's block, as
// for the note and the notebook. The quad, the fragment and the thumbnail's ink are
// board-card.wgsl's — the flat-card pipeline draws a board with the same three (K7b).

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> board_k: BoardUniforms;
@group(0) @binding(2) var<storage, read> boards: array<Board>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var board_gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var board_noise_samp: sampler;
@group(0) @binding(7) var board_ink_samp: sampler;         // trilinear — the ink seen small reads its mips
@group(0) @binding(8) var board_lin_samp: sampler;         // bilinear, level 0 — the stroke and the wet layer
@group(0) @binding(9) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot (persistent records, D6)
@group(1) @binding(0) var board_thumbs: texture_2d_array<f32>;   // every board's ink chain from its first level ≤ BOARD_THUMB², a layer each
@group(1) @binding(1) var ink0: texture_2d<f32>;           // the pool: a board's raster — premultiplied linear ink, coverage in alpha
@group(1) @binding(2) var ink1: texture_2d<f32>;
@group(1) @binding(3) var ink2: texture_2d<f32>;
@group(1) @binding(4) var ink3: texture_2d<f32>;
@group(1) @binding(5) var ink4: texture_2d<f32>;
@group(1) @binding(6) var ink5: texture_2d<f32>;
@group(1) @binding(7) var ink6: texture_2d<f32>;
@group(1) @binding(8) var ink7: texture_2d<f32>;
@group(1) @binding(9) var stroke_live: texture_2d<f32>;    // the live board's stroke being laid (r8)
@group(1) @binding(10) var wet_live: texture_2d<f32>;      // …and how wet its ink still is (r8)

// A board's ink at (uv, lod) — lod in its raster's chain. `tier`: its thumbnail's layer, the level of its source's chain the
// layer starts at (k), its pool slot (−1: none), live. The slot's raster, else the layer (board-card.wgsl `board_thumb`).
fn board_ink(B: Board, uv: vec2f, lod: f32) -> vec4f {
  switch i32(B.tier.z) {
    case 0: { return textureSampleLevel(ink0, board_ink_samp, uv, lod); }
    case 1: { return textureSampleLevel(ink1, board_ink_samp, uv, lod); }
    case 2: { return textureSampleLevel(ink2, board_ink_samp, uv, lod); }
    case 3: { return textureSampleLevel(ink3, board_ink_samp, uv, lod); }
    case 4: { return textureSampleLevel(ink4, board_ink_samp, uv, lod); }
    case 5: { return textureSampleLevel(ink5, board_ink_samp, uv, lod); }
    case 6: { return textureSampleLevel(ink6, board_ink_samp, uv, lod); }
    case 7: { return textureSampleLevel(ink7, board_ink_samp, uv, lod); }
    default: {}
  }
  return board_thumb(B, uv, lod);
}

// The live board's stroke being laid, and how wet its ink is — 0 on any other board (their layers are not bound).
fn board_stroke(B: Board, uv: vec2f) -> f32 {
  if (B.tier.w < 0.5) { return 0.0; }
  return textureSampleLevel(stroke_live, board_lin_samp, uv, 0.0).r;
}
fn board_wet(B: Board, uv: vec2f) -> f32 {
  if (B.tier.w < 0.5) { return 0.0; }
  return textureSampleLevel(wet_live, board_lin_samp, uv, 0.0).r;
}

struct BoardOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> BoardOut {
  var out: BoardOut;
  out.idx = order[iid];
  out.clip = board_quad(out.idx, vid);
  return out;
}

// The fragment, written out: shade_board reached through one more function compiles to one LSB off on a pixel or two a scene
// (K7b, measured) — so the flat-card pipeline splices THESE statements (shaders.ts `BOARD_FRAGMENT`, a test holds them equal).
@fragment
fn fs(in: BoardOut) -> @location(0) vec4f {
  let B = boards[in.idx];
  let zoom = max(u.cam.z, 1.0e-12);
  let dpr = max(u.cam.w, 1.0e-6);
  let px = 1.0 / (zoom * dpr);           // world per device px
  let css = 1.0 / zoom;                  // world per CSS px
  let p = in.clip.xy * px + u.cam.xy;    // device px → world
  let c = shade_board(B, u, board_k, p, px, css, in.clip.xy, gobo_tex, board_gobo_samp, noise_tex, board_noise_samp);
  if (c.a < 0.002) { discard; }
  // Premultiplied: the presentation's opacity through the portal clip scales every channel.
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
