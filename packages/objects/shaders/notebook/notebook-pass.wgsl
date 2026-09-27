// The notebook pass's entries (NOTEBOOK.md §6). Three draws per book into a 4× multisampled
// layer, then one composite onto the canvas:
//   vs_shadow           the book's depth from its lamp, into its layer of the shadow map
//   vs_book · fs_book   the book itself — depth-tested, opaque, its page corners rounded by the sample mask
//   vs_recv · fs_recv   the mat under it: the book's shadow (PCSS) and its contact, the selection ring —
//                       drawn after the book, so the depth test skips every pixel the book covers
// The book's record carries its placement, its lamp and its shadow map's frame.
// The view block `u` is the SLOT's since K4a (design-016 K-L3), shared with the mat and every kind: this layer is drawn at FULL
// presence, as it always was (the pass's own copy of the block carried no presentation, and the composite lays the layer whole),
// so it reads neither `u.view.w` (the objects' presence) nor `u.presence.x` (the slot's) — its alpha is its coverage alone.

@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<uniform> k: NbUniforms;
@group(0) @binding(2) var<storage, read> books: array<NbBook>;
@group(0) @binding(3) var gobo_tex: texture_2d<f32>;
@group(0) @binding(4) var gobo_samp: sampler;
@group(0) @binding(5) var noise_tex: texture_2d<f32>;
@group(0) @binding(6) var noise_samp: sampler;
@group(0) @binding(7) var shadow_tex: texture_depth_2d_array;
@group(0) @binding(8) var shadow_cmp: sampler_comparison;
@group(0) @binding(9) var ink_tex: texture_2d_array<f32>;   // the pages' ink rasters (straight alpha)
@group(0) @binding(10) var ink_samp: sampler;
@group(0) @binding(11) var paper_tex: texture_2d<f32>;      // the baked paper (mottle · fibres · the tooth's slope), mipmapped
@group(0) @binding(12) var paper_samp: sampler;            // repeat, trilinear, anisotropic

// The layer a page's ink is in, from the book's table; −1 when the page has none on the device. Read
// straight from the storage buffer: indexing the arrays of a by-value record would push the whole
// record out of registers.
fn nb_ink_layer(bi: u32, page: f32) -> i32 {
  let pa = books[bi].inkPage[0];
  let pb = books[bi].inkPage[1];
  let hitA = (abs(pa - vec4f(page)) < vec4f(0.5)) & (pa >= vec4f(0.0));
  let hitB = (abs(pb - vec4f(page)) < vec4f(0.5)) & (pb >= vec4f(0.0));
  if (any(hitA)) { return i32(dot(select(vec4f(0.0), books[bi].inkLayer[0], hitA), vec4f(1.0)) + 0.5); }
  if (any(hitB)) { return i32(dot(select(vec4f(0.0), books[bi].inkLayer[1], hitB), vec4f(1.0)) + 0.5); }
  return -1;
}

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) mat: vec4f,     // material, page, flags, ao
  @location(4) size: vec2f,    // the face's size, world units
  @location(5) extra: vec2f,
}

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) mat: vec3f,
  @location(4) ao: f32,
  @location(5) @interpolate(flat) size: vec4f,
  @location(6) @interpolate(flat) book: u32,
}

@vertex
fn vs_shadow(@location(0) pos: vec3f, @builtin(instance_index) iid: u32) -> @builtin(position) vec4f {
  let B = books[iid];
  return B.light * (B.model * vec4f(pos, 1.0));
}

@vertex
fn vs_book(v: VIn, @builtin(instance_index) iid: u32) -> VOut {
  let B = books[iid];
  var out: VOut;
  let P = (B.model * vec4f(v.pos, 1.0)).xyz;
  out.clip = nb_clip(k, P);
  out.world = P;
  out.nrm = (B.model * vec4f(v.nrm, 0.0)).xyz;
  out.uv = v.uv;
  out.mat = v.mat.xyz;
  out.ao = v.mat.w;
  out.size = vec4f(v.size, v.extra);
  out.book = iid;
  return out;
}

