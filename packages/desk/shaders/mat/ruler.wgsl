// The RULERS printed on the mat (RULER.md) — a PURE module: no bindings. The
// ink coverage at a fragment from the frame's lines, the ticks and the labels,
// in screen space; the mat pass mixes it into the albedo before the light, so
// the print is lit and shadowed like the lines. Every number is a uniform
// `matUniformValues` fills from lattice/ruler.ts — the levels' spacings,
// presences and tick lengths per frame; the shader only lays them out.
//
// Layout: the frame's outer rect one `margin` in from the viewport; the top
// and left BANDS one `band` wide inside it, each closed by its inner line
// (the ticks' baseline). A tick stands on the baseline at every site of every
// level, its length the level's, its presence the level's. A label sits in
// the band's outer half after its tick, laid out on the finest labelled
// level's sites; the left ruler's labels are the top's rotated a quarter turn
// clockwise (reading down the band, their tops toward the field) — James's
// mockup. All distances are DEVICE px inside; positions arrive as CSS px.

const RULER_LEVELS = 5;
const GLYPH_PAD = 2.0;

// A printed line's coverage across `d` device px at half-width `hw`: a 1 px AA ramp.
fn ruler_line(d: f32, hw: f32) -> f32 { return 1.0 - smoothstep(hw - 0.5, hw + 0.5, abs(d)); }
// Inside [a, b] — the ends of a segment and the extents of a band.
fn ruler_in(x: f32, a: f32, b: f32) -> f32 { return step(a, x) * step(x, b); }

fn ruler_digits(a: i32) -> i32 { var n = 1; var v = a; loop { if (v < 10) { break; } v = v / 10; n += 1; } return n; }
fn ruler_pow10(p: i32) -> i32 { var r = 1; for (var i = 0; i < p; i++) { r = r * 10; } return r; }
// The i-th digit (0 = leftmost) of `a` written with `nd` digits — leading zeros where `a` is short.
fn ruler_digit_at(a: i32, i: i32, nd: i32) -> i32 { return (a / ruler_pow10(nd - 1 - i)) % 10; }

// A label's text — lattice/ruler.ts `formatLabel`, per character: the glyph
// index at slot `k` of `index · mult · 10^exp` (0–9, 10 '-', 11 '.', -1 past
// the end), and (x < 0) the character count. Plain digits, no suffix; a
// fraction with its trailing zeros stripped, so "1.0" is "1" at every level.
fn ruler_label(index: i32, mult: i32, exp: i32, k: i32) -> i32 {
  let M = index * mult;
  if (M == 0) { return select(-1, 0, k == 0); }
  let neg = M < 0;
  let a = abs(M);
  var i = k;
  if (neg) { if (i == 0) { return 10; } i -= 1; }
  if (exp >= 0) {
    let nd = ruler_digits(a);
    if (i < nd) { return ruler_digit_at(a, i, nd); }
    if (i < nd + exp) { return 0; }
    return -1;
  }
  let p = -exp;
  let nd = max(ruler_digits(a), p + 1);
  let intDigits = nd - p;
  var fracLen = p;
  loop { if (fracLen == 0) { break; } if ((a / ruler_pow10(p - fracLen)) % 10 != 0) { break; } fracLen -= 1; }
  if (i < intDigits) { return ruler_digit_at(a, i, nd); }
  if (i == intDigits) { return select(-1, 11, fracLen > 0); }
  let j = i - intDigits - 1;
  if (j < fracLen) { return ruler_digit_at(a, intDigits + j, nd); }
  return -1;
}
fn ruler_label_len(index: i32, mult: i32, exp: i32) -> i32 {
  var n = 0;
  loop { if (n >= 16) { break; } if (ruler_label(index, mult, exp, n) < 0) { break; } n += 1; }
  return n;
}

// The ticks and the label along ONE band. `along` is the fragment's CSS px
// along the band (x for the top, y for the left), `across` its device px in
// from the outer line; `phase` the lattice's wrapped camera coordinate along
// it, `wraps` the wrap count, `lim` the band's extent along (CSS px: the inner
// corner, the far frame line), `turned` the left band. `glyph` receives the
// atlas texel to sample when the fragment lies in a label (its .z the label's
// presence), else .z 0.
struct RulerHit { ink: f32, glyph: vec3f }

