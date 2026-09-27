// The pegboard tray's pass (design-017 §5): drawn in the ROOT's render pass after the marks — two instanced quads, premultiplied:
// instance 0 the dim over the whole view (black at the slide's share of 10 % by day, 40 % by night), instance 1 the drawer's quad
// grown by its shadow (tray.wgsl `tray_drawer`). Only the drawer's quad shades the pegboard; the dim is one blend.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> t: TrayUniforms;
@group(0) @binding(2) var noise_tex: texture_2d<f32>;
@group(0) @binding(3) var noise_samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) which: u32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let k = corners[vi];
  let vw = t.view.x;
  let vh = t.view.y;
  // the dim: the whole view; the drawer: its box from the shadow's reach above and beside it down to the view's bottom edge
  var lo = vec2f(0.0, 0.0);
  var hi = vec2f(vw, vh);
  if (ii == 1u) {
    let reach = 3.0 * max(t.shadow.x, t.room.x) + length(t.shadow.zw);
    lo = vec2f(max(t.rect.x - reach, 0.0), max(t.rect.y - reach, 0.0));
    hi = vec2f(min(t.rect.x + t.rect.z + reach, vw), vh);
  }
  let css = mix(lo, hi, k);
  var out: VOut;
  out.pos = vec4f(css.x / vw * 2.0 - 1.0, 1.0 - css.y / vh * 2.0, 0.0, 1.0);
  out.which = ii;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  if (in.which == 0u) { return vec4f(0.0, 0.0, 0.0, t.dim); }
  return tray_drawer(u, t, in.pos.xy, noise_tex, noise_samp);
}
