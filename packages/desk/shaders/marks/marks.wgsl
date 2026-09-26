// The MARKS — the desk's chrome as SDF terms (design-015 §7, stratum 5; D4a): *Marks on the Mat*'s
// reference drawing code (vibe-field/draft/desk-chrome/chrome.js) as distances. Every mark is ONE
// record (a `Mark`, laid out on the CPU by src/marks/layout.ts in SCREEN px — the chrome keeps its size
// at every zoom), shaded here into a premultiplied colour: an outline or a fill of a turned rounded
// box (a frame, a ring, a knob, the vellum, a pill), the four brackets of a frame, a segment (solid or
// dotted, a laser's line), a gap's bar with its end ticks, a flare, a glyph of the rulers' mono atlas
// (with its halo), a strip of masking tape, a remote person's hand (D5a). Light is ADDED: a mark flagged so returns alpha 0 over its
// colour, which the pass's premultiplied blend turns into dst + src — Canvas2D's "lighter".
// Pure: every resource is a parameter (engine/shader.ts's rule).

const MARK_STROKE: f32 = 0.0;
const MARK_FILL: f32 = 1.0;
const MARK_BRACKETS: f32 = 2.0;
const MARK_SEGMENT: f32 = 3.0;
const MARK_BAR: f32 = 4.0;
const MARK_FLARE: f32 = 5.0;
const MARK_GLYPH: f32 = 6.0;
const MARK_TAPE: f32 = 7.0;
const MARK_HAND: f32 = 8.0;

/** Coverage of a distance (CSS px) over one DEVICE px of ramp. */
fn marks_cov(sd: f32, dpr: f32) -> f32 { return clamp(0.5 - sd * dpr, 0.0, 1.0); }

