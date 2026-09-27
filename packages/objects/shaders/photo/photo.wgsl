// The PHOTO — a glossy print as a material under the desk's one light
// (PHOTO.md). A PURE module: the record, the two uniform blocks and the
// textures arrive as parameters. The sheet is a rounded box in 3D — a centre
// with a height, its own axes on a tilted plane, a bend — seen through a
// LOCAL eye over its anchor (photo.ts `unproject` is this arithmetic on the
// CPU): the fragment's desk point is a ray from that eye, cast onto the sheet.
// Its shadow is the same cast from the desk point toward the light: where the
// ray meets the sheet, how high the sheet is there sets the blur. The picture
// is laid into the paper's albedo before the light (so the dapple crosses it
// as it crosses the mat); the coating's gloss is added after it — the lamp's
// highlight where the sheet turns toward it, and the room's sheen at a slant.

fn photo_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }

fn photo_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage of the silhouette — the shadow, straight out of the field.
fn photo_blur_cov(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * photo_erf(d / max(sigma * 1.4142136, 1.0e-4)); }

fn photo_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }

fn photo_encode(c: vec3f) -> vec3f {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), c));
}

// The bend's offset along the normal at a point of the sheet (photo.ts `bendAt`):
// the rest curl rises toward the short edges; a held sheet droops away from the grab point.
fn photo_bend(P: Photo, q: vec2f) -> f32 {
  let d = length(q - P.bend.zw) / (2.0 * length(vec2f(P.ex.w, P.ey.w)));
  let cu = q.x / max(P.ex.w, P.ey.w);
  return P.bend.y * cu * cu - P.bend.x * d * d;
}

// The sheet's normal with its bend, by central differences one world unit apart.
fn photo_normal(P: Photo, q: vec2f) -> vec3f {
  let dx = photo_bend(P, q + vec2f(1.0, 0.0)) - photo_bend(P, q - vec2f(1.0, 0.0));
  let dy = photo_bend(P, q + vec2f(0.0, 1.0)) - photo_bend(P, q - vec2f(0.0, 1.0));
  return normalize(P.n.xyz - P.ex.xyz * (dx * 0.5) - P.ey.xyz * (dy * 0.5));
}

// A ray (origin o, direction D) onto the sheet: the point in 3D and the sheet's frame, with one bend correction.
struct PhotoHit { p: vec3f, q: vec2f, ok: bool }
fn photo_cast(P: Photo, o: vec3f, D: vec3f) -> PhotoHit {
  var h: PhotoHit;
  let n = P.n.xyz;
  let dn = dot(n, D);
  if (abs(dn) < 1.0e-5) { h.ok = false; return h; }
  var t = dot(n, P.centre.xyz - o) / dn;
  var p = o + D * t;
  var q = vec2f(dot(p - P.centre.xyz, P.ex.xyz), dot(p - P.centre.xyz, P.ey.xyz));
  t = dot(n, P.centre.xyz + n * photo_bend(P, q) - o) / dn;
  p = o + D * t;
  let r = p - (P.centre.xyz + n * photo_bend(P, q));
  h.p = p;
  h.q = vec2f(dot(r, P.ex.xyz), dot(r, P.ey.xyz));
  h.ok = t > 0.0;
  return h;
}

// The picture at a point of the sheet: sRGB-encoded rgb, and whether this point is the picture (1) or the border (0). Its texel
// at (uv, lod) is the entry's `photo_texel` (K6a: the entry binds where the pixels live — a shared array's layer, a pool's detail).
fn photo_picture(P: Photo, q: vec2f, px: f32) -> vec4f {
  let inner = vec2f(P.ex.w, P.ey.w) - vec2f(P.eye.w);
  if (P.image.w < 0.5 || inner.x <= 0.0 || inner.y <= 0.0) { return vec4f(0.0); }
  let d = sdf_box(q, inner);
  let cov = photo_cov(d, px);
  if (cov <= 0.0) { return vec4f(0.0); }
  let uv = clamp((q + inner) / (2.0 * inner), vec2f(0.0), vec2f(1.0));
  // the mip: texels per device pixel along the picture's wider axis (the ray's own foreshortening is small; the eye is far)
  let lod = clamp(log2(max(P.image.x / (2.0 * inner.x), P.image.y / (2.0 * inner.y)) * px), 0.0, P.image.z - 1.0);
  let c = photo_texel(P, uv, lod);
  return vec4f(photo_encode(c.rgb), cov * c.a);
}

