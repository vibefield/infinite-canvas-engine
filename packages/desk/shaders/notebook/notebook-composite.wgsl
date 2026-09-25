// The notebook layer onto the canvas: the resolved, premultiplied layer, over what the ground drew.

@group(0) @binding(0) var layer: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vid], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return textureLoad(layer, vec2i(pos.xy), 0);
}
