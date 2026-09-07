// The card pass's ENGINE half (design-014): the coverage filter, the analytic
// shadow blur, the content term (plate · page · own · hole), the premultiplied
// layer helpers, and the SEAM COMPOSITE — one function, `shade_frame`, that
// every card program draws through. A program (card/program.ts) provides the
// two functions declared here and nothing else on the GPU:
//
//   shade_card(G, u, p, px) -> Shade   BELOW the content: whatever paints under
//                                      the card (the shadow) as `under`, the
//                                      chrome band's colour and coverage `cF`,
//                                      the interior coverage `cI`, the outer
//                                      and inner distances, and `skip` when
//                                      the fragment is past the card's reach.
//   shade_over(G, u, p, px, s, acc)    ABOVE the content: lines, lights,
//                                      controls, painted over `acc`.
//
// The law the composite keeps: frame and content are ADDITIVE, not
// sequential. Their coverages partition the pixel (cF + cI == 1 across the
// shared boundary), and a second `over` would leak bg·cF·cI at the seam. A
// program returns cF and cI so that they do; the engine composes the one
// layer. This file names no colour: every rgb is a uniform or the record's.

struct Shade {
  under: vec4f,     // premultiplied layers beneath the card (the §5 shadow)
  chrome: vec3f,    // the frame band's colour at cF
  cF: f32,          // the band's coverage
  cI: f32,          // the interior's coverage — the content term paints at it
  dO: f32,          // signed distance to the outer silhouette (card units)
  dI: f32,          // signed distance to the inner boundary
  skip: bool,       // past the card's reach: `under` is the whole answer
}

// ---- coverage: an exact 1-px box filter. `px` is world units per device pixel.
fn cov(d: f32, px: f32) -> f32 { return clamp(0.5 - d / px, 0.0, 1.0); }

// The band −w < d < 0: a line of width w just INSIDE a boundary, antialiased
// on both edges. This is how the hairline and the selection ring are drawn.
fn inside_line(d: f32, w: f32, px: f32) -> f32 { return cov(d, px) - cov(d + w, px); }

fn erf_approx(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
// Gaussian-blurred coverage — the analytic shadow, straight out of the field.
fn blur_cov(d: f32, sigma: f32) -> f32 {
  return 0.5 - 0.5 * erf_approx(d / max(sigma * 1.4142136, 1.0e-4));
}

// The run's OWN texture is `-srgb` (an island's render target): sampling
// decoded it to linear and the swap chain is plain, so the write must encode.
// A pipeline constant, never a uniform flag (README §4c's 1/255 lesson).
override ENCODE_SRGB: bool = false;

fn linear_to_srgb(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
// Defined on UNPREMULTIPLIED colour (design-012 §4): undo the alpha, encode, redo it.
fn encode_srgb(c: vec4f) -> vec4f {
  let a = max(c.a, 1e-6);
  return vec4f(linear_to_srgb(saturate(c.rgb / a)) * a, c.a);
}

// The CONTENT term (content.ts, design-013 §10.2–10.3): the interior colour at
// card point `p`. `plate` is the surface colour — today's card. `page` and
// `own` sample a premultiplied texel and lay it OVER the plate (an island's
// transparent pixels show the surface): a second `over` INSIDE the content
// layer, legal — the seam law concerns frame vs content only. The content
// rect (`chalf`, the inner box) maps onto the WRITTEN rect, clamped half a
// texel in so the gutter's bilinear safety is exact. `textureSampleLevel`
// because the branch is per instance and level 0 is the only level a page
// or a target has.
fn content_rgb(G: Frame, p: vec2f, pages: texture_2d_array<f32>, own: texture_2d<f32>, samp: sampler) -> vec3f {
  let plate = G.surface.rgb;
  if (G.mode == 0u) { return plate; }
  let dims = select(vec2f(textureDimensions(own)), vec2f(textureDimensions(pages)), G.mode == 1u);
  let eps = 0.5 / max(G.uv.zw * dims, vec2f(1.0));
  let t = clamp((p - G.centre) / (2.0 * G.chalf) + vec2f(0.5), eps, vec2f(1.0) - eps);
  let uv = G.uv.xy + t * G.uv.zw;
  var c = vec4f(0.0);
  if (G.mode == 1u) { c = textureSampleLevel(pages, samp, uv, G.layer, 0.0); }
  else {
    c = textureSampleLevel(own, samp, uv, 0.0);
    if (ENCODE_SRGB) { c = encode_srgb(c); }
  }
  return c.rgb + plate * (1.0 - c.a);
}

// Premultiplied "src over dst".
fn over(src: vec4f, dst: vec4f) -> vec4f { return src + dst * (1.0 - src.a); }
// A straight-alpha colour at coverage c, as a premultiplied layer.
fn layer(c: vec4f, cov_: f32) -> vec4f { let a = c.a * cov_; return vec4f(c.rgb * a, a); }

// The card, shaded as PREMULTIPLIED layers, bottom to top: the program's
// `under` · the frame band + the content term as ONE additive layer · the
// program's `shade_over`. Then the whole card takes its §7 lift opacity,
// shadow included, exactly as the DOM card's `opacity` does.
fn shade_frame(G: Frame, u: FrameUniforms, p: vec2f, px: f32, pages: texture_2d_array<f32>, own: texture_2d<f32>, samp: sampler) -> vec4f {
  let s = shade_card(G, u, p, px);
  var acc = s.under;
  // More than a pixel outside the outer box, nothing but what is under the card
  // can paint — and the shadow skirt is most of the quad, so a program's inner
  // field is never evaluated for it. Exact, not a heuristic: cov(d, px) is
  // identically 0 for d ≥ px/2.
  if (s.skip) { return acc * G.frameAlpha; }
  // The interior is the content term — a colour today, a texel when the record says so (§10.1) —
  // or a HOLE (mode 3, PORTAL.md §2.2, §10): the container's inside was drawn beneath through its
  // FACE (uv.xy the face's centre from the card's, chalf its half extents, uv.z its radius; uv.w
  // 0 = the whole interior). Inside the face nothing paints — the fill beneath, grown a device px
  // past this edge, is what shows — and outside it the plate stays: the inset band, the bar. cov()
  // is the fill's own filter, so at the edge the plate and the hole partition the pixel and
  // nothing under the container ever shows. (The §5 shadow is outside the silhouette only.)
  let hole = G.mode == 3u;
  var content = G.surface.rgb;
  var cC = s.cI;
  if (hole) {
    let covF = select(1.0, cov(sdf_round_box(p - G.centre - G.uv.xy, G.chalf, G.uv.z), px), G.uv.w > 0.5);
    cC = s.cI * (1.0 - covF);
  } else if (s.cI > 0.0) { content = content_rgb(G, p, pages, own, samp); }
  acc = over(vec4f(s.chrome * s.cF + content * cC, s.cF + cC), acc);
  acc = shade_over(G, u, p, px, s, acc);
  return acc * G.frameAlpha;
}