// The print by day: the mat's light — the reference's grade on the sRGB albedo, lit the identity (a
// picture's byte is the drawn byte), the palm's shade darkening it as it darkens the mat.
//
// The print by NIGHT (PHOTO.md §4a): the same Moon, the same palm, seen by the eye that sees by moonlight
// — but the print keeps its colour where it is a PICTURE. The fovea has no rods: what the eye looks at it
// sees with cones alone, white-balanced to the thing it attends to (CIECAM's D → 1), so a picture keeps its
// hue while its light is the Moon's. The paper around it is seen as the mat is (night_mat's model: the
// Moon's partly adapted warmth, the rods' blue by the mesopic weight at its own luminance, their noise).
// The level is the mat's night LAW, not its exposure number: moonlit = `k.night.x` (½) of the day's
// luminance (MAT.md §2; the mat's exposure is fitted to its double-gamma day look, a print's day look is
// its plain sRGB). The shade is the night's: the sky's fill `moon.w` where the palm blocks the Moon.
// `keep` = how far a picture's pixel is seen foveally (1 = its hue exactly).
fn photo_night(u: MatUniforms, k: PhotoUniforms, albedo: vec3f, gobo: f32, pic: f32, noise: f32) -> vec3f {
  let lin = srgb_to_linear(albedo);
  let shade = u.moon.w + (1.0 - u.moon.w) * gobo;
  let fovea = pic * k.night.y;
  // the cones: the paper takes the Moon's partly adapted warmth, the picture the eye's own white
  let cone = lin * mix(u.moon.xyz, vec3f(1.0), fovea) * shade * k.night.x;
  // the rods, as night_mat has them: V' normalised to white, drawn in the rods' blue
  let rod = max(night_scotopic(cone), 0.0) / night_scotopic(vec3f(1.0));
  let L = u.night.y * night_luminance(lin * u.moon.xyz * shade) * 0.3183098862;   // cd/m² on the print: E · ρ / π
  let m = mix(night_mesopic(L), 1.0, fovea);
  let see = mix(rod * u.rod.xyz, cone, m);
  // the dark is not black (MAT.md §1.5): the paper wears Eigengrau and the rods' snow as the mat does; the fovea's
  // picture takes the same floor as a NEUTRAL grey of Eigengrau's luminance — a grey keeps the hue, the blue would not
  let floor = mix(u.eigengrau.xyz, vec3f(night_luminance(u.eigengrau.xyz)), fovea);
  return night_encode(floor + see) + (noise - 0.5) * u.night.w * (1.0 - fovea);
}

