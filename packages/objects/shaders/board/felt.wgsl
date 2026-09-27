// The FELT's noise (BOARD.md) — a PURE module: the research whiteboard's gradient noise
// (research/whiteboard noise.wgsl) with its analytic derivatives, an integer hash so it is
// the same on every GPU, prefixed `felt_` beside the mat's own `hash12` / `value_noise`. The
// pen's fibre lanes read it in the stamp; the melamine's waviness and orange peel, the
// frame's brushing and the eraser's wood read it on the desk.

fn felt_hash(p: vec2u) -> u32 {
  var v = p.x * 1664525u + 1013904223u;
  v = v ^ (p.y * 22695477u + 374761393u);
  v = v ^ (v >> 16u);
  v = v * 0x7feb352du;
  v = v ^ (v >> 15u);
  v = v * 0x846ca68bu;
  v = v ^ (v >> 16u);
  return v;
}

fn felt_grad(i: vec2i) -> vec2f {
  let h = felt_hash(bitcast<vec2u>(i));
  let a = f32(h & 0xffffu) * (6.283185307 / 65536.0);
  return vec2f(cos(a), sin(a));
}

// Gradient noise with its derivatives: (value, d/dx, d/dy); the value roughly in [−0.7, 0.7].
fn felt_noised(p: vec2f) -> vec3f {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = felt_grad(i);
  let gb = felt_grad(i + vec2i(1, 0));
  let gc = felt_grad(i + vec2i(0, 1));
  let gd = felt_grad(i + vec2i(1, 1));
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let k = va - vb - vc + vd;
  let v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  let d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * (u.yx * k + vec2f(vb, vc) - va);
  return vec3f(v, d.x, d.y);
}

fn felt_noise(p: vec2f) -> f32 { return felt_noised(p).x; }

fn felt_fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    v = v + a * felt_noise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a = a * 0.5;
  }
  return v;
}
