// The NOTEBOOK — a real 3D book under the desk's one lamp (NOTEBOOK.md). A PURE module: the
// uniform blocks, the book records and the textures arrive as parameters, and it names no
// colour (a book's palette is its record's). mat.wgsl comes first: its noise, its colour chain
// (`shade_mat` by day, `night_mat` by night) and its gobo (`sample_gobo`) are the desk's, so a
// page under the palm is dappled and graded exactly as the mat beside it.
//
// The pieces: the desk eye's projection (`nb_clip`, eye.ts is the same arithmetic); the
// shadow — PCSS on the book's own shadow map, whose penumbra grows with the gap between caster
// and receiver by the desk's law (σ = σ0 + k·height, the note's and the photo's); the
// materials — bookcloth with a weave and a sheen, the cover's printed design, the ivory page
// with its fibre, tooth, cockle and dots, the stacked edges of the sheets, the endpaper framed
// by the cloth's turn-in; and the light — a lambert normalised so a flat face reads its own
// albedo, the sky's share where the lamp is blocked, the leaves' dapple.

const NB_PI = 3.14159265;

fn nb_sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

// ---- the desk eye: a world point → clip space (x, y 2·zoom·(p − E)/viewport; w = (H − z)/H; a perspective depth)
fn nb_clip(k: NbUniforms, P: vec3f) -> vec4f {
  let H = k.eye.z;
  let d = H - P.z;
  let x = 2.0 * k.eye.w * (P.x - k.eye.x) / k.view.x;
  let y = -2.0 * k.eye.w * (P.y - k.eye.y) / k.view.y;
  let n = k.view.z;
  let f = k.view.w;
  let z = (d - n) * f / ((f - n) * H);
  return vec4f(x, y, z, d / H);
}

// A world point raised off the desk, in the projector's frame (mat.wgsl `desk_of` with a height).
fn nb_desk_at(u: MatUniforms, P: vec3f) -> vec3f {
  return vec3f(u.plane.x + P.x * u.plane.z, u.plane.w + P.z * u.plane.z, u.plane.y + P.y * u.plane.z);
}

// ---- noise in a face's own world units: an integer hash (no sin — a page fragment reads a dozen of these),
// value noise with its analytic gradient (so a bump costs one evaluation, not three)
fn nb_hash(p: vec2i) -> f32 {
  var h = (u32(p.x) * 668265261u) ^ (u32(p.y) * 374761393u);
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  h = h ^ (h >> 16u);
  return f32(h) * 2.3283064e-10;
}

// value (centred on 0), d/dx, d/dy
fn nb_vn(p: vec2f) -> vec3f {
  let fl = floor(p);
  let i = vec2i(fl);
  let f = p - fl;
  let w = f * f * (3.0 - 2.0 * f);
  let dw = 6.0 * f * (1.0 - f);
  let a = nb_hash(i);
  let b = nb_hash(i + vec2i(1, 0));
  let c = nb_hash(i + vec2i(0, 1));
  let d = nb_hash(i + vec2i(1, 1));
  let k = a - b - c + d;
  return vec3f(a + (b - a) * w.x + (c - a) * w.y + k * w.x * w.y - 0.5, dw.x * (b - a + k * w.y), dw.y * (c - a + k * w.x));
}

// three octaves, the gradient carried through
fn nb_fbm(p: vec2f) -> vec3f {
  let a = nb_vn(p);
  let b = nb_vn(p * 2.03 + vec2f(17.1, 3.7));
  let c = nb_vn(p * 4.11 + vec2f(-5.3, 11.9));
  return vec3f(a.x + b.x * 0.5 + c.x * 0.25, a.yz + b.yz * 1.015 + c.yz * 1.0275);
}

// A pattern's detail faded as its period falls under the pixel: 1 while `period` spans ≥ 3 px of `px` world, 0 under 1.
fn nb_detail(period: f32, px: f32) -> f32 { return smoothstep(1.2, 3.0, period / max(px, 1e-5)); }

