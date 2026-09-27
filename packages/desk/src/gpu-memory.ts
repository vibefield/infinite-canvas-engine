// What a texture's texels weigh (design-016 §4, K2) — the byte rule the profiler states, shared by the upload count
// (`copyExternalImageToTexture` carries no byte length: its bytes are the copy's texels in the destination's format) and
// the memory ledger. THE FORMULA: Σ over mips l of ⌈w_l / bw⌉ × ⌈h_l / bh⌉ × blockBytes × layers_l, × sampleCount — w_l =
// max(1, w >> l) and h_l likewise (1 for a 1d texture), layers_l = the array layers (a 3d texture's depth halves per mip
// like its width), and (bw × bh, blockBytes) the format's block: 1 × 1 and the texel's size for every uncompressed format,
// 4 × 4 for BC/ETC2/EAC, the named footprint for ASTC. It is the LOGICAL size — what the texels need, never what the driver
// allocates: tiling, row alignment, lossless compression, a depth24plus stored as 32 bits, a tiler's memoryless MSAA
// attachment all differ from it, both ways.

/** A format's block: its footprint in texels and its bytes. `guessed` — a format this table does not know, weighed as 4 bytes a texel. */
export interface FormatBlock { readonly w: number; readonly h: number; readonly bytes: number; readonly guessed?: boolean }

/** The formats no channel-and-width pattern reads. The depth-stencil pairs are their logical bits (24 + 8, 32 + 8). */
const SPECIAL: Readonly<Record<string, number>> = {
  "rgb10a2uint": 4, "rgb10a2unorm": 4, "rg11b10ufloat": 4, "rgb9e5ufloat": 4,
  "stencil8": 1, "depth16unorm": 2, "depth24plus": 4, "depth24plus-stencil8": 4, "depth32float": 4, "depth32float-stencil8": 5,
};

export function formatBlock(format: string): FormatBlock {
  const special = SPECIAL[format];
  if (special !== undefined) return { w: 1, h: 1, bytes: special };
  const plain = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/.exec(format);
  if (plain !== null) return { w: 1, h: 1, bytes: ((plain[1] as string).length * Number(plain[2])) / 8 };
  const astc = /^astc-(\d+)x(\d+)-/.exec(format);
  if (astc !== null) return { w: Number(astc[1]), h: Number(astc[2]), bytes: 16 };
  if (/^(bc1-|bc4-|etc2-rgb8unorm|etc2-rgb8a1unorm|eac-r11)/.test(format)) return { w: 4, h: 4, bytes: 8 };
  if (/^(bc[2356]-|bc6h-|bc7-|etc2-rgba8unorm|eac-rg11)/.test(format)) return { w: 4, h: 4, bytes: 16 };
  return { w: 1, h: 1, bytes: 4, guessed: true };
}

/** An extent's width, height and depth-or-layers — the list form (`[w, h?, d?]`) or the dictionary form. */
export function extentOf(size: GPUExtent3DStrict): [number, number, number] {
  if (Symbol.iterator in Object(size)) {
    const [w = 1, h = 1, d = 1] = [...(size as Iterable<number>)];
    return [w, h, d];
  }
  const s = size as GPUExtent3DDictStrict;
  return [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1];
}

/** The bytes of `size` texels of `format` in one mip (a copy's weight): ⌈w / bw⌉ × ⌈h / bh⌉ × blockBytes × depth. */
export function regionBytes(format: string, size: GPUExtent3DStrict): number {
  const [w, h, d] = extentOf(size);
  const b = formatBlock(format);
  return Math.ceil(w / b.w) * Math.ceil(h / b.h) * b.bytes * d;
}

/** A texture's logical bytes by the formula above. */
export function textureBytes(d: { readonly size: GPUExtent3DStrict; readonly format: string; readonly mipLevelCount?: number; readonly sampleCount?: number; readonly dimension?: GPUTextureDimension }): number {
  const [w, h, layers] = extentOf(d.size);
  const b = formatBlock(d.format);
  let total = 0;
  for (let l = 0; l < (d.mipLevelCount ?? 1); l++) {
    const lw = Math.max(1, w >> l);
    const lh = d.dimension === "1d" ? 1 : Math.max(1, h >> l);
    const ld = d.dimension === "3d" ? Math.max(1, layers >> l) : layers;
    total += Math.ceil(lw / b.w) * Math.ceil(lh / b.h) * b.bytes * ld;
  }
  return total * (d.sampleCount ?? 1);
}
