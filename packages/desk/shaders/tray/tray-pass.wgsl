// The pegboard tray's pass (design-017 §5; K5a): drawn in the ROOT's render pass after the marks, premultiplied, three kinds of quad on
// one pipeline, told apart by the instance: instance 0 the drawer UNDER its specimens (tray.wgsl `tray_drawer` — the view whole while
// the slide shows the dim, the drawer's box grown by its shadows' reach while it is closed); from instance 2, one quad per specimen's
// ACCESSORY with its shadow (`tray_accessory`, the records in `acc`); instance 1 the RIM over everything the drawer holds, three strips
// along its top and sides (`tray_rim_over`) — drawn last, after the kinds drew the specimens between the board and it.

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
    // dimming: the view whole; closed: the drawer's box from its shadows' reach above and beside it down to the view's bottom edge
    if (t.dim <= 0.0) {
      let reach = 3.0 * max(t.shadow.x, t.room.x) + length(t.shadow.zw);
      lo = vec2f(max(t.rect.x - reach, 0.0), max(t.rect.y - reach, 0.0));
      hi = vec2f(min(t.rect.x + t.rect.z + reach, vw), vh);
    }
  } else if (ii == 1u) {
    // the rim's three strips, disjoint: the top (its corners and the notch below the edge), then either side below it
    o.mode = 1u;
    let x0 = t.rect.x;
    let x1 = t.rect.x + t.rect.z;
    let top = t.rect.y + max(t.shape.x, t.shape.w + t.shape.y) + 2.0;
    let side = t.shape.y + 2.0;
    let strip = vi / 6u;
    if (strip == 0u) { lo = vec2f(x0, t.rect.y); hi = vec2f(x1, top); }
    else if (strip == 1u) { lo = vec2f(x0, top); hi = vec2f(x0 + side, vh); }
    else { lo = vec2f(x1 - side, top); hi = vec2f(x1, vh); }
    lo = clamp(lo, vec2f(0.0), vec2f(vw, vh));
    hi = clamp(hi, vec2f(0.0), vec2f(vw, vh));
  } else {
    o.mode = 2u;
    o.item = ii - 2u;
    let b = acc[o.item].box;
    lo = clamp(b.xy, vec2f(0.0), vec2f(vw, vh));
    hi = clamp(b.zw, vec2f(0.0), vec2f(vw, vh));
  }
  let css = mix(lo, hi, k);
  o.pos = vec4f(css.x / vw * 2.0 - 1.0, 1.0 - css.y / vh * 2.0, 0.0, 1.0);
  return o;
}

@fragment
fn fs(i: TrayOut) -> @location(0) vec4f {
  if (i.mode == 1u) { return tray_rim_over(u, t, i.pos.xy, noise_tex, noise_samp, hash_tex); }
  if (i.mode == 2u) { return tray_accessory(u, t, acc[i.item], i.pos.xy, noise_tex, noise_samp, hash_tex); }
  return tray_drawer(u, t, i.pos.xy, noise_tex, noise_samp, hash_tex);
}
