// THE MARKS — what a sheet's marks lay at a point, read in a kind's own fragment shader beside its ink (petition I60, "Editing the
// Ink": the pen draws every mark the way it draws a letter, when the mark is made and never when a desk opens). A run built from an
// ink (kit/hand-run.ts `handRun({ ink })`) carries a MARKS SECTION after its glyphs (kit/ink-strokes.ts says its vec4s): the strokes as
// the pen draws them — a highlighter's band, a line through the words, a line under them — each with its moment, listed in rows an
// em tall so a fragment reads only its own row's few; and the selection's WASH, one rect a laid line, rewritten alone as the
// selection changes. `ink_marks` reads them: what lies UNDER the ink at a point (the highlighters' cover and which; the wash's) and
// what lies OVER it (a line's cover and its pen). A stroke is analytic — a centre line that tilts and wobbles, its ends run past the
// words — so no atlas is read; on paper without marks the read loads ONE run texel. kit/ink-marks.ts `inkMarksAt` is its CPU twin.
//
// THE KIT'S `marks` PIECE (`kitWgsl([..., "marks"])`; it reads the run with `hand`'s `hand_load` and eases with its `hand_ease`, so
// asking for `marks` composes `hand` too; petition I31 — every declaration's `///` block says what it takes and gives). PURE: the run
// store is the kind's own binding, passed as `hand_ink` takes it. UNITS and TIME are `hand_ink`'s: a point and the AA width in the
// run's units (the layout's), the AA width worked out outside any loop; `now` the pen's clock as `penNow(ms)` splits it. A VALUE is a
// highlighter's number (n: `HIGHLIGHTERS[n − 1]`) or a pen's (0 the sheet's own, n `PENS[n − 1]`), numbered as `HandInk.pen` is: the
// KIND's palette gives the colours, and it lays them in the paper's order — the highlighter (it stains the paper), the wash, the ink,
// the lines over it.

/// The marks' head in a run (kit/ink-strokes.ts `INK_MARKS.head`): vec4 4 of its header — `at strokes wy0 wy1`: where the section
/// begins (vec4s from the base; 0 — none), its strokes, and the wash's extent in y (`wy1` ≤ `wy0`: nothing washed).
const INK_HEAD: u32 = 4u;
/// One stroke of a run's marks, vec4s (`INK_MARKS.stroke`): its ends and reach, its width and wobble, its phases and code, its moment.
const INK_STROKE: u32 = 4u;
/// The wobble's slow wavelength and its quick one (at half the height), em of the layout (`INK_MARKS.wave`).
const INK_WAVE: vec2f = vec2f(2.6, 0.9);
/// The widest edge ramp, em (`INK_MARKS.ramp`): a sheet whose device px is wider is its kind's to greek.
const INK_RAMP: f32 = 0.25;
/// How far the wash's rect is grown across each end of its line, em (kit/ink-strokes.ts `INK_WASH.pad`).
const INK_WASH_PAD: f32 = 0.04;
/// The wash's corners' radius, em (`INK_WASH.radius`), never more than half its rect.
const INK_WASH_RADIUS: f32 = 0.09;

/// What a sheet's marks lay at a point. UNDER the ink: `marker` — the highlighters' cover, 0..1 (its presence in it), the most any
/// laid there, and `tint` — which highlighter laid it (n: `HIGHLIGHTERS[n − 1]`; 0 none); `wash` — the selection's cover, 0..1 (the
/// kind lays its pencil at its own presence). OVER the ink: `line` — the strikes' and underlines' cover, 0..1 (its presence in it),
/// the most any laid, and `pen` — its pen (0 the sheet's own, n `PENS[n − 1]`). `loads` — the run texels the read loaded (a witness:
/// its cost).
struct InkMarks { marker: f32, tint: u32, wash: f32, line: f32, pen: u32, loads: u32 }

/// An angle brought within half a turn of 0 (the GPU's sine is held to its error bound only there).
/// `a` — radians.
/// → the same angle, in [−π, π].
fn ink_turn(a: f32) -> f32 {
  return a - 6.2831855 * round(a / 6.2831855);
}

