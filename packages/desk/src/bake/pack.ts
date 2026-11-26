// The atlas's SHELVES (petition I59): glyph rects packed tallest first (then widest; a stable sort, so ties keep the glyphs'
// code point order) into a width near the square root of their area, with a one-texel gutter — left 0, 0: outside every
// glyph — between rects and round the edge; both sides a multiple of 4. The approach of the site's shelf packer.

export interface PackedAtlas {
  readonly width: number;
  readonly height: number;
  /** Each rect's top-left, in the order the rects were given. */
  readonly at: readonly (readonly [number, number])[];
}

export function packRects(rects: readonly { readonly w: number; readonly h: number }[]): PackedAtlas {
  const order = rects.map((_, i) => i);
  const rect = (i: number): { readonly w: number; readonly h: number } => rects[i] as { readonly w: number; readonly h: number };
  order.sort((p, q) => rect(q).h - rect(p).h || rect(q).w - rect(p).w);
  let area = 0;
  let widest = 0;
  for (const r of rects) {
    area += (r.w + 1) * (r.h + 1);
    widest = Math.max(widest, r.w);
  }
  const width = Math.max(256, Math.ceil(Math.sqrt(area * 1.15) / 4) * 4, Math.ceil((widest + 2) / 4) * 4);
  const at = rects.map((): [number, number] => [0, 0]);
  let x = 1;
  let y = 1;
  let shelf = 0;
  for (const i of order) {
    const r = rect(i);
    if (x + r.w + 1 > width) {
      x = 1;
      y += shelf + 1;
      shelf = 0;
    }
    at[i] = [x, y];
    x += r.w + 1;
    shelf = Math.max(shelf, r.h);
  }
  return { width, height: Math.ceil((y + shelf + 1) / 4) * 4, at };
}
