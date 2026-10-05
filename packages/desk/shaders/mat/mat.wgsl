// The cutting mat's maths — a PURE module: no bindings. The uniform block and
// the textures arrive as parameters. Every function body is the reference's
// (research/tree-shadow/prototype/src/shaders.js), transcribed to the engine's
// units: world = CSS px at zoom 1, the lattice's decade rungs, `MatUniforms`
// from src/mat/layout.ts prepended by the engine.
//
// THE KIT'S `light` PIECE (`kitWgsl([..., "light"])` — `lamp`, `gobo`, `night` and `noise` name it too; petition I31: every
// declaration's `///` block says what it takes and gives). THE CONVENTIONS every kit piece is written in:
//  - WORLD units: one is one CSS px at zoom 1. World x runs right and world y runs DOWN, as the screen's do. A slot's camera is
//    unwrapped world (`u.cam.xy`, the world point at the attachment's top-left); the lattice's PHASE is the camera wrapped to
//    the coarse rung's period (`u.phase.xy`), what the lines are drawn from so they stay exact at any distance.
//  - CSS px: the attachment's layout px, origin its top-left, y down — `(world − u.cam.xy) · zoom`.
//  - DEVICE px: the attachment's texels — a fragment's `@builtin(position).xy`, pixel centres at .5 — CSS px · dpr. So a
//    fragment's world point is `frag / (zoom · dpr) + u.cam.xy`, and one device px is `1 / (zoom · dpr)` world units.
//  - zoom = `mat_zoom(u)`: CSS px per world unit. dpr = `mat_dpr(u)`: device px per CSS px — the ATTACHMENT's own, below 1 for
//    a capture's thumbnail or the held desk copy (petition I29). Both > 0.
//  - the DESK: the plane the lamp lights, in the projector's frame — metres, y UP (three's): world x runs along its x, world y
//    along its z, and a height above the desk along its y (`desk_of`, `lit_desk`; `u.plane`).
//  - COLOUR: 0..1 per channel. sRGB-encoded unless a parameter says LINEAR; the swap chain is a plain 8-bit format, so what a
//    pass writes is what CSS would show. The day's chain (`shade_mat`) keeps its input's encoding; the night's (`night_mat`)
//    takes linear reflectance and returns encoded colour.

/// The slot's zoom: CSS px per world unit.
/// `u` — the slot's view block (`MatUniforms`, bound as `u`).
/// → `u.cam.z`, floored at 1e-12 so it divides safely: > 0 (the desk's band is 1e-8 … 1e8).
fn mat_zoom(u: MatUniforms) -> f32 { return max(u.cam.z, 1e-12); }
// The ATTACHMENT's own device ratio — below 1 for a capture's thumbnail (dpr × scale), the held desk copy (dpr / 2) and a page
// zoomed out — guarded only against an unset block. Every fragment's CSS px is its device px over it: a floor at 1 put each one
// at the wrong point of the desk there, and the flat kinds shaded nothing (petition I29).
/// The attachment's device px per CSS px.
/// `u` — the slot's view block.
/// → `u.cam.w`, floored at 1e-6 against an unset block only: > 0, and below 1 for a thumbnail capture or the held desk copy.
fn mat_dpr(u: MatUniforms) -> f32 { return max(u.cam.w, 1e-6); }

// ---- the reference's noise (hash12 · valueNoise), on framebuffer pixels
/// The reference's hash: one pseudo-random number per point (`sin`-based — cheap, not a quality RNG; best for |p| within a
/// few thousand, where f32 `sin` keeps its digits).
/// `p` — any point (the mat hands framebuffer device px, scaled).
/// → [0, 1): a different value at every distinct `p`, with no continuity between neighbours.
fn hash12(p: vec2f) -> f32 {
  let n = sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453;
  return n - floor(n);
}

/// Value noise: `hash12` at the four corners of `p`'s lattice cell, blended by a smoothstep weight.
/// `p` — the point in the noise's own cells (one cell per unit of `p`; the mat's grain hands device px × 0.45, a cell ≈ 2.2
/// device px).
/// → [0, 1): continuous, with a continuous gradient across cells, mean ≈ 0.5 — centre it with `value_noise(p) − 0.5`
///   ([−0.5, 0.5)).
fn value_noise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), f.x),
    mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), f.x),
    f.y);
}

