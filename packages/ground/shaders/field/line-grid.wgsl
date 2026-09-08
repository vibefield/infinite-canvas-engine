// PASS 2, the LINE grid — the engine's second glyph (design-013 §8, D-C1.4). A
// SURFACE program (field/program.ts): one fullscreen triangle that draws the
// lattice's LINES instead of a glyph at each of its sites, so it reads no atlas
// and the field bake never runs for it. The mechanism is the cutting mat's
// (packs/mat/mat.wgsl `line_coverage` · `grid2` · `line_weight`) — analytic
// coverage on the same three rungs, weighted by lattice/line.ts's law over the
// engine's own fade-in window — without the mat's material, its gobo or its
// colour chain: the ink is the theme's line ink and the alpha is the field
// config's, exactly as the dot's is.

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<uniform> lg: LineUniforms;

struct VSOut { @builtin(position) clip: vec4f }

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.clip = vec4f(p[vid], 0.0, 1.0);
  return out;
}

// Coverage of one rung's lines through a point. `x`, `spacing`, `half_width`
// and `px` are all WORLD units; `px` is one device pixel, which is both the
// half-width's unit conversion and the antialiasing window.
fn line_cover(x: f32, spacing: f32, half_width: f32, px: f32) -> f32 {
  let d = abs(fract(x / spacing - 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(max(half_width - px, 0.0), half_width + px, d);
}

fn line_grid2(p: vec2f, spacing: f32, half_width: f32, px: f32) -> f32 {
  return max(line_cover(p.x, spacing, half_width, px), line_cover(p.y, spacing, half_width, px));
}

// lattice/line.ts `lineWeight`, on the engine's window (`u.lod`) and the config's
// law: a rung fades in by its OWN cell — the same smoothstep every glyph fades by
// (magnet.wgsl `rung_alpha`), so a decade wrap is continuous by construction — and
// then thickens and darkens over the next decade. x = half-width (DEVICE px —
// `lineUniformValues` converts the law's CSS px by the frame's dpr at upload,
// D-C4.10), y = alpha. The ENGINE's law is flat in both decade terms (theme.ts
// LINE_GRID): one width and one weight at every rung, which is what the old TSL
// grid drew.
fn line_weight(u: Uniforms, law: vec4f, cell_px: f32) -> vec2f {
  let s = smoothstep(u.lod.x, u.lod.y, cell_px);
  let t = saturate(log(max(cell_px, 1e-9) / u.lod.y) / 2.302585093);
  return vec2f(mix(law.x, law.y, t), law.z * s + (law.w - law.z) * t);
}

// One rung composited into the coverage so far, by max() — a coarser rung's
// lines sit on a subset of the finer rung's sites, and the stronger weight wins
// there (the reference's compositing, and `promoted()`'s intent for the dot).
fn line_rung(u: Uniforms, law: vec4f, world: vec2f, spacing: f32, px: f32, cover: f32) -> f32 {
  let w = line_weight(u, law, spacing * zoom(u));
  if (w.y <= 0.0) { return cover; }   // a rung under the window draws nothing, and costs one compare
  return max(cover, line_grid2(world, spacing, w.x * px, px) * w.y);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let z = zoom(u);
  let d = dpr(u);
  let screen = in.clip.xy / d;               // CSS px
  let px = 1.0 / (z * d);                    // world units per DEVICE px
  let world = u.phase.xy + screen / z;       // lattice-phase world (the camera is pre-wrapped on the CPU)
  var cover = line_rung(u, lg.law, world, u.rungs.x, px, 0.0);
  cover = line_rung(u, lg.law, world, u.rungs.y, px, cover);
  cover = line_rung(u, lg.law, world, u.rungs.z, px, cover);
  // `u.color.w` is the field config's ink alpha through the presentation's opacity —
  // the dot's alpha term, unchanged; only the ink itself is the line grid's own.
  let a = cover * u.color.w * portal_cover(screen, u.portals, u.clips, d);
  if (a < 0.004) { discard; }
  return vec4f(lg.ink.xyz, a);
}
