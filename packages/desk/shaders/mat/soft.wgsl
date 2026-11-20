// THE SOFT LIGHT'S TEXT (petition I56; src/mat/soft.ts states its numbers, src/shaders.ts composes it) — the mat's light
// with a second gobo model and two more numbers for the night. It is NOT a module of its own: it is laid AFTER mat.wgsl
// in ONE text, in which mat.wgsl's four definitions `project_gobo`, `shade_mat`, `night_mat` and `mat_colour` have been
// renamed `cone_…` (`softLightWgsl`), so the four names every caller uses are the definitions below. Each of them is the
// cone's own function wherever the new numbers ask for nothing.
//
// WHY A SECOND TEXT, and not four branches in mat.wgsl: the day's and the night's chains are float arithmetic the device's
// compiler reorders by what stands around it. A branch added to `project_gobo` or `mat_colour` moved a last digit in shaded
// pixels of frames that never took the branch (measured under Dawn on Metal, 2026-11-19: 1 of 255 in a few bytes of six
// frames in nine). A host that does not ask for this text compiles mat.wgsl as it always was, token for token.
//
// SOFT LIGHT: the cone throws the plate from a point, in perspective, and blurs it by depth. Soft light lays the plate FLAT
// over the lamp's frame, as a plant between a window and a wall is seen, in two layers. A layer is read through a disc the
// Sun's size: a gap smaller than the disc prints round, and an edge ramps as a penumbra does. Twelve taps on a Vogel
// spiral, turned per pixel by the blue noise; each reads the mip its share of the disc covers, so the twelve tile the disc
// and their sum is smooth (the mat draws the silhouette's chain under this model — mat-pass.ts). The disc grows across the
// plate (0.7× … 1.4×), so one layer holds more than one depth.

/// One layer of soft light at a point of the lamp's frame.
/// `u` — the slot's view block (`u.view.xy` the frame's size, `u.soft` the mirror and the sway, `u.softTilt` the pointer's
/// tilt, `u.wind.x` the gobo clock); `tex` — the slot's silhouette with its mip chain (r8, 1 = open); `samp` — a linear
/// sampler (the level is rounded here, so one with no mip filter reads the same); `at` — the point, CSS px of the lamp's
/// frame; `L` — the layer: its plate's centre (x, y — fractions of the frame), side (z — × the frame's longer side) and turn
/// (w — radians); `disc` — the blur disc's radius, plate texels, > 0; `par` — the layer's travel per unit of tilt, CSS px;
/// `beat` — the layer's phase in the sway, radians; `n` — blue noise 0..1 (the spiral's turn).
/// → [0, 1]: the silhouette's mean over the disc. Exactly 1 outside the plate (no tap is read there), and thinned toward 1
///   over the plate's outer seventh, so a picture that runs off its frame ends as a crown thins, not in a straight line.
fn soft_layer(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, at: vec2f, L: vec4f, disc: f32, par: f32, beat: f32, n: f32) -> f32 {
  let size = u.view.xy;
  let span = max(L.z * max(size.x, size.y), 1e-6);
  var c = L.xy;
  if (u.soft.y > 0.5) { c.x = 1.0 - c.x; }
  var d = (at - c * size + u.softTilt.xy * vec2f(par, -par)) / span;
  if (u.soft.y > 0.5) { d.x = -d.x; }
  let cr = cos(L.w);
  let sr = sin(L.w);
  d = vec2f(cr * d.x + sr * d.y, -sr * d.x + cr * d.y);
  var uv = d + 0.5;
  let clock = u.wind.x;
  uv += (u.soft.z / 512.0) * vec2f(sin(clock * 0.23 + beat + uv.y * 4.0), 0.6 * sin(clock * 0.17 + beat * 1.7 + uv.x * 3.0));
  let r = disc * mix(0.7, 1.4, smoothstep(0.1, 0.9, 0.5 * (uv.x + 1.0 - uv.y)));
  let reach = r / 512.0;
  if (uv.x < -reach || uv.x > 1.0 + reach || uv.y < -reach || uv.y > 1.0 + reach) { return 1.0; }
  // A tap's share of the disc is a square of side r·√(π/12) texels; where the plate is drawn smaller than that, the texels
  // under one device px. The level is ROUNDED and held to the chain the mat draws (0 … 3): a kind's own gobo sampler has
  // no mip filter, and a fractional level would be read differently by each.
  let lod = clamp(floor(log2(max(r * 0.5117, 512.0 / (span * mat_dpr(u)))) + 0.5), 0.0, 3.0);
  let a0 = n * 6.28318530718;
  var sum = 0.0;
  for (var i = 0; i < 12; i++) {
    let a = a0 + f32(i) * 2.39996323;
    sum += textureSampleLevel(tex, samp, uv + reach * sqrt((f32(i) + 0.5) / 12.0) * vec2f(cos(a), sin(a)), lod).r;
  }
  let inset = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return mix(1.0, sum / 12.0, smoothstep(0.0, 0.14, inset));
}

