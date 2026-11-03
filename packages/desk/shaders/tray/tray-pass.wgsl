// The pegboard drawer and its edge veil share one layout. The board is drawn under the specimens; the veil is drawn over them.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> t: TrayUniforms;
@group(0) @binding(2) var noise_tex: texture_2d<f32>;
@group(0) @binding(3) var noise_samp: sampler;
@group(0) @binding(4) var hash_tex: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let k = corners[vi % 6u];
  let vw = t.view.x;
  let vh = t.view.y;
  var lo = vec2f(0.0, 0.0);
  var hi = vec2f(vw, vh);
  // Dimming covers the view; otherwise cover only the drawer and its shadows.
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

// THE VEIL (design-018 rev 5): one quad over the drawer's top — from its edge down through the header and its ramp — laid LAST, over
// everything the drawer holds (tray.wgsl `tray_veil`: the plain board, whole in the header, fading out over the ramp). With a host's
// FOOT inset (petition I21, `fade.z`) a second quad in the same draw, vertices 6–11: from the foot's ramp down to the board's bottom
// edge (never above the first's foot), the plain board whole in the foot and fading out over the ramp above its line.
@vertex
fn vs_veil(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let k = corners[vi % 6u];
  let vw = t.view.x;
  let vh = t.view.y;
  let head = t.rect.y + t.shape.y + t.fade.y + t.fade.x + 1.0;
  var lo = clamp(vec2f(t.rect.x, t.rect.y), vec2f(0.0), vec2f(vw, vh));
  var hi = clamp(vec2f(t.rect.x + t.rect.z, head), vec2f(0.0), vec2f(vw, vh));
  if (vi >= 6u) {
    lo = clamp(vec2f(t.rect.x, max(t.rect.y + t.rect.w - t.fade.z - t.fade.w - 1.0, head)), vec2f(0.0), vec2f(vw, vh));
    hi = clamp(vec2f(t.rect.x + t.rect.z, t.rect.y + t.rect.w), vec2f(0.0), vec2f(vw, vh));
  }
  let css = mix(lo, hi, k);
  return vec4f(css.x / vw * 2.0 - 1.0, 1.0 - css.y / vh * 2.0, 0.0, 1.0);
}

@fragment
fn fs_veil(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tray_veil(u, t, pos.xy, noise_tex, noise_samp, hash_tex);
}
