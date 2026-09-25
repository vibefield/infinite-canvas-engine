// The paper pass — the notes, instanced: one quad per sheet, expanded on the
// vertex side by the shadow's reach and the AA, one `shade_paper` per covered
// fragment in world units, premultiplied output through the presentation's
// opacity and the portal clip (like the frames).

// The slot is lit from elsewhere (MINIMAT.md §4): the pass's second pipeline — a pipeline constant, never a uniform flag.
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: PaperUniforms;
@group(0) @binding(2) var<storage, read> papers: array<Paper>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var ink_tex: texture_2d_array<f32>; // the ink pages: r8 coverage, one layer of rasters per binding
@group(0) @binding(8) var ink_samp: sampler;

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
  out.idx = iid;
  let P = papers[iid];
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * mat_dpr(u));
  // the tilted sheet's bounds, grown by everything the fragment can paint outside it: the shadow's reach and the AA
  let hmax = P.lift + P.curl * (1.0 + P.cornerCurl);
  let pad = length(P.slope) * hmax + 2.5 * (P.shadow.x + P.shadow.z * hmax) + 3.0 * px;
  let ext = vec2f(abs(P.rot.x) * P.half.x + abs(P.rot.y) * P.half.y, abs(P.rot.y) * P.half.x + abs(P.rot.x) * P.half.y) + vec2f(pad);
  let lo = (P.centre - ext - u.cam.xy) * zoom;   // CSS px
  let hi = (P.centre + ext - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let corner = CORNERS[vid];
  let pos = mix(lo, hi, corner * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let P = papers[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let p = in.clip.xy * px + u.cam.xy;   // device px → world
  let c = shade_paper(P, u, k, p, px, px * dpr, in.clip.xy, gobo_tex, gobo_samp, noise_tex, noise_samp, ink_tex, ink_samp, LIT_ELSEWHERE);
  if (c.a < 0.002) { discard; }
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
