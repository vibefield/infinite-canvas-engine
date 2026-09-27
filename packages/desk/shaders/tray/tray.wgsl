// THE PEGBOARD TRAY (design-017 §5–§6) — the drawer, and the research board in it (research/sdf-pegboard, shader.js), shaded in
// CLOSED FORM for a head-on view: no march, no history, no jitter — every frame is final, so a scrolling drawer is clean on every
// frame. A PURE module: the uniform blocks arrive as parameters — `u` the mat's struct carrying the DESK's light (the colour law is
// mat.wgsl's own), `t` the tray's (src/tray/pass.ts) — and so does the blue noise.
//
// Board units are PITCHES (the research's 1). A board point is x from the drawer's left edge and Y down the board, Y split into a
// whole row R (i32: the scroll's whole rows carried on the CPU plus the rows on screen) and fy ∈ [0,1): nothing large ever enters
// an f32, so the pattern is exact at any scroll (src/tray/lattice.ts is this arithmetic on the CPU, rounding half up as here).

// ---- hashing: the research's pcg, on integer lattice points only (wrapping u32)
fn peg_pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// Four independent uniforms for a lattice cell (the research's hash2i4).
fn peg_hash4(x: u32, y: u32, seed: u32) -> vec4f {
  let h0 = peg_pcg(x ^ peg_pcg(y + seed));
  let h1 = peg_pcg(h0);
  let h2 = peg_pcg(h1);
  let h3 = peg_pcg(h2);
  return vec4f(f32(h0), f32(h1), f32(h2), f32(h3)) * 2.3283064365386963e-10;
}

// ---- the board point
struct PegPoint { x: f32, R: i32, fy: f32 }

// The same point moved by `d` pitches — the move's rows re-carried into R, so R stays exact.
fn peg_move(p: PegPoint, d: vec2f) -> PegPoint {
  let y = p.fy + d.y;
  let fl = floor(y);
  return PegPoint(p.x + d.x, p.R + i32(fl), y - fl);
}

// ---- value noise on the board (the research's noise2, its quintic fade): the value and its gradient in lattice units. The corners'
// hashes come PRE-GATHERED (src/tray/pass.ts `hashTexels`: texel (i, j) holds the research's pcg hash of lattice points (i, j),
// (i+1, j), (i, j+1), (i+1, j+1), 8 bits each, tiled every 256 cells) — one load where the pcg took eight rounds. Each band reads
// it at its own offset (its seed); the lattice point is an integer, so the noise stays exact at any row.
fn peg_vnoise(ht: texture_2d<f32>, x: u32, y: u32, f: vec2f, seed: u32) -> vec3f {
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let k = textureLoad(ht, vec2u((x + seed) & 255u, (y + ((seed * 2654435761u) >> 24u)) & 255u), 0);
  let a = k.r;
  let b = k.g;
  let c = k.b;
  let d = k.a;
  let v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  return vec3f(v, du.x * mix(b - a, d - c, u.y), du.y * mix(c - a, d - b, u.x));
}

// One band at (fx, fy) cells per pitch (integers): its lattice row is R·fy plus the cells within the row, in wrapping u32 — seamless
// and exact at any R. The value, and its gradient in pitches.
fn peg_band(ht: texture_2d<f32>, p: PegPoint, fx: u32, fy: u32, seed: u32) -> vec3f {
  let X = p.x * f32(fx);
  let ix = floor(X);
  let Y = p.fy * f32(fy);
  let iy = floor(Y);
  let n = peg_vnoise(ht, u32(i32(ix)), u32(p.R) * fy + u32(i32(iy)), vec2f(X - ix, Y - iy), seed);
  return vec3f(n.x, n.y * f32(fx), n.z * f32(fy));
}

// The coarse TONE — the research's two coarsest octaves, ½ and 1 per pitch, pre-gathered TOGETHER at the 1-per-pitch lattice (the
// hash texture's lower half, pass.ts `hashTexels`): one load and the quintic, normalised to [0, 1]. The row is R itself.
fn peg_tone(ht: texture_2d<f32>, p: PegPoint) -> f32 {
  let ix = floor(p.x);
  let f = vec2f(p.x - ix, p.fy);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let k = textureLoad(ht, vec2u(u32(i32(ix)) & 255u, 256u + (u32(p.R) & 255u)), 0);
  return mix(mix(k.r, k.g, u.x), mix(k.b, k.a, u.x), u.y);
}

