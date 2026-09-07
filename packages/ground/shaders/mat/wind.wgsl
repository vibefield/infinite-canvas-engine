// The wind pass — the reference's `goboWind`: one fragment per plate texel,
// R silhouette + three sines whose amplitudes and phase the plate's other
// channels carry, written to an r8 target the mat pass samples. Runs only when
// the gobo time moved; the target is 512² like the plate.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var plate: texture_2d<f32>;

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
  let params = textureLoad(plate, vec2i(in.clip.xy), 0);
  let time = u.wind.x;
  let strength = u.wind.y;
  let s = params.r;
  let amp1 = params.g * strength;
  let phase1 = (params.b - 0.5) * 6.283185;
  let amp23 = params.a * strength;
  let waves = sin(time * vec3f(1.0, 2.0, 3.0) + phase1 * vec3f(1.0, 2.0, 0.5));
  let motion = (amp1 * waves.x) + (amp23 * 0.5 * waves.y) + (amp23 * 0.3 * waves.z);
  let v = clamp(s + motion, 0.0, 1.0);
  return vec4f(v, 0.0, 0.0, 1.0);
}
