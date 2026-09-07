// The card frame's distance field and shading, on a per-instance `Frame`
// record. A PURE module: the record, the pass uniforms and the pixel scale are
// parameters. Every geometric number in `Frame` was resolved on the CPU this
// frame — no curve is evaluated here — and every colour comes in through
// `FrameUniforms`, projected from DESIGN.md by theme.ts: this file names no
// colour. (Lineage: research/sdf-card/src/sdf/card.wgsl, glyphs.wgsl and
// render.wgsl, generalised from one uniform card to N records.)
//
//   frame = outer \ inner
//   outer = rounded rect
//   inner = rounded rect with a rounded-rect NOTCH cut flush into each corner

// One-hot corner mask, TL TR BR BL, from the sign of p.
fn corner_mask(p: vec2f) -> vec4f {
  let a = select(0.0, 1.0, p.x >= 0.0);
  let b = select(0.0, 1.0, p.y >= 0.0);
  return vec4f((1.0 - a) * (1.0 - b), a * (1.0 - b), a * b, (1.0 - a) * b);
}

// One corner's constraint region: the quadrant that corner owns, minus its
// notch. Every rounding joins two PERPENDICULAR half-planes, the condition
// under which the fillet operators are exact rather than plausible.
fn corner_sd(p: vec2f, ih: vec2f, s: vec2f,
             nw: f32, nh: f32, rho: f32, rfH: f32, rfV: f32, br: f32) -> f32 {
  let u  = p * s;
  let bx = u.x - ih.x;
  let by = u.y - ih.y;
  let dR = op_isect_round(bx, by, br);         // the card's own rounded corner
  if (nw <= 0.001 || nh <= 0.001) { return dR; }
  let nx = u.x - (ih.x - nw);
  let ny = u.y - (ih.y - nh);
  let dN = op_isect_round(-nx, -ny, rho);      // the notch, concave corner rounded by rho
  // The content is the ROUNDED card with the notch cut from it. While the
  // notch is smaller than the corner's own arc it bites nothing — the arc
  // lies outside it — so the bay blooms out of the rounded corner instead of
  // out of a square one; fully revealed, the notch contains the arc and the
  // intersection is the notched card exactly.
  // INSIDE: the intersection form — max is exact inside.
  let din = max(max(op_isect_round(by, -dN, rfH),
                    op_isect_round(bx, -dN, rfV)), dR);
  if (din <= 0.0) { return din; }
  // OUTSIDE: the same region as a union of two rounded quadrants — min is
  // exact outside. Both forms share the zero set, so switching on the sign is seamless.
  let f1 = op_isect_round(by, nx, rfH);
  let f2 = op_isect_round(bx, ny, rfV);
  return max(op_union_round(f1, f2, rho), dR);
}