/// The sRGB transfer curve, decoded (IEC 61966-2-1).
/// `c` — sRGB-encoded, 0..1 per channel. Clamp first: below −0.055 the curve's unused branch is NaN, and NaN survives the mix.
/// → LINEAR, 0..1 per channel.
fn srgb_to_linear(c: vec3f) -> vec3f {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), step(vec3f(0.04045), c));
}

/// RGB → HSB (hue, saturation, brightness).
/// `c` — RGB, 0..1 per channel (either encoding — the result is in the same one).
/// → x the hue in TURNS, [0, 1) (0 red, 1/3 green, 2/3 blue); y the saturation, [0, 1]; z the brightness `max(r, g, b)`, [0, 1].
fn rgb2hsb(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

/// HSB → RGB, `rgb2hsb`'s inverse.
/// `c` — x the hue in turns (any value: only its fraction counts), y the saturation 0..1, z the brightness 0..1.
/// → RGB, 0..1 per channel.
fn hsb2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(K.xyz + c.x) * 6.0 - K.w);
  return c.z * mix(K.xxx, clamp(p - K.x, vec3f(0.0), vec3f(1.0)), c.y);
}

// ---- the lines. `px` is world units per DEVICE pixel; half-widths are in device px.
/// One family of parallel lines — one every `spacing` along an axis, a line at every multiple of it.
/// `x` — the coordinate across the lines, world units (the lattice's phase); `spacing` — their pitch, world units, > 0;
/// `half_width` — a line's half width, WORLD units (`line_weight`'s device px × `px`); `px` — world units per device px, > 0.
/// → [0, 1]: 1 within `half_width − px` of a line, 0 beyond `half_width + px`, a smoothstep between (the AA).
fn line_coverage(x: f32, spacing: f32, half_width: f32, px: f32) -> f32 {
  let d = abs(fract(x / spacing - 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(max(half_width - px, 0.0), half_width + px, d);
}

/// A square grid: `line_coverage` along both axes, the larger.
/// `p` — the point, world units (the lattice's phase); `spacing`, `half_width`, `px` — as `line_coverage`'s, world units.
/// → [0, 1]: the grid's coverage at `p`.
fn grid2(p: vec2f, spacing: f32, half_width: f32, px: f32) -> f32 {
  return max(line_coverage(p.x, spacing, half_width, px), line_coverage(p.y, spacing, half_width, px));
}

// One law for every rung (src/lattice/line.ts `lineWeight`): fade in over the
// engine's window by the rung's OWN cell, then thicken and darken over the
// next decade. x = half-width (device px), y = alpha.
/// The lattice's line law for one rung — src/lattice/line.ts `lineWeight`, number for number.
/// `u` — the slot's view block (`u.lod`: the fade-in window, CSS px; `u.line`: the half-widths and alphas); `cell_px` — the
/// rung's cell on screen, CSS px (its spacing × zoom).
/// → x the line's half-width, DEVICE px, from `u.line.x` (at the window's top) to `u.line.y` (a decade above it); y its
///   alpha: 0 at or below `u.lod.x`, `u.line.z` at `u.lod.y`, rising to `u.line.w` a decade above.
fn line_weight(u: MatUniforms, cell_px: f32) -> vec2f {
  let s = smoothstep(u.lod.x, u.lod.y, cell_px);
  let t = saturate(log(max(cell_px, 1e-9) / u.lod.y) / 2.302585093);
  return vec2f(mix(u.line.x, u.line.y, t), u.line.z * s + (u.line.w - u.line.z) * t);
}

// The mat's albedo at a point: the reference's `cuttingMatAlbedo` with the
// three lattice rungs in place of its own decade, and the line law above in
// place of its fade ladder. `world` is lattice-phase world (wrapped); `px` is
// world per device pixel; `frag` is the framebuffer pixel; `ruler` the rulers'
// print at it (ruler.wgsl) — ink over the lines, and at 0 exactly the mix below
// returns the lined mat untouched, bit for bit.
/// The cutting mat's albedo at a point: the sage with its grain, the three rungs' cream lines, the rulers' ink over them.
/// `u` — the slot's view block; `world` — the point in LATTICE-PHASE world units (`u.phase.xy + css / zoom` — wrapped, not
/// the camera's world); `px` — world units per device px, > 0; `frag` — the fragment's device px (the grain's hash runs on
/// it); `bn` — the blue-noise texel at the fragment, 0..1 per channel; `ruler` — the rulers' ink coverage there, 0..1
/// (`ruler_ink`; 0 = the lined mat bit for bit).
/// → LINEAR RGB, 0..1 per channel — the reference's quirk: the chain after it (`mat_colour`) takes it as is.
fn mat_albedo(u: MatUniforms, world: vec2f, px: f32, frag: vec2f, bn: vec3f, ruler: f32) -> vec3f {
  var sage = u.ground.xyz;
  let amp = u.grain.x;
  var g = (hash12(frag * vec2f(0.73, 0.91)) - 0.5) * amp;
  g += (value_noise(frag * 0.45 + vec2f(u.view.z * 0.9, -u.view.z * 0.6)) - 0.5) * amp;
  g += (bn.x - 0.5) * amp * 0.5;
  sage += vec3f(g * 0.4, g, g * 0.35);

  // A rung under the window has alpha 0 and no coverage to compute — the
  // fine rung at most zooms. The branches are uniform across the frame.
  let zoom = mat_zoom(u);
  var cover = 0.0;
  let wf = line_weight(u, u.rungs.x * zoom);
  if (wf.y > 0.0) { cover = grid2(world, u.rungs.x, wf.x * px, px) * wf.y; }
  let wm = line_weight(u, u.rungs.y * zoom);
  if (wm.y > 0.0) { cover = max(cover, grid2(world, u.rungs.y, wm.x * px, px) * wm.y); }
  let wc = line_weight(u, u.rungs.z * zoom);
  if (wc.y > 0.0) { cover = max(cover, grid2(world, u.rungs.z, wc.x * px, px) * wc.y); }
  return srgb_to_linear(clamp(mix(mix(sage, u.ink.xyz, cover), u.ink.xyz, ruler), vec3f(0.0), vec3f(1.0)));
}

// ---- the gobo (the reference's sampleBlur · getGoboBlurRatio · sampleGobo)
/// A linear ramp.
/// `edge0`, `edge1` — where it starts and ends (`edge0` ≠ `edge1`); `x` — the input, in their units.
/// → [0, 1]: 0 at or before `edge0`, 1 at or past `edge1`, linear between.
fn linearstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

// Linearise the WebGL-range NDC z with the projector's near/far, then ramp
// between the two depths: sharp near the projector, soft far from it.
/// How soft the gobo's shadow is at a depth.
/// `ndc_z` — the point's depth in the projector's clip space, WebGL range [−1, 1]; `p` — `u.goboParams`: x the sharp depth
/// and y the soft one (linear, metres from the projector), z and w the projector's near and far planes (metres).
/// → [0, 1]: 0 (sharp) at or nearer than `p.x`, 1 (soft) at or beyond `p.y`.
fn blur_ratio(ndc_z: f32, p: vec4f) -> f32 {
  return linearstep(p.x, p.y, (2.0 * p.z * p.w) / (p.w + p.z - ndc_z * (p.w - p.z)));
}

// Six taps on a golden-angle spiral, the start angle from blue noise so the
// pattern differs per pixel (and per frame while the offset moves).
/// The gobo's silhouette blurred by six taps on a golden-angle spiral.
/// `tex` — the silhouette (r8: 1 = open, 0 = leaf); `samp` — a linear sampler; `uv` — the plate point, 0..1 (v runs down the
/// plate); `texel` — one plate texel in uv; `blur` — the spiral's reach in texels (≤ 0: one tap, sharp); `n` — a per-pixel
/// random 0..1 (blue noise) that turns the spiral.
/// → [0, 1]: the silhouette's mean over the taps.
fn sample_blur(tex: texture_2d<f32>, samp: sampler, uv: vec2f, texel: vec2f, blur: f32, n: f32) -> f32 {
  // No blur: six taps at one point are one tap. The sharp end of the desk.
  if (blur <= 0.0) { return textureSampleLevel(tex, samp, uv, 0.0).r; }
  let G = 2.39996323;
  let rot = mat2x2f(cos(G), sin(G), -sin(G), cos(G));
  let a0 = n * 6.28318530718;
  var d = vec2f(cos(a0), sin(a0));
  let s = texel * blur * (1.0 / sqrt(6.0));
  var c = 0.0;
  for (var i = 0; i < 6; i++) {
    c += textureSampleLevel(tex, samp, uv + d * sqrt(f32(i + 1)) * s, 0.0).r;
    d = rot * d;
  }
  return c / 6.0;
}

// The gobo term at a desk point (metres): 1 = lit. Outside the projector's
// frame the plate is not consulted at all — the cone is finite, as the
// reference's is.
/// The lamp's dapple at a point of the desk.
/// `u` — the slot's view block (`u.goboMatrix` the projector, `u.gobo` its opacity and blur); `tex` — the slot's animated
/// silhouette (`MatPass.silhouette`, r8, 1 = open); `samp` — a linear sampler; `desk` — the point in the projector's frame,
/// metres, y up (`desk_of`, `lit_desk`, a kind's own desk point); `n` — blue noise 0..1 (the blur spiral's turn).
/// → [0, 1]: 1 = fully lit. Exactly 1 outside the projector's frame and when the gobo is off (`u.gobo.x` ≤ 0); else
///   `mix(1, the silhouette blurred by depth, u.gobo.x)`.
fn sample_gobo(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, desk: vec3f, n: f32) -> f32 {
  if (u.gobo.x <= 0.0) { return 1.0; }
  var clip = u.goboMatrix * vec4f(desk, 1.0);
  let ndc = clip.xyz / clip.w;
  // The wind target's row 0 is the plate's top row, so v runs downward.
  let uv = vec2f(0.5 + 0.5 * ndc.x, 0.5 - 0.5 * ndc.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  let g = sample_blur(tex, samp, uv, vec2f(1.0 / 512.0), blur_ratio(ndc.z, u.goboParams) * u.gobo.y, n);
  return mix(1.0, g, u.gobo.x);
}

// World (CSS px at zoom 1, unwrapped) → the desk plane in the projector's frame.
/// A world point on the desk, in the projector's frame.
/// `u` — the slot's view block (`u.plane`: the origin's x and z, metres per world unit, the desk's height); `world` — the
/// point, UNWRAPPED world units (y down).
/// → metres, y up: `(plane.x + world.x · m, plane.w, plane.y + world.y · m)`, m = `u.plane.z` — world y runs along the
///   desk's z.
fn desk_of(u: MatUniforms, world: vec2f) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w, u.plane.y + world.y * u.plane.z);
}

// ---- the LIGHT a slot is lit by (MINIMAT.md §4; src/mat/layout.ts `SlotLight`). The lamp's gobo is
// sampled where a light CAMERA sees a point, not where the slot's camera does: the same camera for the
// root at rest; the host desk's for a mini mat's inside — the dapple runs across the mini mat as across
// anything lying on the desk — and two of them cross-faded (`light.w`) while a flight hands one lamp to
// the other. An object's world point `p` raised `h` world units, as light camera `L` (x, y, zoom) sees it:
// the point on screen, back into L's world; a height scales as a length does.
/// A point of the slot's world, raised, as a LIGHT camera sees it — in the projector's frame.
/// `u` — the slot's view block; `L` — the light camera: x, y the world point at its top-left, z its zoom (`u.light` or
/// `u.light2`; w unread); `p` — the point, the slot's world units; `h` — its height above the desk, world units, ≥ 0.
/// → metres, y up: `p` carried through the screen into `L`'s world, its height scaled as a length is.
fn lit_desk(u: MatUniforms, L: vec4f, p: vec2f, h: f32) -> vec3f {
  let s = max(u.cam.z, 1e-12) / max(L.z, 1e-12);
  let w = L.xy + (p - u.cam.xy) * s;
  return vec3f(u.plane.x + w.x * u.plane.z, u.plane.w + h * s * u.plane.z, u.plane.y + w.y * u.plane.z);
}

// The gobo on an object's world point `p` raised `h`: under the slot's own lamp the desk point itself,
// `own` (the object's own `desk_at`, so a root's object reads exactly what it always read); else under
// the light camera — then, while a flight hands it over, cross-faded to the second.
/// The lamp's dapple on an object's point, under whichever lamp the slot is lit by.
/// `u` — the slot's view block; `tex`, `samp` — the silhouette and its sampler, as `sample_gobo`'s; `p` — the object's point,
/// the slot's world units; `h` — its height above the desk, world units, ≥ 0; `own` — the same point in the projector's frame
/// as the object computes it (metres, y up), read when the slot is lit by its own camera; `n` — blue noise 0..1.
/// → [0, 1]: 1 = fully lit (`sample_gobo` at the point the light sees; cross-faded by `u.light.w` toward `u.light2`'s).
fn lit_gobo(u: MatUniforms, tex: texture_2d<f32>, samp: sampler, p: vec2f, h: f32, own: vec3f, n: f32) -> f32 {
  var g = 0.0;
  if (all(u.light.xyz == u.cam.xyz)) { g = sample_gobo(u, tex, samp, own, n); }
  else { g = sample_gobo(u, tex, samp, lit_desk(u, u.light, p, h), n); }
  if (u.light.w > 0.0) { g = mix(g, sample_gobo(u, tex, samp, lit_desk(u, u.light2, p, h), n), u.light.w); }
  return g;
}

// The reference's grade: `shade = mix(1, floor + (1 − floor)·gobo, mix)`, then
// HSB: saturation up by (1 − shade)·k, brightness × shade. The reference did
// this on pow(albedo, 2.2) and wrote pow(1/2.2) — kept verbatim: that chain is
// the mat's colour on screen.
/// The DAY's chain — the lamp's dapple graded onto a colour.
/// `u` — the slot's view block (`u.gobo.w` the dark floor, `u.gobo.z` the shade's mix, `u.grade.x` the saturation bump);
/// `albedo` — the colour as it is written where lit, 0..1 per channel: an object's sRGB colour (the mat hands its own linear
/// albedo — the reference's look); `gobo` — the dapple, 0..1 (1 = lit).
/// → RGB 0..1 in `albedo`'s encoding: exactly `albedo` where `gobo` ≥ 1; in shade, brightness × shade and saturation up by
///   (1 − shade) · `u.grade.x`, where shade = `mix(1, floor + (1 − floor) · gobo, u.gobo.z)` (≈ 0.51 … 1 by the theme's numbers).
fn shade_mat(u: MatUniforms, albedo: vec3f, gobo: f32) -> vec3f {
  // Lit: shade is exactly 1, the saturation bump exactly 0, and the chain is
  // pow(pow(albedo, 2.2), 1/2.2) — the identity. Every pixel outside the
  // cone, and every lit one inside it, skips six pows and the HSB round trip.
  if (gobo >= 1.0) { return albedo; }
  let shade = mix(1.0, u.gobo.w + (1.0 - u.gobo.w) * gobo, u.gobo.z);
  var hsb = rgb2hsb(pow(albedo, vec3f(2.2)));
  hsb.y = min(hsb.y + (1.0 - shade) * u.grade.x, 1.0);
  hsb.z = hsb.z * shade;
  return pow(hsb2rgb(hsb), vec3f(1.0 / 2.2));
}

// ---- the NIGHT (MAT.md; src/mat/night.ts is the same arithmetic on the CPU):
// the Moon in place of the Sun, and the eye that sees by it. The day's chain
// above is untouched — `mat_colour` returns it, alone, when `night.x` is 0.
/// Photopic luminance Y (the sRGB / Rec. 709 weights).
/// `c` — LINEAR RGB.
/// → Y, in `c`'s scale (0..1 for 0..1 channels; white is 1).
fn night_luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126729, 0.7151522, 0.0721750)); }

