// PASS 2 — instanced NEEDLE glyphs. Same schedule as the dot entry; the glyph
// is a rotated capsule that orients along the field instead of a disc that
// swells with it. RUNG is a pipeline override: 0 fine, 1 mid, 2 coarse.
// Needle has its own entry: nothing here knows a dot exists.

override RUNG: f32 = 1.0;

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var atlas_tex: texture_2d<f32>;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) site: vec2f,
  @location(1) @interpolate(flat) dir: vec2f,
  @location(2) @interpolate(flat) extent: vec2f,   // half length, half width
  @location(3) @interpolate(flat) alpha: f32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);
  out.site = vec2f(0.0);
  out.dir = vec2f(0.0, 1.0);
  out.extent = vec2f(0.0);
  out.alpha = 0.0;

  let spacing = rung_spacing(u, RUNG);
  let cell = max(spacing * zoom(u), 1e-6);
  let cols = max(u32(select(select(u.cols.x, u.cols.y, RUNG > 0.5), u.cols.z, RUNG > 1.5) + 0.5), 1u);
  // The slot's box (PORTAL.md §2.3): the instance grid starts at the box's top-left (a root's is 0 — exactly the phase)
  let origin = floor((u.phase.xy + u.box.xy / zoom(u)) / spacing) - vec2f(1.0);
  let idx = origin + vec2f(f32(iid % cols), f32(iid / cols));

  if (RUNG < 1.5 && promoted(idx)) { return out; }

  let site = site_screen(u, idx * spacing);
  let hl = fit_hl(u, cell);
  let hw = fit_hw(u, cell);
  let aa = aa_px(u);
  let extent = needle_len(u, hl) + aa * 2.0;
  if (site.x < u.box.x - extent || site.y < u.box.y - extent ||
      site.x > u.box.x + u.box.z + extent || site.y > u.box.y + u.box.w + extent) { return out; }

  let packed = field_at_site(u, atlas_tex, atlas_index(u, idx, spacing), site);
  if (packed.z < -0.5) { return out; }

  let mag = length(packed.xy);
  let influence = saturate(mag);
  let dir = needle_dir(u, packed.xy);
  let len = needle_len(u, mix(hl * 0.55, hl, influence));
  let wid = needle_wid(u, mix(hw * 0.85, hw * 1.15, influence));
  let alpha = mix(0.35, 1.0, influence) * rung_alpha(u, RUNG) * u.color.w;
  if (alpha < 0.004) { return out; }

  // Axis-aligned quad large enough to hold the rotated capsule, so the fragment
  // stage can do the exact coverage test the fullscreen reference does.
  let corner = CORNERS[vid];
  let pos = site + corner * (len + aa * 2.0);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  out.site = site;
  out.dir = dir;
  out.extent = vec2f(len, wid);
  out.alpha = alpha;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let screen = in.clip.xy / dpr(u);
  let a = in.alpha *
    cover_needle(screen, in.site, in.dir, in.extent.x, in.extent.y, aa_px(u)) * portal_cover(screen, u.portals, u.clips, dpr(u));
  if (a < 0.004) { discard; }
  return vec4f(u.color.xyz, a);
}