// Coverage of a signed distance (negative inside) at a pixel of `px` world units.
fn nb_cov(d: f32, px: f32) -> f32 { return nb_sat(0.5 - d / max(px, 1e-5)); }

// A rounded box, centred, half extents `b`, radius `r`.
fn nb_sd_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// A face [0, w] × [0, h] whose corners at u = w are rounded by r (the spine side square): signed distance.
fn nb_sd_fore(q: vec2f, w: f32, h: f32, r: f32) -> f32 {
  // mirror the square side out of reach: extend the box past u = 0 by r
  let c = vec2f((w - r) * 0.5, h * 0.5);
  let b = vec2f((w + r) * 0.5, h * 0.5);
  return nb_sd_box(q - c, b, r);
}

// ---- the shadow: PCSS on the book's own map (the blocker's gap → the desk's penumbra law)
// The golden angle as a rotation: a Vogel spiral's next direction is this times the last.
const NB_GOLDEN = mat2x2f(-0.7373688, 0.6754903, -0.6754903, -0.7373688);

fn nb_shadow(k: NbUniforms, B: NbBook, P: vec3f, n: vec3f, rot: f32, tex: texture_depth_2d_array, cmp: sampler_comparison) -> f32 {
  if (B.sh.z < 0.5 || (u32(k.ring.y) & 1u) != 0u) { return 1.0; }
  let texel = B.sh.x;
  let res = k.shadow2.z;
  let layer = i32(B.lamp.w);
  let Po = P + n * texel * 1.5;
  let lc = B.light * vec4f(Po, 1.0);
  let uv = vec2f(lc.x * 0.5 + 0.5, 0.5 - lc.y * 0.5);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) { return 1.0; }
  // nothing was drawn at 1 (the clear): a receiver compares just inside it, so "no caster here" is lit wherever it lies
  let depth = min(lc.z, 0.99995);
  let bias = 0.35 / max(B.sh.y, 1.0);
  // the blocker search: as far as the widest penumbra this book can cast
  let widest = k.shadow.x + k.shadow.y * B.sh.w;
  let search = clamp(2.2 * widest / texel, 2.0, 72.0);
  var sum = 0.0;
  var cnt = 0.0;
  let base = uv * res;
  var dir = vec2f(cos(rot), sin(rot));
  for (var i = 0; i < 10; i++) {
    let o = dir * sqrt((f32(i) + 0.5) / 10.0) * search;
    dir = NB_GOLDEN * dir;
    let t = clamp(vec2i(base + o), vec2i(0), vec2i(i32(res) - 1));
    let d = textureLoad(tex, t, layer, 0);
    if (d < depth - bias) { sum += d; cnt += 1.0; }
  }
  if (cnt < 0.5) { return 1.0; }
  let gap = (depth - sum / cnt) * B.sh.y * B.lamp.z;   // the blocker's height over the receiver, world units
  let sigma = k.shadow.x + k.shadow.y * max(gap, 0.0);
  let r = clamp(sigma / texel * 1.7, 0.75, 72.0);
  var lit = 0.0;
  var wsum = 0.0;
  dir = vec2f(-dir.y, dir.x);
  let inv2s2 = 1.0 / (2.0 * (r / 1.7) * (r / 1.7) + 1e-4);
  for (var i = 0; i < 14; i++) {
    let o = dir * sqrt((f32(i) + 0.5) / 14.0) * r;
    dir = NB_GOLDEN * dir;
    let w = exp(-dot(o, o) * inv2s2);
    lit += w * textureSampleCompareLevel(tex, cmp, (base + o) / res, layer, depth - bias);
    wsum += w;
  }
  return lit / max(wsum, 1e-5);
}

// ---- the colour chain: the lamp's light on a face, then the desk's day or night
fn nb_colour(u: MatUniforms, albedo: vec3f, light: f32, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, clamp(albedo * pow(max(light, 0.0), 1.0 / 2.2), vec3f(0.0), vec3f(1.0)), gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(clamp(albedo, vec3f(0.0), vec3f(1.0))) * max(light, 0.0), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}

