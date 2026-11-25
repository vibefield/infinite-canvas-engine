// THE HAND — the desk's pen read in a kind's own fragment shader (petition I59: the field READ IN THE KIND'S SHADER — no bitmap per
// object, no raster per zoom rung). A sheet's writing is a GLYPH RUN (kit/hand-run.ts `handRun`: a few vec4s a glyph, a grid of
// cells about an em over the writing's box, the glyphs each cell can meet) in the kind's run store, and the face's `ice-hand/1`
// ATLAS (R the signed distance to the ink's edge, G the ARRIVAL — the moment the nib first covers the texel, 0..1 along the glyph's
// writing). `hand_ink` reads the cell under a point and only the glyphs it lists: on blank paper it reads NO atlas texel; where there
// is ink, one trilinear sample for each glyph whose exact turned box holds the point. kit/hand-run.ts `handInkAt` is its CPU twin.
//
// THE KIT'S `hand` PIECE (`kitWgsl([..., "hand"])`; petition I31 — every declaration's `///` block says what it takes and gives).
// PURE: a kind passes its OWN three bindings (kit/hand-gpu.ts `handBindings(prefix)` declares them under its names, so two kinds
// that write with the pen compose this piece once in one card program, each over its own):
//  - `runs` — its run store, `texture_2d<f32>` over `rgba32float` (layout sample type `unfilterable-float`: `HandRuns.view`);
//  - `atlas` — the face's atlas, `texture_2d<f32>` over `rg8unorm` with its mips (sample type `float`: `handAtlasGpu(…).view`);
//  - `samp` — a filtering sampler, linear between the levels (`handSampler(device)`).
// UNITS: a point and the AA width are the RUN's — the layout's (`layoutText`: note units from the sheet's top-left, y down). The AA
// width is one device px in those units, worked out by the caller OUTSIDE any loop (derivatives need uniform control flow; the view
// block's zoom and dpr need none). TIME: the pen's clock as `penNow(ms)` splits it — whole seconds and the ms past them — the run
// holding its epoch the same way, so the time since the epoch is exact where it matters (a glyph being written is within seconds of
// its run's epoch) on a desk open for days.

/// Texels a row of a run store (kit/hand-run.ts `HAND_RUN.row`): a run's vec4 `i` lives at texel (`i` mod 1024, `i` / 1024).
const HAND_ROW: u32 = 1024u;
/// A run's header, vec4s (`HAND_RUN.header`): the grid's box, the grid, where the list and the glyphs start with the epoch, the edge.
const HAND_HEADER: u32 = 4u;
/// One glyph of a run, vec4s (`HAND_RUN.glyph`): its box, its place and turned scale, its atlas origin with size and pressure, its
/// atlas rect, its moment with the pen.
const HAND_GLYPH: u32 = 5u;
/// The edge in the atlas's R channel as unorm (`HAND_ATLAS_EDGE` / 255): a texel is `(R − HAND_EDGE) · range` em inside the ink.
const HAND_EDGE: f32 = 128.0 / 255.0;
/// The wet ink's reach behind the nib, em of the pen's path (`HAND_RUN.wet`).
const HAND_WET: f32 = 1.1;

/// What the pen laid at a point: `cover` — the ink's coverage 0..1 (its pressure in it), every glyph's laid over the ones before as
/// the raster lays them; `wet` — how fresh the ink of the glyph that laid the most is, 0..1 (1 just behind the nib, 0 dry: 0 wherever
/// its glyph is whole — a kind weighs it by `cover`); `pen` — the pen of the glyph that laid the most (0 = the sheet's own, else the
/// kind's pen n); `samples` — the atlas samples the read took (0 on blank paper); `loads` — the run texels it loaded (a witness: the
/// read's cost).
struct HandInk { cover: f32, wet: f32, pen: u32, samples: u32, loads: u32 }