@fragment
fn fs_book(in: VOut) -> @location(0) vec4f {
  // every derivative first — they must be taken in uniform control flow
  let dPdx = dpdx(in.world);
  let dPdy = dpdy(in.world);
  let dUdx = dpdx(in.uv);
  let dUdy = dpdy(in.uv);
  let dqdx = dUdx * in.size.xy;
  let dqdy = dUdy * in.size.xy;
  let B = books[in.book];
  let px = max(max(length(dPdx), length(dPdy)), 1e-4);   // world units per device px
  let mat = i32(in.mat.x + 0.5);
  let flags = u32(in.mat.z + 0.5);
  var n = normalize(in.nrm);
  let E = vec3f(k.eye.x, k.eye.y, k.eye.z);
  let V = normalize(E - in.world);
  var page = in.mat.y;
  let q = in.uv * in.size.xy;
  var inside = false;
  if ((flags & 1u) != 0u && dot(n, V) < 0.0) { n = -n; page += 1.0; inside = true; }

  // the face's tangents (world units along its u and v) from the uv's screen derivatives
  let det = dUdx.x * dUdy.y - dUdx.y * dUdy.x;
  var Tu = vec3f(1.0, 0.0, 0.0);
  var Tv = vec3f(0.0, 1.0, 0.0);
  if (abs(det) > 1e-14) {
    Tu = (dPdx * dUdy.y - dPdy * dUdx.y) / det;
    Tv = (dPdy * dUdx.x - dPdx * dUdy.x) / det;
  }
  Tu = Tu - n * dot(n, Tu);
  Tv = Tv - n * dot(n, Tv);
  Tu = select(vec3f(1.0, 0.0, 0.0), normalize(Tu), length(Tu) > 1e-8);
  Tv = select(vec3f(0.0, 1.0, 0.0), normalize(Tv), length(Tv) > 1e-8);

  let bn = textureSampleLevel(noise_tex, noise_samp, (in.clip.xy + k.ring.zw) * u.noise.z + u.noise.xy, 0.0).rgb;
  var albedo = B.col6.rgb;
  var grad = vec2f(0.0);           // the surface's height slope along u and v
  var ao = in.ao;
  var dapple = k.light.w;
  var sheen = vec2f(k.cloth.z, k.cloth.w);
  let dbg = u32(k.ring.y);

  if ((dbg & 2u) != 0u) {
    albedo = select(B.col0.rgb, B.col6.rgb, mat == 3 || mat == 4);
  } else if (mat == 3) {
    // a PAGE: ivory with its fibre and tooth, dots printed on it, its fore-edge corners rounded
    let w = in.size.x;
    let h = in.size.y;
    let pp = nb_paper(k, B.col6.rgb, q, dqdx, dqdy, page, paper_tex, paper_samp);
    albedo = pp.albedo;
    grad = pp.g;
    albedo = mix(albedo, k.ruleInk.rgb, nb_ruling(k, B, q, w, h, px) * k.ruleInk.a);
    // the pen's ink, laid into the paper before the light: it takes the gutter, the dapple and the night with it
    let layer = nb_ink_layer(in.book, page);
    if (layer >= 0) {
      let ink = textureSampleLevel(ink_tex, ink_samp, in.uv, layer, 0.0);
      albedo = mix(albedo, ink.rgb, ink.a);
    }
    // the gutter's occlusion, and the page's own edge a breath darker
    ao *= 1.0 - 0.3 * exp(-q.x / 4.5) - 0.12 * exp(-q.x / 18.0);
    dapple = k.light.z;
    sheen = vec2f(5.0, 0.02);
  } else if (mat == 0) {
    // the COVER: the cloth, the band, the design
    albedo = nb_cover_albedo(k, B, q, px);
    grad = nb_cover_g(k, B, q, px);
    if (B.foot.y > 0.5 && q.x > B.page.w) { sheen = vec2f(6.0, 0.02); }
  } else if (mat == 1) {
    let end = nb_endpaper(k, B, q, px, in.size.w > 0.5, dqdx, dqdy, paper_tex, paper_samp);
    albedo = end.albedo;
    ao *= end.ao;
    grad = nb_paper(k, B.col5.rgb, q, dqdx, dqdy, 77.0, paper_tex, paper_samp).g * 0.6;
    dapple = k.light.z;
    sheen = vec2f(5.0, 0.015);
  } else if (mat == 2) {
    albedo = nb_board(k, B, q, px);
  } else if (mat == 4) {
    albedo = nb_edge(k, B, q, in.size.z, in.size.w, px);
    sheen = vec2f(4.0, 0.0);
    dapple = k.light.z;
  } else if (mat == 6) {
    // the RIBBON: satin — a grosgrain of fine ribs along it, and a sheen that runs along its length (Kajiya–Kay on the weave's direction)
    albedo = B.col4.rgb * (0.9 + 0.1 * sin(in.uv.y * 44.0));
    grad = vec2f(0.0, cos(in.uv.y * 44.0) * 0.12);
    sheen = vec2f(0.0, 0.0);
    let Hs = normalize(B.lamp.xyz + V);
    let th = dot(Tu, Hs);
    let satin = pow(max(sqrt(max(1.0 - th * th, 0.0)), 0.0), 48.0) * 0.16;
    albedo += vec3f(satin);
    dapple = k.light.w;
  } else {
    // the SPINE: the band's cloth; seen from inside (the hollow of an open book), in shade
    albedo = B.col1.rgb * (1.0 + nb_cloth(q, k.cloth.x, px).shade * 0.16);
    if (inside) { albedo *= 0.5; ao *= 0.7; }
  }

  // the bumped normal: the height's slope tips the face
  let nb = normalize(n - Tu * grad.x - Tv * grad.y);
  let L = B.lamp.xyz;
  let lam = min(max(dot(nb, L), 0.0) / max(L.z, 1e-3), k.light.y);
  // the book shades itself only while something of it rises over the rest (a sheet in the air, the cover swinging)
  var vis = 1.0;
  if (B.foot.w > 0.5) { vis = nb_shadow(k, B, in.world, n, bn.x * 6.2831853, shadow_tex, shadow_cmp); }
  // paper sees more sky than cloth: the facing page and the desk bounce light onto it
  let sky = select(k.light.x, mix(k.light.x, 1.0, 0.22), mat == 3);
  var light = (sky + (1.0 - sky) * lam * vis) * ao;
  if (mat == 3) {
    // paper is translucent: a sheet with the lamp behind it glows with what comes through
    let back = max(-dot(n, L), 0.0) / max(L.z, 1e-3);
    light += 0.32 * (1.0 - k.light.x) * min(back, 1.2) * vis * ao;
  }
  var g0 = 1.0;
  if ((dbg & 4u) == 0u) { g0 = sample_gobo(u, gobo_tex, gobo_samp, nb_desk_at(u, in.world), bn.z); }
  let gobo = mix(1.0, g0, dapple);
  var c = nb_colour(u, albedo, light, gobo, bn.y);
  // the sheen: the lamp's glint on cloth and paper, where the lamp reaches
  let Hh = normalize(L + V);
  let sp = pow(max(dot(nb, Hh), 0.0), sheen.x) * sheen.y * vis * g0;
  c += vec3f(sp * (1.0 - u.night.x * 0.85));

  return vec4f(c, 1.0);
}

