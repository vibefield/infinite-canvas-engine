// The marks pass — the desk's chrome over every stratum (design-015 §4.2 stratum 5, §7; D4a): one
// instanced draw, one quad per mark over the screen rect the CPU gave it (`quad`, CSS px — the marks do
// not zoom), one `marks_shade` per covered fragment, premultiplied out; a mark of light returns alpha 0,
// so the blend (one, one − src alpha) adds it. The glyphs are the rulers' mono atlas (RULER.md), the
// mat's own texture — the pills' and the rulers' numerals are one face.

@group(0) @binding(0) var<uniform> u: MarksUniforms;
@group(0) @binding(1) var<storage, read> marks: array<Mark>;
@group(0) @binding(2) var glyph_tex: texture_2d<f32>;
@group(0) @binding(3) var glyph_samp: sampler;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.idx = iid;
  let q = marks[iid].quad;
  let pos = mix(q.xy, q.zw, CORNERS[vid]);   // CSS px
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let dpr = max(u.view.z, 1e-6);
  var c = marks_shade(marks[in.idx], in.clip.xy / dpr, dpr, u.atlas, glyph_tex, glyph_samp);
  // the tray's name tags fade out at the drawer's top edge as its specimens do (design-018 §4) — from the first tag's record on
  if (u.fade.y > 0.0 && f32(in.idx) >= u.fade.z) { c *= smoothstep(u.fade.x, u.fade.x + u.fade.y, in.clip.y / dpr); }
  if (c.a <= 0.0 && max(c.r, max(c.g, c.b)) <= 0.0) { discard; }
  return c;
}
