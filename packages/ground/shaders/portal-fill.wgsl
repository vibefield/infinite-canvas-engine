// The portal FILL — the canvas background through the portal, drawn before a
// portal-clipped slot's grid and frames so that slot is OPAQUE inside its
// portal: the two frames of a flight tile the screen (the arriving one on the
// card face, the departed one around it) instead of superimposing their
// grids. One fullscreen triangle, straight alpha = opacity × coverage through
// the chain — the slot's own face grown by `bg.w` device px for a slot drawn
// beneath a HOLE, so the hole's edge partitions with the plate around it and
// nothing under the container ever shows (PORTAL.md §10).

@group(0) @binding(0) var<uniform> u: FillUniforms;

struct VSOut { @builtin(position) clip: vec4f }

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.clip = vec4f(p[vid], 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let dpr = max(u.view.z, 1.0);
  let a = u.view.w * portal_cover_grown(in.clip.xy / dpr, u.portals, u.clips, dpr, u.bg.w);
  if (a < 0.002) { discard; }
  return vec4f(u.bg.xyz, a);
}
