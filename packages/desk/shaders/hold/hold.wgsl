// THE HAND'S FOCUS (design-015 §8; D4b) — the desk behind the object in hand goes out of focus, and the
// object is laid over it in its own light. Four fullscreen fragments over one triangle, one binding set:
//  - `fs_down` / `fs_up`: the dual-Kawase blur (Bjørge, ARM 2015) — a down pass takes the centre ×4 and the
//    four diagonals at ±offset half-texels; an up pass eight taps at ±offset (the axes once, the diagonals
//    twice) — the desk's HALF-SIZE copy blurred through two levels and back, once per settled desk.
//  - `fs_desk`: the frame's background — the sharp half-size copy mixed with the blurred one by the carry
//    amount (half-way up, half the blur), dimmed by `dim` (8 % at the top).
//  - `fs_hand`: the object in hand, drawn into a transparent target with the kinds' own straight-alpha
//    "source over" — which, from a cleared target, accumulates PREMULTIPLIED colour — laid over the frame
//    (one, one − src alpha), through the READING LIGHT (Q-n): saturate then brighten, both linear in the
//    premultiplied colour, so the at-rest passes' bytes never move.
// Pure of everything but its bindings (engine/shader.ts's rule): the CPU decides every number.

@group(0) @binding(0) var<uniform> u: HoldUniforms;
@group(0) @binding(1) var tex_a: texture_2d<f32>;
@group(0) @binding(2) var tex_b: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

/** One triangle over the whole attachment; uv (0, 0) at the top-left, as the texture's rows run. */
@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  out.clip = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}

/** Dual Kawase, down: `u.texel.xy` = one texel of the SOURCE, `u.texel.z` = the offset in half-texels. */
@fragment
fn fs_down(in: VSOut) -> @location(0) vec4f {
  let o = u.texel.xy * 0.5 * u.texel.z;
  var c = textureSample(tex_a, samp, in.uv) * 4.0;
  c += textureSample(tex_a, samp, in.uv + vec2f(-o.x, -o.y));
  c += textureSample(tex_a, samp, in.uv + vec2f(o.x, -o.y));
  c += textureSample(tex_a, samp, in.uv + vec2f(-o.x, o.y));
  c += textureSample(tex_a, samp, in.uv + vec2f(o.x, o.y));
  return c / 8.0;
}

/** Dual Kawase, up: the same offset, eight taps. */
@fragment
fn fs_up(in: VSOut) -> @location(0) vec4f {
  let o = u.texel.xy * 0.5 * u.texel.z;
  var c = textureSample(tex_a, samp, in.uv + vec2f(-o.x * 2.0, 0.0));
  c += textureSample(tex_a, samp, in.uv + vec2f(-o.x, o.y)) * 2.0;
  c += textureSample(tex_a, samp, in.uv + vec2f(0.0, o.y * 2.0));
  c += textureSample(tex_a, samp, in.uv + vec2f(o.x, o.y)) * 2.0;
  c += textureSample(tex_a, samp, in.uv + vec2f(o.x * 2.0, 0.0));
  c += textureSample(tex_a, samp, in.uv + vec2f(o.x, -o.y)) * 2.0;
  c += textureSample(tex_a, samp, in.uv + vec2f(0.0, -o.y * 2.0));
  c += textureSample(tex_a, samp, in.uv + vec2f(-o.x, -o.y)) * 2.0;
  return c / 12.0;
}

/** The desk out of focus: the sharp copy (tex_a) mixed with the blurred one (tex_b) by the carry `u.mix.x`, dimmed by `u.mix.y`. Opaque. */
@fragment
fn fs_desk(in: VSOut) -> @location(0) vec4f {
  let sharp = textureSample(tex_a, samp, in.uv).rgb;
  let soft = textureSample(tex_b, samp, in.uv).rgb;
  return vec4f(mix(sharp, soft, u.mix.x) * (1.0 - u.mix.y), 1.0);
}

/** The hand over the frame: premultiplied (tex_a), through the reading light — saturate `u.mix.z`, brightness `u.mix.w`. Blend (one, one − src alpha). */
@fragment
fn fs_hand(in: VSOut) -> @location(0) vec4f {
  let h = textureSample(tex_a, samp, in.uv);
  let lum = dot(h.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let rgb = mix(vec3f(lum), h.rgb, u.mix.z) * u.mix.w;
  return vec4f(rgb, h.a);
}
