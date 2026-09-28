// The note as the paper pass AND the flat-card pipeline draw it (K7b, design-016 §6 K7): the corner's clip position and
// the fragment, over the note's bindings by their own names — `papers`, `paper_k`, `paper_ink` … — beside the slot's `u`,
// `gobo_tex`, `noise_tex` and the pipeline's `LIT_ELSEWHERE`, which whichever entry composes them declares. One quad per
// sheet, expanded by the shadow's reach and the AA; one `shade_paper` per covered fragment in world units, premultiplied,
// through the presentation's opacity and the portal clip; alpha < 0 = discard.

const PAPER_CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

fn paper_quad(slot: u32, vid: u32) -> vec4f {
  let P = papers[slot];
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * mat_dpr(u));
  // the tilted sheet's bounds, grown by everything the fragment can paint outside it: the shadow's reach and the AA
  let hmax = P.lift + P.curl * (1.0 + P.cornerCurl);
  let pad = length(P.slope) * hmax + 2.5 * (P.shadow.x + P.shadow.z * hmax) + 3.0 * px;
  let ext = vec2f(abs(P.rot.x) * P.half.x + abs(P.rot.y) * P.half.y, abs(P.rot.y) * P.half.x + abs(P.rot.x) * P.half.y) + vec2f(pad);
  let lo = (P.centre - ext - u.cam.xy) * zoom;   // CSS px
  let hi = (P.centre + ext - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return vec4f(2.0, 2.0, 2.0, 1.0); }   // degenerate: a culled instance collapses
  let corner = PAPER_CORNERS[vid];
  let pos = mix(lo, hi, corner * 0.5 + 0.5);
  return vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
}

fn paper_frag(slot: u32, clip: vec4f) -> vec4f {
  let P = papers[slot];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let p = clip.xy * px + u.cam.xy;   // device px → world
  let c = shade_paper(P, u, paper_k, p, px, px * dpr, clip.xy, gobo_tex, paper_gobo_samp, noise_tex, paper_noise_samp, paper_ink, paper_ink_samp, LIT_ELSEWHERE);
  if (c.a < 0.002) { return vec4f(-1.0); }
  return c * (u.view.w * portal_cover(clip.xy / dpr, u.portals, u.clips, dpr));
}
