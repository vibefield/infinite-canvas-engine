// The DESK CALENDAR — a pad of months under the desk's one lamp (CALENDAR.md). A PURE module: the
// uniform blocks and the pad's record arrive as parameters, and it names no colour. mat.wgsl and
// notebook.wgsl come first: the light, the gobo, the night and the noise are the mat's; the weave,
// the colour chain and the coverage helpers are the notebook's — the pad is the same paper and cloth.
//
// Here: the desk eye (the notebook's `nb_clip`, over this pass's knobs); the ROLL (roll.ts's
// `rollPoint`, point for point — the moving sheet is bent in the vertex shader); the paper; the
// GRID the month is printed on (its rules, the weekend's wash, a neighbour month's days — analytic,
// so they are crisp at every zoom); and the rolls' shadows on the pad, cast by the lamp from a
// cylinder lying on the paper (exact, so no shadow map is drawn for a flat thing).

const CAL_PI = 3.14159265;

fn cal_clip(k: CalUniforms, P: vec3f) -> vec4f {
  let H = k.eye.z;
  let d = H - P.z;
  let x = 2.0 * k.eye.w * (P.x - k.eye.x) / k.view.x;
  let y = -2.0 * k.eye.w * (P.y - k.eye.y) / k.view.y;
  let n = k.view.z;
  let f = k.view.w;
  let z = (d - n) * f / ((f - n) * H);
  return vec4f(x, y, z, d / H);
}

// ---- the roll: a sheet point (x across, s down from the tape's edge) as the spiral bends it
struct CalRollPt { p: vec3f, n: vec3f, phi: f32 }

fn cal_radius(r0: f32, tau: f32, D: f32) -> f32 { return sqrt(r0 * r0 + tau * max(D, 0.0) / CAL_PI); }

fn cal_roll(a: f32, alpha: f32, px: f32, r0: f32, tau: f32, L: f32, x: f32, s: f32) -> CalRollPt {
  var out: CalRollPt;
  let sa = sin(alpha);
  let ca = cos(alpha);
  let d = (x - px) * (-sa) + (s - a) * ca;
  if (d <= 0.0) {
    out.p = vec3f(x, s, 0.0);
    out.n = vec3f(0.0, 0.0, 1.0);
    out.phi = 0.0;
    return out;
  }
  let D = max((x - px) * (-sa) + (L - a) * ca, d);
  let R = cal_radius(r0, tau, D);
  var phi = d / R;
  if (tau > 1e-6) { phi = (2.0 * CAL_PI / tau) * (R - sqrt(max(R * R - tau * d / CAL_PI, 0.0))); }
  let rho = R - tau * phi / (2.0 * CAL_PI);
  let n2 = vec2f(-sa, ca);
  let b = vec2f(x, s) - d * n2;
  let sp = sin(phi);
  let cp = cos(phi);
  out.p = vec3f(b + n2 * (rho * sp), R - rho * cp);
  out.n = vec3f(-n2 * sp, cp);
  out.phi = phi;
  return out;
}

// ---- the paper (the notebook's baked texture, over this pass's knobs)
struct CalPaperS { albedo: vec3f, g: vec2f }
fn cal_paper(k: CalUniforms, base: vec3f, q: vec2f, dqdx: vec2f, dqdy: vec2f, seed: f32, tex: texture_2d<f32>, samp: sampler) -> CalPaperS {
  let s = nb_paper_seed(seed);
  let a = textureSampleGrad(tex, samp, q / 64.0 + s / 64.0, dqdx / 64.0, dqdy / 64.0);
  let tt = 9.6;
  let b = textureSampleGrad(tex, samp, q / tt + s.yx / 31.0, dqdx / tt, dqdy / tt);
  let v = (a.r - 0.5) * k.paper.y * 2.0 + (a.g - 0.5) * k.paper.x * 3.0;
  var out: CalPaperS;
  out.albedo = base + vec3f(v * 1.05, v, v * 0.8);
  let tooth = (b.ba - vec2f(0.5)) * (2.0 * 48.0 / tt) * (k.paper.z * 0.02);
  let c = nb_vn(q / 55.0 + s * 0.5);
  out.g = tooth + c.yz / 55.0 * (k.paper.w * 2.0);
  return out;
}

// ---- the grid the month is printed on: the rules' coverage, the heading rule's, the weekend's wash, a neighbour's day
struct CalGrid { rule: f32, head: f32, weekend: f32, outside: f32 }

// A thin line's coverage at distance `d` (world units) of half-width `hw`, never thinner than a device px's worth of ink.
fn cal_line(d: f32, hw: f32, px: f32) -> f32 {
  let w = max(hw, px * 0.5);
  return nb_sat(0.5 - (abs(d) - w) / max(px, 1e-5)) * min(hw / w, 1.0);
}

