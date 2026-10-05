// (The kit's since K4a — moved from notebook/notebook-composite.wgsl: every layered kind lays its layer with it, kit/layer.ts `layerComposite`.)
// A layered kind's layer onto the canvas: the resolved, premultiplied layer, over what the ground drew — through the slot's PORTAL CHAIN
// (design-018 §4 — the kit's contract, which the kind's own passes cannot keep: they draw into the layer, not onto the canvas). The
// whole layer is laid at the chain's cover, so its object fades as ONE (a book's cover never shows its pages through it — group
// opacity, the tray's feather); at the root the chain is empty, the cover exactly 1, and the layer is laid as it always was.
// K7a: the layer is its screen BOX's (kit/layer.ts `BoxTargets`) — the texel of a pixel is the pixel less the box's origin.
//
// THE KIT'S COMPOSITE ENTRY (`LAYER_COMPOSITE_FILE`; composed by `layerComposite` after the `view` and `portal` pieces; petition
// I31 — every declaration's `///` block says what it takes and gives). Drawn inside the slot's scissor; its output is
// premultiplied, laid "one, one − src alpha".

/// The layer: the kind's resolved target, premultiplied RGBA, one texel a device px of its screen box.
@group(0) @binding(0) var layer: texture_2d<f32>;
/// The layer box's origin on the attachment, device px (xy; zw unused) — `BoxTargets.origin`.
@group(0) @binding(1) var<uniform> origin: vec4f;
/// The slot's view block (`MatPass.view`) — its portal chain and its ratio.
@group(0) @binding(2) var<uniform> u: MatUniforms;

/// One triangle over the whole attachment.
/// `vid` — the vertex index, 0 … 2.
/// → its clip-space corner: (−1, −1), (3, −1), (−1, 3).
@vertex
fn vs(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vid], 0.0, 1.0);
}

/// The layer's texel at a pixel, through the slot's chain.
/// `pos` — the fragment's position, device px of the attachment.
/// → premultiplied RGBA: the layer's texel at `pos − origin`, times `portal_cover` at `pos` (exactly the texel at the root).
@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dpr = u.cam.w;
  return textureLoad(layer, vec2i(pos.xy) - vec2i(origin.xy), 0) * portal_cover(pos.xy / dpr, u.portals, u.clips, dpr);
}
