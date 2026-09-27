// The calendar pass's entries (CALENDAR.md §6). A pad's record is always read through a POINTER into the storage
// buffer (`&pads[i]`): a by-value copy of it (a kilobyte, with arrays indexed at run time) is pushed out of
// registers into memory and cost a full-screen pad ~10 ms. Into a 4× multisampled layer, per calendar:
//   vs_moving · fs_sheet  the sheet in motion (first, so the month it covers is skipped by the depth test): a grid
//                         laid on the sheet, its rows fine only where the roll is, bent by the roll (cal_roll)
//   vs_pad    · fs_face   the month on the pad: its face — the largest thing on the screen, a lean shader of its own
//   vs_pad    · fs_sheet  the roll of the months before (seen from behind as much as not)
//   vs_pad    · fs_solid  the pad's solid parts: its sides, the chipboard, the cloth tape (a lean shader of their own)
//   vs_recv   · fs_recv   the mat under it: its shadow, its contact, its selection ring — after the pad, so
//                         the depth test skips every pixel the pad covers
// The layer is resolved and laid on the mat INSIDE the ground's pass, before the cards and the notes
// (ground.ts `underlays`): the pad lies beneath everything else on the desk.
// The view block `u` is the SLOT's since K4a (design-016 K-L3), shared with the mat and every kind: this layer is drawn at FULL
// presence, as it always was (the pass's own copy of the block carried no presentation, and the composite lays the layer whole),
// so it reads neither `u.view.w` (the objects' presence) nor `u.presence.x` (the slot's) — its alpha is its coverage alone.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: CalUniforms;
@group(0) @binding(2) var<storage, read> pads: array<CalPad>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var tile_tex: texture_2d_array<f32>;   // the print's tiles (straight alpha), 260² each
@group(0) @binding(8) var tile_samp: sampler;
@group(0) @binding(9) var<storage, read> tiles: array<i32>;  // the page tables: a layer, −1 missing, −2 empty
@group(0) @binding(10) var paper_tex: texture_2d<f32>;
@group(0) @binding(11) var paper_samp: sampler;

// The print at a sheet point, from the table `slot`: the level at or above the screen's density (`bias`
// rungs coarser), falling back a rung at a time to one that is there. Transparent where nothing is printed.
fn cal_tile(slot: f32, q: vec2f, px: f32, bias: i32) -> vec4f {
  if (slot < 0.0) { return vec4f(0.0); }
  let base = i32(slot + 0.5) * i32(k.tiles.x + 0.5);
  var l = clamp(i32(ceil(2.0 * log2(max(1.0 / px, 1e-6) / 0.25) - 1e-3)) - bias, 0, 10);
  for (var i = 0; i < 11; i++) {
    let band = 0.25 * exp2(f32(l) * 0.5);
    let t = q * (band / k.tiles.y);
    let ti = vec2i(floor(t));
    let nx = i32(k.tileNx[l / 4][l % 4] + 0.5);
    let ny = i32(k.tileNy[l / 4][l % 4] + 0.5);
    if (ti.x < 0 || ti.y < 0 || ti.x >= nx || ti.y >= ny) { return vec4f(0.0); }
    let e = tiles[base + i32(k.tileOff[l / 4][l % 4] + 0.5) + ti.y * nx + ti.x];
    if (e >= 0) {
      let uv = (fract(t) * k.tiles.y + vec2f(k.tiles.z)) / k.tiles.w;
      return textureSampleLevel(tile_tex, tile_samp, uv, e, 0.0);
    }
    if (e == -2 || l == 0) { return vec4f(0.0); }
    l -= 1;
  }
  return vec4f(0.0);
}

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) mat: vec4f,     // material, unused, flags, ao
  @location(4) size: vec2f,
  @location(5) extra: vec2f,
}

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,                         // the SHEET point (world units from the sheet's top-left)
  @location(3) @interpolate(flat) mat: vec3f,     // material, flags, the calendar
  @location(4) ao: f32,
  @location(5) local: vec3f,                      // the pad's own coordinates
}

