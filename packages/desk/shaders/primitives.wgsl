// 2D primitives for the desk's objects — the note, the whiteboard, the photo,
// the mini mat. Pure functions, exact Euclidean distances — which is what
// everything downstream (1-px AA, the analytic shadows, the hit-test mirrors,
// src/sdf.ts) relies on. Prefixed `sdf_` so this module can share a program
// with the mat's module without a name clash. Moved out of shaders/card/ when
// the card frame retired (2026-09-25).
// (Lineage: research/sdf-card/src/sdf/primitives.wgsl.)

fn sdf_box(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn sdf_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let rr = clamp(r, 0.0, min(b.x, b.y));
  let q  = abs(p) - b + rr;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rr;
}

fn sdf_circle(p: vec2f, r: f32) -> f32 { return length(p) - r; }

fn sdf_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h  = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sdf_rounded_x(p: vec2f, w: f32, r: f32) -> f32 {
  let q = abs(p);
  return length(q - min(q.x + q.y, w) * 0.5) - r;
}

// Exact circular fillet CSG (Quilez). Unlike smin/smax these put a TRUE circle
// of radius r on the seam. Exact when the operands are perpendicular
// half-planes (the retired card frame's corner was built to satisfy it).
//
// The union form clamps its operands to >= -r so the fillet stays local: the
// unclamped hg_sdf form keeps growing once both surfaces are more than r
// inside, and the field goes badly wrong in the interior.
fn op_union_round(a: f32, b: f32, r: f32) -> f32 {
  let m = min(a, b);
  let A = max(a, -r);
  let B = max(b, -r);
  let u = max(vec2f(r - A, r - B), vec2f(0.0));
  return min(m, max(r, min(A, B)) - length(u));
}

fn op_isect_round(a: f32, b: f32, r: f32) -> f32 {
  let u = max(vec2f(r + a, r + b), vec2f(0.0));
  return min(-r, max(a, b)) + length(u);
}