/// The selection's WASH on one laid line at a point: its rect, grown across by `INK_WASH_PAD` em, its corners rounded.
/// `r` — the line's rect, `x0 y0 x1 y1` (the run's units); `p` — the point; `em` — the layout's em, units; `ramp` — the edge's
/// ramp, units (a device px, never wider than `INK_RAMP` em).
/// → its cover, 0..1.
fn ink_wash(r: vec4f, p: vec2f, em: f32, ramp: f32) -> f32 {
  let c = 0.5 * (r.xy + r.zw);
  let h = vec2f(0.5 * (r.z - r.x) + INK_WASH_PAD * em, 0.5 * (r.w - r.y));
  let k = min(INK_WASH_RADIUS * em, min(h.x, h.y));
  let q = abs(p - c) - h + k;
  let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - k;
  return saturate(0.5 - d / ramp);
}

/// One STROKE at a point: its cover and how far along it the point lies. Its centre line at x (clamped to its ends) is
/// `y + slope·(x − mid) + amp·(sin(2π(x − x0)/(2.6 em) + p1) + ½ sin(2π(x − x0)/(0.9 em) + p2))`. A highlighter's band is measured
/// straight down from it, its ends cut on the chisel's lean; a pen line is the distance to it, its ends round.
/// `s0` — `x0 x1 y reach` (its ends, its centre line at its middle, its ink's reach); `s1` — `hw slope amp press` (half its width,
/// its tilt, the wobble's height, its presence); `s2` — `p1 p2 lean code` (the wobble's phases, a highlighter's lean, its code: the
/// kind in its two low bits, 0 a highlighter); `p` — the point; `em` — the layout's em, units; `ramp` — the edge's ramp, units.
/// → `x` its cover, 0..1 (its presence in it); `y` how far along it the point lies, 0..1.
fn ink_stroke(s0: vec4f, s1: vec4f, s2: vec4f, p: vec2f, em: f32, ramp: f32) -> vec2f {
  let w = 6.2831855 / (INK_WAVE * em);
  let xc = clamp(p.x, s0.x, s0.y);
  let d = xc - s0.x;
  let a1 = ink_turn(w.x * d + s2.x);
  let a2 = ink_turn(w.y * d + s2.y);
  let yc = s0.z + s1.y * (xc - 0.5 * (s0.x + s0.y)) + s1.z * (sin(a1) + 0.5 * sin(a2));
  let len = max(s0.y - s0.x, 1.0e-6);
  if ((u32(s2.w) & 3u) == 0u) {
    let lean = (p.y - yc) * s2.z;
    let dist = max(abs(p.y - yc) - s1.x, max(s0.x + lean - p.x, p.x - (s0.y + lean)));
    return vec2f(saturate(0.5 - dist / ramp) * s1.w, saturate((p.x - lean - s0.x) / len));
  }
  let dy = s1.y + s1.z * (w.x * cos(a1) + 0.5 * w.y * cos(a2));
  let dist = length(vec2f(p.x - xc, (p.y - yc) * inverseSqrt(1.0 + dy * dy))) - s1.x;
  return vec2f(saturate(0.5 - dist / ramp) * s1.w, d / len);
}

/// How much of a stroke the pen has drawn at a point along it. The stretch on the paper before shows whole; before its pen sets off
/// nothing else does; while it draws, a point shows once the pen's eased progress — pulled from where the new stretch starts to where
/// it ends — has passed it, ramped over a device px of the stroke; once its time is out it is whole.
/// `s3` — the stroke's moment, `start dur h0 h1` (ms from the run's epoch; `[h0, h1]` the stretch on the paper before, 0..1 along
/// it — `[1, 0]` none); `u` — how far along it the point lies, 0..1; `t` — ms since the run's epoch; `len` — its length, units;
/// `aa` — one device px, units.
/// → 0..1: how much of it is drawn there.
fn ink_drawn(s3: vec4f, u: f32, t: f32, len: f32, aa: f32) -> f32 {
  let since = t - s3.x;
  if (since >= s3.y || (u >= s3.z && u <= s3.w)) { return 1.0; }
  if (since <= 0.0) { return 0.0; }
  let lo = select(0.0, s3.w, s3.z <= 0.004);
  let hi = select(1.0, s3.z, s3.w >= 0.996);
  let front = lo + (hi - lo) * hand_ease(since / s3.y);
  return saturate(0.5 + (front - u) * len / aa);
}

