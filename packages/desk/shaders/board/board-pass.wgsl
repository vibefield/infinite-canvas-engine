// The board pass — the whiteboards: one quad per board (its extent the record's own: the slab,
// its shadow, the tool in the hand — resolved on the CPU), one `shade_board` per covered
// fragment, premultiplied output over the mat. Group 0 is the slot's (the mat's block, the
// knobs, the records, the gobo, the noise, the samplers); group 1 is the board's own raster —
// its ink (with mips), the stroke being laid, the wet layer. The camera, the box and the
// portal chain come through the mat's block, as for the note and the notebook.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: BoardUniforms;
@group(0) @binding(2) var<storage, read> boards: array<Board>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var ink_samp: sampler;               // trilinear — the ink seen small reads its mips
@group(0) @binding(8) var lin_samp: sampler;               // bilinear, level 0 — the stroke and the wet layer
@group(1) @binding(0) var ink_tex: texture_2d<f32>;        // premultiplied linear ink, coverage in alpha
@group(1) @binding(1) var stroke_tex: texture_2d<f32>;     // the stroke being laid (r8)
@group(1) @binding(2) var wet_tex: texture_2d<f32>;        // how wet the ink still is (r8)

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
  out.idx = iid;
  let B = boards[iid];
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
  let c = shade_board(B, u, k, p, px, css, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp, ink_tex, ink_samp, stroke_tex, wet_tex, lin_samp);
  if (c.a < 0.002) { discard; }
  // Premultiplied: the presentation's opacity through the portal clip scales every channel.
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
