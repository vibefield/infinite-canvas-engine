// THE WHITEBOARD (BOARD.md) — a desk dry-erase board under the mat's one lamp. A PURE module:
// the record `Board`, the pass's knobs `BoardUniforms`, the mat's block `MatUniforms` and the
// textures arrive as parameters; it names no colour.
//
// The board is a slab on the mat: an aluminium frame round a melamine face recessed a hair
// below it. The camera is top-down, so the depth is the lamp's work, as for the note and the
// notebook: the slab casts its footprint along the lamp's ground slope from every height it
// spans, each blurred by its own height, with a contact shadow at its base; the frame's
// profile rolls at both rims — turned toward the lamp it brightens and glints, turned away it
// falls into shade; the frame's lip shades the melamine on the lamp's side. The melamine
// carries the ink raster — a filter laid into its albedo before the light, so the dapple
// crosses the drawing as it crosses the mat — its waviness, the ghost of old erasures, fresh
// ink's wet gloss, and a SHEEN: the window the lamp shines through, mirrored in the glossy face
// and seen by an eye over the board, so it lands on one part of it and slides as the pointer
// moves (the research whiteboard's room, reduced to the one bright thing a desk has over it).
// On the board lies a capped marker; while it is open, the tool in the hand is drawn at the
// pointer — its shadow meets its tip as it presses. The colour chain is the note's: the
// reference's grade on the sRGB byte by day, the eye's chain on its linear value by night.

fn bd_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }
fn bd_line(d: f32, w: f32, px: f32) -> f32 { return bd_cov(d, px) - bd_cov(d + w, px); }
fn bd_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage — a shadow, straight out of the field.
fn bd_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * bd_erf(d / max(sigma * 1.4142136, 1.0e-4)); }
// Premultiplied "src over dst".
fn bd_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }
// A world point raised `h` world units off the desk, in the projector's frame (the note's `paper_desk_at`).
fn bd_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}
fn bd_encode(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return mix(x * 12.92, 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), x));
}

