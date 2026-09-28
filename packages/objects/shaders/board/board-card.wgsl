// The whiteboard as the board pass AND the flat-card pipeline draw it (K7b, design-016 §6 K7): the corner's clip position and
// the THUMBNAIL's ink, over the board's bindings by their own names — `boards`, `board_k`, `board_thumbs` … — beside the slot's
// `u`, `gobo_tex`, `noise_tex`, which whichever entry composes them declares. (Its fragment is the pass entry's `fs`, written
// out — the card splices the same statements, shaders.ts `BOARD_FRAGMENT`.) `shade_board` reads its ink
// through `board_ink` and the live board's layers through `board_stroke` / `board_wet`: the pass's entry reads the pool and
// the live layers there, else the thumbnail; the card binds neither and reads the thumbnail alone (a board with a raster, or
// being written on, is the pass's to draw).

// The thumbnails' layer side (board-pass.ts `BOARD_THUMB`).
const BOARD_THUMB = 512.0;

const BD_CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

// A board's ink at (uv, lod) from its THUMBNAIL — lod in its raster's chain: the layer (`tier.x`), which starts at the level k of
// its source's chain (`tier.y`) — the chain's tail at the layer's origin, its edge carried to the layer's — at lod − k.
fn board_thumb(B: Board, uv: vec2f, lod: f32) -> vec4f {
  let k = B.tier.y;
  let size = max(floor(B.texels / exp2(k)), vec2f(1.0));
  return textureSampleLevel(board_thumbs, board_ink_samp, uv * size / BOARD_THUMB, i32(B.tier.x), max(lod - k, 0.0));
}

fn board_quad(slot: u32, vid: u32) -> vec4f {
  let B = boards[slot];
  let zoom = max(u.cam.z, 1.0e-12);
  let lo = (B.quad.xy - u.cam.xy) * zoom;   // CSS px
  let hi = (B.quad.zw - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return vec4f(2.0, 2.0, 2.0, 1.0); }   // degenerate: a culled board collapses
  let corner = BD_CORNERS[vid];
  let pos = mix(lo, hi, corner * 0.5 + 0.5);
  return vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
}