@vertex
fn vs_pad(v: VIn, @builtin(instance_index) iid: u32) -> VOut {
  let B = &pads[iid];
  var out: VOut;
  var p = v.pos;
  // the past roll lies a hair over the sheet coming off it, so the two never fight
  if (i32(v.mat.x + 0.5) == 2) { p.z += 0.12; }
  let P = ((*B).model * vec4f(p, 1.0)).xyz;
  out.clip = cal_clip(k, P);
  out.world = P;
  out.nrm = ((*B).model * vec4f(v.nrm, 0.0)).xyz;
  out.uv = v.uv;
  out.mat = vec3f(v.mat.x, v.mat.z, f32(iid));
  out.ao = v.mat.w;
  out.local = p;
  return out;
}

@vertex
fn vs_moving(@location(0) g: vec2f, @builtin(instance_index) iid: u32) -> VOut {
  let B = &pads[iid];
  var out: VOut;
  let W = (*B).size.x;
  let H = (*B).size.y;
  let T = (*B).size.z;
  let L = (*B).size.w;
  let sx = g.x * W;
  // the grid's rows laid where they are needed: a dozen over the flat part, the rest from just before the
  // tangent line (wherever it crosses the sheet) to just past the turns drawn — beyond that is inside the roll
  let ta = tan((*B).roll.y);
  let a0 = (*B).roll.x + (0.0 - (*B).roll.z) * ta;
  let a1 = (*B).roll.x + (W - (*B).roll.z) * ta;
  let sA = clamp(min(a0, a1) - 24.0, 0.0, L);
  let turnLen = ((*B).roll2.w + 2.0) * (*B).roll2.y;
  let sB = clamp(max(a0, a1) + turnLen / max(cos((*B).roll.y), 0.3) + 24.0, sA, L);
  let v0 = 12.0 / 220.0;
  var s = sA * g.y / v0;
  if (g.y > v0) { s = sA + (sB - sA) * (g.y - v0) / (1.0 - v0); }
  var r = cal_roll((*B).roll.x, (*B).roll.y, (*B).roll.z, (*B).roll.w, (*B).roll2.x, L, sx, s);
  // past the turns drawn a point is inside the roll: it folds onto the last one drawn (its triangles vanish)
  if (r.phi > (*B).roll2.y) {
    let sa = sin((*B).roll.y);
    let ca = cos((*B).roll.y);
    let d = (sx - (*B).roll.z) * (-sa) + (s - (*B).roll.x) * ca;
    let D = max((sx - (*B).roll.z) * (-sa) + (L - (*B).roll.x) * ca, d);
    let R = cal_radius((*B).roll.w, (*B).roll2.x, D);
    let pm = (*B).roll2.y;
    let dc = R * pm - (*B).roll2.x * pm * pm / (4.0 * CAL_PI);
    r = cal_roll((*B).roll.x, (*B).roll.y, (*B).roll.z, (*B).roll.w, (*B).roll2.x, L, sx + (d - dc) * sa, s - (d - dc) * ca);
  }
  let local = vec3f(r.p.x - W * 0.5, -H * 0.5 + T + r.p.y, (*B).z.z + r.p.z);
  let P = ((*B).model * vec4f(local, 1.0)).xyz;
  out.clip = cal_clip(k, P);
  out.world = P;
  out.nrm = ((*B).model * vec4f(r.n, 0.0)).xyz;
  out.uv = vec2f(sx, T + s);
  out.mat = vec3f(1.0, 1.0, f32(iid));
  out.ao = 1.0;
  out.local = local;
  return out;
}

