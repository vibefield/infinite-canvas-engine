// THE MINI MAT (MINIMAT.md) — a smaller self-healing cutting mat lying on the desk, and inside
// it another desk. A PURE module: the record `MiniMat`, the pass's knobs `MiniMatUniforms` and
// the mat's block `MatUniforms` arrive as parameters; it names no colour.
//
// The sheet is the mat's own vinyl, so its colour goes through the mat's own chain (`mat_colour`
// — the reference's double gamma by day, the Moon by night) and it takes the dapple of the lamp
// the desk is lit by. What tells it from the desk is what a small mat on a big one shows: its
// shadow — a thin slab's, the board's sweep with a contact line at its base; its CUT EDGE — a
// bevel that catches the lamp on the near side and falls away on the far; and its PRINT, in the
// mat's cream — a frame round the cutting area; a ruler along the face's top and left edges, its
// ticks at the very lattice the face shows (minor · medium · major for its fine, mid and coarse
// rungs) and numbered in the inside's own units with the rulers' own digits (ruler.wgsl); and the
// mat's NAME in the foot, in the design's print label (mono capitals, tracked), as a mat's maker
// prints its own. The FACE, at the far LOD, is the inside's
// lattice as the live inside would draw it (the rungs and their weights come from the host,
// dressed as the live slot dresses its mat), and its children are drawn over it as CHIPS by the
// entry: flat silhouettes in their own colours, a note's writing greeked into lines of ink.

fn mm_cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }
// A band `w` wide INSIDE the edge d = 0.
fn mm_line(d: f32, w: f32, px: f32) -> f32 { return mm_cov(d, px) - mm_cov(d + w, px); }
fn mm_erf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage — a shadow, straight out of the field.
fn mm_blur(d: f32, sigma: f32) -> f32 { return 0.5 - 0.5 * mm_erf(d / max(sigma * 1.4142136, 1.0e-4)); }
// Premultiplied "src over dst".
fn mm_over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }
// A world point raised `h` world units off the desk, in the projector's frame (mat.wgsl `desk_of` with a height).
fn mm_desk_at(u: MatUniforms, world: vec2f, h: f32) -> vec3f {
  return vec3f(u.plane.x + world.x * u.plane.z, u.plane.w + h * u.plane.z, u.plane.y + world.y * u.plane.z);
}
fn mm_encode(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return mix(x * 12.92, 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, step(vec3f(0.0031308), x));
}

// The shadow a THIN SLAB casts (the board's `bd_slab`): its footprint swept along the ground slope
// `S` from its underside `bottom` to its top `top`, each copy blurred by its own height — the union
// as the max — and a contact line at its base while it rests, fading as it floats off.
fn mm_slab(q: vec2f, half: vec2f, r: f32, bottom: f32, top: f32, S: vec2f, k: MiniMatUniforms) -> f32 {
  var sh = 0.0;
  for (var i = 0; i < 4; i++) {
    let h = mix(bottom, top, f32(i) / 3.0);
    if (h <= 0.0) { continue; }
    sh = max(sh, mm_blur(sdf_round_box(q - S * h, half, r), k.shadow.x + k.shadow.y * h));
  }
  sh = sh * k.shadow.z;
  let g = max(bottom, 0.0);
  let con = mm_blur(sdf_round_box(q - S * min(g, 1.0) * 0.5, half, r), k.shadow2.x) * k.shadow.w * exp(-g / max(k.shadow2.y, 1.0e-3));
  return max(sh, con);
}

// The CUT EDGE: within `k.edge.x` of the rim the sheet's surface rolls over — turned toward the
// lamp it brightens, turned away it darkens. `q` in the sheet's frame, `d` its distance; a factor
// on the linear albedo (1 on the flat).
fn mm_bevel(q: vec2f, d: f32, M: MiniMat, k: MiniMatUniforms) -> f32 {
  let t = smoothstep(-k.edge.x, 0.0, d);
  if (t <= 0.0) { return 1.0; }
  // the rim's outward normal: along the corner's radius, or the nearer side's axis
  let e = abs(q) - (M.half - vec2f(M.radius));
  var n = vec2f(0.0);
  if (e.x > 0.0 && e.y > 0.0) { n = normalize(e) * sign(q); }
  else if (e.x > e.y) { n = vec2f(sign(q.x), 0.0); }
  else { n = vec2f(0.0, sign(q.y)); }
  let facing = dot(n, M.lamp);
  return 1.0 + t * select(facing * k.edge.z, facing * k.edge.y, facing > 0.0);
}

