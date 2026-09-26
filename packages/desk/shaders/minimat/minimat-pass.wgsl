// The mini mat pass (MINIMAT.md §6) — the desk's containers, instanced: one quad per mini mat,
// expanded on the vertex side by its shadow's reach and the AA. Two entries on one layout:
//
//   fs        the mini mat: its shadow, the vinyl with its print and its cut edge, the selection
//             ring — and, while no live inside covers it, the FACE's far LOD: the inside's lattice
//             and its children as CHIPS (a note's writing greeked). Where a live inside is drawn
//             (the ground draws it right after the mini mat — ground.ts `drawSlot`) the face is
//             plain vinyl under it: the inside's own mat covers it, the same lattice by the same lamp.
//   fs_chips  the chips again, OVER the live inside, at 1 − its presence — the far LOD fading out
//             as the inside's objects fade in (MINIMAT.md §5), drawn only while both are on.
//
// Premultiplied, through the presentation's opacity and the portal clip.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: MiniMatUniforms;
@group(0) @binding(2) var<storage, read> mats: array<MiniMat>;
@group(0) @binding(3) var<storage, read> chips: array<Chip>;
@group(0) @binding(4) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(5) var gobo_samp: sampler;
@group(0) @binding(6) var noise_tex: texture_2d<f32>;
@group(0) @binding(7) var noise_samp: sampler;
@group(0) @binding(8) var glyph_tex: texture_2d<f32>;     // the rulers' glyph atlas and the capitals (RULER.md, MINIMAT.md §2)
@group(0) @binding(9) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot (persistent records, D6)

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: a culled instance collapses
  let slot = order[iid];
  out.idx = slot;
  let M = &mats[slot];
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * mat_dpr(u));
  // the sheet's bounds, grown by everything the fragment can paint outside it: the slab's sweep, its penumbra, the contact, the AA
  let top = (*M).lift + (*M).thick;
  let pad = length((*M).slope) * top + 2.5 * (k.shadow.x + k.shadow.y * top) + 2.5 * k.shadow2.x + 3.0 * px;
  let lo = ((*M).centre - (*M).half - vec2f(pad) - u.cam.xy) * zoom;   // CSS px
  let hi = ((*M).centre + (*M).half + vec2f(pad) - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

// What a shadow is made of: the world's darkest value by day (the design's cast), the dark's own grey by night.
fn shadow_ink() -> vec3f { return mix(k.castTint.rgb, mm_encode(u.eigengrau.xyz), clamp(u.night.x, 0.0, 1.0)); }

// The children as CHIPS (MINIMAT.md §5), composited over `acc` (premultiplied): each flat on the
// face in its own colour, its contact shadow cast along the lamp's slope by its height, a note's
// writing greeked into strokes of ink along its lines' x-height once the chip is tall enough to
// read as writing, a mini mat of its own wearing its frame line. `s` is the inside's scale.
fn chips_on(M: MiniMat, p: vec2f, px: f32, css: f32, s: f32, gobo: f32, bn: vec3f, ink0: vec3f, grain3: vec3f, acc0: vec4f) -> vec4f {
  var acc = acc0;
  let S = M.slope;
  for (var i = 0u; i < M.chipCount; i++) {
    let C = &chips[M.chipFirst + i];
    let h = (*C).colour.w;
    let cr = (*C).rot;
    let ch = (*C).half;
    // the tilted chip's bounds, grown by its shadow's reach and the AA
    let ext = vec2f(abs(cr.x) * ch.x + abs(cr.y) * ch.y, abs(cr.y) * ch.x + abs(cr.x) * ch.y) + vec2f(length(S) * h + 3.0 * max(h, px) + 2.0 * px);
    let rel = p - (*C).centre;
    if (abs(rel.x) > ext.x || abs(rel.y) > ext.y) { continue; }
    let lq = vec2f(cr.x * rel.x + cr.y * rel.y, -cr.y * rel.x + cr.x * rel.y);
    let dc = sdf_round_box(lq, ch, (*C).radius);
    let rs = rel - S * h;
    let ls = vec2f(cr.x * rs.x + cr.y * rs.y, -cr.y * rs.x + cr.x * rs.y);
    let shc = mm_blur(sdf_round_box(ls, ch, (*C).radius), max(0.8 * h, 0.75 * px)) * 0.35 * (1.0 - mm_cov(dc, px));
    acc = mm_over(vec4f(ink0 * shc, shc), acc);
    if (dc > px) { continue; }
    let cc = mm_cov(dc, px);
    var lit = vec3f(0.0);
    if ((*C).kind > 0.5) {
      // a mini mat of its own: its vinyl with the grain, and its frame line just outside its face — never thinner than a device px
      let fm = (*C).frame.x;
      let w = max(k.print.w * s, px);
      let fr = mm_line(sdf_box(lq, max(ch - vec2f(fm), vec2f(1.0e-3))) - w, w, px) * k.print.x * min(k.print.w * s / px, 1.0) * 1.6;
      lit = mm_vinyl(u, mix((*C).colour.rgb + grain3, k.cream.rgb, min(fr, 1.0)), 1.0, gobo, bn.y);
    } else {
      var pa = (*C).colour.rgb;
      let n = u32((*C).frame.y);
      let tall = 2.0 * ch.y / css;
      let greek = smoothstep(0.6 * k.cream.w, k.cream.w, tall) * k.shadow2.z;
      if (greek > 0.0 && n > 0u) {
        var wl = 0.0;
        for (var j = 0u; j < n; j++) {
          let L = (*C).lines[j];
          wl = max(wl, mm_cov(sdf_segment(lq, vec2f(L.x, L.z), vec2f(L.y, L.z)) - (*C).ink.w, px));
        }
        pa = mix(pa, (*C).ink.rgb, wl * greek);
      }
      lit = mm_paper(u, pa, gobo, bn.y);
    }
    acc = mm_over(vec4f(lit * cc, cc), acc);
  }
  return acc;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let M = mats[in.idx];
  let dpr = mat_dpr(u);
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * dpr);          // world per device px
  let css = px * dpr;                    // world per CSS px
  let p = in.clip.xy * px + u.cam.xy;   // device px → world
  let q = p - M.centre;
  let d = sdf_round_box(q, M.half, M.radius);
  let ink0 = shadow_ink();
  let clip = M.alpha * u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr);

  // The slab's shadow on the desk, outside the sheet.
  var acc = vec4f(0.0);
  if (d > -px) {
    let sh = mm_slab(q, M.half, M.radius, M.lift, M.lift + M.thick, M.slope, k) * (1.0 - mm_cov(d, px));
    acc = vec4f(ink0 * sh, sh);
  }
  if (d > px) { return acc * clip; }
  let cov = mm_cov(d, px);

  // The vinyl: the mat's own sage and grain (mat.wgsl `mat_albedo`'s — screen-anchored, as the desk's is).
  let frag = in.clip.xy;
  let bn = textureSampleLevel(noise_tex, noise_samp, frag * u.noise.z + u.noise.xy, 0.0).rgb;
  var vinyl = M.ground.xyz;
  let amp = M.ground.w;
  var g = (hash12(frag * vec2f(0.73, 0.91)) - 0.5) * amp;
  g += (value_noise(frag * 0.45 + vec2f(u.view.z * 0.9, -u.view.z * 0.6)) - 0.5) * amp;
  g += (bn.x - 0.5) * amp * 0.5;
  vinyl += vec3f(g * 0.4, g, g * 0.35);

  // The inside's point under this fragment (host = o + inside · s), and inside units per device px.
  let s = max(M.inside.x, 1.0e-9);
  let a = (p - M.inside.yz) / s;
  let ipx = px / s;
  let fh = max(M.half - vec2f(M.margin), vec2f(1.0e-3));
  let inFace = max(abs(q.x) - fh.x, abs(q.y) - fh.y) < 0.0;
  let faceOwn = inFace && M.live < 0.0;   // the face is drawn here only where no live inside covers it

  // The lattice on the face, the print in the border — both the mat's cream, mixed in before the light.
  var lines = 0.0;
  if (faceOwn) { lines = mm_lattice(M, a, ipx); }
  let ink = mm_print(u, M, k, q, fh, a, px, ipx, zoom, glyph_tex, gobo_samp);
  let albedo = mix(mix(vinyl, k.cream.rgb, lines), k.cream.rgb, ink);

  // The light: the desk's lamp where the slot's light sees this point (MINIMAT.md §4) — the desk plane's
  // own dapple, as a live inside's mat takes it, so the face and the inside are lit alike; the cut edge's roll.
  let gobo = lit_gobo(u, gobo_tex, gobo_samp, p, 0.0, desk_of(u, p), bn.z);
  let bevel = mm_bevel(q, d, M, k);
  var col = vec4f(mm_vinyl(u, albedo, bevel, gobo, bn.y) * cov, cov);
  if (faceOwn && M.chipCount > 0u) { col = chips_on(M, p, px, css, s, gobo, bn, ink0, vinyl - M.ground.xyz, col); }

  // The sole-selection ring, inside the rim, in the theme's select.
  let ring = mm_line(d, k.edge.w * css, px) * M.ring;
  col = mm_over(vec4f(k.select.rgb * ring, ring), col);
  acc = mm_over(col, acc);
  return acc * clip;
}

