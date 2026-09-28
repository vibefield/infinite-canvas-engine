// (The kit's since K4a — moved from notebook/notebook-composite.wgsl: every layered kind lays its layer with it, kit/layer.ts `layerComposite`.)
// A layered kind's layer onto the canvas: the resolved, premultiplied layer, over what the ground drew — through the slot's PORTAL CHAIN
// (design-018 §4 — the kit's contract, which the kind's own passes cannot keep: they draw into the layer, not onto the canvas). The
// whole layer is laid at the chain's cover, so its object fades as ONE (a book's cover never shows its pages through it — group
// opacity, the tray's feather); at the root the chain is empty, the cover exactly 1, and the layer is laid as it always was.
// K7a: the layer is its screen BOX's (kit/layer.ts `BoxTargets`) — the texel of a pixel is the pixel less the box's origin.

@group(0) @binding(0) var layer: texture_2d<f32>;
@group(0) @binding(1) var<uniform> origin: vec4f;
@group(0) @binding(2) var<uniform> u: MatUniforms;

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vid], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dpr = u.cam.w;
  return textureLoad(layer, vec2i(pos.xy) - vec2i(origin.xy), 0) * portal_cover(pos.xy / dpr, u.portals, u.clips, dpr);
}
