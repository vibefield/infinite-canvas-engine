// The pegboard tray's pass (design-017 §5): drawn in the ROOT's render pass after the marks — ONE quad, premultiplied, each pixel once
// (tray.wgsl `tray_drawer`): the view whole while the slide shows the dim (black at its share of 10 % by day, 40 % by night; the
// drawer's shadows in it, the board over it), the drawer's box grown by its shadows' reach while it is closed (the lip alone).

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> t: TrayUniforms;
@group(0) @binding(2) var noise_tex: texture_2d<f32>;
@group(0) @binding(3) var noise_samp: sampler;
@group(0) @binding(4) var hash_tex: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let k = corners[vi];
  let vw = t.view.x;
  let vh = t.view.y;
  // dimming: the view whole; closed: the drawer's box from its shadows' reach above and beside it down to the view's bottom edge
  var lo = vec2f(0.0, 0.0);
  var hi = vec2f(vw, vh);
  if (t.dim <= 0.0) {
    let reach = 3.0 * max(t.shadow.x, t.room.x) + length(t.shadow.zw);
    lo = vec2f(max(t.rect.x - reach, 0.0), max(t.rect.y - reach, 0.0));
    hi = vec2f(min(t.rect.x + t.rect.z + reach, vw), vh);
  }
  let css = mix(lo, hi, k);
  return vec4f(css.x / vw * 2.0 - 1.0, 1.0 - css.y / vh * 2.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tray_drawer(u, t, pos.xy, noise_tex, noise_samp, hash_tex);
}