// Scotopic luminance V' from XYZ — Larson, Rushmeier & Piatko 1997's regression:
// the rods peak at 507 nm, so greens and blues keep their brightness by night and reds die.
/// Scotopic luminance V′ — what the rods see (Larson, Rushmeier & Piatko 1997).
/// `c` — LINEAR RGB.
/// → V′ in `c`'s scale: ≥ 0 over the sRGB gamut, white ≈ 2.57 (`night_mat` normalises by it).
fn night_scotopic(c: vec3f) -> f32 {
  let X = dot(c, vec3f(0.4124564, 0.3575761, 0.1804375));
  let Y = dot(c, vec3f(0.2126729, 0.7151522, 0.0721750));
  let Z = dot(c, vec3f(0.0193339, 0.1191920, 0.9503041));
  return Y * (1.33 * (1.0 + (Y + Z) / max(X, 1e-6)) - 1.68);
}

// CIE 191:2010's mesopic weight — the cones' share of the seeing at L cd/m²:
// 0 at 0.005 (the rods alone), 1 at 5 (the cones alone).
/// The cones' share of the seeing at a luminance (CIE 191:2010's mesopic weight).
/// `L` — luminance, cd/m², > 0.
/// → [0, 1]: 0 at or below 0.005 cd/m² (the rods alone), 1 at or above 5 (the cones alone), linear in log10(L) between.
fn night_mesopic(L: f32) -> f32 { return saturate(0.767 + 0.3334 * log(max(L, 1e-9)) * 0.4342944819); }

