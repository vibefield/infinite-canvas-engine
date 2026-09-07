// The overlay SOUP (design-013 §8 C1, D-C1.2) — a triangle list in the slot's
// SCREEN CSS px with a colour per vertex, drawn into the slot's render pass
// between the field and the frames (`under`: wires) or after them (`over`:
// guides). The vertex maps px → clip through the slot's own view; the fragment
// is the vertex colour, faded by the slot's presentation opacity and clipped by
// its portal CHAIN, exactly as the field and the fill are — so a slot seen
// through a face carries its overlays through the same hole.
//
// No depth, straight-alpha "source over", and `cullMode: "none"`: the screen-px
// collectors emit y-down geometry, which lands CLOCKWISE through this mapping.
// Under three that needed `DoubleSide` (the invisible-guides find, 2026-07-16);
// under WebGPU the default is to cull nothing. The pipeline states it anyway and
// the oracle's `overlay-soup-z1` scene carries a clockwise triangle and a
// counter-clockwise one, so both windings are asserted to land in real pixels
// rather than the default being trusted to hold.

@group(0) @binding(0) var<uniform> u: SoupUniforms;

struct VSOut {
  @builtin(position) clip  : vec4f,
  @location(0)       color : vec4f,
}

@vertex
fn vs(@location(0) pos: vec3f, @location(1) color: vec4f) -> VSOut {
  let css = vec2f(max(u.view.x, 1.0), max(u.view.y, 1.0));
  var out: VSOut;
  out.clip = vec4f(pos.x / css.x * 2.0 - 1.0, 1.0 - pos.y / css.y * 2.0, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let dpr = max(u.view.z, 1.0);
  let a = in.color.a * u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr);
  if (a < 0.002) { discard; }
  return vec4f(in.color.rgb, a);
}
