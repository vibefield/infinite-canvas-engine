// The paper pass — the notes, instanced: one quad per sheet, expanded on the
// vertex side by the shadow's reach and the AA, one `shade_paper` per covered
// fragment in world units, premultiplied output through the presentation's
// opacity and the portal clip (like the frames). The quad and the fragment are
// paper-card.wgsl's — the flat-card pipeline draws a note with the same two (K7b).

// The slot is lit from elsewhere (MINIMAT.md §4): the pass's second pipeline — a pipeline constant, never a uniform flag.
override LIT_ELSEWHERE: bool = false;

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> paper_k: PaperUniforms;
@group(0) @binding(2) var<storage, read> papers: array<Paper>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;      // the mat's animated silhouette (its wind target)
@group(0) @binding(4) var paper_gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var paper_noise_samp: sampler;
@group(0) @binding(7) var paper_ink: texture_2d_array<f32>; // the ink pages: r8 coverage, one layer of rasters per binding
@group(0) @binding(8) var paper_ink_samp: sampler;
@group(0) @binding(9) var<storage, read> order: array<u32>;   // the draw list: paint index → the record's slot (persistent records, D6)
@group(0) @binding(10) var paper_hand_runs: texture_2d<f32>;  // THE PEN (petition I59): the kind's run store — rgba32float, read texel by texel
@group(0) @binding(11) var paper_hand_atlas: texture_2d<f32>; // …the face's atlas (rg8unorm: the ink's edge, the pen's arrival), every level
@group(0) @binding(12) var paper_hand_samp: sampler;          // …and its sampler, linear between the levels

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.idx = order[iid];
  out.clip = paper_quad(out.idx, vid);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let c = paper_frag(in.idx, in.clip);
  if (c.a < 0.0) { discard; }
  return c;
}
