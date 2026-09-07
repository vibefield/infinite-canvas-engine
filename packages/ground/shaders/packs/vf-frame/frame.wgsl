// VibeField's card frame — a CARD PROGRAM pack (design-014): the composed
// corners with their bays, the close and lock buttons with their glyphs, the
// §7 selection ring, the §2.3 hairline and the §7 overlap heat, on the engine's
// record HEAD plus this pack's TAIL. A PURE module: the record, the pass
// uniforms and the pixel scale are parameters. Every geometric number was
// resolved on the CPU this frame (choreography.ts) — no curve is evaluated
// here — and every colour comes in through the uniform slots this pack fills
// from its theme section: this file names no colour. (Lineage: research/
// sdf-card/src/sdf/card.wgsl, glyphs.wgsl and render.wgsl; the engine's
// frame.wgsl before design-014 split the seam.)
//
//   frame = outer \ inner
//   outer = rounded rect
//   inner = rounded rect with a rounded-rect NOTCH cut flush into each corner
//
// The TAIL (packs/vf-frame/index.ts packs it): ext[0..5] nw · nh · rho · rfH ·
// rfV · baseR (per corner, TL TR BR BL); ext[6] closeC.xy · closeR · closeGlyphW;
// ext[7] lockC.xy · lockR · lockGlyphScale; ext[8] closeGlyphR · lockOpen ·
// lockSquash · hoverC; ext[9] hoverK. The UNIFORM slots: uext[0] colFrame ·
// [1] colBtn · [2] colBtnHover · [3] colDestructive · [4] colInk · [5]
// colInkStrong · [6] colInkMuted · [7] colOnSolid · [8] colGlow · [9] colRim ·
// [10] glowK (height, alpha reject, alpha accept) · [11] rimK (width, alpha
// reject, alpha accept).

fn vf_nw(G: Frame) -> vec4f { return G.ext[0]; }
fn vf_nh(G: Frame) -> vec4f { return G.ext[1]; }
fn vf_rho(G: Frame) -> vec4f { return G.ext[2]; }
fn vf_rfH(G: Frame) -> vec4f { return G.ext[3]; }
fn vf_rfV(G: Frame) -> vec4f { return G.ext[4]; }
fn vf_baseR(G: Frame) -> vec4f { return G.ext[5]; }

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
  let nw = vf_nw(G);
  let nh = vf_nh(G);
  let rho = vf_rho(G);
  let rfH = vf_rfH(G);
  let rfV = vf_rfV(G);
  let baseR = vf_baseR(G);
  if (exact) {
    // Intersect all four corner regions: a real distance field over the whole plane.
    var d =    corner_sd(p, ih, vec2f(-1.0, -1.0), nw.x, nh.x, rho.x, rfH.x, rfV.x, baseR.x);
    d = max(d, corner_sd(p, ih, vec2f( 1.0, -1.0), nw.y, nh.y, rho.y, rfH.y, rfV.y, baseR.y));
    d = max(d, corner_sd(p, ih, vec2f( 1.0,  1.0), nw.z, nh.z, rho.z, rfH.z, rfV.z, baseR.z));
    d = max(d, corner_sd(p, ih, vec2f(-1.0,  1.0), nw.w, nh.w, rho.w, rfH.w, rfV.w, baseR.w));
    return d;
  }
  // FAST: fold by the sign of p and evaluate only the owning corner. Identical
  // silhouette; exact within min(nw, nh) of the outline, which covers AA, the
  // border, the shadow and hit-testing.
  let m = corner_mask(p);
  let s = vec2f(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
  return corner_sd(p, ih, s, dot(nw, m), dot(nh, m), dot(rho, m),
                   dot(rfH, m), dot(rfV, m), dot(baseR, m));
}

fn frame_outer(G: Frame, p: vec2f) -> f32 { return sdf_round_box(p - G.centre, G.half, G.outerR); }

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

