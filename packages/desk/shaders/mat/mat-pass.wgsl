// PASS 2, the cutting mat — one fullscreen triangle: the lattice's lines as
// analytic coverage, the grain, the gobo projected onto the desk plane, the
// reference's grade by day or the night's eye by night (MAT.md). Alpha 1 at
// rest (a plain write); a flight fades it and clips it to the portal.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var gobo_tex: texture_2d<f32>;
@group(0) @binding(2) var gobo_samp: sampler;
@group(0) @binding(3) var noise_tex: texture_2d<f32>;
@group(0) @binding(4) var noise_samp: sampler;
@group(0) @binding(5) var glyph_tex: texture_2d<f32>;   // the rulers' glyph atlas (RULER.md); a 1×1 empty cell until a host uploads one

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
  let zoom = mat_zoom(u);
  let dpr = mat_dpr(u);
  let frag = in.clip.xy;                       // device px
  let screen = frag / dpr;                     // CSS px
  let px = 1.0 / (zoom * dpr);                 // world per device px
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  // the rulers' print — screen-space ink mixed into the albedo before the light, so it is lit and shadowed like the lines
  let ruler = ruler_ink(u, screen, frag, glyph_tex, gobo_samp);
  let albedo = mat_albedo(u, u.phase.xy + screen / zoom, px, frag, bn, ruler);
  // the lamp's gobo where the LIGHT sees this pixel (MINIMAT.md §4): the slot's own camera at rest
  // (`light` = `cam`, so this is the desk under the pixel), the host desk's through a mini mat's face
  var gobo = sample_gobo(u, gobo_tex, gobo_samp, desk_of(u, u.light.xy + screen / max(u.light.z, 1e-12)), bn.z);
  if (u.light.w > 0.0) { gobo = mix(gobo, sample_gobo(u, gobo_tex, gobo_samp, desk_of(u, u.light2.xy + screen / max(u.light2.z, 1e-12)), bn.z), u.light.w); }
  // Straight alpha: the presentation's opacity through the portal clip — both 1 at rest,
  // when "source over" reduces to a plain write.
  return vec4f(mat_colour(u, albedo, gobo, bn.y), u.view.w * portal_cover(screen, u.portals, u.clips, dpr));
}