// The face's own lattice at the far LOD (mat.wgsl `grid2` per rung, weighed as the live inside
// weighs it): `a` the inside point, `ipx` inside units per DEVICE px.
fn mm_lattice(M: MiniMat, a: vec2f, ipx: f32) -> f32 {
  var cover = 0.0;
  if (M.weights.x > 0.0) { cover = grid2(a, M.rungs.x, M.widths.x * ipx, ipx) * M.weights.x; }
  if (M.weights.y > 0.0) { cover = max(cover, grid2(a, M.rungs.y, M.widths.y * ipx, ipx) * M.weights.y); }
  if (M.weights.z > 0.0) { cover = max(cover, grid2(a, M.rungs.z, M.widths.z * ipx, ipx) * M.weights.z); }
  return cover;
}

// One rung's ticks along one edge: the site's line across the edge (`along` the inside coordinate
// along it, `ipx` inside units per device px, `hw` the print's half-width in inside units), standing
// out of the face by `len` world units (`out` how far out the point is, world; `px` world per device px).
fn mm_tick(along: f32, spacing: f32, hw: f32, ipx: f32, out: f32, len: f32, px: f32) -> f32 {
  return line_coverage(along, spacing, hw, ipx) * mm_cov(out - len, px) * mm_cov(-out, px);
}

// A texel of the glyph atlas (RULER.md; mat/layout.ts `GLYPHS`): glyph `g` at `tx` texels from its
// origin (its cell's left edge + the pad) and `ty` texels down from its cell's top; 0 outside it.
fn mm_glyph(tex: texture_2d<f32>, samp: sampler, k: MiniMatUniforms, g: i32, tx: f32, ty: f32) -> f32 {
  if (g < 0 || f32(g) >= k.atlas2.w || tx < -GLYPH_PAD || tx >= k.atlas.x - GLYPH_PAD || ty < 0.0 || ty >= k.atlas.y) { return 0.0; }
  return textureSampleLevel(tex, samp, vec2f(f32(g) * k.atlas.x + GLYPH_PAD + tx, ty) / k.atlas2.yz, 0.0).r;
}

// A NUMERAL along one edge: `A` the inside coordinate along it at the fragment, `host` the fragment's
// host coordinate along it and `o` the host coordinate of inside 0 (the embedding's offset on that
// axis); `acrossOuter` how far in from the sheet's outer edge (world); `turned` the left edge (the
// glyph turned a quarter clockwise, read down, its top toward the face — the desk rulers' hand).
// The label is the site at or before the fragment: `index · mult · 10^exp` (ruler.wgsl `ruler_label`).
fn mm_numeral(M: MiniMat, k: MiniMatUniforms, tex: texture_2d<f32>, samp: sampler, A: f32, host: f32, o: f32, acrossOuter: f32, turned: bool) -> f32 {
  let S = M.numerals.x;
  if (S <= 0.0 || k.atlas2.w <= 0.0) { return 0.0; }
  let s = max(M.inside.x, 1.0e-9);
  let n = floor(A / S);
  let index = i32(n);
  let presence = select(M.numerals.w, 1.0, index % 10 == 0);
  if (presence <= 0.0) { return 0.0; }
  let tpw = k.atlas2.x / max(k.digits.x, 1.0e-6);   // atlas texels per world unit, the cap on the digits' cap
  let adv = k.atlas.z / tpw;                        // a digit's advance, world
  let t = host - (o + n * S * s) - k.digits.y;      // world along, after the tick and the gap
  if (t < 0.0) { return 0.0; }
  let slot = i32(floor(t / adv));
  let g = ruler_label(index, i32(M.numerals.y), i32(M.numerals.z), slot);
  if (g < 0) { return 0.0; }
  var v = 0.0;
  if (turned) { v = k.atlas.w - (acrossOuter - k.digits.z) * tpw; }
  else { v = (acrossOuter - (k.digits.z - (k.atlas.w - k.atlas2.x) / tpw)) * tpw; }
  return mm_glyph(tex, samp, k, g, (t - f32(slot) * adv) * tpw, v) * presence;
}

// The NAME's glyph at slot `i` (minimat.ts `packGlyphs`: four 6-bit indices to a float).
fn mm_name_glyph(M: MiniMat, i: i32) -> i32 {
  let f = M.name[i / 16][(i / 4) % 4];
  return i32((u32(f) >> (6u * u32(i % 4))) & 63u);
}

