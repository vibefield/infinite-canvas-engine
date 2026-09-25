// The PAPER — a sticky note as a material under the mat's one light
// (STICKY.md). A PURE module: the records, the two uniform blocks and the
// textures arrive as parameters; it names no colour. The sheet is a rounded
// box in its own tilted frame with a HEIGHT off the mat — flat under the
// adhesive strip, rising as t² to the free edge, its corners most, the whole
// sheet raised while held — and that height does three things: it tilts the
// normal the lamp shades, it moves the point the gobo is read at, and it casts
// the sheet's shadow along the lamp's ground slope, blurred by how high the
// rim is there. The ink is a coverage raster laid into the paper's albedo
// before the light, so the dapple crosses the writing as it crosses the mat.

fn paper_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }
fn paper_line(d: f32, w: f32, px: f32) -> f32 { return paper_cov(d, px) - paper_cov(d + w, px); }

fn paper_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage — the shadow, straight out of the field.
fn paper_blur_cov(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * paper_erf(d / max(sigma * 1.4142136, 1.0e-4)); }

// Premultiplied "src over dst".
fn paper_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }

// World → the sheet's own frame; a world direction → the same.
fn paper_local(P: Paper, p: vec2f) -> vec2f {
  let d = p - P.centre;
  return vec2f(P.rot.x * d.x + P.rot.y * d.y, -P.rot.y * d.x + P.rot.x * d.y);
}
fn paper_dir(P: Paper, v: vec2f) -> vec2f { return vec2f(P.rot.x * v.x + P.rot.y * v.y, -P.rot.y * v.x + P.rot.x * v.y); }

// The sheet's height off the mat at a local point (paper.ts `heightAt` is the same arithmetic).
fn paper_height(P: Paper, q: vec2f) -> f32 {
  let hy = P.half.y;
  let flat = -hy + P.glue * 2.0 * hy;
  let t = saturate((q.y - flat) / max(2.0 * hy * (1.0 - P.glue), 1.0e-6));
  let c = pow(min(abs(q.x) / max(P.half.x, 1.0e-6), 1.0), 6.0);
  return P.lift + P.curl * t * t * (1.0 + P.cornerCurl * c);
}

// The sheet's normal from its height, by central differences one world unit apart — the slope
// exaggerated by the relief (`shadow.w`), or a few px of curl over a hundred would shade nothing.
fn paper_normal(P: Paper, q: vec2f) -> vec3f {
  let e = 1.0;
  let dx = paper_height(P, q + vec2f(e, 0.0)) - paper_height(P, q - vec2f(e, 0.0));
  let dy = paper_height(P, q + vec2f(0.0, e)) - paper_height(P, q - vec2f(0.0, e));
  return normalize(vec3f(-dx * P.shadow.w / (2.0 * e), -dy * P.shadow.w / (2.0 * e), 1.0));
}

// A world point raised `h` world units off the desk, in the projector's frame (mat.wgsl `desk_of` with a height).
fn paper_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}

