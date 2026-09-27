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

fn peg_hash(x: u32, y: u32, seed: u32) -> f32 {
  return f32(peg_pcg(x ^ peg_pcg(y + seed))) * 2.3283064365386963e-10;
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

// ⌊a / b⌋ for b > 0 (WGSL's `/` truncates toward zero).
fn peg_floor_div(a: i32, b: i32) -> i32 {
  let q = a / b;
  return select(q, q - 1, (a % b != 0) && (a < 0));
}

// ---- value noise on the board (the research's noise2, its quintic fade): the value and its gradient in lattice units
fn peg_vnoise(x: u32, y: u32, f: vec2f, seed: u32) -> vec3f {
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = peg_hash(x, y, seed);
  let b = peg_hash(x + 1u, y, seed);
  let c = peg_hash(x, y + 1u, seed);
  let d = peg_hash(x + 1u, y + 1u, seed);
  let v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  return vec3f(v, du.x * mix(b - a, d - c, u.y), du.y * mix(c - a, d - b, u.x));
}

// One band at (fx, fy) cells per pitch (integers): its lattice row is R·fy plus the cells within the row, in wrapping u32 — seamless
// and exact at any R. The value, and its gradient in pitches.
fn peg_band(p: PegPoint, fx: u32, fy: u32, seed: u32) -> vec3f {
  let X = p.x * f32(fx);
  let ix = floor(X);
  let Y = p.fy * f32(fy);
  let iy = floor(Y);
  let n = peg_vnoise(u32(i32(ix)), u32(p.R) * fy + u32(i32(iy)), vec2f(X - ix, Y - iy), seed);
  return vec3f(n.x, n.y * f32(fx), n.z * f32(fy));
}

// A band WIDER than a pitch — one cell per `d` pitches (the tone drift's): the row carried by floor division.
fn peg_band_wide(p: PegPoint, d: i32, seed: u32) -> f32 {
  let X = p.x / f32(d);
  let ix = floor(X);
  let q = peg_floor_div(p.R, d);
  let Y = (f32(p.R - q * d) + p.fy) / f32(d);
  return peg_vnoise(u32(i32(ix)), u32(q), vec2f(X - ix, Y), seed).x;
}

// The research's "fine detail fading with pixel footprint", per band: F cycles per pitch are kept while a cycle spans ≥ 4 device
// px and gone at 2 (`fp` = pitches per device px), so a scrolling board never shimmers.
fn peg_keep(fp: f32, F: f32) -> f32 { return 1.0 - smoothstep(0.25, 0.5, fp * F); }

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
// The tempered face: the tone drift (`big` at ½ · 1 · 2 per pitch, `mid` at 5 · 10 · 20 — the research's fbm), the fine height grain
// and its bump, the fibre flecks — every band faded by its own footprint. Out: the albedo, and the height's gradient (the bump).
struct PegFace { alb: vec3f, grad: vec2f }
fn peg_face(t: TrayUniforms, p: PegPoint, fp: f32) -> PegFace {
  let big = (0.5 * (peg_band_wide(p, 2, 0x3a1u) - 0.5) + 0.25 * (peg_band(p, 1u, 1u, 0x5c7u).x - 0.5) + 0.125 * (peg_band(p, 2u, 2u, 0x9e3u).x - 0.5)) / 0.875;
  var mid = 0.0;
  let k5 = peg_keep(fp, 5.0);
  let k10 = peg_keep(fp, 10.0);
  let k20 = peg_keep(fp, 20.0);
  if (k5 > 0.0) { mid += 0.5 * k5 * (peg_band(p, 5u, 5u, 0x2b1u).x - 0.5); }
  if (k10 > 0.0) { mid += 0.25 * k10 * (peg_band(p, 10u, 10u, 0x6d3u).x - 0.5); }
  if (k20 > 0.0) { mid += 0.125 * k20 * (peg_band(p, 20u, 20u, 0x8f5u).x - 0.5); }
  mid = mid / 0.875;
  // the fine height (the research's faceHeight: 0.55 · 85, 0.30 · 190×70, 0.15 · 60×210) — at a UI pitch its footprint fades it
  var h = 0.0;
  var grad = vec2f(0.0);
  let k85 = peg_keep(fp, 85.0);
  let k190 = peg_keep(fp, 190.0);
  let k210 = peg_keep(fp, 210.0);
  if (k85 > 0.0) { let n = peg_band(p, 85u, 85u, 0x1f3u); h += 0.55 * k85 * (n.x - 0.5); grad += 0.55 * k85 * n.yz; }
  if (k190 > 0.0) { let n = peg_band(p, 190u, 70u, 0x4a7u); h += 0.30 * k190 * (n.x - 0.5); grad += 0.30 * k190 * n.yz; }
  if (k210 > 0.0) { let n = peg_band(p, 60u, 210u, 0x7c9u); h += 0.15 * k210 * (n.x - 0.5); grad += 0.15 * k210 * n.yz; }
  var alb = t.face.xyz * (1.0 + 0.18 * big + 0.12 * mid + 0.40 * h);
  let k42 = peg_keep(fp, 42.0);
  let k105 = peg_keep(fp, 105.0);
  var fl = 0.0;
  if (k42 > 0.0) { fl += 0.30 * k42 * peg_flecks(p, 42u, 0.40, 0xa13u); }
  if (k105 > 0.0) { fl += 0.18 * k105 * peg_flecks(p, 105u, 0.35, 0xc35u); }
  alb = alb * (1.0 + fl);
  var f: PegFace;
  f.alb = alb;
  f.grad = grad;
  return f;
}

// The paler, fuzzier punched fibre (the research's edge): its clumps at 9 · 18 · 36 per pitch, faded by the footprint.
fn peg_edge(t: TrayUniforms, p: PegPoint, fp: f32) -> vec3f {
  var clump = 0.0;
  let k9 = peg_keep(fp, 9.0);
  let k18 = peg_keep(fp, 18.0);
  let k36 = peg_keep(fp, 36.0);
  if (k9 > 0.0) { clump += 0.5 * k9 * (peg_band(p, 9u, 9u, 0x3e5u).x - 0.5); }
  if (k18 > 0.0) { clump += 0.25 * k18 * (peg_band(p, 18u, 18u, 0x5a9u).x - 0.5); }
  if (k36 > 0.0) { clump += 0.125 * k36 * (peg_band(p, 36u, 36u, 0x7bdu).x - 0.5); }
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
fn peg_surface(u: MatUniforms, t: TrayUniforms, p: PegPoint, h: PegHole, fp: f32, noise: f32) -> vec3f {
  let k = t.hole.z;
  let face = peg_face(t, p, fp);
  var n = normalize(vec3f(-face.grad * 0.003, 1.0));   // the research's bump: 0.0030 per unit of the height's slope
  if (h.d < k) {
    let s = sqrt(max(h.d, 0.0) / k);
    n = normalize(vec3f((s - 1.0) * h.g, s));
  }
  let faceness = smoothstep(0.35, 0.75, n.z);
  var alb = face.alb;
  if (faceness < 1.0) { alb = mix(peg_edge(t, p, fp) * 0.86, alb, faceness); }   // the punched rim, burnished at the front
  return tray_lit(u, t, alb, n, 1.0, noise);
}

// The wall seen through a hole. THE TWO PLANES (§6.4): the ray from the wall toward the lamp crosses the back face at A and the front
// face at B; the wall is lit iff both lie in the SAME hole — B's, with A tested against it (a convex prism holds the segment iff it
// holds both ends) — the penumbra from the SDF distance, widened by the lamp's size over each plane's depth. The room's light reaches
// the wall through the hole, cut by the cavity: darker toward the hole's edges.
fn peg_wall(u: MatUniforms, t: TrayUniforms, p: PegPoint, h: PegHole, fp: f32, noise: f32) -> vec3f {
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
  let plaster = 1.0 + 0.10 * (peg_band(p, 2u, 2u, 0xe17u).x - 0.5);
  return tray_lit(u, t, t.wall.xyz * (s * plaster), vec3f(0.0, 0.0, 1.0), vis, noise);
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

// The drawer's outline (CSS px, negative inside): a box whose top corners round and whose bottom lies past the view, less the finger
// notch scooped from the top edge at the centre (a half-ellipse, the usual two-length estimate of its distance; its join smoothed).
fn tray_outline(t: TrayUniforms, p: vec2f) -> f32 {
  let r = t.shape.x;
  let ext = vec2f(0.5 * t.rect.z, 0.5 * t.rect.w + r);
  let c = vec2f(t.rect.x + ext.x, t.rect.y + ext.y);
  let body = sdf_round_box(p - c, ext, r);
  let nr = vec2f(t.shape.z, t.shape.w);
  let q = p - vec2f(c.x, t.rect.y);
  let k0 = length(q / nr);
  let k1 = length(q / (nr * nr));
  return peg_smax(body, -(k0 * (k0 - 1.0) / max(k1, 1.0e-6)), t.room.z);
}

// The rim — the board's cut edge, the paler fibre — within `rim` px of the outline: a bevel facing out of the drawer and toward the
// eye, lit on the lamp's side and in the room's shadow on the far one. Its fibre is the drawer's own (it never scrolls).
fn tray_rim(u: MatUniforms, t: TrayUniforms, p: vec2f, noise: f32) -> vec3f {
  let e = 0.5;
  let gx = tray_outline(t, p + vec2f(e, 0.0)) - tray_outline(t, p - vec2f(e, 0.0));
  let gy = tray_outline(t, p + vec2f(0.0, e)) - tray_outline(t, p - vec2f(0.0, e));
  let g = vec2f(gx, gy) / max(length(vec2f(gx, gy)), 1.0e-6);
  let n = normalize(vec3f(g * 0.8, 0.6));
  let yl = (p.y - t.rect.y) / t.view.w;
  let fl = floor(yl);
  let pt = PegPoint((p.x - t.rect.x) / t.view.w, i32(fl), yl - fl);
  return tray_lit(u, t, peg_edge(t, pt, t.fp), n, 1.0, noise);
}

// The board inside the rim: the point under the carry — the rows on screen added to the carried rows in i32 — its hole, the front
// surface over the hole by its analytic coverage.
fn tray_board(u: MatUniforms, t: TrayUniforms, p: vec2f, noise: f32) -> vec3f {
  let ly = (p.y - t.rect.y) / t.view.w + t.frac;
  let fl = floor(ly);
  let pt = PegPoint((p.x - t.rect.x) / t.view.w, t.rowBase + i32(fl), ly - fl);
  let h = peg_hole(t, pt);
  let c = clamp(0.5 + h.d / t.fp, 0.0, 1.0);
  var col = vec3f(0.0);
  if (c > 0.0) { col = peg_surface(u, t, pt, h, t.fp, noise); }
  if (c < 1.0) { col = mix(peg_wall(u, t, pt, h, t.fp, noise), col, c); }
  return col;
}

// One pixel of the drawer's quad (`frag` in device px): the shadow on the desk, the rim, the board — premultiplied.
fn tray_drawer(u: MatUniforms, t: TrayUniforms, frag: vec2f, noise_tex: texture_2d<f32>, noise_samp: sampler) -> vec4f {
  let dpr = t.view.z;
  let p = frag / dpr;
  let px = 1.0 / dpr;
  let o = tray_outline(t, p);
  let cover = clamp(0.5 - o / px, 0.0, 1.0);
  // the shadows on the desk: the room's round the outline, the lamp's pushed along its ground direction — one over the other
  let room = t.room.y * tray_blur(o, t.room.x);
  let lamp = t.shadow.y * tray_blur(tray_outline(t, p - t.shadow.zw), t.shadow.x);
  let under = vec4f(0.0, 0.0, 0.0, 1.0 - (1.0 - room) * (1.0 - lamp));
  if (cover <= 0.0) { return under; }
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  let rim = clamp(0.5 + (o + t.shape.y) / px, 0.0, 1.0);
  var col = vec3f(0.0);
  if (rim < 1.0) { col = tray_board(u, t, p, bn.y); }
  if (rim > 0.0) { col = mix(col, tray_rim(u, t, p, bn.y), rim); }
  col = clamp(col + (bn.x - 0.5) / 255.0, vec3f(0.0), vec3f(1.0));   // the photo's dither: the tone drift never bands
  return vec4f(col * cover, cover) + under * (1.0 - cover);
}