/// One vec4 of a run store.
/// `runs` — the store (`texture_2d<f32>` over `rgba32float`); `i` — the vec4's index from the store's first texel (a run's base
/// plus its offset).
/// → the vec4, as written (`HandRuns.write`).
fn hand_load(runs: texture_2d<f32>, i: u32) -> vec4f {
  return textureLoad(runs, vec2u(i % HAND_ROW, i / HAND_ROW), 0);
}

/// The pen's progress through a glyph: the product's plain ease, cubic-bezier(.25, .1, .25, 1), solved by five Newton steps
/// (kit/hand-run.ts `handEase` takes the same five).
/// `x` — the time through the glyph's writing, 0..1 (clamped).
/// → how far along its path the pen is, 0..1.
fn hand_ease(x: f32) -> f32 {
  let s = saturate(x);
  var t = s;
  for (var i = 0; i < 5; i++) {
    let f = ((t - 0.75) * t + 0.75) * t - s;
    let df = (3.0 * t - 1.5) * t + 0.75;
    t = clamp(t - f / df, 0.0, 1.0);
  }
  return ((-1.7 * t + 2.4) * t + 0.3) * t;
}

/// THE PEN at a point: what a sheet's writing lays at `p` at `now`. The grid's box first (outside: nothing, one load); then the
/// cell (an empty one: nothing, and no atlas read); then each glyph the cell lists — its box (outside: next), its exact turned
/// rect (outside: next), and one atlas sample at the LOD its texels per device px ask, kept half a texel of the coarser level it
/// reads inside that rect (the chain is made over the whole atlas, so no level's box reaches a neighbour's ink — kit/hand-run.ts
/// `handMips`). The edge is `(R − 128/255) · range` em, made units by the glyph's size, its coverage a one-device-px ramp — never
/// wider than the field's own reach (half its range): a sheet that small is past reading (its kind greeks it), and a wider ramp
/// would lay a haze over the glyph's whole rect. THE INK LIES AS THE RASTER LAYS IT (desk/host/ink.ts — `strokeText` the bleed,
/// then `fillText`, each glyph over the ones before): the run's bleed is a stroke, a band that wide about the outline, laid at its
/// alpha times the glyph's pressure; the fill at the pressure over it, source-over (F + S·(1 − F)); and every glyph over the ones
/// before, source-over (1 − Π(1 − cover)) — so letters that meet darken where they meet, as on the bitmap. THE REVEAL: a glyph lays
/// nothing before its pen sets off; while it writes, a texel shows once the pen's eased progress has reached its arrival (`G`),
/// ramped over a device px of the pen's path — so the front is the arrival's own edge, round where the nib's is, and where a later
/// stroke crosses an earlier one the earlier ink is already there; once its time is out it is whole.
/// `runs` — the kind's run store (`texture_2d<f32>` over `rgba32float`); `atlas` — the face's atlas (`texture_2d<f32>` over
/// `rg8unorm`, every level); `samp` — a filtering sampler, linear between the levels; `base` — the run's base in the store (the
/// texel index `HandRuns.write` gave its record); `p` — the point, the run's units (the layout's: note units from the sheet's
/// top-left, y down); `now` — the pen's clock, `penNow(ms)`: whole seconds (x) and the ms past them (y); `aa` — one device px in
/// the run's units, > 0, worked out outside any loop.
/// → the ink there (`HandInk`): its coverage, how wet, its pen, and what the read took.
fn hand_ink(runs: texture_2d<f32>, atlas: texture_2d<f32>, samp: sampler, base: u32, p: vec2f, now: vec2f, aa: f32) -> HandInk {
  var ink = HandInk(0.0, 0.0, 0u, 0u, 1u);
  let box = hand_load(runs, base);
  if (p.x < box.x || p.y < box.y || p.x >= box.z || p.y >= box.w) { return ink; }
  let grid = hand_load(runs, base + 1u);
  let cols = u32(grid.y);
  let cx = min(u32((p.x - box.x) * grid.x), cols - 1u);
  let cy = min(u32((p.y - box.y) * grid.x), u32(grid.z) - 1u);
  let c = cy * cols + cx;
  let pair = hand_load(runs, base + HAND_HEADER + c / 2u);
  let cell = select(pair.xy, pair.zw, (c & 1u) == 1u);
  ink.loads = 3u;
  let n = u32(cell.y);
  if (n == 0u) { return ink; }
  let at = hand_load(runs, base + 2u);
  let edge = hand_load(runs, base + 3u);
  ink.loads += 2u;
  let t = (now.x - at.z) * 1000.0 + (now.y - at.w);
  let list = base + u32(at.x);
  let glyphs = base + u32(at.y);
  let first = u32(cell.x);
  let levels = f32(textureNumLevels(atlas) - 1u);
  let texels = vec2f(textureDimensions(atlas, 0));
  var four = vec4f(0.0);
  // what the glyphs leave bare, laid one over another (the coverage is 1 − it), and the most one glyph laid (its pen, its wet ink)
  var bare = 1.0;
  var most = 0.0;
  for (var k = 0u; k < n; k++) {
    let e = first + k;
    if (k == 0u || (e & 3u) == 0u) { four = hand_load(runs, list + e / 4u); ink.loads += 1u; }
    let g = glyphs + u32(four[e & 3u]) * HAND_GLYPH;
    let g0 = hand_load(runs, g);
    ink.loads += 1u;
    if (p.x < g0.x || p.y < g0.y || p.x > g0.z || p.y > g0.w) { continue; }
    let g1 = hand_load(runs, g + 1u);
    let g3 = hand_load(runs, g + 3u);
    ink.loads += 2u;
    let d = p - g1.xy;
    let tau = vec2f(g1.z * d.x + g1.w * d.y, g1.z * d.y - g1.w * d.x);
    if (tau.x < g3.x || tau.y < g3.y || tau.x > g3.z || tau.y > g3.w) { continue; }
    let g2 = hand_load(runs, g + 2u);
    let g4 = hand_load(runs, g + 4u);
    ink.loads += 2u;
    let since = t - g4.x;
    if (since <= 0.0) { continue; }
    let lod = clamp(log2(max(aa * length(g1.zw), 1.0e-6)), 0.0, levels);
    let inset = min(vec2f(0.5 * exp2(ceil(lod))), 0.5 * (g3.zw - g3.xy));
    let field = textureSampleLevel(atlas, samp, (g2.xy + clamp(tau, g3.xy + inset, g3.zw - inset)) / texels, lod);
    ink.samples += 1u;
    let dist = (field.r - HAND_EDGE) * edge.x * g2.z;
    let ramp = min(aa, 0.5 * edge.x * g2.z);
    // the fill at the glyph's pressure, over its bleed's stroke — the band `edge.y` wide about the outline, at the alpha × the
    // pressure — source-over, as the raster strokes then fills
    let fill = saturate(0.5 + dist / ramp) * g2.w;
    var glyph = fill;
    if (edge.y > 0.0) {
      let band = saturate(0.5 + (dist + 0.5 * edge.y) / ramp) - saturate(0.5 + (dist - 0.5 * edge.y) / ramp);
      glyph = fill + edge.z * g2.w * band * (1.0 - fill);
    }
    var written = 1.0;
    var fresh = 0.0;
    if (since < g4.y) {
      let ahead = (hand_ease(since / g4.y) - field.g) * g4.z;
      written = saturate(0.5 + ahead / aa);
      fresh = written * saturate(1.0 - ahead / (HAND_WET * g2.z));
    }
    let laid = glyph * written;
    bare *= 1.0 - laid;
    if (laid > most) { most = laid; ink.pen = u32(g4.w) & 15u; ink.wet = fresh; }
  }
  ink.cover = 1.0 - bare;
  return ink;
}