@fragment
fn fs_chips(in: VSOut) -> @location(0) vec4f {
  let M = mats[in.idx];
  if (M.live < 0.0 || M.live >= 1.0 || M.chipCount == 0u) { discard; }
  let fade = 1.0 - M.live;
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let p = in.clip.xy * px + u.cam.xy;
  let q = p - M.centre;
  let fh = max(M.half - vec2f(M.margin), vec2f(1.0e-3));
  if (max(abs(q.x) - fh.x, abs(q.y) - fh.y) >= 0.0) { discard; }
  let bn = textureSampleLevel(noise_tex, noise_samp, in.clip.xy * u.noise.z + u.noise.xy, 0.0).rgb;
  let gobo = lit_gobo(u, gobo_tex, gobo_samp, p, 0.0, desk_of(u, p), bn.z);
  let frag = in.clip.xy;
  let amp = M.ground.w;
  var g = (hash12(frag * vec2f(0.73, 0.91)) - 0.5) * amp;
  g += (value_noise(frag * 0.45 + vec2f(u.view.z * 0.9, -u.view.z * 0.6)) - 0.5) * amp;
  g += (bn.x - 0.5) * amp * 0.5;
  let acc = chips_on(M, p, px, px * dpr, max(M.inside.x, 1.0e-9), gobo, bn, shadow_ink(), vec3f(g * 0.4, g, g * 0.35), vec4f(0.0));
  if (acc.a < 0.002) { discard; }
  return acc * (fade * M.alpha * u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