// The PRINT in the border, as a presence of the cream: the frame just outside the face; the ruler
// along its top and left edges — ticks on the inside's lattice (each rung at its line's presence,
// relative to the law's thickest: a tick is the line it stands for, printed on) and the numerals; and
// the NAME in the foot, from the face's left edge. A line never prints thinner than a device px (the
// ink thins instead); the words print only once their cap is legible. `q` in the sheet's frame, `fh`
// the face's half extents, `a` the inside point, `zoom` the camera's.
fn mm_print(u: MatUniforms, M: MiniMat, k: MiniMatUniforms, q: vec2f, fh: vec2f, a: vec2f, px: f32, ipx: f32, zoom: f32, tex: texture_2d<f32>, samp: sampler) -> f32 {
  let w = max(k.print.w, px);
  let thin = min(k.print.w / px, 1.0);
  let dF = sdf_box(q, fh);
  // the frame: a band hugging the face from outside (the live inside is clipped to the face, so it never covers it)
  var ink = mm_line(dF - w, w, px) * k.print.x * thin;
  if (dF <= 0.0) { return ink; }
  // the ruler's ticks: out of the top edge (−y) and the left (−x)
  let hw = 0.5 * w / max(M.inside.x, 1.0e-9);
  let thick = max(u.line.w, 1.0e-3);
  let outTop = -fh.y - q.y;
  let outLeft = -fh.x - q.x;
  var t = 0.0;
  if (outTop > -px && q.x > -fh.x - px && q.x < fh.x + px) {
    if (M.weights.x > 0.0) { t = max(t, mm_tick(a.x, M.rungs.x, hw, ipx, outTop, k.ticks.x, px) * min(M.weights.x / thick, 1.0)); }
    if (M.weights.y > 0.0) { t = max(t, mm_tick(a.x, M.rungs.y, hw, ipx, outTop, k.ticks.y, px) * min(M.weights.y / thick, 1.0)); }
    if (M.weights.z > 0.0) { t = max(t, mm_tick(a.x, M.rungs.z, hw, ipx, outTop, k.ticks.z, px) * min(M.weights.z / thick, 1.0)); }
  }
  if (outLeft > -px && q.y > -fh.y - px && q.y < fh.y + px) {
    if (M.weights.x > 0.0) { t = max(t, mm_tick(a.y, M.rungs.x, hw, ipx, outLeft, k.ticks.x, px) * min(M.weights.x / thick, 1.0)); }
    if (M.weights.y > 0.0) { t = max(t, mm_tick(a.y, M.rungs.y, hw, ipx, outLeft, k.ticks.y, px) * min(M.weights.y / thick, 1.0)); }
    if (M.weights.z > 0.0) { t = max(t, mm_tick(a.y, M.rungs.z, hw, ipx, outLeft, k.ticks.z, px) * min(M.weights.z / thick, 1.0)); }
  }
  ink = max(ink, t * k.print.y * thin);
  // the words, once their cap is legible on screen
  let digitsOn = smoothstep(k.text.z, k.text.w, k.digits.x * zoom);
  if (digitsOn > 0.0) {
    if (outTop > 0.0 && q.x > -fh.x && q.x < fh.x) { ink = max(ink, mm_numeral(M, k, tex, samp, a.x, q.x + M.centre.x, M.inside.y, q.y + M.half.y, false) * k.print.y * digitsOn); }
    if (outLeft > 0.0 && q.y > -fh.y && q.y < fh.y) { ink = max(ink, mm_numeral(M, k, tex, samp, a.y, q.y + M.centre.y, M.inside.z, q.x + M.half.x, true) * k.print.y * digitsOn); }
  }
  let nameOn = smoothstep(k.text.z, k.text.w, k.text.x * zoom);
  if (nameOn > 0.0 && M.nameLen > 0.0 && q.y > fh.y) {
    let tpw = k.atlas2.x / max(k.text.x, 1.0e-6);
    // a mono face's cap is ~0.72 of its em: the tracking is in em
    let adv = k.atlas.z / tpw + k.text.y * k.text.x / 0.72;
    let x = q.x + fh.x;                                          // world from the face's left edge
    let baseline = 0.5 * (fh.y + M.half.y) + 0.5 * k.text.x;     // the cap centred in the foot
    if (x >= 0.0 && x < 2.0 * fh.x) {
      let slot = i32(floor(x / adv));
      if (f32(slot) < M.nameLen) {
        let g = mm_name_glyph(M, slot);
        let v = (q.y - baseline) * tpw + k.atlas.w;
        ink = max(ink, mm_glyph(tex, samp, k, g, (x - f32(slot) * adv) * tpw, v) * k.print.y * nameOn);
      }
    }
  }
  return ink;
}

// The vinyl's colour on screen under the desk's light: its albedo (sRGB, the print mixed in) through
// the mat's own chain — the same double gamma the desk's sage takes, the Moon by night — with the
// cut edge's roll on the linear value.
fn mm_vinyl(u: MatUniforms, albedo: vec3f, bevel: f32, gobo: f32, noise: f32) -> vec3f {
  return mat_colour(u, srgb_to_linear(clamp(albedo, vec3f(0.0), vec3f(1.0))) * bevel, gobo, noise);
}

// Paper on the face (a chip): the note's chain — the reference's grade on the sRGB albedo by day
// (lit, the identity), the eye's chain on its linear value by night.
fn mm_paper(u: MatUniforms, albedo: vec3f, gobo: f32, noise: f32) -> vec3f {
  let day = shade_mat(u, albedo, gobo);
  if (u.night.x <= 0.0) { return day; }
  let night = night_mat(u, srgb_to_linear(albedo), gobo, noise);
  if (u.night.x >= 1.0) { return night; }
  return mix(day, night, u.night.x);
}
