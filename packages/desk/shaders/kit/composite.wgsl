// (The kit's since K4a — moved from notebook/notebook-composite.wgsl: every layered kind lays its layer with it, kit/layer.ts `layerComposite`.)
// The notebook layer onto the canvas: the resolved, premultiplied layer, over what the ground drew.
// K7a: the layer is its screen BOX's (kit/layer.ts `BoxTargets`) — the texel of a pixel is the pixel less the box's origin.

@group(0) @binding(0) var layer: texture_2d<f32>;
@group(0) @binding(1) var<uniform> origin: vec4f;

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vid], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(layer, vec2i(pos.xy) - vec2i(origin.xy), 0);
}