// ---- the mat under a book: its shadow, its contact, its ring

struct ROut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec2f,
  @location(1) @interpolate(flat) book: u32,
}

const RQUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));

@vertex
fn vs_recv(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> ROut {
  let B = books[iid];
  var out: ROut;
  let p = mix(B.recv.xy, B.recv.zw, RQUAD[vid]);
  out.clip = nb_clip(k, vec3f(p, 0.0));
  out.world = p;
  out.book = iid;
  return out;
}

// The book's footprint on the desk, in its own coordinates: the back board, and — once the cover has come down — the spine and the front board beside it.
fn nb_footprint(B: NbBook, p: vec2f) -> f32 {
  let w = B.size.x;
  let h = B.size.y;
  let r = B.size.w;
  let back = nb_sd_fore(p + vec2f(w * 0.5, h * 0.5), w, h, r);
  if (B.foot.x < 0.5) { return back; }
  let sw = B.open.z;
  let front = nb_sd_fore(vec2f(-w * 0.5 - sw - p.x, p.y + h * 0.5), w, h, r);
  let spine = nb_sd_box(p - vec2f(-w * 0.5 - sw * 0.5, 0.0), vec2f(sw * 0.5 + 0.5, h * 0.5), 0.0);
  return min(back, min(front, spine));
}

@fragment
fn fs_recv(in: ROut) -> @location(0) vec4f {
  let B = books[in.book];
  let P = vec3f(in.world, 0.0);
  let bn = textureSampleLevel(noise_tex, noise_samp, (in.clip.xy + k.ring.zw) * u.noise.z + u.noise.xy, 0.0).rgb;
  let vis = nb_shadow(k, B, P, vec3f(0.0, 0.0, 1.0), bn.x * 6.2831853, shadow_tex, shadow_cmp);
  let aS = k.shadow.z * (1.0 - vis);
  // the contact: where the case meets the mat, fading as it rises
  let L = (B.inv * vec4f(P, 1.0)).xyz;
  let d = nb_footprint(B, L.xy);
  let rise = max(-L.z, 0.0);
  let touch = 1.0 - smoothstep(0.0, k.shadow2.y, rise);
  let s = k.shadow2.x;
  let aC = k.shadow.w * touch * exp(-max(d, 0.0) * max(d, 0.0) / (2.0 * s * s)) * step(-0.5, d);
  let a = 1.0 - (1.0 - aS) * (1.0 - aC);
  var c = vec4f(k.castCol.rgb * a, a);
  // the selection ring, on the mat around the book
  let css = 1.0 / max(k.eye.w, 1e-6);
  let rw = k.select.w * css;
  let rd = abs(d - k.ring.x * css) - rw * 0.5;
  let ring = nb_cov(rd, css / max(k.shadow2.w, 1.0)) * B.look.z;
  c = vec4f(k.select.rgb * ring, ring) + c * (1.0 - ring);
  return c;
}
