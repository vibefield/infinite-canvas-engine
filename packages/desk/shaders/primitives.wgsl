// 2D primitives for the desk's objects — the note, the whiteboard, the photo,
// the mini mat. Pure functions, exact Euclidean distances — which is what
// everything downstream (1-px AA, the analytic shadows, the hit-test mirrors,
// src/sdf.ts) relies on. Prefixed `sdf_` so this module can share a program
// with the mat's module without a name clash. Moved out of shaders/card/ when
// the card frame retired (2026-09-25).
// (Lineage: research/sdf-card/src/sdf/primitives.wgsl.)
//
// THE KIT'S `sdf` PIECE (`kitWgsl([..., "sdf"])`; petition I31 — every declaration's `///` block says what it takes and gives).
// A distance here is SIGNED — negative inside, 0 on the edge, positive outside — and in the units its point is given in: a kind
// hands world units (one world unit is one CSS px at zoom 1), so a one-device-px AA band is `1 / (mat_zoom(u) · mat_dpr(u))`
// world units wide. A shape is centred on its frame's origin unless it takes its own points; y runs down, as everywhere on
// the desk, and no shape here cares (each is symmetric under the flip).

/// An axis-aligned box centred on the origin.
/// `p` — the point, in the box's own units (world units for a kind); `b` — the half extents, ≥ 0, in the same units.
/// → the exact Euclidean signed distance in those units: negative inside (−min(b.x, b.y) at the centre), 0 on the edge,
///   positive outside.
fn sdf_box(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

/// A box centred on the origin with its four corners rounded — the card's outline; src/sdf.ts `sdRoundBox` is its CPU mirror,
/// number for number.
/// `p` — the point, in the box's units; `b` — the half extents, ≥ 0; `r` — the corner radius, clamped to [0, min(b.x, b.y)]
/// (an oversized radius makes a stadium, never a dent).
/// → the exact Euclidean signed distance, in `p`'s units: negative inside, 0 on the rounded edge, positive outside.
fn sdf_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let rr = clamp(r, 0.0, min(b.x, b.y));
  let q  = abs(p) - b + rr;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rr;
}

/// A circle centred on the origin.
/// `p` — the point; `r` — the radius, ≥ 0, in `p`'s units.
/// → `length(p) − r`: exact, negative inside (−r at the centre), positive outside.
fn sdf_circle(p: vec2f, r: f32) -> f32 { return length(p) - r; }

/// The segment from `a` to `b` — a line of zero width (subtract a half-width for a stroke with round caps).
/// `p` — the point; `a`, `b` — the segment's ends, in `p`'s units; `a` ≠ `b` (a zero-length segment divides by zero).
/// → the exact UNSIGNED distance to the nearest point of the segment, ≥ 0, in `p`'s units.
fn sdf_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h  = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

/// An X centred on the origin (Quilez's rounded X): two bars along the diagonals, crossing at the origin.
/// `p` — the point; `w` — the X's span: each arm runs from the origin to (±w/2, ±w/2), ≥ 0; `r` — the bars' half thickness,
/// ≥ 0, their ends round. All in `p`'s units.
/// → the exact signed distance: negative inside the bars, positive outside.
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

/// The UNION of two shapes with a circular fillet of radius `r` on their seam.
/// `a`, `b` — the two shapes' signed distances at one point, in one unit; `r` — the fillet's radius, ≥ 0, in that unit
/// (0 = the plain `min(a, b)`).
/// → the union's signed distance: exact where the operands are perpendicular half-planes, a bound elsewhere; the fillet stays
///   local to the seam (each operand is clamped at −r), and away from it the answer is `min(a, b)`.
fn op_union_round(a: f32, b: f32, r: f32) -> f32 {
  let m = min(a, b);
  let A = max(a, -r);
  let B = max(b, -r);
  let u = max(vec2f(r - A, r - B), vec2f(0.0));
  return min(m, max(r, min(A, B)) - length(u));
}

/// The INTERSECTION of two shapes with a circular round of radius `r` on their crease.
/// `a`, `b` — the two shapes' signed distances at one point, in one unit; `r` — the round's radius, ≥ 0, in that unit
/// (0 = the plain `max(a, b)`).
/// → the intersection's signed distance: exact where the operands are perpendicular half-planes, a bound elsewhere.
fn op_isect_round(a: f32, b: f32, r: f32) -> f32 {
  let u = max(vec2f(r + a, r + b), vec2f(0.0));
  return min(-r, max(a, b)) + length(u);
}
