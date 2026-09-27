// The board pass — the whiteboards: one quad per board (its extent the record's own: the slab,
// its shadow, the tool in the hand — resolved on the CPU), one `shade_board` per covered
// fragment, premultiplied output over the mat. Group 0 is the slot's (the mat's block, the
// knobs, the records, the gobo, the noise, the samplers); group 1 is the SAME for every board
// (K6a, K-L4 — a run of boards is one instanced draw): the far-LOD thumbnails' array, the pool's
// rasters' ink (with mips), the live board's stroke and wet layers; a board's record says where
// its ink is (`tier`). The camera, the box and the portal chain come through the mat's block, as
// for the note and the notebook.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: BoardUniforms;
@group(0) @binding(2) var<storage, read> boards: array<Board>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var ink_samp: sampler;               // trilinear — the ink seen small reads its mips
@group(0) @binding(8) var lin_samp: sampler;               // bilinear, level 0 — the stroke and the wet layer
@group(0) @binding(9) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot (persistent records, D6)
@group(1) @binding(0) var thumbs: texture_2d_array<f32>;   // every board's ink chain from its first level ≤ BOARD_THUMB², a layer each
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

// The thumbnails' layer side (board-pass.ts `BOARD_THUMB`).
const BOARD_THUMB = 512.0;

// A board's ink at (uv, lod) — lod in its raster's chain. `tier`: its thumbnail's layer, the level of its source's chain the
// layer starts at (k), its pool slot (−1: none), live. The slot's raster, else the layer at lod − k (the chain's tail at the
// layer's origin, its edge carried to the layer's).
fn board_ink(B: Board, uv: vec2f, lod: f32) -> vec4f {
  switch i32(B.tier.z) {
    case 0: { return textureSampleLevel(ink0, ink_samp, uv, lod); }
    case 1: { return textureSampleLevel(ink1, ink_samp, uv, lod); }
    case 2: { return textureSampleLevel(ink2, ink_samp, uv, lod); }
    case 3: { return textureSampleLevel(ink3, ink_samp, uv, lod); }
    case 4: { return textureSampleLevel(ink4, ink_samp, uv, lod); }
    case 5: { return textureSampleLevel(ink5, ink_samp, uv, lod); }
    case 6: { return textureSampleLevel(ink6, ink_samp, uv, lod); }
    case 7: { return textureSampleLevel(ink7, ink_samp, uv, lod); }
    default: {}
  }
  let k = B.tier.y;
  let size = max(floor(B.texels / exp2(k)), vec2f(1.0));
  return textureSampleLevel(thumbs, ink_samp, uv * size / BOARD_THUMB, i32(B.tier.x), max(lod - k, 0.0));
}

// The live board's stroke being laid, and how wet its ink is — 0 on any other board (their layers are not bound).
fn board_stroke(B: Board, uv: vec2f) -> f32 {
  if (B.tier.w < 0.5) { return 0.0; }
  return textureSampleLevel(stroke_live, lin_samp, uv, 0.0).r;
}
fn board_wet(B: Board, uv: vec2f) -> f32 {
  if (B.tier.w < 0.5) { return 0.0; }
  return textureSampleLevel(wet_live, lin_samp, uv, 0.0).r;
}

struct BoardOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const BD_CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> BoardOut {
  var out: BoardOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: a culled board collapses
  let slot = order[iid];
  out.idx = slot;
  let B = boards[slot];
  let zoom = max(u.cam.z, 1.0e-12);
  let lo = (B.quad.xy - u.cam.xy) * zoom;   // CSS px
  let hi = (B.quad.zw - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let corner = BD_CORNERS[vid];
  let pos = mix(lo, hi, corner * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: BoardOut) -> @location(0) vec4f {
  let B = boards[in.idx];
  let zoom = max(u.cam.z, 1.0e-12);
  let dpr = max(u.cam.w, 1.0);
  let px = 1.0 / (zoom * dpr);           // world per device px
  let css = 1.0 / zoom;                  // world per CSS px
  let p = in.clip.xy * px + u.cam.xy;    // device px → world
  let c = shade_board(B, u, k, p, px, css, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp);
  if (c.a < 0.002) { discard; }
  // Premultiplied: the presentation's opacity through the portal clip scales every channel.
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