/// The sRGB transfer curve, encoded — `srgb_to_linear`'s inverse.
/// `c` — LINEAR RGB, ≥ 0 (0..1 for an on-screen colour).
/// → sRGB-encoded RGB (0..1 for 0..1).
fn night_encode(c: vec3f) -> vec3f {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), c));
}

/// The NIGHT's chain — a reflectance under the Moon, as the dark-adapted eye reports it.
/// `u` — the slot's view block (`u.moon`, `u.night`, `u.rod`, `u.eigengrau`: the theme's night, mat/night.ts); `albedo` —
/// LINEAR reflectance, 0..1 per channel (unlike `shade_mat`'s: `srgb_to_linear` an sRGB colour first); `gobo` — the dapple,
/// 0..1 (1 = lit); `noise` — blue noise 0..1 (the rods' own snow).
/// → sRGB-ENCODED RGB, ≈ 0..1 — the Eigengrau's grey under everything, plus the snow (± `u.night.w` / 2).
fn night_mat(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let shade = u.moon.w + (1.0 - u.moon.w) * gobo;                         // the Moon, and the sky's share where it is blocked
  let cone = albedo * u.moon.xyz * shade;                                  // the mat under the Moon, as the partly adapted cones take it
  let rod = max(night_scotopic(cone), 0.0) / night_scotopic(vec3f(1.0));  // the rods' signal, white = 1
  let L = u.night.y * night_luminance(cone) * 0.3183098862;               // cd/m² on the desk: E · ρ / π
  let see = mix(rod * u.rod.xyz, cone, night_mesopic(L));                 // what the eye reports
  let disp = u.eigengrau.xyz + see * u.night.z;                            // the dark's own grey under it, at the appearance's scale
  return night_encode(disp) + (noise - 0.5) * u.night.w;                   // encoded; then the rods' own noise
}

// The mat's colour on screen: the day's chain, the night, or a cross-fade of the two.
/// The MAT's colour on screen: the day's chain, the night's, or between them by `u.night.x`.
/// `u` — the slot's view block; `albedo` — the colour handed to BOTH chains, as the mat's is (`mat_albedo`'s, linear — the
/// reference's look); `gobo` — the dapple, 0..1; `noise` — blue noise 0..1.
/// → the day's answer (`shade_mat`) while `u.night.x` ≤ 0, the night's (`night_mat`, encoded) from 1, a mix between. A kind
///   with an sRGB colour composes its own: the colour into `shade_mat`, `srgb_to_linear` of it into `night_mat` (the book's
///   `nb_colour`).
fn mat_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  if (u.night.x <= 0.0) { return shade_mat(u, albedo, gobo); }
  let night = night_mat(u, albedo, gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(shade_mat(u, albedo, gobo), night, u.night.x);
}
