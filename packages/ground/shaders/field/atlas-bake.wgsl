// PASS 1 — the lattice-aligned field atlas.
//
// One fragment per lattice site of the finest LIVE rung. Since mid = fine × 10
// and coarse = fine × 100, a single atlas at that step serves all three rungs
// exactly. Sized by site count, not by framebuffer. Target: rgba32float, no
// blending. Re-run when cards or the camera change — never on pointer motion.

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> cards: array<Card>;

struct VSOut { @builtin(position) clip: vec4f }

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.clip = vec4f(p[vid], 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let idx = u.atlas.xy + floor(in.clip.xy);
  let screen = site_screen(u, idx * u.phase.w);

  let k = u.field.x;
  let eps = u.field.y;
  let polarity = u.field.z;
  var field = vec2f(0.0);
  var min_d = 1e9;

  // The AABB reject must stay a branch: a branchless "always run the SDF"
  // variant measured 3x slower at high card counts.
  let pad = sqrt(max(k, 1.0) / 0.02);
  let count = min(u32(u.flags.x + 0.5), arrayLength(&cards));
  for (var i = 0u; i < count; i++) {
    let card = cards[i];
    let center = card.center_half.xy;
    let half = card.center_half.zw;
    let radius = card.shape.x;
    let strength = card.shape.y;
    let rel = screen - center;
    let reach = pad * sqrt(max(strength, 0.0001));
    if (abs(rel.x) > half.x + reach || abs(rel.y) > half.y + reach) { continue; }
    let d = sd_round_box(rel, half, radius);
    min_d = min(min_d, d);
    let dist = max(d, 0.0);
    let outward = round_box_normal(rel, half, radius);
    field += -outward * (k * strength * polarity / (dist * dist + eps));
  }
  return vec4f(field, min_d, 0.0);
}
