// The INK — fullscreen passes over a board's raster (the research whiteboard's
// composite.wgsl): lay a finished stroke from the stroke layer into the ink layer, mark it wet,
// let the wet fade. The ink layer is PREMULTIPLIED LINEAR colour with coverage in alpha, so
// its mips average correctly and the melamine can read it as a filter.

@group(0) @binding(0) var<uniform> C: InkUniforms;
@group(0) @binding(1) var stroke: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn ink_cov(p: vec4f) -> f32 { return textureLoad(stroke, vec2i(p.xy), 0).r; }

// a marker: premultiplied "over" into the ink layer (blend one / one-minus-src-alpha)
@fragment
fn fs_draw(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = ink_cov(p);
  return vec4f(C.color.rgb * c, c);
}

// the eraser: ink *= 1 − coverage (blend zero / one-minus-src-alpha)
@fragment
fn fs_erase(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(0.0, 0.0, 0.0, ink_cov(p));
}

// the wet layer: max(wet, coverage)
@fragment
fn fs_wet(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(ink_cov(p), 0.0, 0.0, 1.0);
}

// the wet fades: dst *= the blend constant
@fragment
fn fs_dry(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(0.0);
}
