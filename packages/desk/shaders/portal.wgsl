// The portal clip — a slot's ground and frames are visible only through a
// rounded rect on screen (CSS px): its FACE and, for a nested slot, every face
// above it — the CHAIN (src/nav/portal.ts `Presentation`, `within`). A PURE
// module every pass includes: the records arrive as parameters. `clips[i].y`
// < 0.5 ends the chain (an empty chain is no clip at all, and the loop is one
// compare); `clips[i].x` is a face's corner radius; `clips[i].z` its top
// FEATHER (CSS px; 0 = a hard edge — design-018 §4, the tray's face: what it
// shows fades in over that band below its top edge, with no code of its own).

// = nav/portal.ts PORTAL_CHAIN, the uniform arrays' length; a mismatch fails to compile.
const PORTAL_CHAIN = 6u;

fn portal_sd(p: vec2f, half: vec2f, r: f32) -> f32 {
  let rr = min(r, min(half.x, half.y));
  let q = abs(p) - half + vec2f(rr, rr);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - rr;
}

// Coverage at a CSS-px point through ONE face grown by `grow` device px: 1 inside, 0 outside, a one-device-px ramp across the edge —
// times, where the face has a feather, a smoothstep from 0 at its top edge to 1 the feather below it.
fn portal_cover_one(p_css: vec2f, portal: vec4f, clip: vec4f, dpr: f32, grow: f32) -> f32 {
  let px = 1.0 / max(dpr, 1.0);
  let d = portal_sd(p_css - portal.xy, portal.zw, clip.x) - grow * px;
  let c = clamp(0.5 - d / px, 0.0, 1.0);
  if (clip.z <= 0.0) { return c; }
  let top = portal.y - portal.w;
  return c * smoothstep(top, top + clip.z, p_css.y);
}

// Coverage through the chain: the slot's own face grown by `grow` device px (the fill's one
// px, so the hole's edge partitions with the plate — PORTAL.md §10) times every face above
// it as it is. The product: a nested slot shows only where all of them agree.
fn portal_cover_grown(p_css: vec2f, portals: array<vec4f, PORTAL_CHAIN>, clips: array<vec4f, PORTAL_CHAIN>, dpr: f32, grow: f32) -> f32 {
  var c = 1.0;
  for (var i = 0u; i < PORTAL_CHAIN; i++) {
    if (clips[i].y < 0.5) { break; }
    c *= portal_cover_one(p_css, portals[i], clips[i], dpr, select(0.0, grow, i == 0u));
  }
  return c;
}

fn portal_cover(p_css: vec2f, portals: array<vec4f, PORTAL_CHAIN>, clips: array<vec4f, PORTAL_CHAIN>, dpr: f32) -> f32 {
  return portal_cover_grown(p_css, portals, clips, dpr, 0.0);
}