// The research's "fine detail fading with pixel footprint", per band: F cycles per pitch are kept while a cycle spans ≥ 4 device
// px and gone at 2, so a scrolling board never shimmers. The footprint is the frame's, so every band's share is a UNIFORM (pass.ts
// `keeps` — `1 − smoothstep(¼, ½, fp·F)`): the face's 5 · 10 · 85 · 190, then 210 · 42 · 105, the punched fibre's 9 · 18 · 36.

// Sparse fibre flecks (the research's `flecks`): one randomly turned ellipse per jittered cell at F per pitch, signed — dark
// negative, pale positive.
fn peg_flecks(p: PegPoint, F: u32, density: f32, seed: u32) -> f32 {
  let X = p.x * f32(F);
  let ix = floor(X);
  let Y = p.fy * f32(F);
  let iy = floor(Y);
  let cx = u32(i32(ix));
  let cy = u32(p.R) * F + u32(i32(iy));
  let q = vec2f(X - ix, Y - iy);
  var acc = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let r = peg_hash4(cx + u32(i), cy + u32(j), seed);
      if (r.w > density) { continue; }
      let d = q - (vec2f(f32(i), f32(j)) + r.xy);
      let ang = r.z * 3.14159265;
      let ca = cos(ang);
      let sa = sin(ang);
      let dl = vec2f(d.x * ca + d.y * sa, -d.x * sa + d.y * ca);
      let e = length(vec2f(dl.x / (0.35 + 0.65 * r.x), dl.y / (0.10 + 0.10 * r.y)));
      acc += (1.0 - smoothstep(0.6, 1.0, e)) * select(-1.0, 0.8, r.z > 0.62);
    }
  }
  return clamp(acc, -1.0, 1.0);
}

// ---- the lattice (the research's cellCoord · sdStadiumV)
struct PegHole { q: vec2f, d: f32, g: vec2f }

// The vertical stadium at an offset from its centre: the distance (negative inside) and its gradient, pointing out of the hole.
fn peg_stadium(t: TrayUniforms, q: vec2f) -> vec3f {
  let e = vec2f(q.x, q.y - clamp(q.y, -t.hole.y, t.hole.y));
  let len = max(length(e), 1.0e-6);
  return vec3f(len - t.hole.x, e / len);
}

// The hole of the nearest row (a hole's half-height, 0.33, is under half a pitch): rows at Y = r + ¾, odd rows shifted ½ — the
// stagger's parity from the exact row index. A hole whose centre lies within the solid border of a side is never punched.
fn peg_hole(t: TrayUniforms, p: PegPoint) -> PegHole {
  let dr = floor(p.fy - t.depth.w + 0.5);
  let row = p.R + i32(dr);
  let shift = t.depth.z + select(0.0, 0.5, (row & 1) != 0);
  let hx = p.x - shift;
  let col = floor(hx + 0.5);
  var h: PegHole;
  h.q = vec2f(hx - col, p.fy - dr - t.depth.w);
  let s = peg_stadium(t, h.q);
  h.d = s.x;
  h.g = s.yz;
  let cx = col + shift;
  if ((cx < t.hole.w) || (cx > t.rect.z / t.view.w - t.hole.w)) { h.d = 1.0e3; }
  return h;
}

// ---- the materials (the research's boardMat · wallMat), linear albedo
// The tempered face: the tone drift (`big` at ½ · 1 per pitch, pre-gathered as one — `peg_tone` — and `mid` at 5: the research's fbm,
// less its three faintest octaves, which at a UI pitch carried ±4 % between them and half the face's cost), the fine height grain
// and its bump, the fibre flecks — every band faded by its own footprint. Out: the grain as one factor on the face's linear albedo
// (`g`: the albedo is face·(1 + g)), the height's gradient (the bump), and whether the face is FLAT here (every bump band faded).
struct PegFace { g: f32, grad: vec2f, flat: bool }
fn peg_face(ht: texture_2d<f32>, t: TrayUniforms, p: PegPoint, fp: f32) -> PegFace {
  let big = peg_tone(ht, p) - 0.5;
  var mid = 0.0;
  let k5 = t.keepFace.x;
  if (k5 > 0.0) { mid = k5 * (peg_band(ht, p, 5u, 5u, 0x2b1u).x - 0.5); }
  // the fine height (the research's faceHeight: 0.55 · 85, 0.30 · 190×70, 0.15 · 60×210) — at a UI pitch its footprint fades it
  var h = 0.0;
  var grad = vec2f(0.0);
  let k85 = t.keepFace.z;
  let k190 = t.keepFace.w;
  let k210 = t.keepFine.x;
  if (k85 > 0.0) { let n = peg_band(ht, p, 85u, 85u, 0x1f3u); h += 0.55 * k85 * (n.x - 0.5); grad += 0.55 * k85 * n.yz; }
  if (k190 > 0.0) { let n = peg_band(ht, p, 190u, 70u, 0x4a7u); h += 0.30 * k190 * (n.x - 0.5); grad += 0.30 * k190 * n.yz; }
  if (k210 > 0.0) { let n = peg_band(ht, p, 60u, 210u, 0x7c9u); h += 0.15 * k210 * (n.x - 0.5); grad += 0.15 * k210 * n.yz; }
  let k42 = t.keepFine.y;
  let k105 = t.keepFine.z;
  var fl = 0.0;
  if (k42 > 0.0) { fl += 0.30 * k42 * peg_flecks(p, 42u, 0.40, 0xa13u); }
  if (k105 > 0.0) { fl += 0.18 * k105 * peg_flecks(p, 105u, 0.35, 0xc35u); }
  var f: PegFace;
  f.g = (1.0 + 0.18 * big + 0.12 * mid + 0.40 * h) * (1.0 + fl) - 1.0;
  f.grad = grad;
  f.flat = (k85 <= 0.0) && (k190 <= 0.0) && (k210 <= 0.0);
  return f;
}