// ---- the cloth: a plain weave as a height, with its threads' own shades
struct NbCloth { h: f32, g: vec2f, shade: f32 }
fn nb_cloth(q: vec2f, pitch: f32, px: f32) -> NbCloth {
  let fade = 1.0 - smoothstep(0.35, 0.9, px / pitch);
  let a = q / pitch;
  let cell = floor(a);
  let over = ((i32(cell.x) + i32(cell.y)) & 1) == 0;
  let f = fract(a) - vec2f(0.5);
  // warp (along v) over weft (along u) on alternate cells: a raised thread across each cell
  let warp = 1.0 - 4.0 * f.x * f.x;
  let weft = 1.0 - 4.0 * f.y * f.y;
  let h = select(weft, warp, over) * 0.8 + 0.2 * (warp * weft);
  let dwarp = -8.0 * f.x / pitch;
  let dweft = -8.0 * f.y / pitch;
  let g = select(vec2f(0.0, dweft), vec2f(dwarp, 0.0), over) * 0.8 + 0.2 * vec2f(dwarp * weft, warp * dweft);
  // the threads' slubs: each thread a little thicker or lighter along its run
  let slub = nb_vn(vec2f(select(cell.y, cell.x, over) * 1.7, select(a.x, a.y, over) * 0.21)).x;
  var out: NbCloth;
  out.h = (h - 0.55 + slub * 0.35) * fade;
  out.g = g * fade;
  out.shade = (slub * 0.9 + (h - 0.55) * 0.35) * fade;
  return out;
}

// ---- the cover's DESIGNS, printed on the cloth past the spine band (u, v in the face's world units from the band's edge and the head)
fn nb_ring(d: f32, r: f32, w: f32, px: f32) -> f32 { return nb_cov(abs(d - r) - w * 0.5, px); }

fn nb_hash2(p: vec2f) -> f32 { return hash12(p * vec2f(0.1031, 0.1030) + vec2f(19.19, 7.7)); }