fn ruler_band(u: MatUniforms, along: f32, across: f32, phase: f32, wraps: f32, lim: vec2f, turned: bool) -> RulerHit {
  var hit: RulerHit;
  hit.ink = 0.0; hit.glyph = vec3f(0.0);
  let dpr = mat_dpr(u); let zoom = mat_zoom(u);
  let band_dev = u.ruler.z * dpr;
  let hw = 0.5 * u.ruler.w * dpr;
  // only the band's own pixels pay for the levels and the text — the rest of the mat returns here
  if (across < -1.0 || across > band_dev + 1.0 || ruler_in(along, lim.x, lim.y) <= 0.0) { return hit; }
  let w = phase + along / zoom;   // lattice-phase world along the band
  // the ticks: on the baseline (the band's inner edge), up the level's length; the coarsest level owning a site wins the max
  var tick = 0.0;
  for (var i = 0; i < RULER_LEVELS; i++) {
    let s = u.rulerSites[i].x;
    let len = u.rulerSites[i].y * dpr;
    let a = u.rulerSites[i].z;
    if (a <= 0.0 || len <= 0.0) { continue; }
    let d = (abs(fract(w / s - 0.5) - 0.5) * s) * zoom * dpr;
    tick = max(tick, ruler_line(d, hw) * ruler_in(across, band_dev - len - 0.5, band_dev + 0.5) * a);
  }
  hit.ink = tick * u.rulerAlpha.y;
  // the label: laid out on the finest labelled level's sites, the site at or before the fragment
  let lf = i32(u.rulerOrigin.z);
  if (lf < 0 || u.rulerAtlas.w <= 0.0) { return hit; }
  let s = u.rulerSites[lf].x;
  let nLocal = floor(w / s);
  let site = (nLocal * s - phase) * zoom;   // CSS px along
  if (site < lim.x) { return hit; }          // a site inside the corner square prints nothing
  let index = i32(wraps) * i32(u.rulerFormat[lf].z) + i32(nLocal);
  // the site's presence: the coarsest level it lies on
  var presence = u.rulerSites[lf].w;
  for (var j = RULER_LEVELS - 1; j > lf; j--) {
    let ratio = i32(u.rulerFormat[lf].z) / i32(u.rulerFormat[j].z);
    if (index % ratio == 0) { presence = u.rulerSites[j].w; break; }
  }
  if (presence <= 0.0) { return hit; }
  let mult = i32(u.rulerFormat[lf].x); let exp = i32(u.rulerFormat[lf].y);
  let texel = u.rulerText.w / dpr;           // atlas texels per device px
  let adv = u.rulerGlyph.z / texel;          // a glyph's advance, device px
  let origin = floor((site + u.rulerText.y) * dpr + 0.5);   // the text's start, on a whole device px
  let t = along * dpr - origin;
  if (t < 0.0) { return hit; }
  let slot = i32(floor(t / adv));
  let g = ruler_label(index, mult, exp, slot);
  if (g < 0) { return hit; }
  // the glyph cell. The top band: the cap's top `top` in from the outer line, the glyph read down the band. The left band: the
  // glyph turned a quarter CLOCKWISE — read down the band still, but its baseline `top` in from the outer line and its top toward
  // the field (the mockup's "1" above "0", the foot of the "1" at the outer side). Reading along +y with the cell's rows along −x
  // keeps the hand: a rotation, not the mirror a transpose would be.
  var v = 0.0;
  if (turned) { v = u.rulerGlyph.w - (across - u.rulerText.x * dpr) * texel; }
  else { v = (across - (u.rulerText.x * dpr - (u.rulerGlyph.w - u.rulerAtlas.z) / texel)) * texel; }
  if (v < 0.0 || v >= u.rulerGlyph.y) { return hit; }
  let uu = f32(g) * u.rulerGlyph.x + GLYPH_PAD + (t - f32(slot) * adv) * texel;
  hit.glyph = vec3f(uu, v, presence);
  return hit;
}

// The whole print: the frame's lines, the two bands' ticks, the labels'
// texels sampled from the atlas. Returns ink coverage 0..1 at this fragment.
fn ruler_ink(u: MatUniforms, screen: vec2f, frag: vec2f, glyph_tex: texture_2d<f32>, samp: sampler) -> f32 {
  if (u.ruler.x <= 0.0) { return 0.0; }
  let dpr = mat_dpr(u);
  let margin = u.ruler.y; let band = u.ruler.z;
  let W = u.view.x; let H = u.view.y;
  let hw = 0.5 * u.ruler.w * dpr;
  let m = margin * dpr; let inner = (margin + band) * dpr;
  let right = (W - margin) * dpr; let bottom = (H - margin) * dpr;
  // the frame: the outer rect, and the two baselines closing the bands
  var frame = 0.0;
  frame = max(frame, ruler_line(frag.x - m, hw) * ruler_in(frag.y, m - hw, bottom + hw));
  frame = max(frame, ruler_line(frag.x - right, hw) * ruler_in(frag.y, m - hw, bottom + hw));
  frame = max(frame, ruler_line(frag.y - m, hw) * ruler_in(frag.x, m - hw, right + hw));
  frame = max(frame, ruler_line(frag.y - bottom, hw) * ruler_in(frag.x, m - hw, right + hw));
  frame = max(frame, ruler_line(frag.x - inner, hw) * ruler_in(frag.y, m, bottom));
  frame = max(frame, ruler_line(frag.y - inner, hw) * ruler_in(frag.x, m, right));
  var ink = frame * u.rulerAlpha.x;
  // the top band (across = down from the outer line) and the left band (across = right from it); a pixel in neither pays nothing more.
  // The labels: the top band's cell read along x, the left band's along y and turned — the same atlas texels either way.
  if (ruler_in(frag.y, m - 1.0, inner + 1.0) * ruler_in(frag.x, inner - 1.0, right + 1.0) > 0.0) {
    let top = ruler_band(u, screen.x, frag.y - m, u.phase.x, u.rulerOrigin.x, vec2f(margin + band, W - margin), false);
    ink = max(ink, top.ink);
    if (top.glyph.z > 0.0) { ink = max(ink, textureSampleLevel(glyph_tex, samp, top.glyph.xy / u.rulerAtlas.xy, 0.0).r * top.glyph.z * u.rulerAlpha.z); }
  }
  if (ruler_in(frag.x, m - 1.0, inner + 1.0) * ruler_in(frag.y, inner - 1.0, bottom + 1.0) > 0.0) {
    let left = ruler_band(u, screen.y, frag.x - m, u.phase.y, u.rulerOrigin.y, vec2f(margin + band, H - margin), true);
    ink = max(ink, left.ink);
    if (left.glyph.z > 0.0) { ink = max(ink, textureSampleLevel(glyph_tex, samp, left.glyph.xy / u.rulerAtlas.xy, 0.0).r * left.glyph.z * u.rulerAlpha.z); }
  }
  return ink;
}
