// The INK pages — where a note's raster lives on the GPU: fixed-size r8
// layers (coverage, one byte a texel), carved into rows of one height, each
// row into spans (a SHELF allocator — notes are near one size, so rows fill
// and a freed span is reused by the next raster of that height). Pure: the
// texture is the pass's (paper-pass.ts); this decides WHERE, so the lab and
// the Node oracle, allocating the same notes in the same order, land the same
// bytes at the same texels — what the parity witness needs.

export interface InkRect { readonly layer: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** A WRITTEN rect inside a layer, normalised — the record's `u0 v0 u1 v1` (design-013 §5's; the card's content term had it first). */
export interface UvRect { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }

/** A written rect in texels as the record's normalised uv. */
export function uvOf(x: number, y: number, w: number, h: number, texW: number, texH: number): UvRect {
  return { u0: x / texW, v0: y / texH, u1: (x + w) / texW, v1: (y + h) / texH };
}

interface Span { x: number; w: number; free: boolean }
interface Row { readonly y: number; readonly h: number; readonly spans: Span[] }
interface Layer { readonly rows: Row[]; cursor: number }

export class InkShelves {
  readonly size: number;
  readonly layers: number;
  private readonly stack: Layer[];

  constructor(size = 2048, layers = 2) {
    this.size = size; this.layers = layers;
    this.stack = Array.from({ length: layers }, () => ({ rows: [], cursor: 0 }));
  }

  /** A rect for a `w × h` raster, or null when no layer has room (the note then draws its paper alone). */
  alloc(w0: number, h0: number): InkRect | null {
    let w = w0;
    let h = h0;
    w = Math.ceil(w); h = Math.ceil(h);
    if (w <= 0 || h <= 0 || w > this.size || h > this.size) return null;
    for (let l = 0; l < this.stack.length; l++) {
      const L = this.stack[l] as Layer;
      // a row of this height, or a little taller (a fifth: the waste a shelf accepts)
      for (const row of L.rows) {
        if (row.h < h || row.h > h * 1.2) continue;
        for (let i = 0; i < row.spans.length; i++) {
          const s = row.spans[i] as Span;
          if (!s.free || s.w < w) continue;
          const rect = { layer: l, x: s.x, y: row.y, w, h };
          if (s.w === w) s.free = false;
          else { row.spans.splice(i, 0, { x: s.x, w, free: false }); s.x += w; s.w -= w; }
          return rect;
        }
      }
      if (L.cursor + h <= this.size) {
        const row: Row = { y: L.cursor, h, spans: [{ x: 0, w, free: false }, { x: w, w: this.size - w, free: true }] };
        if (w === this.size) row.spans.pop();
        L.rows.push(row); L.cursor += h;
        return { layer: l, x: 0, y: row.y, w, h };
      }
    }
    // no row fits and no layer has room below its rows: a run of EMPTY rows re-carved (K6b) — the band ladder leaves a layer carved
    // into rows of every rung, and after a zoom out and back the texels are free in rows too short for the new band. Taken only
    // where the two ways above found nothing, so pages that never gave a rect back (a still's) land every rect where they did.
    for (let l = 0; l < this.stack.length; l++) {
      const rect = this.recarve(l, w, h);
      if (rect !== null) return rect;
    }
    return null;
  }

  /** In layer `l`, the first run of adjacent rows that hold nothing and are `h` tall together: one row of `h` holding the rect, the rest one empty row. */
  private recarve(l: number, w: number, h: number): InkRect | null {
    const L = this.stack[l] as Layer;
    const empty = (row: Row): boolean => row.spans.every((s) => s.free);
    for (let i = 0; i < L.rows.length; i++) {
      if (!empty(L.rows[i] as Row)) continue;
      let j = i;
      let tall = 0;
      while (j < L.rows.length && empty(L.rows[j] as Row) && tall < h) { tall += (L.rows[j] as Row).h; j += 1; }
      if (tall < h) { i = j; continue; }
      const y = (L.rows[i] as Row).y;
      const row: Row = { y, h, spans: [{ x: 0, w, free: false }, { x: w, w: this.size - w, free: true }] };
      if (w === this.size) row.spans.pop();
      const rest: Row[] = tall > h ? [{ y: y + h, h: tall - h, spans: [{ x: 0, w: this.size, free: true }] }] : [];
      L.rows.splice(i, j - i, row, ...rest);
      return { layer: l, x: 0, y, w, h };
    }
    return null;
  }

  /** Give a rect back; adjacent free spans merge. A rect not from `alloc` is ignored. */
  free(r: InkRect): void {
    const L = this.stack[r.layer];
    if (!L) return;
    const row = L.rows.find((q) => q.y === r.y);
    if (!row) return;
    const i = row.spans.findIndex((s) => s.x === r.x && !s.free);
    if (i < 0) return;
    (row.spans[i] as Span).free = true;
    // merge with the neighbours
    for (let k = row.spans.length - 2; k >= 0; k--) {
      const a = row.spans[k] as Span;
      const b = row.spans[k + 1] as Span;
      if (a.free && b.free) { a.w += b.w; row.spans.splice(k + 1, 1); }
    }
  }

  reset(): void { for (const L of this.stack) { L.rows.length = 0; L.cursor = 0; } }

  /**
   * Give back every layer's TRAILING rows that hold nothing (D2c): a row keeps its height for life, so a
   * zoom through the band ladder would otherwise leave each layer carved into rows of every rung, and a
   * raster of a new height would find no room though the texels are free. A trimmed layer's cursor
   * retreats; a layer emptied entirely is carved afresh. Rows before a used one stay — the rects in
   * them are the notes' own. Returns the rows given back.
   */
  trim(): number {
    let n = 0;
    for (const L of this.stack) {
      for (;;) {
        const last = L.rows.at(-1);
        if (last === undefined || !last.spans.every((s) => s.free)) break;
        L.rows.pop();
        L.cursor = last.y;
        n += 1;
      }
    }
    return n;
  }

  /** Texels in use, rows opened, layers touched — the churn instrument. */
  get stats(): { readonly used: number; readonly rows: number; readonly layersUsed: number } {
    let used = 0;
    let rows = 0;
    let layersUsed = 0;
    for (const L of this.stack) {
      if (L.rows.length) layersUsed += 1;
      rows += L.rows.length;
      for (const row of L.rows) for (const s of row.spans) if (!s.free) used += s.w * row.h;
    }
    return { used, rows, layersUsed };
  }
}
