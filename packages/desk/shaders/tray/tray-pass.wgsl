// The pegboard tray's pass (design-017 §5; K5a; design-018 §2): drawn in the ROOT's render pass after the marks, premultiplied, two kinds
// of quad — one vertex entry that lays each by its instance, two fragment entries (two pipelines on one layout: a branch over both in one
// entry cost the board a third of its time, the register budget of the largest path paid by every pixel): instance 0 the drawer UNDER
// its specimens, its edge included (`fs` → tray.wgsl `tray_drawer` — the view whole while the slide shows the dim, the drawer's box grown
// by its shadows' reach while nothing dims; shut, nothing is drawn at all); from instance 1, one quad per specimen's ACCESSORY with its
// shadow (`fs_accessory`, the records in `acc`). The rim's strips over it all retired with the rim (design-018 §2).

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> t: TrayUniforms;
@group(0) @binding(2) var noise_tex: texture_2d<f32>;
@group(0) @binding(3) var noise_samp: sampler;
@group(0) @binding(4) var hash_tex: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> acc: array<TrayAccessory>;

struct TrayOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) mode: u32,
  @location(1) @interpolate(flat) item: u32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TrayOut {
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let k = corners[vi % 6u];
  let vw = t.view.x;
  let vh = t.view.y;
  var lo = vec2f(0.0, 0.0);
  var hi = vec2f(vw, vh);
  var o: TrayOut;
  o.mode = 0u;
  o.item = 0u;
  if (ii == 0u) {
    // dimming: the view whole; undimmed: the drawer's box from its shadows' reach above and beside it down to the view's bottom edge
    if (t.dim <= 0.0) {
      let reach = 3.0 * max(t.shadow.x, t.room.x) + length(t.shadow.zw);
      lo = vec2f(max(t.rect.x - reach, 0.0), max(t.rect.y - reach, 0.0));
      hi = vec2f(min(t.rect.x + t.rect.z + reach, vw), vh);
    }
  } else {
    o.mode = 1u;
    o.item = ii - 1u;
    let b = acc[o.item].box;
    lo = clamp(b.xy, vec2f(0.0), vec2f(vw, vh));
    hi = clamp(b.zw, vec2f(0.0), vec2f(vw, vh));
  }
  let css = mix(lo, hi, k);
  o.pos = vec4f(css.x / vw * 2.0 - 1.0, 1.0 - css.y / vh * 2.0, 0.0, 1.0);
  return o;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tray_drawer(u, t, pos.xy, noise_tex, noise_samp, hash_tex);
}

@fragment
fn fs_accessory(@builtin(position) pos: vec4f, @location(1) @interpolate(flat) item: u32) -> @location(0) vec4f {
  return tray_accessory(u, t, acc[item], pos.xy, noise_tex, noise_samp, hash_tex);
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
    lo = clamp(vec2f(t.rect.x, max(t.rect.y + t.rect.w - t.fade.z - t.fade.x - 1.0, head)), vec2f(0.0), vec2f(vw, vh));
    hi = clamp(vec2f(t.rect.x + t.rect.z, t.rect.y + t.rect.w), vec2f(0.0), vec2f(vw, vh));
  }
  let css = mix(lo, hi, k);
  return vec4f(css.x / vw * 2.0 - 1.0, 1.0 - css.y / vh * 2.0, 0.0, 1.0);
}

@fragment
fn fs_veil(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tray_veil(u, t, pos.xy, noise_tex, noise_samp, hash_tex);
}
