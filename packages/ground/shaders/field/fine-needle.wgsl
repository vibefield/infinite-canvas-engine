// PASS 2, dense branch — the FINE rung as one fullscreen triangle, NEEDLE glyph.
// Same switch-over rule as fine-dot; a separate entry so neither glyph's code
// is ever compiled into the other's pipeline.

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
  if (promoted(idx)) { discard; }

  let site = site_screen(u, idx * spacing);
  let cell = max(spacing * zoom(u), 1e-6);
  let hl = fit_hl(u, cell);
  let hw = fit_hw(u, cell);
  let aa = aa_px(u);
  if (length(screen - site) > needle_len(u, hl) + aa * 2.0) { discard; }

  let packed = field_at_site(u, atlas_tex, atlas_index(u, idx, spacing), site);
  if (packed.z < -0.5) { discard; }

  let mag = length(packed.xy);
  let influence = saturate(mag);
  let dir = needle_dir(u, packed.xy);
  let len = needle_len(u, mix(hl * 0.55, hl, influence));
  let wid = needle_wid(u, mix(hw * 0.85, hw * 1.15, influence));
  let a = cover_needle(screen, site, dir, len, wid, aa) * portal_cover(screen, u.portals, u.clips, dpr(u)) *
          mix(0.35, 1.0, influence) * rung_alpha(u, 0.0) * u.color.w;
  if (a < 0.004) { discard; }
  return vec4f(u.color.xyz, a);
}