// The chain, as the note's `paper_colour`: by day the reference's grade on the sRGB albedo — lit,
// the identity, so a configured byte is the drawn byte — or, at `chain` 1, through the mat's own
// double gamma; by night the eye's chain on the linear albedo, as the mat's; between, the cross-fade.
fn bd_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32, chain: f32) -> vec3f {
  let day = shade_mat(u, mix(albedo, srgb_to_linear(albedo), chain), gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// The lamp on a face (the notebook's `bk_lambert`): its fill, plus the lambert normalised so a
// flat face reads 1 and capped so a face turned toward a low lamp brightens only so far.
fn bd_lambert(n: vec3f, L: vec3f, k: BoardUniforms) -> f32 {
  let d = max(dot(n, L), 0.0) / max(L.z, 0.05);
  return k.light.x + (1.0 - k.light.x) * min(d, k.light.y);
}

// A glint: the lamp mirrored by a face toward the eye straight above (Blinn's half vector).
fn bd_glint(n: vec3f, L: vec3f, power: f32) -> f32 {
  return pow(max(dot(n, normalize(L + vec3f(0.0, 0.0, 1.0))), 0.0), power);
}

// How bright a glint can be under the light in force: the Sun's, or the Moon's much less.
fn bd_lit(u: MatUniforms, k: BoardUniforms) -> f32 { return mix(1.0, k.light.w, clamp(u.night.x, 0.0, 1.0)); }

// A rounded box's outward gradient, by central differences.
fn bd_grad(q: vec2f, half: vec2f, r: f32) -> vec2f {
  let e = 0.35;
  let g = vec2f(
    sdf_round_box(q + vec2f(e, 0.0), half, r) - sdf_round_box(q - vec2f(e, 0.0), half, r),
    sdf_round_box(q + vec2f(0.0, e), half, r) - sdf_round_box(q - vec2f(0.0, e), half, r));
  let l = length(g);
  return select(vec2f(0.0, -1.0), g / l, l > 1.0e-5);
}

// ---- the shadows

// A SLAB (a rounded box, `q` in its frame) whose underside is `bottom` and top `top` above the
// receiver: its footprint cast along the ground slope `S` from every height it spans — each
// blurred by its own height, the penumbra widening as the slab rises — the union as the max;
// with the contact shadow at its base while it rests, fading as it floats off. `grow` scales the
// penumbra's growth (the hand's tools cast sharper); `steps` samples the sweep — enough that the
// copies never show as steps under that penumbra.
fn bd_slab(q: vec2f, half: vec2f, r: f32, bottom: f32, top: f32, S: vec2f, k: BoardUniforms, grow: f32, steps: i32) -> f32 {
  var sh = 0.0;
  for (var i = 0; i < steps; i++) {
    let h = mix(bottom, top, f32(i) / f32(steps - 1));
    if (h <= 0.0) { continue; }
    sh = max(sh, bd_blur(sdf_round_box(q - S * h, half, r), k.shadow.x + k.shadow.y * grow * h));
  }
  sh = sh * k.shadow.z;
  let g = max(bottom, 0.0);
  let con = bd_blur(sdf_round_box(q - S * min(g, 1.0) * 0.5, half, r), k.shadow2.x) * k.shadow.w * exp(-g / max(k.shadow2.y, 1.0e-3));
  return max(sh, con);
}

// ---- the marker

// The tools in the hand cast in the sun's own sharpness — their penumbra grows at this share of the
// desk objects' rate, their umbra this much firmer — so the shadow of a hovering nib is a clear mark
// that slides to meet it as it presses: the one cue a hand draws by.
const HAND_PENUMBRA = 0.35;
const HAND_UMBRA = 1.35;

// THE PEN seen from above, in its own frame: `m` = (u along it from the nib, w across). Its cap
// slides with `cap`: 0 = on the nib (the marker lying capped), 1 = posted on its back (in the
// hand), and between, travelling along the barrel as a hand uncaps and posts it. Its ends are
// ROUND — a domed cap, a round nib, a chamfered plug — so it reads as a moulded thing, not a
// cut-out. Returns its signed distance, the part the point is on (0 nib · 1 holder · 2 barrel ·
// 3 stripe · 4 cap · 5 end · 6 the cap's clip · 7 the cap's rim), the local radius, and where
// the point is on a rounded end (−1 … 0 toward the nib, 0 … 1 toward the back; 0 along the tube).
fn bd_pen(m: vec2f, cap: f32, nib: f32, k: BoardUniforms) -> vec4f {
  let L = k.pen.x;
  let R = k.pen.y;
  let capL = k.pen.z;
  let u = m.x;
  let w = abs(m.y);
  let nr = max(nib, 0.6);
  let c0 = mix(-2.0, L - capL * 0.55, cap);   // the cap: from … to
  let c1 = c0 + capL;
  let u0 = min(0.0, c0);
  let u1 = max(L, c1);
  var r = R;
  var part = 2.0;
  if (u < 3.2) { r = nr; part = 0.0; }
  else if (u < 14.0) { r = mix(nr + 0.8, R * 0.76, smoothstep(3.2, 14.0, u)); part = 1.0; }
  else if (u < 16.5) { r = R * 0.94; }
  else if (u > 44.0 && u < 47.0) { part = 3.0; }
  else if (u > L - 7.0) { r = R * 0.9; part = 5.0; }
  if (u >= c0 && u <= c1) {
    r = R + 0.9; part = 4.0;
    // the rim at the cap's open end (toward the barrel while it is on, toward the nib once posted), the clip along its top
    let atBack = u > c1 - 2.2;
    let atFront = u < c0 + 2.2;
    if (select(atFront, atBack, cap < 0.5)) { part = 7.0; }
    else if (w < 1.15 && u > c0 + 6.0 && u < c1 - 7.0) { part = 6.0; }
  }
  // a rounded box in (u, w): the nearer end's rounding, never past the tube's own radius
  let start = u < (u0 + u1) * 0.5;
  let rc0 = select(nr, R + 0.9, c0 < 0.5);
  let rc1 = select(2.4, R + 0.9, c1 > L - 0.5);
  let rc = min(select(rc1, rc0, start), r);
  let de = select(u - u1, u0 - u, start);
  let dw = w - r;
  let q = vec2f(de, dw) + vec2f(rc);
  let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rc;
  let s = select(clamp((u - (u1 - rc)) / max(rc, 1.0e-3), 0.0, 1.0), -clamp(((u0 + rc) - u) / max(rc, 1.0e-3), 0.0, 1.0), start);
  return vec4f(d, part, r, s);
}

// The pen's silhouette for its SHADOW: the same tube, its steps smoothed out — a shadow is soft,
// and a step in the radius (the nib's holder, the cap's lip) would print a line across it.
fn bd_pen_soft(m: vec2f, cap: f32, nib: f32, k: BoardUniforms) -> f32 {
  let L = k.pen.x;
  let R = k.pen.y;
  let capL = k.pen.z;
  let c0 = mix(-2.0, L - capL * 0.55, cap);
  let c1 = c0 + capL;
  let u0 = min(0.0, c0);
  let u1 = max(L, c1);
  let uu = clamp(m.x, u0, u1);
  let capped = smoothstep(c0 - 3.0, c0 + 3.0, uu) * (1.0 - smoothstep(c1 - 3.0, c1 + 3.0, uu));
  let tube = mix(max(nib, 0.6), R, smoothstep(0.0, 16.0, uu)) - 0.1 * R * smoothstep(L - 10.0, L - 4.0, uu);
  let r = mix(tube, R + 0.9, capped);
  return length(vec2f(m.x - uu, m.y)) - r;
}

// Its colour at a point of it, seen from above: a tube lying on its side — its across-position
// turns the normal, and on a rounded end its along-position too; the lamp shades it and the
// gloss of moulded plastic glints on it; the part picks the material. The clip is a little
// half-round rod on the cap, lit on the lamp's side.
fn bd_marker_colour(u: MatUniforms, k: BoardUniforms, sd: vec4f, across: f32, axis: vec2f, perp: vec2f, ink: vec3f, L: vec3f, gobo: f32, noise: f32) -> vec3f {
  var t = clamp(across / max(sd.z, 1.0e-3), -1.0, 1.0);
  if (sd.y == 6.0) { t = clamp(across / 1.15, -1.0, 1.0) * 0.85; }
  let s = sd.w;
  var n = normalize(vec3f(perp * t + axis * s, sqrt(max(1.0 - t * t - s * s, 0.02))));
  var albedo = k.barrel.rgb;
  var gloss = 0.3;
  if (sd.y == 0.0) { albedo = ink * 0.8; gloss = 0.0; }                      // the felt nib
  else if (sd.y == 1.0) { albedo = k.barrel.rgb * 0.8; }                      // the tip's holder, a greyer plastic
  else if (sd.y == 3.0) { albedo = ink; }                                      // the stripe that names the ink
  else if (sd.y == 4.0) { albedo = ink; gloss = 0.45; }                        // the cap
  else if (sd.y == 5.0) { albedo = ink * 0.9; }                                // the end plug
  else if (sd.y == 6.0) { albedo = mix(ink, k.barrel.rgb, 0.18); gloss = 0.7; }   // the clip
  else if (sd.y == 7.0) { albedo = ink * 0.7; }                                // the cap's rim
  // a small round thing wants more modelling than a flat face: the lamp's fill is less on it
  let lam = 0.32 + 0.68 * min(max(dot(n, L), 0.0) / max(L.z, 0.05), k.light.y);
  albedo = albedo * pow(lam, 1.0 / 2.2);
  let c = bd_colour(u, clamp(albedo, vec3f(0.0), vec3f(1.0)), gobo, noise, k.light.z);
  // the gloss: the lamp's glint where it can land, and — where it cannot (a lamp along the axis
  // has no mirror line on a tube) — the bright sky over the desk, a soft stripe along the top
  let toward = L.xy / max(length(L.xy), 1.0e-4);
  let sky = pow(max(dot(n, normalize(vec3f(toward * 0.35, 1.0))), 0.0), 18.0);
  return c + vec3f((bd_glint(n, L, 40.0) + 0.3 * bd_glint(n, L, 8.0) + 0.55 * sky) * gloss * bd_lit(u, k) * mix(0.45, 1.0, gobo));
}

// ---- the melamine's sheen

// The window the lamp shines through, mirrored in the melamine and seen by an eye over the
// board: a soft disc of sky toward the lamp, high up; Schlick's Fresnel on melamine's f0. The
// eye rides the pointer (`B.sheen`), so the reflection slides as the hand moves.
fn bd_sheen(B: Board, k: BoardUniforms, p: vec2f, n: vec3f) -> f32 {
  let eye = vec3f(B.centre + B.sheen * B.half, k.sheen.z * 2.0 * B.half.y);
  let V = normalize(eye - vec3f(p, 0.0));
  let R = reflect(-V, n);
  let toward = B.lamp.xy / max(length(B.lamp.xy), 1.0e-4);
  let W = normalize(vec3f(toward * 0.42, 0.91));
  let w = smoothstep(cos(k.sheen.y), 1.0, dot(R, W));
  let f = 0.045 + 0.955 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  return w * w * (f / 0.045);
}

// ---- the board

// One board at a world point `p`: premultiplied colour. `px` is world units per DEVICE px, `css`
// world units per CSS px; `frag` the framebuffer pixel (the blue noise's key).
fn shade_board(B: Board, u: MatUniforms, k: BoardUniforms, p: vec2f, px: f32, css: f32, frag: vec2f,
               gobo_tex: texture_2d<f32>, gobo_samp: sampler, noise_tex: texture_2d<f32>, noise_samp: sampler,
               ink_tex: texture_2d<f32>, ink_samp: sampler, stroke_tex: texture_2d<f32>, wet_tex: texture_2d<f32>, lin_samp: sampler) -> vec4f {
  let q = p - B.centre;
  let L = B.lamp.xyz;
  let S = B.slope;
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  let dOut = sdf_round_box(q, B.half, B.radius);
  var acc = vec4f(0.0);
  // what a shadow is made of: the world's darkest value by day (the design's cast), the dark's own grey by night
  let shadowInk = mix(k.castTint.rgb, bd_encode(u.eigengrau.xyz), clamp(u.night.x, 0.0, 1.0));

  // The slab's shadow on the mat, outside its footprint.
  if (dOut > -px) {
    let sh = bd_slab(q, B.half, B.radius, B.lift, B.lift + B.thick, S, k, 1.0, 6) * (1.0 - bd_cov(dOut, px));
    acc = vec4f(shadowInk * sh, sh);
  }

  let top = B.lift + B.thick;          // the frame's top off the mat
  let face = top - B.recess;           // the melamine's
  if (dOut < px) {
    let cov = bd_cov(dOut, px);
    let dIn = sdf_round_box(q, B.inner, B.innerR);
    var col: vec3f;
    if (dIn > 0.0) {
      // THE FRAME — a rounded bar: across the band the rims roll away, outward at the edge,
      // inward at the lip; brushed along its length; glinting where it turns to the lamp.
      let t = clamp(dIn / max(dIn - dOut, 1.0e-4), 0.0, 1.0);
      let e = 2.0 * t - 1.0;
      // a half-round bar: the normal turns steadily across it, steepest at the rims
      let theta = k.lip.w * sign(e) * pow(abs(e), 0.85);
      let g = bd_grad(q, B.half, B.radius);
      let n = normalize(vec3f(g * sin(theta), cos(theta)));
      let along = dot(q, vec2f(-g.y, g.x));
      let across = dot(q, g);
      let brushed = (felt_noise(vec2f(along * 0.045, across * 2.2)) + 0.5 * felt_noise(vec2f(along * 0.13 + 7.0, across * 6.1))) * k.lip.z;
      var albedo = B.metal.rgb + vec3f(brushed);
      albedo = albedo * pow(bd_lambert(n, L, k), 1.0 / 2.2);
      let gobo = sample_gobo(u, gobo_tex, gobo_samp, bd_desk_at(u, p, top), bn.z);
      col = bd_colour(u, clamp(albedo, vec3f(0.0), vec3f(1.0)), gobo, bn.y, k.light.z);
      // the metal: a tight glint where the bar turns the lamp to the eye, and a broad sheen round it
      let lit = bd_lit(u, k) * mix(0.2, 1.0, gobo);
      col += vec3f((bd_glint(n, L, 90.0) + 0.6 * bd_glint(n, L, 14.0)) * k.glint.x * lit);
      // metal mirrors the sky: a face turned up and out catches it — the bar's shaded half is never dead
      col += vec3f(0.06 * smoothstep(0.2, 1.0, n.z) * bd_lit(u, k));
    } else {
      // THE MELAMINE — the raster over it: uv across the face, the ink's mip by the screen's density.
      let uv = (q + B.inner) / (2.0 * B.inner);
      let lod = max(log2(max(B.density * px / max(B.scale, 1.0e-3), 1.0e-6)), 0.0);
      var ink = textureSampleLevel(ink_tex, ink_samp, uv, lod);
      if (B.laying > 0.5) {
        // the stroke being laid, shown as it will land
        let sc = textureSampleLevel(stroke_tex, lin_samp, uv, 0.0).r;
        if (B.tool.w < 0.5) { ink = vec4f(ink.rgb * (1.0 - sc) + B.tool.rgb * sc, ink.a * (1.0 - sc) + sc); }
        else { ink = ink * (1.0 - sc); }
      }
      let cov2 = ink.a;
      var wet = 0.0;
      if (B.wet > 0.5) { wet = textureSampleLevel(wet_tex, lin_samp, uv, 0.0).r * smoothstep(0.0, 0.3, cov2); }

      // the face's normal: a slow waviness, and the ink film standing a few microns proud of it
      let dt = exp2(lod) / B.texels;
      let ax = textureSampleLevel(ink_tex, ink_samp, uv + vec2f(dt.x, 0.0), lod).a - textureSampleLevel(ink_tex, ink_samp, uv - vec2f(dt.x, 0.0), lod).a;
      let ay = textureSampleLevel(ink_tex, ink_samp, uv + vec2f(0.0, dt.y), lod).a - textureSampleLevel(ink_tex, ink_samp, uv - vec2f(0.0, dt.y), lod).a;
      let w1 = felt_noised(q * (1.0 / 80.0) + vec2f(3.1, 7.7)).yz;
      let w2 = felt_noised(q * (1.0 / 31.0) + vec2f(11.0, 5.0)).yz;
      let slope = (w1 + 0.5 * w2) * 0.006 + vec2f(ax, ay) * k.mel.w;
      let n = normalize(vec3f(-slope, 1.0));

      // the albedo: the melamine's tone and grain, the ghost of old erasures, the ink as a filter (linear) over it
      let tone = felt_noise(q * (1.0 / 140.0) + vec2f(20.0, 4.0)) * k.mel.x;
      let grain = (bn.x - 0.5) * k.mel.y;
      let ghost = smoothstep(0.1, 0.45, felt_fbm(q * (1.0 / 21.0) + vec2f(40.0, 3.0))) * k.mel.z;
      let base = (B.surface.rgb * (1.0 + tone) + vec3f(grain)) * (1.0 - ghost);
      let filt = vec3f(1.0 - cov2) + ink.rgb * mix(1.0, k.sheen.w, wet);
      var albedo = bd_encode(srgb_to_linear(clamp(base, vec3f(0.0), vec3f(1.0))) * filt);

      // the light on it: the lamp over the ink's relief, the frame's lip on the lamp's side, the corner's occlusion
      let dl = sdf_round_box(q - S * B.recess, B.inner, B.innerR);
      let lip = bd_blur(-dl, k.lip.y) * k.lip.x;
      let ao = 1.0 - 0.07 * (1.0 - smoothstep(0.0, 3.0, -dIn));
      albedo = albedo * pow(bd_lambert(n, L, k) * (1.0 - lip) * ao, 1.0 / 2.2);
      let gobo = sample_gobo(u, gobo_tex, gobo_samp, bd_desk_at(u, p, face), bn.z);
      col = bd_colour(u, clamp(albedo, vec3f(0.0), vec3f(1.0)), gobo, bn.y, k.light.z);

      // the window in the glossy face — stronger on wet ink; it shows most where the face is darkest
      // (in the leaves' shade, on the ink), as a reflection does
      let sheen = bd_sheen(B, k, p, n) * k.sheen.x * (1.0 + 1.5 * wet) * bd_lit(u, k);
      col = col + vec3f(sheen) * (vec3f(1.0) - col * 0.55);
    }
    acc = bd_over(vec4f(col * cov, cov), acc);
  }

  // THE PEN — one marker in whatever pose the host gives it: lying capped on the melamine, in the
  // hand at the pointer with its cap posted, or on its way between (BOARD.md §5). Its shadow first
  // — the axis point at u stands h0 + u·rise over the melamine and casts along the lamp's slope,
  // softened by that height; a lying pen has its contact line — then the pen itself.
  if (B.pen.w > 0.001) {
    let a = vec2f(cos(B.pen.z), sin(B.pen.z));
    let perp = vec2f(-a.y, a.x);
    let tip = B.pen.xy;
    let h0 = B.penPose.x;
    let rise = B.penPose.y;
    let cap = B.penPose.z;
    let nib = B.penPose.w;
    let pres = B.pen.w;
    if (distance(p, tip) < k.pen.x * 1.3 + 90.0) {
      let D = a + S * rise;
      let A0 = tip + S * h0;
      let c0 = mix(-2.0, k.pen.x - k.pen.z * 0.55, cap);
      let tt = clamp(dot(p - A0, D) / max(dot(D, D), 1.0e-6), min(0.0, c0), max(k.pen.x, c0 + k.pen.z));
      let hs = h0 + tt * rise;
      let rs = p - (A0 + D * tt);
      let msd = bd_pen_soft(vec2f(tt, length(rs)), cap, nib, k);
      let shade = bd_blur(msd, k.shadow.x + k.shadow.y * HAND_PENUMBRA * hs) * k.shadow.z * HAND_UMBRA;
      let rc = p - tip;
      let mc = vec2f(dot(rc, a), dot(rc, perp));
      // lying, it touches the melamine along a line: the contact shadow, gone as it lifts
      let lying = exp(-max(h0 - k.pen.y, 0.0) / 2.5) * (1.0 - smoothstep(0.0, 0.05, rise));
      let contact = bd_blur(bd_pen_soft(mc, cap, nib, k) + k.pen.y * 0.45, k.shadow2.x * 1.4) * 0.42 * lying;
      let msh = min(max(shade, contact), 1.0) * pres;
      acc = bd_over(vec4f(shadowInk * msh, msh), acc);
      let sd = bd_pen(mc, cap, nib, k);
      let mcov = bd_cov(sd.x, px) * pres;
      if (mcov > 0.0) {
        let gobo = sample_gobo(u, gobo_tex, gobo_samp, bd_desk_at(u, p, face + h0 + max(mc.x, 0.0) * rise + k.pen.y), bn.z);
        let c = bd_marker_colour(u, k, sd, mc.y, a, perp, B.penInk.rgb, L, gobo, bn.y);
        acc = bd_over(vec4f(c * mcov, mcov), acc);
      }
    }
  }

  // THE ERASER in the hand: a felt block with a wooden back, square to its angle.
  if (B.eraser.w > 0.001 && distance(p, B.eraser.xy) < 120.0) {
    let ang = k.block2.x;
    let a = vec2f(cos(ang), sin(ang));
    let perp = vec2f(-a.y, a.x);
    let rc = p - B.eraser.xy;
    let qe = vec2f(dot(rc, a), dot(rc, perp));
    let half = k.block.xy;
    let gap = B.eraser.z;
    let hTop = gap + k.block.z + k.block.w;
    let pres = B.eraser.w;
    let sh = min(bd_slab(qe, half, 3.0, gap, hTop, vec2f(dot(S, a), dot(S, perp)), k, HAND_PENUMBRA, 14) * HAND_UMBRA, 1.0) * pres;   // the slope, in the block's frame
    acc = bd_over(vec4f(shadowInk * sh, sh), acc);
    let dFelt = sdf_round_box(qe, half, 3.0);
    let fcov = bd_cov(dFelt, px) * pres;
    if (fcov > 0.0) {
      let dWood = sdf_round_box(qe, half - vec2f(1.5), 2.4);
      let gw = bd_grad(qe, half - vec2f(1.5), 2.4);
      let bevel = 1.0 - smoothstep(0.0, 2.2, -dWood);
      let gw3 = vec2f(gw.x * a.x - gw.y * a.y, gw.x * a.y + gw.y * a.x);   // back to world axes
      let n = normalize(vec3f(gw3 * sin(bevel * 0.9), cos(bevel * 0.9)));
      let grain = felt_noise(vec2f(qe.x * 0.06, qe.y * 1.3)) * 0.05 + felt_noise(vec2f(qe.x * 0.21, qe.y * 3.7)) * 0.025;
      var albedo = k.felt.rgb;
      if (dWood < 0.0) {
        // the wooden back, its grain along the block, a finger groove routed round its top
        let groove = 1.0 - smoothstep(0.25, 0.9, abs(sdf_round_box(qe, half - vec2f(6.5, 3.4), 1.8)));
        albedo = (k.wood.rgb + vec3f(grain)) * pow(bd_lambert(n, L, k), 1.0 / 2.2) * (1.0 - 0.2 * groove);
      }
      let gobo = sample_gobo(u, gobo_tex, gobo_samp, bd_desk_at(u, p, face + hTop), bn.z);
      let c = bd_colour(u, clamp(albedo, vec3f(0.0), vec3f(1.0)), gobo, bn.y, k.light.z);
      acc = bd_over(vec4f(c * fcov, fcov), acc);
    }
  }

  // The sole-selection ring, inside the outer edge, in the theme's select.
  let ring = bd_line(dOut, k.shadow2.z * css, px) * B.ring;
  acc = bd_over(vec4f(k.select.rgb * ring, ring), acc);
  return acc * B.alpha;
}