fn cal_grid(k: CalUniforms, q: vec2f, px: f32, G0: vec4f, G1: vec4f) -> CalGrid {
  var out: CalGrid;
  let rows = G1.x;
  let gw = G0.z * 7.0;
  let gh = G0.w * rows;
  let p = q - G0.xy;
  let inside = step(-px, p.x) * step(p.x, gw + px) * step(-px, p.y) * step(p.y, gh + px);
  // the nearest rule down and across
  let cx = p.x / G0.z;
  let cy = p.y / G0.w;
  let dx = (cx - round(cx)) * G0.z;
  let dy = (cy - round(cy)) * G0.w;
  let hw = k.ring.z * 0.5;
  out.rule = max(cal_line(dx, hw, px), cal_line(dy, hw, px)) * inside;
  out.head = cal_line(p.y, k.ring.w * 0.5, px) * step(-px, p.x) * step(p.x, gw + px);
  let col = i32(floor(cx));
  let row = i32(floor(cy));
  let inCell = step(0.0, p.x) * step(p.x, gw) * step(0.0, p.y) * step(p.y, gh);
  let mask = u32(G1.y + 0.5);
  out.weekend = select(0.0, 1.0, col >= 0 && col < 7 && ((mask >> u32(clamp(col, 0, 6))) & 1u) != 0u) * inCell;
  let idx = row * 7 + col;
  let lead = i32(G1.z + 0.5);
  let days = i32(G1.w + 0.5);
  out.outside = select(0.0, 1.0, idx < lead || idx >= lead + days) * inCell;
  return out;
}

// ---- a lying cylinder's shadow on the paper: the lamp's ray from a point at height `zr` past an axis
// at height `za` (its radius R, lying along `dir` through `o` in the pad's plane): how much light gets
// through (1 lit … 0 shadowed), softened by the desk's penumbra law for the gap
fn cal_cyl_shadow(k: CalUniforms, P: vec2f, zr: f32, o: vec2f, dir: vec2f, R: f32, za: f32, L: vec3f, x0: f32, x1: f32) -> f32 {
  if (R <= 0.0) { return 1.0; }
  let t = dot(P - o, dir);
  let nrm = vec2f(-dir.y, dir.x);
  let dn = dot(P - o, nrm);
  // the ray in the plane across the axis: from (dn, zr) toward the lamp (ln, lz)
  let ln = dot(L.xy, nrm);
  let lz = max(L.z, 1e-3);
  let rel = vec2f(0.0 - dn, za - zr);
  let dirL = normalize(vec2f(ln, lz));
  let along = dot(rel, dirL);
  if (along <= 0.0) { return 1.0; }
  let miss = abs(rel.x * dirL.y - rel.y * dirL.x);
  let gap = max(za - zr, 0.0);
  let sigma = k.shadow.x + k.shadow.y * gap;
  let s = smoothstep(R - sigma * 1.2, R + sigma * 1.2, miss);
  // along the axis: the roll ends where the sheet does (its shadow's ends soft too)
  let ta = t + dot(L.xy, dir) / lz * (za - zr);
  let ends = smoothstep(x0 - sigma, x0 + sigma, ta) * (1.0 - smoothstep(x1 - sigma, x1 + sigma, ta));
  return 1.0 - (1.0 - s) * ends;
}

// The crease where a roll meets the paper: a little dark each side of its line of contact.
fn cal_crease(P: vec2f, o: vec2f, dir: vec2f, R: f32) -> f32 {
  if (R <= 0.0) { return 1.0; }
  let dn = dot(P - o, vec2f(-dir.y, dir.x));
  let w = max(R * 0.45, 1.0);
  return 1.0 - 0.32 * exp(-(dn * dn) / (w * w));
}

// A box's outline, `w` wide, just inside it: the marks the host draws on the sheet.
fn cal_outline(q: vec2f, box: vec4f, w: f32, r: f32, px: f32) -> f32 {
  if (box.z <= box.x) { return 0.0; }
  let c = (box.xy + box.zw) * 0.5;
  let h = (box.zw - box.xy) * 0.5;
  let d = nb_sd_box(q - c, h - vec2f(w * 0.5 + 1.0), r);
  return nb_cov(abs(d) - w * 0.5, px);
}

// The selection's BRACKETS on a box of the sheet (D3t-c — *Marks on the Mat* Q-a on a day or a line): the outline strong along
// `reach` of each side from every corner (never past 30 % of a side), the hairline between them one device px at 42 %.
fn cal_brackets(q: vec2f, box: vec4f, w: f32, r: f32, px: f32, reach: f32) -> f32 {
  if (box.z <= box.x) { return 0.0; }
  let c = (box.xy + box.zw) * 0.5;
  let h = (box.zw - box.xy) * 0.5;
  let a = abs(q - c);
  let arm = min(vec2f(reach), h * 0.3 + vec2f(r + 2.0));
  let arms = nb_sat((a.x - (h.x - arm.x)) / max(px, 1e-5) + 0.5) * nb_sat((a.y - (h.y - arm.y)) / max(px, 1e-5) + 0.5);
  let hair = nb_cov(abs(nb_sd_box(q - c, h - vec2f(w * 0.5 + 1.0), r)) - 0.5 * px, px);
  return max(cal_outline(q, box, w, r, px) * arms, hair * 0.42);
}
