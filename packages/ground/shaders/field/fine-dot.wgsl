// PASS 2, dense branch — the FINE rung as one fullscreen triangle, DOT glyph.
// Above ~40 k on-screen fine sites the vertex stage of the instanced draw costs
// more than shading every pixel; the host switches this in instead.

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var atlas_tex: texture_2d<f32>;

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
  let screen = in.clip.xy / dpr(u);
  let spacing = u.rungs.x;
  let world = u.phase.xy + screen / zoom(u);
  let idx = round(world / spacing);
  if (promoted(idx)) { discard; }          // the mid rung owns this site

  let site = site_screen(u, idx * spacing);
  let cell = max(spacing * zoom(u), 1e-6);
  let hl = fit_hl(u, cell);
  let aa = aa_px(u);
  if (length(screen - site) > dot_radius(u, hl * 1.05) + aa * 2.0) { discard; }

  let packed = field_at_site(u, atlas_tex, atlas_index(u, idx, spacing), site);
  if (packed.z < -0.5) { discard; }

  let mag = length(packed.xy);
  let influence = mag / (mag + 1.0);
  let radius = dot_radius(u, mix(hl * 0.16, hl * 1.05, influence));
  let a = cover_dot(screen, site, radius, aa) * portal_cover(screen, u.portals, u.clips, dpr(u)) *
          mix(0.72, 1.0, influence) * rung_alpha(u, 0.0) * u.color.w;
  if (a < 0.004) { discard; }
  return vec4f(u.color.xyz, a);
}