/// THE MARKS at a point: what a sheet's marks lay at `p` at `now`, under its ink and over it. The marks' head first (no section, or
/// no stroke and the point outside the wash's rows: nothing, one load); then the row under the point (outside the rows: nothing) —
/// the wash of each laid line whose caret band meets the row, and each stroke the row lists: its reach (outside: next, one load),
/// its cover, and how much of it the pen has drawn by `now`. A stroke whose value changed (a recolour) shows the value it had where
/// its pen has not reached yet. Highlighters combine by the most each lays, and lines alike.
/// `runs` — the kind's run store (`texture_2d<f32>` over `rgba32float`, as `hand_ink` takes it); `base` — the run's base in the store;
/// `p` — the point, the run's units (the layout's: note units from the sheet's top-left, y down); `now` — the pen's clock,
/// `penNow(ms)`: whole seconds (x) and the ms past them (y); `aa` — one device px in the run's units, > 0, worked out outside any loop.
/// → the marks there (`InkMarks`): under the ink, over it, and what the read took.
fn ink_marks(runs: texture_2d<f32>, base: u32, p: vec2f, now: vec2f, aa: f32) -> InkMarks {
  var m = InkMarks(0.0, 0u, 0.0, 0.0, 0u, 1u);
  let head = hand_load(runs, base + INK_HEAD);
  let washed = p.y >= head.z && p.y < head.w;
  if (head.x == 0.0 || (head.y == 0.0 && !washed)) { return m; }
  let at = base + u32(head.x);
  let m0 = hand_load(runs, at);
  m.loads += 1u;
  let fr = (p.y - m0.x) * m0.y;
  if (fr < 0.0 || fr >= m0.z) { return m; }
  let row = hand_load(runs, at + 1u + u32(fr));
  m.loads += 1u;
  let em = 1.0 / m0.y;
  let ramp = min(aa, INK_RAMP * em);
  if (washed) {
    for (var l = u32(row.z); l < u32(row.w); l++) {
      let r = hand_load(runs, at + u32(m0.w) + l);
      m.loads += 1u;
      if (r.z > r.x) { m.wash = max(m.wash, ink_wash(r, p, em, ramp)); }
    }
  }
  let n = u32(row.y);
  if (n == 0u) { return m; }
  let clock = hand_load(runs, base + 2u);
  m.loads += 1u;
  let t = (now.x - clock.z) * 1000.0 + (now.y - clock.w);
  let strokes = at + 1u + u32(m0.z);
  let list = strokes + INK_STROKE * u32(head.y);
  let first = u32(row.x);
  var four = vec4f(0.0);
  for (var k = 0u; k < n; k++) {
    let e = first + k;
    if (k == 0u || (e & 3u) == 0u) { four = hand_load(runs, list + e / 4u); m.loads += 1u; }
    let s = strokes + u32(four[e & 3u]) * INK_STROKE;
    let s0 = hand_load(runs, s);
    m.loads += 1u;
    let reach = s0.w + 0.5 * ramp;
    if (p.x < s0.x - reach || p.x > s0.y + reach || abs(p.y - s0.z) > reach) { continue; }
    let s1 = hand_load(runs, s + 1u);
    let s2 = hand_load(runs, s + 2u);
    let s3 = hand_load(runs, s + 3u);
    m.loads += 3u;
    let cu = ink_stroke(s0, s1, s2, p, em, ramp);
    if (cu.x <= 0.0) { continue; }
    let drawn = ink_drawn(s3, cu.y, t, s0.y - s0.x, aa);
    let code = u32(s2.w);
    var laid = cu.x * drawn;
    var v = (code >> 2u) & 7u;
    if ((code >> 5u) > 0u) {
      laid = cu.x;
      v = select((code >> 5u) - 1u, v, drawn >= 0.5);
    }
    if ((code & 3u) == 0u) {
      if (laid > m.marker) { m.marker = laid; m.tint = v; }
    } else if (laid > m.line) {
      m.line = laid;
      m.pen = v;
    }
  }
  return m;
}