// 0 plain cloth · 1 orbit (rings round a brass sun) · 2 tiles (a grid of quarter-rounds, halves and dots) · 3 label (a cream label on kraft) · 4 bordered (a blind-pressed frame)
fn nb_design(B: NbBook, q: vec2f, w: f32, h: f32, px: f32, base: vec3f) -> vec4f {
  let id = i32(B.look.x + 0.5);
  var c = base;
  var press = 0.0;   // a blind line pressed into the cloth (a height)
  if (id == 1) {
    let o = vec2f(w * 0.5, h * 0.47);
    let d = length(q - o);
    let ringW = 0.9;
    for (var i = 1; i <= 6; i++) {
      let r = f32(i) * min(w, h) * 0.075 + 4.0;
      c = mix(c, B.col3.rgb, nb_ring(d, r, ringW, px) * 0.8);
      // a planet on each ring
      let a = nb_hash2(vec2f(f32(i), 3.0)) * 6.2831 + B.look.w;
      let pc = o + vec2f(cos(a), sin(a)) * r;
      let pr = 1.6 + 2.4 * nb_hash2(vec2f(f32(i), 9.0));
      let pcol = select(select(B.col4.rgb, B.col2.rgb, i % 3 == 1), B.col3.rgb, i % 3 == 2);
      c = mix(c, pcol, nb_cov(length(q - pc) - pr, px));
    }
    c = mix(c, B.col2.rgb, nb_cov(d - 9.0, px));
  } else if (id == 2) {
    let n = vec2f(3.0, 4.0);
    let cs = vec2f(w, h) / n;
    let cell = clamp(floor(q / cs), vec2f(0.0), n - vec2f(1.0));
    let f = (q - cell * cs) / cs;   // 0..1 in the tile
    let r = nb_hash2(cell + vec2f(B.look.w * 7.0, 1.0));
    let r2 = nb_hash2(cell + vec2f(5.0, B.look.w * 3.0));
    let bgI = i32(r2 * 4.0);
    let fgI = (bgI + 1 + i32(r * 3.0)) % 4;
    var bg = B.col2.rgb; var fg = B.col3.rgb;
    if (bgI == 1) { bg = B.col3.rgb; } else if (bgI == 2) { bg = B.col4.rgb; } else if (bgI == 3) { bg = base; }
    if (fgI == 0) { fg = B.col2.rgb; } else if (fgI == 2) { fg = B.col4.rgb; } else if (fgI == 3) { fg = base; }
    let pxt = px / min(cs.x, cs.y);
    var m = 0.0;
    let kind = i32(r * 5.0);
    if (kind == 0) { m = nb_cov(length(f) - 1.0, pxt); }                        // a quarter-round from a corner
    else if (kind == 1) { m = nb_cov(length(f - vec2f(0.5, 1.0)) - 0.5, pxt); }  // a half-round on the edge
    else if (kind == 2) { m = nb_cov((f.x - f.y) * 0.7071, pxt); }            // a diagonal half
    else if (kind == 3) { m = nb_cov(length(f - vec2f(0.5)) - 0.3, pxt); }       // a dot
    else { m = nb_cov(max(abs(f.x - 0.5), abs(f.y - 0.5)) - 0.22, pxt); }      // a square
    c = mix(bg, fg, m);
  } else if (id == 3) {
    let lo = vec2f(w * 0.16, h * 0.16);
    let hi = vec2f(w * 0.84, h * 0.33);
    let d = nb_sd_box(q - (lo + hi) * 0.5, (hi - lo) * 0.5, 3.0);
    let lab = nb_cov(d, px);
    var lc = B.col3.rgb;
    // two ruled lines on the label for a name
    let ly = (q.y - lo.y) / (hi.y - lo.y);
    let rule = max(nb_cov(abs(ly - 0.55) * (hi.y - lo.y) - 0.3, px), nb_cov(abs(ly - 0.8) * (hi.y - lo.y) - 0.3, px)) * step(lo.x + 6.0, q.x) * step(q.x, hi.x - 6.0);
    lc = mix(lc, B.col7.rgb, rule * 0.35);
    c = mix(c, lc, lab);
  } else if (id == 4) {
    let d = nb_sd_box(q - vec2f(w, h) * 0.5, vec2f(w, h) * 0.5 - vec2f(9.0), 2.5);
    press = -exp(-(d * d) / 0.6) * 0.5;
    c = c * (1.0 - exp(-(d * d) / 0.6) * 0.08);
  }
  return vec4f(c, press);
}

// ---- the paper: its albedo (fibre, mottle) and its height (tooth, cockle), in the page's world units
fn nb_paper_seed(seed: f32) -> vec2f { return vec2f(fract(seed * 0.618034) * 97.0, fract(seed * 0.381966) * 89.0); }

// The paper from its baked texture (src/notebook/paper-tex.ts): the mottle and the fibres over a 64-unit
// tile, the tooth's slope over a 9.6-unit one, each page's tiles offset by its number; the cockle, slow
// enough for one noise. Explicit gradients, so it may be read anywhere and filters by its mips.
struct NbPaperS { albedo: vec3f, g: vec2f }
fn nb_paper(k: NbUniforms, base: vec3f, q: vec2f, dqdx: vec2f, dqdy: vec2f, seed: f32, tex: texture_2d<f32>, samp: sampler) -> NbPaperS {
  let s = nb_paper_seed(seed);
  let a = textureSampleGrad(tex, samp, q / 64.0 + s / 64.0, dqdx / 64.0, dqdy / 64.0);
  let tt = 9.6;
  let b = textureSampleGrad(tex, samp, q / tt + s.yx / 31.0, dqdx / tt, dqdy / tt);
  let v = (a.r - 0.5) * k.paper.y * 2.0 + (a.g - 0.5) * k.paper.x * 3.0;
  var out: NbPaperS;
  out.albedo = base + vec3f(v * 1.05, v, v * 0.8);
  let tooth = (b.ba - vec2f(0.5)) * (2.0 * 48.0 / tt) * (k.paper.z * 0.02);
  let c = nb_vn(q / 55.0 + s * 0.5);
  out.g = tooth + c.yz / 55.0 * (k.paper.w * 2.0);
  return out;
}