// The paler, fuzzier punched fibre (the research's edge): its clumps at 9 · 18 · 36 per pitch, faded by the footprint.
fn peg_edge(ht: texture_2d<f32>, t: TrayUniforms, p: PegPoint, fp: f32) -> vec3f {
  var clump = 0.0;
  let k9 = t.keepEdge.x;
  let k18 = t.keepEdge.y;
  let k36 = t.keepEdge.z;
  if (k9 > 0.0) { clump += 0.5 * k9 * (peg_band(ht, p, 9u, 9u, 0x3e5u).x - 0.5); }
  if (k18 > 0.0) { clump += 0.25 * k18 * (peg_band(ht, p, 18u, 18u, 0x5a9u).x - 0.5); }
  if (k36 > 0.0) { clump += 0.125 * k36 * (peg_band(ht, p, 36u, 36u, 0x7bdu).x - 0.5); }
  return t.edge.xyz * (1.0 + 0.30 * clump / 0.875);
}

// ---- the light: the desk's
// The desk's colour law on the tray (the paper's `paper_colour`, chain 0): by day the mat's grade on the sRGB albedo — lit (`gobo`
// 1) the identity, a configured byte is the drawn byte; in shadow the room's ½ and its touch of saturation — by night the Moon and
// the eye (mat.wgsl `night_mat`) on the linear albedo; between, the cross-fade.
fn tray_colour(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// A surface under the lamp, its linear albedo and normal → the colour on screen. The relief is the paper's — `(N·L/L_z)^(1/2.2)`, the
// flat face exactly 1 — and only brightens; a normal turned from the lamp takes the room's grade instead (`gobo` = the Lambert term),
// so a face turned away reads as a shadow does, never black. `vis`: the lamp seen at all. The glint is the photo's.
fn tray_lit(u: MatUniforms, t: TrayUniforms, alb: vec3f, n: vec3f, vis: f32, noise: f32) -> vec3f {
  let L = t.lamp.xyz;
  let lam = clamp(dot(n, L) / max(L.z, 1.0e-3), 0.0, 1.6);
  let srgb = clamp(night_encode(alb) * pow(max(lam, 1.0), 1.0 / 2.2), vec3f(0.0), vec3f(1.0));
  var c = tray_colour(u, srgb, min(lam, 1.0) * vis, noise);
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  let spec = pow(saturate(dot(n, H)), 48.0) * 0.08 * vis;
  let glint = mix(vec3f(1.0, 0.985, 0.95), vec3f(0.78, 0.86, 1.0) * 0.5, saturate(u.night.x));
  return c + glint * spec;
}

// ---- the board: the face and the rim fillet, and the wall through a hole
// The front surface at a board point: the face, or — within k of a hole — the fillet. On smax(slab, −hole, k) = 0 seen head-on the
// surface's blend weight is h = √(d/k) for d ∈ [0,k], and its normal normalize(((h − 1)·∇d, h)) sweeps from the hole's wall to the
// face: the rim's lit edge and its shadowed one, in the paler punched fibre where the normal is steep (the research's faceness).
fn peg_surface(ht: texture_2d<f32>, u: MatUniforms, t: TrayUniforms, p: PegPoint, h: PegHole, fp: f32, noise: f32) -> vec3f {
  let k = t.hole.z;
  let face = peg_face(ht, t, p, fp);
  // the PLAIN FACE — clear of every fillet, its bump faded: N·L is L_z exactly, the relief 1, the glint nothing; the grain's small
  // linear factor rides the configured byte to first order ((1 + g)^(1/2.4) ≈ 1 + g/2.4 — the byte itself where the grain is 0)
  if ((h.d >= k) && face.flat) {
    return tray_colour(u, clamp(t.faceSrgb.xyz * (1.0 + face.g / 2.4), vec3f(0.0), vec3f(1.0)), 1.0, noise);
  }
  var n = normalize(vec3f(-face.grad * 0.003, 1.0));   // the research's bump: 0.0030 per unit of the height's slope
  if (h.d < k) {
    let s = sqrt(max(h.d, 0.0) / k);
    n = normalize(vec3f((s - 1.0) * h.g, s));
  }
  let faceness = smoothstep(0.35, 0.75, n.z);
  var alb = t.face.xyz * (1.0 + face.g);
  if (faceness < 1.0) { alb = mix(peg_edge(ht, t, p, fp) * 0.86, alb, faceness); }   // the punched rim, burnished at the front
  return tray_lit(u, t, alb, n, 1.0, noise);
}

// The wall seen through a hole. THE TWO PLANES (§6.4): the ray from the wall toward the lamp crosses the back face at A and the front
// face at B; the wall is lit iff both lie in the SAME hole — B's, with A tested against it (a convex prism holds the segment iff it
// holds both ends) — the penumbra from the SDF distance, widened by the lamp's size over each plane's depth. The room's light reaches
// the wall through the hole, cut by the cavity: darker toward the hole's edges.
fn peg_wall(ht: texture_2d<f32>, u: MatUniforms, t: TrayUniforms, p: PegPoint, h: PegHole, fp: f32, noise: f32) -> vec3f {
  let L = t.lamp.xyz;
  let off = L.xy / max(L.z, 1.0e-3);
  let thick = t.depth.x;
  let gap = t.depth.y;
  let hb = peg_hole(t, peg_move(p, off * (gap + thick)));
  let da = peg_stadium(t, hb.q - off * thick).x;
  let wa = t.lamp.w * gap + fp;
  let wb = t.lamp.w * (gap + thick) + fp;
  let vis = smoothstep(-wb, wb, -hb.d) * smoothstep(-wa, wa, -da);
  let cav = mix(t.cavity.x, t.cavity.y, smoothstep(0.0, t.cavity.z, -h.d));
  // the room's share in the mat's shadow (shade_mat at gobo 0): the wall takes a·cav of the room and (1 − a)·vis of the lamp
  let a = 1.0 - u.gobo.z * (1.0 - u.gobo.w);
  let s = (a * cav + (1.0 - a) * vis) / (a + (1.0 - a) * vis);
  let plaster = 1.0 + 0.10 * (peg_band(ht, p, 2u, 2u, 0xe17u).x - 0.5);
  // the wall faces the eye: its relief is exactly 1 and the lamp's glint on it nothing — the colour law alone, on its byte
  return tray_colour(u, clamp(night_encode(t.wall.xyz * (s * plaster)), vec3f(0.0), vec3f(1.0)), vis, noise);
}

// ---- the drawer
fn tray_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let k = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * exp(-a * a);
  return s * y;
}