// BELOW the content: the §5 ambient shadow, then the frame's two coverages —
// the solid-chrome band at cF and the interior at cI, partitioning the pixel.
fn shade_card(G: Frame, u: FrameUniforms, p: vec2f, px: f32) -> Shade {
  var s: Shade;
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
  s.under = acc;
  s.dO = dO;
  s.chrome = u.uext[0].rgb;
  // More than a pixel outside the outer box, nothing but the shadow can paint
  // (every coverage below is 0 there) — and the shadow skirt is most of the
  // quad, so the notched inner field is never evaluated for it. Exact, not a
  // heuristic: cov(d, px) is identically 0 for d ≥ px/2.
  if (dO > px) { s.dI = dO; s.cF = 0.0; s.cI = 0.0; s.skip = true; return s; }

  let dI = frame_inner(G, p, exact);
  let dF = max(dO, -dI);

  // Frame and content are ADDITIVE, not sequential: their coverages partition
  // the pixel (cov(dF) + cov(dI) == 1 across the shared boundary), and a second
  // `over` would leak bg·cF·cI at the seam. Clamped so a rounding slip cannot
  // push the sum past 1.
  let cF = cov(dF, px);
  let cI = min(cov(dI, px), 1.0 - cF);
  s.dI = dI;
  s.cF = cF;
  s.cI = cI;
  s.skip = false;
  return s;
}

// ABOVE the content: the §2.3 hairline · the §7 overlap glow and rim · the §7
// selection ring · the two buttons.
fn shade_over(G: Frame, u: FrameUniforms, p: vec2f, px: f32, s: Shade, acc_in: vec4f) -> vec4f {
  var acc = acc_in;
  let dO = s.dO;
  let cF = s.cF;
  let cI = s.cI;
  let e8 = G.ext[8];
  let e9 = G.ext[9];
  let hoverC = e8.w;
  let hoverK = e9.x;

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
    let glowK = u.uext[10];
    let rimK = u.uext[11];
    let tier = G.hot.w;
    let dS = sdf_round_box(p - G.hot.xy, G.src.xy, G.src.z);
    let h = max(glowK.x, 1e-3);
    let lit = 0.5 * (1.0 - dS * inverseSqrt(dS * dS + h * h)) * G.hot.z;
    let glow = u.uext[8].rgb * (mix(glowK.y, glowK.z, tier) * lit * (cF + cI));
    let rim = u.uext[9].rgb * (mix(rimK.y, rimK.z, tier) * lit * inside_line(dO, rimK.x, px));
    acc = vec4f(acc.rgb + glow + rim, acc.a);
  }

  acc = over(layer(vec4f(u.colRing.rgb, G.ring), inside_line(dO, u.lines.y, px)), acc);

  // The lock: a §7 fill that steps on hover; the glyph wears the text ramp —
  // secondary locked, tertiary open, foreground on hover.
  let lock = G.ext[7];
  if (lock.z > 0.05) {
    let lp = p - lock.xy;
    let cB = cov(sdf_circle(lp, lock.z), px);
    acc = over(layer(mix(u.uext[1], u.uext[2], hoverK), cB), acc);
    let ink = mix(mix(u.uext[4], u.uext[6], e8.y), u.uext[5], hoverK);
    acc = over(layer(ink, cov(sdf_lock(lp, lock.w, e8.y, e8.z), px)), acc);
  }
  // The close: colourless at rest like every other chrome; §2.5 red the moment
  // it is armed — destructive is visually distinct BEFORE the act.
  let close = G.ext[6];
  if (close.z > 0.05) {
    let bp = p - close.xy;
    let cB = cov(sdf_circle(bp, close.z), px);
    acc = over(layer(u.uext[1], cB), acc);
    acc = over(layer(vec4f(u.uext[3].rgb, hoverC), cB), acc);
    let ink = mix(u.uext[4], u.uext[7], hoverC);
    acc = over(layer(ink, cov(sdf_rounded_x(bp, close.w, e8.x), px)), acc);
  }
  return acc;
}
