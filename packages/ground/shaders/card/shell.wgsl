// The SHELL — the engine's own card program (design-014): a rounded plate at
// the card's radius with no chrome band, the §5 ambient shadow, a hairline a
// pixel inside the edge, and the selection ring that fades in with the
// reveal — which also carries the drop cue (D2): on the accept tier the ring
// shows at the heat's presence, so a bare engine still says "this will take
// it". No parts, no lights, no morph. Everything a pack adds, it adds by
// replacing these two functions (card.wgsl names the contract).

fn shade_card(G: Frame, u: FrameUniforms, p: vec2f, px: f32) -> Shade {
  var s: Shade;
  let dO = sdf_round_box(p - G.centre, G.half, G.outerR);
  var acc = vec4f(0.0);
  // §5: the outer silhouette, Gaussian-blurred, cast down by `shadowOffset`.
  // Only outside the card — what the card covers, the card paints.
  if (G.shadowSigma > 0.01) {
    let sh = blur_cov(sdf_round_box(p - vec2f(0.0, G.shadowOffset) - G.centre, G.half, G.outerR), G.shadowSigma)
           * G.shadowAlpha * u.colBg.w * (1.0 - cov(dO, px));
    acc = over(vec4f(0.0, 0.0, 0.0, sh), acc);
  }
  s.under = acc;
  s.dO = dO;
  s.dI = dO;                 // no band: the content rect IS the card
  s.chrome = vec3f(0.0);
  s.cF = 0.0;
  s.cI = cov(dO, px);
  s.skip = dO > px;
  return s;
}

fn shade_over(G: Frame, u: FrameUniforms, p: vec2f, px: f32, s: Shade, acc_in: vec4f) -> vec4f {
  var acc = acc_in;
  // §2.3 the hairline, 1 px inside the outer edge.
  acc = over(layer(u.colHair, inside_line(s.dO, u.lines.x, px)), acc);
  // §7 the sole-selection ring, 1.5 px inside the same edge — and the drop cue at the accept tier (D2).
  let ring = max(G.ring, G.hot.z * G.hot.w);
  acc = over(layer(vec4f(u.colRing.rgb, ring), inside_line(s.dO, u.lines.y, px)), acc);
  return acc;
}