// The ruling printed on a page: dots on a pitch, inside a margin, faded as they fall under the pixel.
fn nb_ruling(k: NbUniforms, B: NbBook, q: vec2f, w: f32, h: f32, px: f32) -> f32 {
  let kind = i32(B.look.y + 0.5);
  if (kind == 0) { return 0.0; }
  let pitch = k.rule.x;
  let m = k.rule.z;
  let inside = step(m, q.x) * step(q.x, w - m) * step(m, q.y) * step(q.y, h - m);
  let vis = smoothstep(2.0, 5.0, pitch / px);
  // the grid is laid from the page's head and fore-edge so it sits the same on every page
  let g = (q - vec2f(w, 0.0)) / pitch;
  let f = fract(g) - vec2f(0.5);
  if (kind == 1) {
    let d = length(f) * pitch - k.rule.y;
    return nb_cov(d, max(px, 0.35)) * inside * vis;
  }
  if (kind == 2) {
    let d = abs(f.y) * pitch - k.rule.y * 0.45;
    return nb_cov(d, max(px, 0.3)) * inside * vis * 0.75;
  }
  let d = min(abs(f.x), abs(f.y)) * pitch - k.rule.y * 0.4;
  return nb_cov(d, max(px, 0.3)) * inside * vis * 0.6;
}

// ---- the case: the cover's face (u from the spine edge, v from the head, world units)

// Its height's slope (d/du, d/dv): the cloth rolling over the board's edge (the bevel), the groove
// where the band's edge lies under the cover's cloth, the hinge's pressed groove, the weave, a blind press.
fn nb_cover_g(k: NbUniforms, B: NbBook, q: vec2f, px: f32) -> vec2f {
  let w = B.size.x;
  let h = B.size.y;
  let e = 0.05;
  let d = nb_sd_fore(q, w, h, B.size.w);
  let dg = vec2f(nb_sd_fore(q + vec2f(e, 0.0), w, h, B.size.w) - d, nb_sd_fore(q + vec2f(0.0, e), w, h, B.size.w) - d) / e;
  // bevel: z = −1.1·(1 + d/2.2)² over the last 2.2 units — its slope along the outline's normal
  let t = nb_sat(1.0 + d / 2.2);
  var g = dg * (-2.2 * t / 2.2) * select(0.0, 1.0, d > -2.2 && d < 0.0);
  let band = B.page.w;
  let xb = q.x - band;
  g.x += 0.22 * exp(-(xb * xb) / 0.5) * (2.0 * xb / 0.5);
  let xh = q.x - 7.0;
  g.x += 0.55 * exp(-(xh * xh) / 2.2) * (2.0 * xh / 2.2);
  if (B.foot.y < 0.5) { g += nb_cloth(q, k.cloth.x, px).g * k.cloth.y; }
  else { g += nb_fbm(q * 1.1).yz * 1.1 * 0.05 * nb_detail(1.0, px); }
  if (i32(B.look.x + 0.5) == 4 && q.x > band) {
    // the blind-pressed frame
    let p = q - vec2f(band, 0.0);
    let hw = vec2f(w - band, h) * 0.5;
    let db = nb_sd_box(p - hw, hw - vec2f(9.0), 2.5);
    let dbg = vec2f(nb_sd_box(p + vec2f(e, 0.0) - hw, hw - vec2f(9.0), 2.5) - db, nb_sd_box(p + vec2f(0.0, e) - hw, hw - vec2f(9.0), 2.5) - db) / e;
    g += dbg * (0.5 * exp(-(db * db) / 0.6) * (2.0 * db / 0.6));
  }
  return g;
}