// Gaussian-blurred coverage of an outline at distance d (the shadow, straight out of the field — the paper's).
fn tray_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * tray_erf(d / max(sigma * 1.4142136, 1.0e-4)); }

// The research's smooth max (its rim fillet's), here the notch's join with the top edge.
fn peg_smax(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

// The drawer's body (CSS px, negative inside): a box whose top corners round and whose bottom lies past the view — what casts the shadows.
fn tray_body(t: TrayUniforms, p: vec2f) -> f32 {
  let r = t.shape.x;
  let ext = vec2f(0.5 * t.rect.z, 0.5 * t.rect.w + r);
  return sdf_round_box(p - vec2f(t.rect.x + ext.x, t.rect.y + ext.y), ext, r);
}

// The drawer's outline: its body less the finger notch scooped from the top edge at the centre (a half-ellipse, the usual two-length
// estimate of its distance; its join smoothed).
fn tray_outline(t: TrayUniforms, p: vec2f) -> f32 {
  let body = tray_body(t, p);
  let nr = vec2f(t.shape.z, t.shape.w);
  let q = p - vec2f(t.rect.x + 0.5 * t.rect.z, t.rect.y);
  let k0 = length(q / nr);
  let k1 = length(q / (nr * nr));
  return peg_smax(body, -(k0 * (k0 - 1.0) / max(k1, 1.0e-6)), t.room.z);
}

// The rim — the board's cut edge, the paler fibre — within `rim` px of the outline: a bevel facing out of the drawer and toward the
// eye, lit on the lamp's side and in the room's shadow on the far one. Its fibre is the drawer's own (it never scrolls).
fn tray_rim(ht: texture_2d<f32>, u: MatUniforms, t: TrayUniforms, p: vec2f, noise: f32) -> vec3f {
  let e = 0.5;
  let gx = tray_outline(t, p + vec2f(e, 0.0)) - tray_outline(t, p - vec2f(e, 0.0));
  let gy = tray_outline(t, p + vec2f(0.0, e)) - tray_outline(t, p - vec2f(0.0, e));
  let g = vec2f(gx, gy) / max(length(vec2f(gx, gy)), 1.0e-6);
  let n = normalize(vec3f(g * 0.8, 0.6));
  let yl = (p.y - t.rect.y) / t.view.w;
  let fl = floor(yl);
  let pt = PegPoint((p.x - t.rect.x) / t.view.w, i32(fl), yl - fl);
  return tray_lit(u, t, peg_edge(ht, t, pt, t.fp), n, 1.0, noise);
}

// The board inside the rim: the point under the carry — the rows on screen added to the carried rows in i32 — its hole, the front
// surface over the hole by its analytic coverage.
fn tray_board(ht: texture_2d<f32>, u: MatUniforms, t: TrayUniforms, p: vec2f, noise: f32) -> vec3f {
  let ly = (p.y - t.rect.y) / t.view.w + t.frac;
  let fl = floor(ly);
  let pt = PegPoint((p.x - t.rect.x) / t.view.w, t.rowBase + i32(fl), ly - fl);
  let h = peg_hole(t, pt);
  let c = clamp(0.5 + h.d / t.fp, 0.0, 1.0);
  var col = vec3f(0.0);
  if (c > 0.0) { col = peg_surface(ht, u, t, pt, h, t.fp, noise); }
  if (c < 1.0) { col = mix(peg_wall(ht, u, t, pt, h, t.fp, noise), col, c); }
  return col;
}

// One pixel of the tray (`frag` in device px), the view whole: the dim over the desk, the drawer's shadows on it, the rim, the board —
// premultiplied; each pixel drawn once.
fn tray_drawer(u: MatUniforms, t: TrayUniforms, frag: vec2f, noise_tex: texture_2d<f32>, noise_samp: sampler, ht: texture_2d<f32>) -> vec4f {
  let dpr = t.view.z;
  let p = frag / dpr;
  let px = 1.0 / dpr;
  let dim = vec4f(0.0, 0.0, 0.0, t.dim);
  // beyond the shadows' reach: the dim alone
  let reach = 3.0 * max(t.shadow.x, t.room.x) + length(t.shadow.zw);
  if ((p.x < t.rect.x - reach) || (p.x > t.rect.x + t.rect.z + reach) || (p.y < t.rect.y - reach)) { return dim; }
  // the blue noise is the NIGHT's (the rods' snow, mat.wgsl `night_mat`): by day the board takes none — its own grain never bands,
  // and a scrolled board is then the same pixels, moved
  var bn = vec3f(0.5);
  if (u.night.x > 0.0) { bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb; }
  // DEEP INSIDE — clear of the rounded corners and the notch, the rim and two px more: covered, no rim, no shadow, no outline to evaluate
  let m = t.shape.y + 2.0;
  if ((p.x > t.rect.x + m) && (p.x < t.rect.x + t.rect.z - m) && (p.y > t.rect.y + max(t.shape.x, t.shape.w) + m)) {
    return vec4f(tray_board(ht, u, t, p, bn.y), 1.0);
  }
  let o = tray_outline(t, p);
  let cover = clamp(0.5 - o / px, 0.0, 1.0);
  // the shadows on the desk — the room's round the outline, the lamp's pushed along its ground direction, one over the other — where
  // the drawer does not cover them
  var under = dim;
  if (cover < 1.0) {
    let room = t.room.y * tray_blur(tray_body(t, p), t.room.x);
    let lamp = t.shadow.y * tray_blur(tray_body(t, p - t.shadow.zw), t.shadow.x);
    under = vec4f(0.0, 0.0, 0.0, 1.0 - (1.0 - room) * (1.0 - lamp) * (1.0 - t.dim));
  }
  if (cover <= 0.0) { return under; }
  let rim = clamp(0.5 + (o + t.shape.y) / px, 0.0, 1.0);
  var col = vec3f(0.0);
  if (rim < 1.0) { col = tray_board(ht, u, t, p, bn.y); }
  if (rim > 0.0) { col = mix(col, tray_rim(ht, u, t, p, bn.y), rim); }
  return vec4f(col * cover, cover) + under * (1.0 - cover);
}