/// Soft light at a point of the lamp's frame: the near layer's shade times the far one's.
/// `u` — the slot's view block (`u.softNear`, `u.softFar` the layers; `u.softDisc` their discs and opacities; `u.soft.w` the
/// discs' scale as the night comes on, by `u.night.x`); `tex`, `samp`, `n` — as `soft_layer`'s; `at` — the point, CSS px of
/// the lamp's frame.
/// → [0, 1]: 1 = fully lit. A layer at opacity 0 is not sampled. Neither layer alone reaches 0 under an opacity below 1,
///   so where the two cross is the darkest place, as it is on a wall.
fn soft_gobo(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, at: vec2f, n: f32) -> f32 {
  // by night the discs widen: the rods pool their signal over more of the retina than the cones do
  let wide = mix(1.0, u.soft.w, saturate(u.night.x));
  var light = 1.0;
  if (u.softDisc.z > 0.0) { light = mix(1.0, soft_layer(u, tex, samp, at, u.softNear, u.softDisc.x * wide, u.softTilt.z, 0.0, n), u.softDisc.z); }
  if (u.softDisc.w > 0.0) { light = light * mix(1.0, soft_layer(u, tex, samp, at, u.softFar, u.softDisc.y * wide, u.softTilt.w, 2.4, fract(n + 0.61803)), u.softDisc.w); }
  return light;
}

/// The lamp's dapple at a point already in the chosen projection space — the cone's, or soft light's.
/// `u`, `tex`, `samp`, `desk`, `n` — as the cone's (`cone_project_gobo`, mat.wgsl's own `project_gobo`); under soft light
/// `tex` carries its mip chain.
/// → [0, 1]: 1 = fully lit, and exactly 1 when the gobo is off (`u.gobo.x` ≤ 0). Under the cone (`u.soft.x` ≤ 0) the cone's
///   answer. Under soft light the projector is not consulted: `mix(1, soft_gobo at the point's place in the lamp's frame,
///   u.gobo.x)`. Every caller's point is in that frame already — the pixel's own CSS px under a viewport lamp, the world's
///   under a world one — as metres from the plane's origin, so the plane's scale gives the px back; its height is unread
///   (the light falls straight down, so a lifted object's dapple does not shift).
fn project_gobo(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, desk: vec3f, n: f32) -> f32 {
  if (u.soft.x <= 0.0) { return cone_project_gobo(u, tex, samp, desk, n); }
  if (u.gobo.x <= 0.0) { return 1.0; }
  return mix(1.0, soft_gobo(u, tex, samp, (desk.xz - u.plane.xy) / max(u.plane.z, 1e-12), n), u.gobo.x);
}

/// The DAY's chain — the lamp's dapple graded onto a colour: the cone's grade, or soft light's.
/// `u`, `albedo`, `gobo` — as the cone's (`cone_shade_mat`, mat.wgsl's own `shade_mat`).
/// → RGB 0..1 in `albedo`'s encoding, and exactly `albedo` where `gobo` ≥ 1 under either. Under the cone the cone's grade.
///   Under soft light (`u.soft.x` > 0) the shade is what the sky alone lights: the albedo's light (`albedo`^2.2) ×
///   `mix(u.softShade, 1, gobo)` per channel, written back through 1/2.2 — cooler as it deepens, never black.
fn shade_mat(u: MatUniforms, albedo: vec3f, gobo: f32) -> vec3f {
  if (u.soft.x <= 0.0) { return cone_shade_mat(u, albedo, gobo); }
  if (gobo >= 1.0) { return albedo; }
  return pow(pow(albedo, vec3f(2.2)) * mix(u.softShade.xyz, vec3f(1.0), gobo), vec3f(1.0 / 2.2));
}

/// The NIGHT's chain — a reflectance under the Moon, as the dark-adapted eye reports it; with a contrast exponent.
/// `u`, `albedo`, `gobo`, `noise` — as the night's own (`cone_night_mat`, mat.wgsl's `night_mat`); `u.night2.x` — the
/// exponent the reported luminance is raised to (1 = none; 0, a block that never set it, reads as none).
/// → sRGB-ENCODED RGB, ≈ 0..1. With no exponent, the night's own answer. With one, the eye's report is scaled by its own
///   luminance raised to (the exponent − 1): a scene seen in a dim surround loses contrast, which lifts the dark ground
///   toward the paper and every shadow toward its light.
fn night_mat(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  if (u.night2.x <= 0.0 || u.night2.x == 1.0) { return cone_night_mat(u, albedo, gobo, noise); }
  let shade = u.moon.w + (1.0 - u.moon.w) * gobo;
  let cone = albedo * u.moon.xyz * shade;
  let rod = max(night_scotopic(cone), 0.0) / night_scotopic(vec3f(1.0));
  let L = u.night.y * night_luminance(cone) * 0.3183098862;
  let see = mix(rod * u.rod.xyz, cone, night_mesopic(L));
  let disp = u.eigengrau.xyz + see * (u.night.z * pow(max(night_luminance(see), 1e-5), u.night2.x - 1.0));
  return night_encode(disp) + (noise - 0.5) * u.night.w;
}

/// The MAT's colour on screen: the day's chain, the night's, or between them by `u.night.x`; the night from the day.
/// `u`, `albedo`, `gobo`, `noise` — as the mat's own (`cone_mat_colour`, mat.wgsl's `mat_colour`); `u.night2.y` — how far
/// the night is taken from what the day SHOWS, 0..1.
/// → the day's answer (`shade_mat`) while `u.night.x` ≤ 0, the night's (`night_mat`, encoded) from 1, a mix between. The day
///   writes this albedo as an sRGB value, so its luminance is one more decode down; by `u.night2.y` the night is handed
///   `mix(albedo, albedo^2.2, u.night2.y)` — at 1, what a kind's `srgb_to_linear(colour)` already is for its own day.
fn mat_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  if (u.night.x <= 0.0) { return shade_mat(u, albedo, gobo); }
  var seen = albedo;
  if (u.night2.y > 0.0) { seen = mix(albedo, pow(albedo, vec3f(2.2)), u.night2.y); }
  let night = night_mat(u, seen, gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(shade_mat(u, albedo, gobo), night, u.night.x);
}
