// The portal clip — a slot's ground and frames are visible only through a
// rounded rect on screen (CSS px): its FACE and, for a nested slot, every face
// above it — the CHAIN (src/nav/portal.ts `Presentation`, `within`). A PURE
// module every pass includes: the records arrive as parameters. `clips[i].y`
// < 0.5 ends the chain (an empty chain is no clip at all, and the loop is one
// compare); `clips[i].x` is a face's corner radius; `clips[i].z` its top
// FEATHER (CSS px; 0 = a hard edge — design-018 §4, the tray's face: what it
// shows fades in over that band below its top edge, with no code of its own).
//
// THE KIT'S `portal` PIECE (`kitWgsl([..., "portal"])`; petition I31). Its points are CSS px of the ATTACHMENT — origin the
// top-left, y down: a fragment's `@builtin(position).xy` (device px) over `mat_dpr(u)` — and the chain is the slot's view
// block's (`u.portals`, `u.clips`). A kind multiplies what it writes by `portal_cover` (premultiplied: rgb and alpha; straight
// alpha: alpha), so it shows only through its slot's faces; at the root the chain is empty and the cover is exactly 1.

/// The portal chain's length: the faces `u.portals` and `u.clips` hold, nearest first (6 — a host's depth belt of four and a
/// flight's face). = nav/portal.ts `PORTAL_CHAIN`, the uniform arrays' length; a mismatch fails to compile.
const PORTAL_CHAIN = 6u;

/// A face's outline: a rounded rect centred on the origin.
/// `p` — the point relative to the face's centre, CSS px; `half` — the face's half extents, CSS px, ≥ 0; `r` — its corner
/// radius, CSS px, ≥ 0 (clamped to the shorter half extent).
/// → the signed distance to the outline, CSS px: negative inside, 0 on the edge, positive outside.
fn portal_sd(p: vec2f, half: vec2f, r: f32) -> f32 {
  let rr = min(r, min(half.x, half.y));
  let q = abs(p) - half + vec2f(rr, rr);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rr;
}

/// The cover through ONE face.
/// `p_css` — the fragment's point, CSS px of the attachment; `portal` — the face: its centre (xy) and half extents (zw), CSS px;
/// `clip` — its corner radius (x, CSS px), on (y — read by the chain's loop, not here), top feather (z, CSS px; ≤ 0 = a hard
/// edge), w unused; `dpr` — the attachment's device px per CSS px, > 0 (below 1 too — petition I29); `grow` — device px the
/// face is grown by, ≥ 0 (0 = the face as it is).
/// → [0, 1]: 1 inside, 0 outside, a linear ramp one DEVICE px wide centred on the grown edge; times, with a feather, a
///   smoothstep from 0 at the face's top edge to 1 `clip.z` CSS px below it.
fn portal_cover_one(p_css: vec2f, portal: vec4f, clip: vec4f, dpr: f32, grow: f32) -> f32 {
  let px = 1.0 / max(dpr, 1e-6);   // CSS px a device px — the attachment's own ratio, below 1 too (petition I29)
  let d = portal_sd(p_css - portal.xy, portal.zw, clip.x) - grow * px;
  let c = clamp(0.5 - d / px, 0.0, 1.0);
  if (clip.z <= 0.0) { return c; }
  let top = portal.y - portal.w;
  return c * smoothstep(top, top + clip.z, p_css.y);
}

/// The cover through the whole chain, its first face grown.
/// `p_css` — the fragment's point, CSS px of the attachment; `portals`, `clips` — the chain (`u.portals`, `u.clips`): face `i`
/// as `portal_cover_one` reads it, nearest first, the first `clips[i].y` < 0.5 ending it; `dpr` — device px per CSS px, > 0;
/// `grow` — device px the FIRST face (the slot's own) is grown by, ≥ 0 — every face above it is taken as it is (the fill's one
/// px, so the hole's edge partitions with the plate — PORTAL.md §10).
/// → [0, 1]: the product of the faces' covers — a nested slot shows only where every face agrees; exactly 1 for an empty chain.
fn portal_cover_grown(p_css: vec2f, portals: array<vec4f, PORTAL_CHAIN>, clips: array<vec4f, PORTAL_CHAIN>, dpr: f32, grow: f32) -> f32 {
  var c = 1.0;
  for (var i = 0u; i < PORTAL_CHAIN; i++) {
    if (clips[i].y < 0.5) { break; }
    c *= portal_cover_one(p_css, portals[i], clips[i], dpr, select(0.0, grow, i == 0u));
  }
  return c;
}

/// The cover a kind multiplies its output by: the slot's chain, no face grown.
/// `p_css` — the fragment's point, CSS px of the attachment (`@builtin(position).xy / mat_dpr(u)`); `portals`, `clips` — the
/// slot's chain, `u.portals` and `u.clips`; `dpr` — the attachment's device px per CSS px, `mat_dpr(u)`.
/// → [0, 1]: 1 where the slot is wholly visible (everywhere, at the root), 0 outside its faces, a one-device-px ramp on each
///   edge and a face's top feather where it has one.
fn portal_cover(p_css: vec2f, portals: array<vec4f, PORTAL_CHAIN>, clips: array<vec4f, PORTAL_CHAIN>, dpr: f32) -> f32 {
  return portal_cover_grown(p_css, portals, clips, dpr, 0.0);
}
