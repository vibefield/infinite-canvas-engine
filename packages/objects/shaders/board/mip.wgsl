// The MIP — one level of a board's ink raster from the level above: each texel the bilinear
// average of the 2×2 it covers (premultiplied, so the average is the right one). A board seen
// small reads its ink here instead of aliasing the full raster.

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var src_samp: sampler;

struct MipOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> MipOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  var o: MipOut;
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  o.uv = vec2f(x, y);
  return o;
}

@fragment
fn fs(in: MipOut) -> @location(0) vec4f {
  return textureSampleLevel(src, src_samp, in.uv, 0.0);
}