// The rolls' and the tape's shade on a flat sheet at pad point `p` (height `zr`): the lamp's light that gets
// through (vis), and the creases' occlusion (ao). Each term only where it can reach: the past roll's within a
// shadow's length of the head, the moving roll's near its line, the tape's lip right under it.
fn cal_sheet_shade(pi: u32, p: vec2f, zr: f32, L: vec3f, moving: bool) -> vec2f {
  let B = &pads[pi];   // a pointer: a copy of the record would be pushed out of registers
  let W = (*B).size.x;
  let H = (*B).size.y;
  let T = (*B).size.z;
  let reach = 2.2 * 60.0 + 40.0;   // the longest shadow a roll lying on the pad throws, and its penumbra
  var vis = 1.0;
  var ao = 1.0;
  // the roll of the months before, against the tape
  let R0 = (*B).roll2.w;
  let o0 = vec2f(-W * 0.5, -H * 0.5 + T + R0);
  if (zr < (*B).z.z + R0 && abs(p.y - o0.y) < reach) {
    vis *= 1.0 - 0.72 * (1.0 - cal_cyl_shadow(k, p, zr, o0, vec2f(1.0, 0.0), R0, (*B).z.z + 0.12 + R0, L, 0.0, W));
    ao *= cal_crease(p, o0, vec2f(1.0, 0.0), R0);
  }
  // the moving sheet's roll, where its tangent line is
  if ((*B).roll2.z > 0.5) {
    let a = (*B).roll.x;
    let al = (*B).roll.y;
    let dir = vec2f(cos(al), sin(al));
    let o = vec2f((*B).roll.z - W * 0.5, -H * 0.5 + T + a);
    let dn = dot(p - o, vec2f(-dir.y, dir.x));
    if (abs(dn) < reach) {
      let sx = p.x + W * 0.5;
      let D = max((sx - (*B).roll.z) * (-sin(al)) + ((*B).size.w - a) * cos(al), 0.0);
      let R = cal_radius((*B).roll.w, (*B).roll2.x, D) * smoothstep(0.0, 6.0, D);
      let t0 = -dot(o - vec2f(-W * 0.5, 0.0), dir);
      if (R > 0.0 && zr < (*B).z.z + R) {
        vis *= 1.0 - 0.72 * (1.0 - cal_cyl_shadow(k, p, zr, o, dir, R, (*B).z.z + R, L, t0, t0 + W / max(dir.x, 0.2)));
        if (!moving) { ao *= cal_crease(p, o, dir, R); }
      }
    }
  }
  // the tape's lip over the sheets: a hairline of contact below its edge
  let below = p.y - (-H * 0.5 + T);
  if (below >= 0.0 && below < 12.0) { ao *= 1.0 - 0.28 * exp(-below / 1.6); }
  return vec2f(vis, ao);
}

// The face's tangents (world units along the sheet's x and y) from the uv's screen derivatives.
fn cal_tangents(n: vec3f, dPdx: vec3f, dPdy: vec3f, dqdx: vec2f, dqdy: vec2f) -> mat2x3f {
  let det = dqdx.x * dqdy.y - dqdx.y * dqdy.x;
  var Tu = vec3f(1.0, 0.0, 0.0);
  var Tv = vec3f(0.0, 1.0, 0.0);
  if (abs(det) > 1e-14) {
    Tu = (dPdx * dqdy.y - dPdy * dqdx.y) / det;
    Tv = (dPdy * dqdx.x - dPdx * dqdy.x) / det;
  }
  Tu = Tu - n * dot(n, Tu);
  Tv = Tv - n * dot(n, Tv);
  Tu = select(vec3f(1.0, 0.0, 0.0), normalize(Tu), length(Tu) > 1e-8);
  Tv = select(vec3f(0.0, 1.0, 0.0), normalize(Tv), length(Tv) > 1e-8);
  return mat2x3f(Tu, Tv);
}