fn nb_cover_albedo(k: NbUniforms, B: NbBook, q: vec2f, px: f32) -> vec3f {
  let w = B.size.x;
  let h = B.size.y;
  let band = B.page.w;
  let design = nb_design(B, q - vec2f(band, 0.0), w - band, h, px, B.col0.rgb).rgb;
  var c = mix(design, B.col1.rgb, nb_cov(q.x - band, px));
  if (B.foot.y < 0.5 || q.x < band) { c *= 1.0 + nb_cloth(q, k.cloth.x, px).shade * 0.16; }
  else { c += vec3f(nb_fbm(q * 0.35).x * 0.035 + nb_fbm(q * 2.1).x * 0.02 * nb_detail(0.6, px)); }
  return c;
}

// The inside of a board: the endpaper, framed by the cloth's turn-in along the head, the fore-edge and the tail.
struct NbEnd { albedo: vec3f, ao: f32 }
fn nb_endpaper(k: NbUniforms, B: NbBook, q: vec2f, px: f32, stacked: bool, dqdx: vec2f, dqdy: vec2f, tex: texture_2d<f32>, samp: sampler) -> NbEnd {
  let w = B.size.x;
  let h = B.size.y;
  let turn = 4.2;
  let de = nb_sd_fore(q - vec2f(-2.0, turn), w - turn + 2.0, h - 2.0 * turn, max(B.size.w - turn * 0.6, 1.0));
  let inside = nb_cov(de, px);
  var cloth = B.col0.rgb;
  if (B.foot.y < 0.5) { cloth *= 1.0 + nb_cloth(q, k.cloth.x, px).shade * 0.16; }
  let paper = nb_paper(k, B.col5.rgb, q, dqdx, dqdy, 91.0 + B.look.w, tex, samp).albedo;
  var out: NbEnd;
  out.albedo = mix(cloth, paper, inside);
  // the endpaper's edge: a hairline of shade where the paper lies over the cloth
  out.ao = 1.0 - 0.3 * exp(-(de * de) / 0.35) * (1.0 - inside * 0.4);
  if (stacked) {
    // the text block standing on it: occlusion at its foot
    let sq = B.open.w;
    let ds = nb_sd_fore(q - vec2f(-4.0, sq), w - sq + 4.0, h - 2.0 * sq, B.page.z);
    out.ao *= 1.0 - 0.34 * exp(-max(ds, 0.0) / 2.6);
  }
  return out;
}

// A board's edge: the cloth wrapped over it — the band's near the spine, the cover's beyond.
fn nb_board(k: NbUniforms, B: NbBook, q: vec2f, px: f32) -> vec3f {
  let w = B.size.x;
  let h = B.size.y;
  let r = B.size.w;
  let total = 2.0 * (w - r) + NB_PI * r + h - 2.0 * r;
  let band = B.page.w;
  let inBand = max(1.0 - smoothstep(band - 0.5, band + 0.5, q.x), smoothstep(total - band - 0.5, total - band + 0.5, q.x));
  var c = mix(B.col0.rgb, B.col1.rgb, inBand);
  c *= 0.94 + nb_cloth(vec2f(q.x, q.y * 3.0), k.cloth.x, px).shade * 0.12;
  return c;
}

// A stack's edge: the sheets' edges, one stripe each, each sheet a shade of its own; averaged as they fall under the pixel.
fn nb_edge(k: NbUniforms, B: NbBook, q: vec2f, sheets: f32, side: f32, px: f32) -> vec3f {
  let t = max(B.foot.z, 1e-3);
  let f = q.y / t;
  let i = floor(f);
  let g = fract(f);
  let vis = smoothstep(0.7, 2.2, t / px);
  let own = hash12(vec2f(i + side * 131.0, 7.0)) - 0.5;
  let gap = pow(1.0 - min(g, 1.0 - g) * 2.0, 6.0);
  let rough = nb_vn(vec2f(q.x * 0.35, i * 1.7)).x * 0.05;
  let shade = 0.9 + (own * 0.08 + rough) * vis - gap * 0.3 * vis;
  return B.col6.rgb * shade;
}