fn frame_inner(G: Frame, pw: vec2f, exact: bool) -> f32 {
  let p  = pw - G.centre;
  let ih = G.ih;
  if (exact) {
    // Intersect all four corner regions: a real distance field over the whole plane.
    var d =    corner_sd(p, ih, vec2f(-1.0, -1.0), G.nw.x, G.nh.x, G.rho.x, G.rfH.x, G.rfV.x, G.baseR.x);
    d = max(d, corner_sd(p, ih, vec2f( 1.0, -1.0), G.nw.y, G.nh.y, G.rho.y, G.rfH.y, G.rfV.y, G.baseR.y));
    d = max(d, corner_sd(p, ih, vec2f( 1.0,  1.0), G.nw.z, G.nh.z, G.rho.z, G.rfH.z, G.rfV.z, G.baseR.z));
    d = max(d, corner_sd(p, ih, vec2f(-1.0,  1.0), G.nw.w, G.nh.w, G.rho.w, G.rfH.w, G.rfV.w, G.baseR.w));
    return d;
  }
  // FAST: fold by the sign of p and evaluate only the owning corner. Identical
  // silhouette; exact within min(nw, nh) of the outline, which covers AA, the
  // border, the shadow and hit-testing.
  let m = corner_mask(p);
  let s = vec2f(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
  return corner_sd(p, ih, s, dot(G.nw, m), dot(G.nh, m), dot(G.rho, m),
                   dot(G.rfH, m), dot(G.rfV, m), dot(G.baseR, m));
}

fn frame_outer(G: Frame, p: vec2f) -> f32 { return sdf_round_box(p - G.centre, G.half, G.outerR); }

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

// Padlock, in units where the button radius is the design radius. `open` swings
// the shackle about the base of its LEFT leg; `sq` is squash-and-stretch.
fn sdf_lock(pp: vec2f, sc: f32, open: f32, sq: f32) -> f32 {
  let p = pp / sc;
  let bh   = 9.0 * (1.0 - 0.09 * sq);
  let bw   = 11.0 * (1.0 + 0.06 * sq);
  let body = sdf_round_box(p - vec2f(0.0, 4.4 + 9.0 - bh), vec2f(bw, bh), 2.8);
  let pivot = vec2f(-6.6, -2.0);
  let a  = -open * 0.50;
  var q  = p - vec2f(0.0, -2.0 * open) - pivot;
  let ca = cos(a);
  let sa = sin(a);
  q = vec2f(ca * q.x + sa * q.y, -sa * q.x + ca * q.y) + pivot;
  let arcC = vec2f(0.0, -4.6);
  let ring = max(abs(length(q - arcC) - 6.6) - 2.2, q.y - arcC.y);
  let legs = min(sdf_segment(q, vec2f(-6.6, -4.6), vec2f(-6.6, -2.0)),
                 sdf_segment(q, vec2f( 6.6, -4.6), vec2f( 6.6, -2.0))) - 2.2;
  return min(body, min(ring, legs)) * sc;
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

// The card, shaded as PREMULTIPLIED layers, bottom to top: the §5 ambient
// shadow · solid-chrome frame + the card's committed surface · the §2.3
// hairline · the §7 overlap glow and rim · the §7 selection ring · the two buttons. Then the whole card
// takes its §7 lift opacity, shadow included, exactly as the DOM card's
// `opacity` does.
fn shade_frame(G: Frame, u: FrameUniforms, p: vec2f, px: f32, pages: texture_2d_array<f32>, own: texture_2d<f32>, samp: sampler) -> vec4f {
  let exact = u.view.z > 0.5;
  let dO = frame_outer(G, p);
  var acc = vec4f(0.0);

  // §5: the outer silhouette, Gaussian-blurred, cast down by `shadowOffset`.
  // Only outside the card — what the card covers, the card paints.
  if (G.shadowSigma > 0.01) {
    let sh = blur_cov(frame_outer(G, p - vec2f(0.0, G.shadowOffset)), G.shadowSigma)
           * G.shadowAlpha * u.colBg.w * (1.0 - cov(dO, px));
    acc = over(vec4f(0.0, 0.0, 0.0, sh), acc);
  }
  // More than a pixel outside the outer box, nothing but the shadow can paint
  // (every coverage below is 0 there) — and the shadow skirt is most of the
  // quad, so the notched inner field is never evaluated for it. Exact, not a
  // heuristic: cov(d, px) is identically 0 for d ≥ px/2.
  if (dO > px) { return acc * G.frameAlpha; }

  let dI = frame_inner(G, p, exact);
  let dF = max(dO, -dI);

  // Frame and content are ADDITIVE, not sequential: their coverages partition
  // the pixel (cov(dF) + cov(dI) == 1 across the shared boundary), and a second
  // `over` would leak bg·cF·cI at the seam. Clamped so a rounding slip cannot
  // push the sum past 1.
  let cF = cov(dF, px);
  let cI = min(cov(dI, px), 1.0 - cF);
  // The interior is the content term — a colour today, a texel when the record says so (§10.1) —
  // or a HOLE (mode 3, PORTAL.md §2.2, §10): the container's inside was drawn beneath through its
  // FACE (uv.xy the face's centre from the card's, chalf its half extents, uv.z its radius; uv.w
  // 0 = the whole interior). Inside the face nothing paints — the fill beneath, grown a device px
  // past this edge, is what shows — and outside it the plate stays: the inset band, the bar. cov()
  // is the fill's own filter, so at the edge the plate and the hole partition the pixel and
  // nothing under the container ever shows. (The §5 shadow is outside the silhouette only.)
  let hole = G.mode == 3u;
  var content = G.surface.rgb;
  var cC = cI;
  if (hole) {
    let covF = select(1.0, cov(sdf_round_box(p - G.centre - G.uv.xy, G.chalf, G.uv.z), px), G.uv.w > 0.5);
    cC = cI * (1.0 - covF);
  } else if (cI > 0.0) { content = content_rgb(G, p, pages, own, samp); }
  acc = over(vec4f(u.colFrame.rgb * cF + content * cC, cF + cC), acc);

  // §2.3 the hairline, 1 px inside the outer edge — the `0 0 0 1px` ring of the
  // card shadow recipe. §7 the sole-selection ring, 1.5 px inside the same edge,
  // arriving with the reveal.
  acc = over(layer(u.colHair, inside_line(dO, u.lines.x, px)), acc);

  // §7 the overlap HEAT (GLOW.md): the LIFTED card is an emitting surface floating
  // `glowK.x` above this one, and this card receives its light through the SOURCE's own
  // distance field — the half-plane irradiance ½(1 − d/√(d² + h²)): 1 deep under the
  // card, ½ at its silhouette, h²/4d² far away; the source's rounded corners follow its
  // field. Light ADDS (the receiver brightens, never greys), masked to this card's
  // coverage, between the hairline (beneath) and the ring (above); the rim is the ring's
  // own line catching the same light. Per instance: a cold card pays one compare.
  if (G.hot.z > 0.001) {
    let tier = G.hot.w;
    let dS = sdf_round_box(p - G.hot.xy, G.src.xy, G.src.z);
    let h = max(u.glowK.x, 1e-3);
    let lit = 0.5 * (1.0 - dS * inverseSqrt(dS * dS + h * h)) * G.hot.z;
    let glow = u.colGlow.rgb * (mix(u.glowK.y, u.glowK.z, tier) * lit * (cF + cI));
    let rim = u.colRim.rgb * (mix(u.rimK.y, u.rimK.z, tier) * lit * inside_line(dO, u.rimK.x, px));
    acc = vec4f(acc.rgb + glow + rim, acc.a);
  }

  acc = over(layer(vec4f(u.colRing.rgb, G.ring), inside_line(dO, u.lines.y, px)), acc);

  // The lock: a §7 fill that steps on hover; the glyph wears the text ramp —
  // secondary locked, tertiary open, foreground on hover.
  if (G.lockR > 0.05) {
    let lp = p - G.lockC;
    let cB = cov(sdf_circle(lp, G.lockR), px);
    acc = over(layer(mix(u.colBtn, u.colBtnHover, G.hoverK), cB), acc);
    let ink = mix(mix(u.colInk, u.colInkMuted, G.lockOpen), u.colInkStrong, G.hoverK);
    acc = over(layer(ink, cov(sdf_lock(lp, G.lockGlyphScale, G.lockOpen, G.lockSquash), px)), acc);
  }
  // The close: colourless at rest like every other chrome; §2.5 red the moment
  // it is armed — destructive is visually distinct BEFORE the act.
  if (G.closeR > 0.05) {
    let bp = p - G.closeC;
    let cB = cov(sdf_circle(bp, G.closeR), px);
    acc = over(layer(u.colBtn, cB), acc);
    acc = over(layer(vec4f(u.colDestructive.rgb, G.hoverC), cB), acc);
    let ink = mix(u.colInk, u.colOnSolid, G.hoverC);
    acc = over(layer(ink, cov(sdf_rounded_x(bp, G.closeGlyphW, G.closeGlyphR), px)), acc);
  }
  return acc * G.frameAlpha;
}