// The lamp on a face: the bumped normal, the sky's share, the leaves' dapple, the desk's day or night, the sheen.
fn cal_lit(albedo: vec3f, n: vec3f, T: mat2x3f, grad: vec2f, world: vec3f, V: vec3f, Lw: vec3f, vis: f32, ao: f32, paper: bool, back: bool, dapple: f32, sheen: vec2f, bn: vec3f) -> vec3f {
  let nb = normalize(n - T[0] * grad.x - T[1] * grad.y);
  let lam = min(max(dot(nb, Lw), 0.0) / max(Lw.z, 1e-3), k.light.y);
  let sky = select(k.light.x, mix(k.light.x, 1.0, 0.22), paper);
  var light = (sky + (1.0 - sky) * lam * vis) * ao;
  if (paper && back) {
    // paper is translucent: the back of a curling sheet glows with the lamp behind it
    light += 0.18 * (1.0 - k.light.x) * max(-dot(n, Lw), 0.0) * ao;
  }
  var g0 = 1.0;
  if ((u32(k.ring.y) & 4u) == 0u) { g0 = sample_gobo(u, gobo_tex, gobo_samp, nb_desk_at(u, world), bn.z); }
  let gobo = mix(1.0, g0, dapple);
  var c = nb_colour(u, albedo, light, gobo, bn.y);
  let Hh = normalize(Lw + V);
  let sp = pow(max(dot(nb, Hh), 0.0), sheen.x) * sheen.y * vis * g0;
  return c + vec3f(sp * (1.0 - u.night.x * 0.85));
}

// The print on a sheet's FACE: the grid it is printed on, the tiles' ink, the pen's caret and wipe (onto the
// albedo), and the host's marks (returned: their coverage). `moving` picks the sheet's grid and table.
struct CalFace { albedo: vec3f, marks: f32 }
fn cal_face(pi: u32, albedo0: vec3f, q: vec2f, px: f32, moving: bool, dbg: u32) -> CalFace {
  let B = &pads[pi];
  var out: CalFace;
  var albedo = albedo0;
  let G0 = select((*B).gridA, (*B).gridC, moving);
  let G1 = select((*B).gridB, (*B).gridD, moving);
  let g = cal_grid(k, q, px, G0, G1);
  albedo *= mix(vec3f(1.0), (*B).col3.rgb, g.weekend * k.alpha.z + g.outside * k.alpha.w);
  albedo *= mix(vec3f(1.0), (*B).col2.rgb, g.rule * k.alpha.x);
  albedo *= mix(vec3f(1.0), (*B).col1.rgb, g.head * k.alpha.y);
  var ink = vec4f(0.0);
  if ((dbg & 64u) == 0u) { ink = cal_tile(select((*B).slots.x, (*B).slots.y, moving), q, px, 0); }
  let onMarks = ((*B).slots.z > 0.5) == moving;
  out.marks = 0.0;
  if (onMarks) {
    // the newest glyph is still being written: the pen's stroke reveals it left to right
    let wp = (*B).wipe;
    if ((*B).wipe2.x < 1.0 && q.x >= wp.x && q.x <= wp.z && q.y >= wp.y && q.y <= wp.w) {
      ink.a *= 1.0 - smoothstep(mix(wp.x, wp.z, (*B).wipe2.x) - 1.5, mix(wp.x, wp.z, (*B).wipe2.x) + 1.5, q.x);
    }
  }
  albedo *= mix(vec3f(1.0), ink.rgb, ink.a);
  if (onMarks) {
    let cr = (*B).caret;
    if (cr.w > 0.0) {
      albedo = mix(albedo, (*B).col8.rgb, nb_cov(abs(q.x - cr.x) - cr.w * 0.5, px) * nb_cov(max(cr.y - q.y, q.y - cr.z), px) * 0.92);
    }
    if ((dbg & 32u) == 0u) {
      // the marks the host draws: the days selected (as many boxes as `wipe2.w` says), the entry selected, the day a note would stick to
      let w = k.select.w / max(k.eye.w, 1e-6);
      let reach = 16.0 / max(k.eye.w, 1e-6);   // the marks' brackets reach 16 CSS px (D3t-c)
      let nSel = i32((*B).wipe2.w + 0.5);
      for (var i = 0; i < nSel; i++) { out.marks = max(out.marks, cal_brackets(q, (*B).sel[i], w, 3.0, px, reach)); }
      out.marks = max(out.marks, cal_brackets(q, (*B).mark, w, 4.0, px, reach));
      out.marks = max(out.marks, cal_outline(q, (*B).drop, w * 1.4, 4.0, px) * 0.85);
    }
  }
  out.albedo = albedo;
  return out;
}

