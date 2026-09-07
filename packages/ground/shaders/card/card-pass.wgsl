// PASS 3 — the card frames, instanced. One quad per card, expanded on the CPU
// side of the vertex stage by the visual reach (shadow + AA), one distance
// evaluation per covered fragment in CARD units, premultiplied output.

@group(0) @binding(0) var<uniform> u: FrameUniforms;
@group(0) @binding(1) var<storage, read> frames: array<Frame>;
@group(0) @binding(2) var pages: texture_2d_array<f32>;   // the atlas: layers of one size, one binding for every dom card
@group(0) @binding(3) var samp: sampler;                   // linear, clamp-to-edge
@group(1) @binding(0) var own: texture_2d<f32>;            // the run's own texture (a 1×1 transparent dummy when none)

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

fn px_scale(u: FrameUniforms) -> f32 { return 1.0 / (max(u.cam.z, 1e-12) * max(u.cam.w, 1.0)); }

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);   // degenerate: culled instances collapse
  out.idx = iid;
  let G = frames[iid];
  let zoom = max(u.cam.z, 1e-12);
  // Everything the fragment can paint outside the outer box, in world units.
  // 2.5σ: the Gaussian tail past it is 0.6% of the shadow's alpha — under 0.4/255 at the
  // §5 alphas, below the swap chain's resolution and the fragment discard threshold.
  let pad = G.shadowSigma * 2.5 + G.shadowOffset + 3.0 * px_scale(u);
  let ext = G.half + vec2f(pad);
  let lo = (G.centre - ext - u.cam.xy) * zoom;   // CSS px
  let hi = (G.centre + ext - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }   // the slot's box (PORTAL.md §2.3)
  let corner = CORNERS[vid];
  let pos = mix(lo, hi, corner * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let G = frames[in.idx];
  let px = px_scale(u);
  let p = in.clip.xy * px + u.cam.xy;   // device px → world (card) units
  let c = shade_frame(G, u, p, px, pages, own, samp);
  if (c.a < 0.002) { discard; }
  // Premultiplied: the presentation's opacity through the portal clip scales every channel.
  let dpr = max(u.cam.w, 1.0);
  return c * (u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
