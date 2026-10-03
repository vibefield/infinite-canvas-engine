// THE MISSING FACE (petition I24; desk src/missing/) — what the desk draws where NOTHING can draw an object: its kind refused at
// create or quarantined at three strikes (src/faults.ts), or its type without a kind on this desk. A faint card the size of the
// object's box, square to the mat: a wash of the ink, the ink's hatching at 45° (a pitch and a weight in CSS px, anchored to the
// box's corner, so it reads at every zoom and moves with the object) and a hairline edge inside the box — no text: the kind's name
// is said in the notice, never on the desk. Premultiplied, through the slot's objects' presence (`u.view.w`) and its portal chain,
// as every kind's face. The record (`MissingFace`, src/missing/layout.ts): `rect` — the centre and half extents, world units;
// `ink` — the colour, and the object's fade in w; `mix` — the wash's, the hatching's and the edge's alpha; `shape` — the corner
// (world units), the hatching's pitch and weight and the edge's weight (CSS px).

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<storage, read> faces: array<MissingFace>;
@group(0) @binding(2) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot

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
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: a culled face (or a gone one, fade 0) collapses
  let slot = order[iid];
  out.idx = slot;
  let F = faces[slot];
  if (F.ink.w <= 0.0) { return out; }
  let zoom = max(u.cam.z, 1e-12);
  let dpr = max(u.cam.w, 1.0);
  let pad = 2.0 / (zoom * dpr);   // two device px of the edge's ramp
  let lo = (F.rect.xy - F.rect.zw - vec2f(pad) - u.cam.xy) * zoom;   // CSS px
  let hi = (F.rect.xy + F.rect.zw + vec2f(pad) - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let F = faces[in.idx];
  let zoom = max(u.cam.z, 1e-12);
  let dpr = max(u.cam.w, 1.0);
  let px = 1.0 / (zoom * dpr);                      // one device px, world units
  let p = in.clip.xy * px + u.cam.xy;               // device px → world
  let r = min(F.shape.x, min(F.rect.z, F.rect.w));
  let d = sdf_round_box(p - F.rect.xy, F.rect.zw, r) / px;   // device px; < 0 inside the box
  let inside = clamp(0.5 - d, 0.0, 1.0);
  if (inside <= 0.0) { discard; }
  // the hatching: lines at 45°, `pitch` CSS px apart and `weight` wide, from the box's top-left corner
  let corner = (F.rect.xy - F.rect.zw - u.cam.xy) * zoom * dpr;   // device px
  let s = in.clip.xy - corner;
  let pitch = F.shape.y * dpr;
  let t = (s.x + s.y) * 0.70710678;
  let k = abs(fract(t / pitch + 0.5) - 0.5) * pitch;              // device px to the nearest line
  let hatch = clamp(0.5 * F.shape.z * dpr - k + 0.5, 0.0, 1.0);
  // the edge: a hairline just inside the box
  let ew = F.shape.w * dpr;
  let edge = clamp(0.5 * ew - abs(d + 0.5 * ew) + 0.5, 0.0, 1.0);
  var a = F.mix.x;
  a = a + (1.0 - a) * F.mix.y * hatch;
  a = a + (1.0 - a) * F.mix.z * edge;
  let cov = a * inside * F.ink.w;
  return vec4f(F.ink.xyz * cov, cov) * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