// The month on the pad (mat 0): the pad's face — the largest thing on the screen, so its own lean shader: a
// face only, never seen from behind, never rolled.
@fragment
fn fs_face(in: VOut) -> @location(0) vec4f {
  let dPdx = dpdx(in.world);
  let dPdy = dpdy(in.world);
  let dqdx = dpdx(in.uv);
  let dqdy = dpdy(in.uv);
  let pi = u32(in.mat.z + 0.5);
  let B = &pads[pi];
  let px = max(max(length(dqdx), length(dqdy)), 1e-4);
  let n = vec3f(0.0, 0.0, 1.0);
  let E = vec3f(k.eye.x, k.eye.y, k.eye.z);
  let V = normalize(E - in.world);
  let q = in.uv;
  let dbg = u32(k.ring.y);
  if ((dbg & 512u) != 0u) { return vec4f((*B).col0.rgb, 1.0); }
  let TT = mat2x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0));   // a pad lies square: its x and y are the world's
  let bn = textureSampleLevel(noise_tex, noise_samp, in.clip.xy * u.noise.z + u.noise.xy, 0.0).rgb;
  let Lw = (*B).lamp.xyz;
  let pp = cal_paper(k, (*B).col0.rgb, q, dqdx, dqdy, 3.0, paper_tex, paper_samp);
  var face = CalFace(pp.albedo, 0.0);
  if ((dbg & 2u) == 0u) { face = cal_face(pi, pp.albedo, q, px, false, dbg); }
  var sh = vec2f(1.0);
  if ((dbg & 8u) == 0u) { sh = cal_sheet_shade(pi, in.local.xy, in.local.z, Lw, false); }
  var c = cal_lit(face.albedo, n, TT, pp.g, in.world, V, Lw, sh.x, in.ao * sh.y, true, false, k.light.z, vec2f(5.0, 0.02), bn);
  c = mix(c, k.select.rgb, face.marks);
  return vec4f(c, 1.0);
}