/** A screen point in a mark's own frame: about its centre, turned by −angle (positive turns clockwise on screen, y down). */
fn marks_local(p: vec2f, c: vec2f, angle: f32) -> vec2f {
  let d = p - c;
  let cs = cos(angle);
  let sn = sin(angle);
  return vec2f(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
}

/**
 * The distance to the four BRACKETS of a rounded frame (half extents X, Y, corner r), each reaching L from its
 * corner along both sides (chrome.js `bracketsPath`): folded into one quadrant, the run along the top edge from
 * its end to the arc, the arc, and the run down the side — round caps come from the distance itself.
 */
fn marks_brackets(p: vec2f, X: f32, Y: f32, r: f32, L: f32) -> f32 {
  let q = abs(p);
  let top = length(q - vec2f(clamp(q.x, X - L, X - r), Y));
  let side = length(q - vec2f(X, clamp(q.y, Y - L, Y - r)));
  var d = min(top, side);
  let v = q - vec2f(X - r, Y - r);
  if (r > 0.0 && v.x >= 0.0 && v.y >= 0.0) { d = min(d, abs(length(v) - r)); }
  return d;
}

/** The distance to a dotted line A→B: a dot every `period` from A (Canvas2D's `[0.01, period − 0.01]` dash with round caps). */
fn marks_dotted(p: vec2f, a: vec2f, b: vec2f, period: f32) -> f32 {
  let ab = b - a;
  let len = length(ab);
  let dir = ab / max(len, 1e-6);
  let k = clamp(round(dot(p - a, dir) / period), 0.0, floor(len / period));
  return length(p - (a + dir * (k * period)));
}

/** A gap's bar: the segment A→B and a tick `tick` either side of it at each end, one stroke. */
fn marks_bar(p: vec2f, a: vec2f, b: vec2f, tick: f32) -> f32 {
  let ab = b - a;
  let n = vec2f(-ab.y, ab.x) / max(length(ab), 1e-6) * tick;
  return min(sdf_segment(p, a, b), min(sdf_segment(p, a - n, a + n), sdf_segment(p, b - n, b + n)));
}

/** Masking tape's torn outline (desk.css `.obj-tape i` clip-path), unit square, clockwise from the top-left. */
const TAPE_EDGE = array<vec2f, 12>(
  vec2f(0.03, 0.0), vec2f(0.97, 0.04), vec2f(1.0, 0.22), vec2f(0.96, 0.40), vec2f(1.0, 0.60), vec2f(0.97, 0.80),
  vec2f(1.0, 1.0), vec2f(0.02, 0.96), vec2f(0.0, 0.78), vec2f(0.04, 0.58), vec2f(0.0, 0.40), vec2f(0.03, 0.20),
);

/** The signed distance to the tape's outline, the strip `half` in its own frame (Quilez's polygon). */
fn marks_tape_sd(p: vec2f, half: vec2f) -> f32 {
  let v0 = (TAPE_EDGE[0] - 0.5) * 2.0 * half;
  var d = dot(p - v0, p - v0);
  var s = 1.0;
  for (var i = 0u; i < 12u; i++) {
    let j = (i + 11u) % 12u;
    let vi = (TAPE_EDGE[i] - 0.5) * 2.0 * half;
    let vj = (TAPE_EDGE[j] - 0.5) * 2.0 * half;
    let e = vj - vi;
    let w = p - vi;
    let b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    let c0 = p.y >= vi.y;
    let c1 = p.y < vj.y;
    let c2 = e.x * w.y > e.y * w.x;
    if ((c0 && c1 && c2) || (!c0 && !c1 && !c2)) { s = -s; }
  }
  return s * sqrt(d);
}

/** CSS `saturate(s) brightness(b)` on an sRGB colour (the Filter Effects matrix). */
fn marks_moonlit(c: vec3f, s: f32, b: f32) -> vec3f {
  let r = vec3f(0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s);
  let g = vec3f(0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s);
  let bl = vec3f(0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s);
  return clamp(vec3f(dot(r, c), dot(g, c), dot(bl, c)) * b, vec3f(0.0), vec3f(1.0));
}

/** One texel sample of a cell (texels from its top-left, kept inside the cell: a neighbour's glyph never bleeds in). */
fn marks_glyph_at(t: vec2f, cell: f32, size: vec2f, atlas: vec4f, tex: texture_2d<f32>, samp: sampler) -> f32 {
  let at = vec2f(cell * atlas.w, 0.0) + clamp(t, vec2f(0.5), size - 0.5);
  return textureSampleLevel(tex, samp, at / atlas.xy, 0.0).r;
}

/** The glyph atlas's coverage at a point of a cell's own frame (CSS px from its top-left; the cell `size` CSS px), `halo` > 0 = its coverage dilated that far. */
fn marks_glyph_cov(q: vec2f, cell: f32, size: vec2f, atlas: vec4f, halo: f32, tex: texture_2d<f32>, samp: sampler) -> f32 {
  let scale = atlas.z;
  let t = q * scale;
  let s = size * scale;
  var c = marks_glyph_at(t, cell, s, atlas, tex, samp);
  if (halo > 0.0) {
    for (var i = 0; i < 8; i++) {
      let a = f32(i) * 0.785398163;
      let o = vec2f(cos(a), sin(a)) * halo * scale;
      c = max(c, marks_glyph_at(t + o, cell, s, atlas, tex, samp));
      c = max(c, marks_glyph_at(t + o * 0.5, cell, s, atlas, tex, samp));
    }
  }
  return c;
}

// A remote person's HAND (D5a, D-D5a.1 — desk.js `ensureAgentCursor`'s arrow): the path in its own 16 × 20 box, CSS px,
// its first vertex the tip (theme.ts `MARKS.hand.path`; src/marks/mirror.ts `handDistance` and the desk's units hold the
// three to each other). Signed (≤ 0 inside), even-odd — the polygon distance of iquilezles.org's 2D distance functions.
const HAND_TIP = vec2f(1.5, 1.5);
fn marks_hand_sd(q: vec2f) -> f32 {
  var v = array<vec2f, 7>(vec2f(1.5, 1.5), vec2f(1.5, 16.0), vec2f(5.4, 12.4), vec2f(8.2, 18.6), vec2f(10.8, 17.4), vec2f(8.0, 11.3), vec2f(13.4, 11.1));
  var d = dot(q - v[0], q - v[0]);
  var s = 1.0;
  var j = 6u;
  for (var i = 0u; i < 7u; i = i + 1u) {
    let e = v[j] - v[i];
    let w = q - v[i];
    let b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    let above = q.y >= v[i].y;
    let below = q.y < v[j].y;
    let left = e.x * w.y > e.y * w.x;
    if ((above && below && left) || (!above && !below && !left)) { s = -s; }
    j = i;
  }
  return s * sqrt(d);
}

/**
 * One mark at screen point `p` (CSS px), premultiplied — alpha 0 when it is light (added). `atlas` = the glyph atlas's
 * width, height (texels), texels per CSS px and cell width (texels).
 */
fn marks_shade(M: Mark, p: vec2f, dpr: f32, atlas: vec4f, tex: texture_2d<f32>, samp: sampler) -> vec4f {
  let kind = M.shape.x;
  let width = M.shape.z;
  var cov = 0.0;
  var col = M.colour;
  if (kind == MARK_STROKE || kind == MARK_FILL || kind == MARK_BRACKETS) {
    let q = marks_local(p, M.centre.xy, M.centre.z);
    let sd = sdf_round_box(q, M.half.xy, M.centre.w);
    if (kind == MARK_STROKE) {
      cov = marks_cov(abs(sd) - 0.5 * width, dpr);
    } else if (kind == MARK_FILL) {
      cov = marks_cov(sd, dpr);
    } else {
      cov = marks_cov(marks_brackets(q, M.half.x, M.half.y, M.centre.w, M.shape.w) - 0.5 * width, dpr);
    }
  } else if (kind == MARK_SEGMENT) {
    let d = select(sdf_segment(p, M.centre.xy, M.half.xy), marks_dotted(p, M.centre.xy, M.half.xy, M.aux.x), M.aux.x > 0.0);
    cov = marks_cov(d - 0.5 * width, dpr);
  } else if (kind == MARK_BAR) {
    cov = marks_cov(marks_bar(p, M.centre.xy, M.half.xy, M.aux.x) - 0.5 * width, dpr);
  } else if (kind == MARK_FLARE) {
    // a radial gradient: the core at the centre, the laser at `stop`, nothing at the rim — interpolated premultiplied
    let t = length(p - M.centre.xy) / M.centre.w;
    if (t >= 1.0) { return vec4f(0.0); }
    let core = vec4f(M.aux.rgb * M.aux.a, M.aux.a);
    let mid = vec4f(M.colour.rgb * M.colour.a, M.colour.a);
    let stop = M.half.x;
    let c = select(mix(mid, vec4f(0.0), (t - stop) / (1.0 - stop)), mix(core, mid, t / stop), t < stop);
    return vec4f(c.rgb, select(c.a, 0.0, (u32(M.shape.y) & 1u) != 0u));
  } else if (kind == MARK_GLYPH) {
    // the cell turned about its centre (`centre.xy`), its own frame from its top-left; a halo reaches `aux.y` past it
    let q = marks_local(p, M.centre.xy, M.centre.z) + 0.5 * M.half.xy;
    let h = M.aux.y;
    if (q.x < -h || q.y < -h || q.x > M.half.x + h || q.y > M.half.y + h) { return vec4f(0.0); }
    cov = marks_glyph_cov(q, M.aux.x, M.half.xy, atlas, h, tex, samp);
  } else if (kind == MARK_TAPE) {
    // the strip in its own frame: its torn outline, its fibres (1 in `every` object units), a light from above, moonlit by night
    let q = marks_local(p, M.centre.xy, M.centre.z);
    let half = M.half.xy;
    cov = marks_cov(marks_tape_sd(q, half), dpr);
    let uv = (q + half) / (2.0 * half);
    let units = M.aux.x;   // CSS px per object unit
    let sheen = mix(vec4f(1.0, 1.0, 1.0, M.half.z), vec4f(0.0, 0.0, 0.0, M.half.w), clamp(uv.y, 0.0, 1.0));
    var c = vec4f(M.colour.rgb * M.colour.a, M.colour.a);
    c = vec4f(sheen.rgb * sheen.a, sheen.a) + c * (1.0 - sheen.a);
    let every = M.shape.w;
    let x = (q.x + half.x) / max(units, 1e-6);
    let seen = clamp(every * units * dpr / 3.0 - 0.5, 0.0, 1.0);   // fibres under ~1.5 device px each fade to the mean
    let fibre = select(0.0, 1.0, fract(x / every) < 1.0 / every) * seen + (1.0 - seen) / every;
    let fa = M.aux.w * fibre;
    c = vec4f(vec3f(fa), fa) + c * (1.0 - fa);
    let rgb = marks_moonlit(c.rgb / max(c.a, 1e-6), M.aux.y, M.aux.z);
    let a = c.a * cov * M.centre.w;
    return vec4f(rgb * a, a);
  } else if (kind == MARK_HAND) {
    // the hand in its own box (the tip at `centre.xy` is the path's first vertex): its shadow on the mat (the hand with its
    // rim, moved by `half.xy`, softened over ± `half.z`, in `aux`), the hand in the peer's colour over it, the white rim over both
    let q = p - M.centre.xy + HAND_TIP;
    let rim = 0.5 * width;
    let sd = marks_hand_sd(q);
    let sds = marks_hand_sd(q - M.half.xy) - rim;
    let drop = M.aux.a * clamp(0.5 - sds / (2.0 * M.half.z), 0.0, 1.0);
    var c = vec4f(M.aux.rgb * drop, drop);
    let body = M.colour.a * marks_cov(sd, dpr);
    c = vec4f(M.colour.rgb * body, body) + c * (1.0 - body);
    let edge = marks_cov(abs(sd) - rim, dpr);
    return vec4f(vec3f(edge), edge) + c * (1.0 - edge);
  }
  let a = col.a * cov;
  return vec4f(col.rgb * a, select(a, 0.0, (u32(M.shape.y) & 1u) != 0u));
}
