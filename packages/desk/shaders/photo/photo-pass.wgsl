// The photo pass — one quad per print over the world rect `resolvePhoto`
// measured (the sheet as seen and its shadow), one `shade_photo` per covered
// fragment, premultiplied output through the presentation's opacity and the
// portal clip. The picture is the print's own texture (group 1), so a print
// is one draw; the paint order is the draw order.

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
@group(1) @binding(0) var pic_tex: texture_2d<f32>;       // the print's picture (rgba8unorm-srgb, mipmapped)

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
  let c = shade_photo(P, u, k, s, px, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp, pic_tex, pic_samp, LIT_ELSEWHERE);
  if (c.a < 0.002) { discard; }
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