fn photo_colour(u: MatUniforms, k: PhotoUniforms, albedo: vec3f, gobo: f32, pic: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = photo_night(u, k, albedo, gobo, pic, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// A world point raised `h` world units off the desk, in the projector's frame (mat.wgsl `desk_of` with a height).
fn photo_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}

// One print at a desk point `s`: premultiplied colour. `px` is world units per DEVICE px; `frag` the framebuffer pixel; `lit`
// the slot is lit from elsewhere (a mini mat's inside, a handover — MINIMAT.md §4): a PIPELINE constant, never a uniform flag,
// so a print under its own lamp compiles to exactly what it always did (the note's precedent, paper.wgsl `shade_paper`).
fn shade_photo(P: Photo, u: MatUniforms, k: PhotoUniforms, s: vec2f, px: f32, frag: vec2f,
               gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler, lit: bool) -> vec4f {
  let half = vec2f(P.ex.w, P.ey.w);
  let L = P.light.xyz;

  // THE SHADOW: from the desk point toward the light, onto the sheet. Its height there is the ray's
  // own parameter (the ray rises one unit per unit), so a flat sheet lies in its contact shadow and a
  // lifted or tilted one casts a wider, softer, offset one — the tilted outline, not a rect's.
  var sh = 0.0;
  let a = vec3f(-P.slope.xy, 1.0);
  let hs = photo_cast(P, vec3f(s, 0.0), a);
  if (hs.ok || P.centre.z < 0.5) {
    let height = max(hs.p.z, 0.0);
    let ds = sdf_round_box(hs.q, half, P.n.w);
    let pen = photo_blur_cov(ds, k.penumbra.y + k.penumbra.z * height) * P.light.w;
    let con = photo_blur_cov(ds, k.contact.y) * k.contact.x * (1.0 - smoothstep(0.0, k.contact.z, height));
    sh = 1.0 - (1.0 - pen) * (1.0 - con);
  }
  var acc = vec4f(k.shade.xyz * sh, sh);

  // THE SHEET: the ray from the local eye through the desk point.
  let eye = P.eye.xyz;
  let hit = photo_cast(P, eye, vec3f(s, 0.0) - eye);
  if (!hit.ok) { return acc * P.centre.w; }
  let q = hit.q;
  // a device pixel on the desk is (eye − h)/eye of that on the sheet
  let pxs = px * max(eye.z - hit.p.z, 1.0) / eye.z;
  let d = sdf_round_box(q, half, P.n.w);
  if (d > pxs) { return acc * P.centre.w; }
  let cov = photo_cov(d, pxs);

  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  // the paper: resin-coated, a faint fibre that sticks to the sheet
  let fibre = ((value_noise(q * 0.7) - 0.5) + (bn.x - 0.5) * 0.5) * k.paper.w;
  var albedo = k.paper.xyz + vec3f(fibre);
  let pic = photo_picture(P, q, pxs);
  albedo = mix(albedo, pic.rgb, pic.a);

  // the light: the lamp's diffuse on the bent sheet (flat = 1, the configured byte), in the display's gamma as the mat's law
  let n = photo_normal(P, q);
  let diffuse = clamp(dot(n, L) / max(L.z, 1.0e-3), 0.0, 1.6);
  albedo = clamp(albedo * pow(diffuse, 1.0 / 2.2), vec3f(0.0), vec3f(1.0));
  // the dapple: under the slot's own lamp the sheet's point itself — else where the LIGHT sees it: the lamp of the desk a mini mat lies on (MINIMAT.md §4)
  var gobo = sample_gobo(u, gobo_tex, gobo_samp, photo_desk_at(u, hit.p.xy, hit.p.z), bn.z);
  if (lit) { gobo = lit_gobo(u, gobo_tex, gobo_samp, hit.p.xy, hit.p.z, photo_desk_at(u, hit.p.xy, hit.p.z), bn.z); }
  var colour = photo_colour(u, k, albedo, gobo, pic.a, bn.y);
  // the light on the coating: the Sun's, or by night the Moon's — the same palm blocks both, and the Moon's
  // glint is dimmer (the night's level) and cooler (what the rods make of a white highlight)
  let night = saturate(u.night.x);
  let glint = mix(vec3f(1.0, 0.985, 0.95), vec3f(0.78, 0.86, 1.0) * k.night.x, night);

  // the coating: the lamp's highlight (blocked where the palm shades it) and the room's sheen at a slant (Schlick)
  let V = normalize(eye - hit.p);
  let H = normalize(L + V);
  let spec = pow(max(dot(n, H), 0.0), k.gloss.y) * k.gloss.x * gobo;
  let R = reflect(-V, n);
  let window = smoothstep(0.62, 0.97, dot(R, L));
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let sheen = (0.12 + 0.88 * window) * fres * k.gloss.z * (0.4 + 0.6 * gobo);
  colour = colour + glint * (spec + sheen);
  // the cut edge: a hairline a shade darker, where the light grazes the paper's thickness
  let edge = photo_cov(d + 0.9 * pxs, pxs) ;
  colour = colour * (1.0 - 0.18 * (1.0 - edge));
  colour = clamp(colour + (bn.y - 0.5) / 255.0, vec3f(0.0), vec3f(1.0));

  acc = photo_over(vec4f(colour * cov, cov), acc);
  return acc * P.centre.w;
}
