// The magnet-grid maths. A PURE module: no bindings. The uniform block and the
// atlas texture arrive as parameters, so the entry alone decides the binding
// layout. `Uniforms` and `Card` are generated from src/field/layout.ts and
// prepended by the engine before this text.
//
// Every function body here is the validated prototype's, unchanged — except
// that a glyph is one size on every rung (`fit_hl` takes no rung multiplier).

fn sd_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let rr = min(r, min(b.x, b.y));
  let q = abs(p) - b + vec2f(rr, rr);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rr;
}

fn round_box_normal(p: vec2f, b: vec2f, r: f32) -> vec2f {
  let s = sign(p);
  let inner = max(b - vec2f(r, r), vec2f(0.0));
  let d = abs(p) - inner;
  if (d.x > 0.0 && d.y > 0.0) {
    let n = length(d);
    if (n > 0.0001) { return s * (d / n); }
    return vec2f(s.x, 0.0);
  }
  if (d.x > d.y) { return vec2f(s.x, 0.0); }
  return vec2f(0.0, s.y);
}

fn safe_normalize(v: vec2f, fallback: vec2f) -> vec2f {
  let n = length(v);
  if (n > 0.0001) { return v / n; }
  return fallback;
}

fn zoom(u: Uniforms) -> f32 { return max(u.cam.z, 1e-12); }
fn dpr(u: Uniforms) -> f32 { return max(u.cam.w, 1.0); }
fn aa_px(u: Uniforms) -> f32 { return max(0.6 / dpr(u), 0.35); }
fn rest_dir(u: Uniforms) -> vec2f { return safe_normalize(u.glyph.xy, vec2f(0.0, 1.0)); }

// World -> screen for a lattice site. The camera is pre-wrapped to the coarse
// period on the CPU so round(world / spacing) stays exact at any zoom.
fn site_screen(u: Uniforms, site_world: vec2f) -> vec2f {
  return (site_world - u.phase.xy) * zoom(u);
}

fn rung_spacing(u: Uniforms, rung: f32) -> f32 {
  return select(select(u.rungs.x, u.rungs.y, rung > 0.5), u.rungs.z, rung > 1.5);
}

// One size for every rung; a rung's alpha is smoothstep(fadeIn, its OWN cell
// in px): the site that is the fine rung at a 20 px cell becomes the mid rung
// at a 20 px cell with the same size and the same alpha, so a decade wrap
// cannot pop. (The prototype's size ladder is gone — lod.ts.)
fn rung_alpha(u: Uniforms, rung: f32) -> f32 {
  return smoothstep(u.lod.x, u.lod.y, rung_spacing(u, rung) * zoom(u));
}

fn fit_hl(u: Uniforms, cell_px: f32) -> f32 { return min(u.glyph.z, cell_px * 0.42); }
fn fit_hw(u: Uniforms, cell_px: f32) -> f32 { return min(u.glyph.w, cell_px * 0.42 * 0.22); }

// The PRESET size ranges (CSS px), applied LAST: whatever the rung multiplier,
// the cell fit and the field influence made of the base size, the drawn glyph
// stays inside them. Monotonic, so the clamped maximum is the clamp of the
// maximum — the entries size their quads and culls with the same calls.
fn dot_radius(u: Uniforms, r: f32) -> f32 { return clamp(r, u.dotRange.x, u.dotRange.y); }
fn needle_len(u: Uniforms, l: f32) -> f32 { return clamp(l, u.needleRange.x, u.needleRange.y); }
fn needle_wid(u: Uniforms, w: f32) -> f32 { return clamp(w, u.needleRange.z, u.needleRange.w); }

// A site whose index is a multiple of ten on both axes also belongs to the next
// coarser rung, which always draws the larger glyph at the same alpha; letting it
// own the site reproduces the reference's max() compositing exactly.
fn promoted(idx: vec2f) -> bool {
  return abs(idx.x - round(idx.x / 10.0) * 10.0) < 0.5 &&
         abs(idx.y - round(idx.y / 10.0) * 10.0) < 0.5;
}

fn cover_dot(screen: vec2f, site: vec2f, radius: f32, aa: f32) -> f32 {
  return 1.0 - smoothstep(max(radius - aa, 0.0), radius + aa, length(screen - site));
}

fn cover_needle(screen: vec2f, site: vec2f, dir: vec2f, hl: f32, hw: f32, aa: f32) -> f32 {
  let rel = screen - site;
  let nrm = vec2f(-dir.y, dir.x);
  let local = vec2f(dot(rel, nrm), dot(rel, dir));
  let across = 1.0 - smoothstep(max(hw - aa, 0.0), hw + aa, abs(local.x));
  let along = 1.0 - smoothstep(max(hl - aa, 0.0), hl + aa, abs(local.y));
  return across * along;
}

// Field at one lattice site: the baked CARD field from the atlas (a textureLoad
// that lands exactly on the texel written for this site — no filtering) plus
// the CURSOR, added analytically so pointer motion never invalidates the atlas.
// The cursor's STRENGTH is `u.flags.z` (design-013 C2, D-C2.2: a host's pointer
// pole rides this term, strength and all); a plain cursor is 1, and `× 1.0` is
// the old expression bit for bit.
fn field_at_site(u: Uniforms, atlas_tex: texture_2d<f32>, atlas_idx: vec2f, screen: vec2f) -> vec3f {
  var f = vec2f(0.0);
  if (u.flags.y > 0.5) {
    let to_pole = u.view.zw - screen;
    let r2 = dot(to_pole, to_pole) + u.field.y;
    f += safe_normalize(to_pole, rest_dir(u)) * (u.field.x * u.field.z * u.flags.z / r2);
  }
  let t = vec2i(round(atlas_idx - u.atlas.xy));
  let dims = vec2i(u.atlas.zw);
  if (t.x < 0 || t.y < 0 || t.x >= dims.x || t.y >= dims.y) {
    return vec3f(f, 1e9);
  }
  let s = textureLoad(atlas_tex, t, 0);
  return vec3f(f + s.xy, s.z);
}

// Site index in atlas-step units for a site of the given rung.
fn atlas_index(u: Uniforms, idx: vec2f, spacing: f32) -> vec2f {
  return idx * round(spacing / u.phase.w);
}

// The glyph's rest-vs-field direction, shared by both needle entries.
fn needle_dir(u: Uniforms, field: vec2f) -> vec2f {
  let mag = length(field);
  let influence = clamp(mag, 0.0, 1.0);
  let fdir = safe_normalize(field, rest_dir(u));
  if (u.field.w > 0.5) { return fdir; }
  return safe_normalize(mix(rest_dir(u), fdir, influence), rest_dir(u));
}