// A SHEET that may be seen from behind: the one in motion (mat 1), the roll of the months before (2) — the ivory,
// its fibre and tooth; on a face, the print; on a back, the month showing through; the rolls' shade on the flat.
@fragment
fn fs_sheet(in: VOut) -> @location(0) vec4f {
  // every derivative first — they must be taken in uniform control flow
  let dPdx = dpdx(in.world);
  let dPdy = dpdy(in.world);
  let dqdx = dpdx(in.uv);
  let dqdy = dpdy(in.uv);
  let pi = u32(in.mat.z + 0.5);
  let B = &pads[pi];
  let px = max(max(length(dqdx), length(dqdy)), 1e-4);   // sheet units per device px
  let mat = i32(in.mat.x + 0.5);
  var n = normalize(in.nrm);
  let E = vec3f(k.eye.x, k.eye.y, k.eye.z);
  let V = normalize(E - in.world);
  var back = false;
  if (dot(n, V) < 0.0) { n = -n; back = true; }
  let q = in.uv;
  let dbg = u32(k.ring.y);
  if ((dbg & 512u) != 0u) { return vec4f((*B).col0.rgb, 1.0); }
  let TT = cal_tangents(n, dPdx, dPdy, dqdx, dqdy);
  let bn = textureSampleLevel(noise_tex, noise_samp, in.clip.xy * u.noise.z + u.noise.xy, 0.0).rgb;
  let Lw = (*B).lamp.xyz;   // a pad lies square on the desk: its own frame is the world's, turned by nothing
  let moving = mat == 1;
  let pp = cal_paper(k, (*B).col0.rgb, q, dqdx, dqdy, select(3.0, 17.0, moving), paper_tex, paper_samp);
  var albedo = pp.albedo;
  var marks = 0.0;
  var sheen = vec2f(5.0, 0.02);
  if (!back && moving && (dbg & 2u) == 0u) {
    let f = cal_face(pi, albedo, q, px, true, dbg);
    albedo = f.albedo;
    marks = f.marks;
  } else if (back) {
    // the back of a sheet: a shade duller — and a moving sheet's month just showing through it
    albedo *= 0.975;
    if (moving) {
      let through = cal_tile((*B).slots.y, q, px * 6.0, 0);
      albedo *= mix(vec3f(1.0), through.rgb, through.a * 0.06);
    }
    sheen = vec2f(4.0, 0.012);
  }
  // the shade of the rolls and the tape, on the flat of a sheet
  var sh = vec2f(1.0);
  if (!back && n.z > 0.985 && (dbg & 8u) == 0u) { sh = cal_sheet_shade(pi, in.local.xy, in.local.z, Lw, moving); }
  var c = cal_lit(albedo, n, TT, pp.g, in.world, V, Lw, sh.x, in.ao * sh.y, true, back, k.light.z, sheen, bn);
  c = mix(c, k.select.rgb, marks);
  return vec4f(c, 1.0);
}

// The pad's SOLID parts: the block's side (mat 3), the chipboard back (4), the cloth tape and its foil (5).
@fragment
fn fs_solid(in: VOut) -> @location(0) vec4f {
  let dPdx = dpdx(in.world);
  let dPdy = dpdy(in.world);
  let dqdx = dpdx(in.uv);
  let dqdy = dpdy(in.uv);
  let pi = u32(in.mat.z + 0.5);
  let B = &pads[pi];
  let px = max(max(length(dqdx), length(dqdy)), 1e-4);
  let mat = i32(in.mat.x + 0.5);
  let n = normalize(in.nrm);
  let E = vec3f(k.eye.x, k.eye.y, k.eye.z);
  let V = normalize(E - in.world);
  let q = in.uv;
  let TT = cal_tangents(n, dPdx, dPdy, dqdx, dqdy);
  let bn = textureSampleLevel(noise_tex, noise_samp, in.clip.xy * u.noise.z + u.noise.xy, 0.0).rgb;
  let Lw = (*B).lamp.xyz;
  var albedo = (*B).col0.rgb;
  var grad = vec2f(0.0);
  var dapple = k.light.z;
  var sheen = vec2f(4.0, 0.0);
  if (mat == 3) {
    // the BLOCK's side: the months to come, edge on — one stripe a sheet, each its own shade
    let t = max((*B).z.z - (*B).z.y, 1e-3);
    let f = q.y / t;
    let i = floor(f);
    let gg = fract(f);
    let vis2 = smoothstep(0.7, 2.2, t / px);
    let own = hash12(vec2f(i, 7.0)) - 0.5;
    let gap = pow(1.0 - min(gg, 1.0 - gg) * 2.0, 6.0);
    albedo = (*B).col0.rgb * (0.9 + own * 0.08 * vis2 - gap * 0.3 * vis2);
  } else if (mat == 4) {
    // the chipboard back: pressed fibre, flecked
    let fb = nb_fbm(q * 0.6);
    albedo = (*B).col5.rgb * (0.94 + fb.x * 0.12 + (nb_hash(vec2i(floor(q * 1.7))) - 0.5) * 0.06 * nb_detail(0.6, px));
    sheen = vec2f(3.0, 0.0);
    dapple = k.light.w;
  } else {
    // the TAPE: bookcloth, and the foil stamped on it (the sheet's print under the tape carries it)
    let cl = nb_cloth(q, k.cloth.x, px);
    albedo = (*B).col6.rgb * (1.0 + cl.shade * 0.16);
    grad = cl.g * k.cloth.y;
    let foil = cal_tile((*B).slots.x, q, px, 0);
    let f = foil.a * step(q.y, (*B).size.z);
    albedo = mix(albedo, (*B).col7.rgb * (0.92 + 0.16 * bn.z), f);
    sheen = vec2f(mix(k.cloth.z, 22.0, f), mix(k.cloth.w, 0.22, f));
    dapple = k.light.w;
  }
  let c = cal_lit(albedo, n, TT, grad, in.world, V, Lw, 1.0, in.ao, false, false, dapple, sheen, bn);
  return vec4f(c, 1.0);
}