// The paper's colour on screen under the mat's light: by day the reference's grade on the
// sheet's sRGB albedo — lit, the identity, so a configured byte is the drawn byte — or, at
// `chain` 1, through the mat's own double gamma (what the sage goes through); by night the
// eye's chain on the sheet's linear albedo, as the mat's. Between, the cross-fade.
fn paper_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32, chain: f32) -> vec3f {
  let day = shade_mat(u, mix(albedo, srgb_to_linear(albedo), chain), gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// One note at a world point `p`: premultiplied colour. `px` is world units per DEVICE px,
// `css` world units per CSS px; `frag` the framebuffer pixel (the blue noise's key); `lit` the
// slot is lit from elsewhere (a mini mat's inside, a handover — MINIMAT.md §4): a PIPELINE constant,
// never a uniform flag, so a note under its own lamp compiles to exactly what it always did.
fn shade_paper(P: Paper, u: MatUniforms, k: PaperUniforms, p: vec2f, px: f32, css: f32, frag: vec2f,
               gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler,
               ink_tex: texture_2d_array<f32>, ink_samp: sampler, lit: bool) -> vec4f {
  let q = paper_local(P, p);
  let d = sdf_round_box(q, P.half, P.radius);
  // The shadow, outside the sheet only: the silhouette cast along the lamp's ground slope
  // by the height of the nearest rim point, blurred by that height — a flat strip lies in
  // a tight contact shadow, the curled edge and a held sheet in a wider, softer one.
  let rim = clamp(q, -P.half, P.half);
  let hr = paper_height(P, rim);
  let ds = sdf_round_box(q - paper_dir(P, P.slope) * hr, P.half, P.radius);
  let sh = paper_blur_cov(ds, P.shadow.x + P.shadow.z * hr) * P.shadow.y * (1.0 - paper_cov(d, px));
  var acc = vec4f(0.0, 0.0, 0.0, sh);
  if (d > px) { return acc * P.alpha; }
  let cov = paper_cov(d, px);

  // The sheet: its height, its normal, the lamp — the flat strip reads 1, the curl turns toward or from the light.
  let h = paper_height(P, q);
  let n = paper_normal(P, q);
  let L = vec3f(paper_dir(P, P.lamp.xy), P.lamp.z);
  let diffuse = saturate(dot(n, L)) / max(L.z, 1.0e-3);

  // The albedo: the paper with its fibre (in the sheet's own units, so the grain sticks to it), the ink laid into it.
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  let fibre = ((value_noise(q * 0.9) - 0.5) + (value_noise(q * 3.1) - 0.5) * 0.5 + (bn.x - 0.5) * 0.5) * P.paper.w;
  var albedo = P.paper.xyz + vec3f(fibre * 1.1, fibre, fibre * 0.7);
  let nq = q + P.half;                      // note units from the sheet's top-left
  let uv = P.uv.xy + (nq / (2.0 * P.half)) * (P.uv.zw - P.uv.xy);
  var ink = 0.0;
  if (P.layer >= 0) { ink = textureSampleLevel(ink_tex, ink_samp, uv, P.layer, 0.0).r; }
  // The wipe: the pen still writing the newest glyph — inside its box the ink appears left to right.
  if (P.wipe.z > P.wipe.x && nq.x >= P.wipe.x && nq.x <= P.wipe.z && nq.y >= P.wipe.y && nq.y <= P.wipe.w) {
    let edge = P.wipe.x + P.marks.x * (P.wipe.z - P.wipe.x + k.knobs.y);
    ink *= 1.0 - smoothstep(edge - k.knobs.y, edge, nq.x);
  }
  albedo = mix(albedo, P.ink.xyz, ink * P.ink.w);
  // the lamp's shading, in the display's own gamma (the mat's law: a linear multiply shows as shade^(1/2.2))
  albedo = albedo * pow(max(diffuse, 0.0), 1.0 / 2.2);
  // the dapple: under the slot's own lamp the desk point itself — else where the LIGHT sees it: the lamp of the desk a mini mat lies on (MINIMAT.md §4)
  var gobo = sample_gobo(u, gobo_tex, gobo_samp, paper_desk_at(u, p, h), bn.z);
  if (lit) { gobo = lit_gobo(u, gobo_tex, gobo_samp, p, h, paper_desk_at(u, p, h), bn.z); }
  let colour = paper_colour(u, clamp(albedo, vec3f(0.0), vec3f(1.0)), gobo, bn.y, k.knobs.x);
  acc = paper_over(vec4f(colour * cov, cov), acc);

  // The caret: a bar of the ink at the writing head, on the host's blink.
  if (P.marks.y > 0.5) {
    let cw = k.knobs.z * css;
    let cq = nq - vec2f(P.caret.x, P.caret.y - P.caret.z);
    let ch = P.caret.z + P.caret.w;
    let cd = sdf_box(cq - vec2f(cw * 0.5, ch * 0.5), vec2f(cw * 0.5, ch * 0.5));
    let cc = paper_cov(cd, px) * 0.9;
    acc = paper_over(vec4f(P.ink.xyz * cc, cc), acc);
  }
  // The sole-selection ring, inside the edge, in the theme's select.
  let ring = paper_line(d, k.knobs.w * css, px) * P.ring;
  acc = paper_over(vec4f(k.select.xyz * ring, ring), acc);
  return acc * P.alpha;
}
