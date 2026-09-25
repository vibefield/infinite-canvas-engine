// The STAMP — the pen's footprints into the stroke layer (r8, max-blended: a stroke never
// darkens where it crosses itself, as a marker line does not). One instance per stamp, its
// quad grown from the stamp's centre by the tip's reach, in the raster's texels; the
// footprint, the felt's lanes and the flow in WORLD units (the stamps are the melamine's world
// units, stroke.ts), so a stroke is the same stroke at any density. The research
// whiteboard's stamp.wgsl, moved off the screen and onto the board.

@group(0) @binding(0) var<uniform> S: StampUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;

struct StampOut {
  @builtin(position) pos: vec4f,
  @location(0) px: vec2f,
  @location(1) @interpolate(flat) inst: u32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> StampOut {
  let st = stamps[ii];
  let k = S.tex.z;   // texels per world unit
  let corner = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u)) * 2.0 - 1.0;
  let ext = (length(S.tip.xy) * st.size + S.felt.x + 0.5) * k + 2.0;
  let px = st.pos * k + corner * ext;
  var o: StampOut;
  o.pos = vec4f(px / S.tex.xy * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  o.px = px;
  o.inst = ii;
  return o;
}

@fragment
fn fs(in: StampOut) -> @location(0) vec4f {
  let st = stamps[in.inst];
  let k = S.tex.z;
  let texel = 1.0 / k;
  let d = (in.px - st.pos * k) * texel;   // world units from the stamp's centre

  // the footprint in the tip's own frame (the tip keeps its angle, like a hand-held marker)
  let ca = cos(S.tip.z);
  let sa = sin(S.tip.z);
  let q = vec2f(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
  let hf = S.tip.xy * st.size;
  let sd = sdf_round_box(q, hf, S.tip.w * st.size);
  let soft = S.felt.x;
  let shape = 1.0 - smoothstep(-soft * 0.5 - texel * 0.5, soft * 0.5 + texel * 0.5, sd);

  // the felt's fibres: each traces a line parallel to the motion, so the lane pattern is a
  // function of the offset across the path (stable under max-blending of the stamps)
  let perp = vec2f(-st.dir.y, st.dir.x);
  let across = dot(d, perp);
  let along = st.s;
  let n1 = felt_noise(vec2f(across * S.lanes.x + st.seed * 37.1, along * S.lanes.y + st.seed * 11.3));
  let n2 = felt_noise(vec2f(across * S.lanes.x * 1.7 + st.seed * 5.7, along * S.lanes.z + st.seed * 3.1));
  let lanes = smoothstep(0.08, 0.5, n1 + 0.45 * n2);

  var density: f32;
  if (S.felt.y < 0.5) {
    // a marker: mostly solid ink; a faster stroke runs drier and opens more, deeper lanes
    let dry = 1.0 - st.flow;
    let streak = clamp(S.felt.w * (1.0 + 5.0 * dry), 0.0, 1.0);
    let flowVar = 1.0 + 0.04 * felt_noise(vec2f(along * S.lanes.y, st.seed * 3.3 + 50.0));
    // the felt presses lighter at its rim
    let rim = 1.0 - 0.22 * smoothstep(-0.35 * min(hf.x, hf.y), 0.0, sd);
    density = (1.0 - streak * lanes) * (1.0 - 0.35 * dry) * flowVar * rim * S.felt.z;
  } else {
    // the eraser: takes most of the ink, leaves a streaky ghost
    density = 0.86 + 0.11 * (1.0 - lanes);
  }
  return vec4f(clamp(shape * density, 0.0, 1.0), 0.0, 0.0, 1.0);
}