// ---- the mat under a pad: its shadow, its contact, its ring

struct ROut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec2f,
  @location(1) @interpolate(flat) pad: u32,
}

const RQUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));

@vertex
fn vs_recv(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> ROut {
  let B = &pads[iid];
  var out: ROut;
  let p = mix((*B).recv.xy, (*B).recv.zw, RQUAD[vid]);
  out.clip = cal_clip(k, vec3f(p, 0.0));
  out.world = p;
  out.pad = iid;
  return out;
}

@fragment
fn fs_recv(in: ROut) -> @location(0) vec4f {
  let B = &pads[in.pad];
  let P = ((*B).inv * vec4f(in.world, 0.0, 1.0)).xyz;
  let Ll = normalize(((*B).inv * vec4f((*B).lamp.xyz, 0.0)).xyz);
  let half = (*B).size.xy * 0.5;
  let h = (*B).z.w + (*B).wipe2.z;   // the pad's height, and its lift while carried
  // the slab's shadow: its footprint carried away from the lamp by its height, softened by it
  let shift = -Ll.xy / max(Ll.z, 1e-3) * h;
  let sigma = k.shadow.x + k.shadow.y * h;
  let dS = nb_sd_box(P.xy - shift * 0.5, half + abs(shift) * 0.5, 0.0);
  let slab = 1.0 - smoothstep(-sigma * 1.5, sigma * 1.5, dS);
  // the roll of the months before, lying along the head: its end throws a little shade past the pad's side
  let R0 = (*B).roll2.w;
  let o0 = vec2f(-half.x, -half.y + (*B).size.z + R0);
  let rv = cal_cyl_shadow(k, P.xy, 0.0, o0, vec2f(1.0, 0.0), R0, (*B).z.z + R0 + (*B).wipe2.z, Ll, 0.0, (*B).size.x);
  // a paper roll's end throws a light, soft shade (its ends are open, the lamp's light passes through the paper)
  let aS = k.shadow.z * max(slab, (1.0 - rv) * 0.45);
  // the contact where the pad meets the mat (gone as it lifts)
  let d = nb_sd_box(P.xy, half, 0.0);
  let touch = 1.0 - smoothstep(0.0, 2.5, (*B).wipe2.z);
  let s = k.shadow2.x;
  let aC = k.shadow.w * touch * exp(-max(d, 0.0) * max(d, 0.0) / (2.0 * s * s)) * step(-0.5, d);
  let a = 1.0 - (1.0 - aS) * (1.0 - aC);
  var c = vec4f(k.castCol.rgb * a, a);
  // the selection ring, on the mat around the pad
  let css = 1.0 / max(k.eye.w, 1e-6);
  let rw = k.select.w * css;
  let rd = abs(d - k.ring.x * css) - rw * 0.5;
  let ring = nb_cov(rd, css / max(k.shadow2.w, 1.0)) * (*B).slots.w;
  c = vec4f(k.select.rgb * ring, ring) + c * (1.0 - ring);
  return c;
}
