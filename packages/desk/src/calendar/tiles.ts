// The PRINT's tiles (CALENDAR.md §6) — a sheet is 1760 × 1852 world units and must read crisply from a
// glance at the whole desk to a date filling the screen, so its ink is not one raster but a PYRAMID
// of tiles: level ℓ is drawn at 0.25·√2^ℓ texels a unit (√2 rungs, the sticky note's ladder), each
// tile 256² texels of the sheet plus a 2-texel gutter (so a tile's bilinear edge reads its
// neighbour's ink, not black). The shader asks for the level at or above the screen's density and
// falls back a rung at a time to one that is resident; the coarse levels (the whole sheet in a few
// tiles) are always kept for the sheets in play, so nothing is ever blank — only soft for a frame.
// A tile nothing is printed in is marked empty and never drawn or stored. Pure bookkeeping: which
// tiles a view needs, their rectangles, the page table the shader reads, a least-recently-used
// cache of texture layers keyed by what the tile shows.

/** A tile's texels of sheet, and its gutter each side. */
export const TILE = 256;
export const GUTTER = 2;
export const TILE_TEX = TILE + 2 * GUTTER;
/** 0.25 … 8 texels a unit. */
export const LEVELS = 11;
/** The coarsest levels kept resident for every sheet in play (the fallbacks). */
export const BASE_LEVELS = 3;
/** Page-table entries: a layer, or one of these. */
export const MISSING = -1;
export const EMPTY = -2;

export const bandOf = (level: number): number => 2 ** (level / 2) / 4;   // exact on the even rungs (the shader's `exp2` too)

/** The level for a density (texels wanted per unit): the rung at or above it. */
export function levelFor(density: number): number {
  const l = Math.ceil(2 * Math.log2(Math.max(density, 1e-6) / 0.25) - 1e-6);
  return Math.min(Math.max(l, 0), LEVELS - 1);
}

/** Each level's tile counts across and down a sheet, and where its entries start in the page table. */
export interface TileGrid {
  readonly W: number;
  readonly H: number;
  readonly nx: readonly number[];
  readonly ny: readonly number[];
  readonly offset: readonly number[];
  /** Entries in one sheet's page table. */
  readonly count: number;
}

export function tileGrid(W: number, H: number): TileGrid {
  const nx: number[] = [];
  const ny: number[] = [];
  const offset: number[] = [];
  let count = 0;
  for (let l = 0; l < LEVELS; l++) {
    const b = bandOf(l);
    nx.push(Math.ceil((W * b) / TILE)); ny.push(Math.ceil((H * b) / TILE));
    offset.push(count);
    count += (nx[l] as number) * (ny[l] as number);
  }
  return { W, H, nx, ny, offset, count };
}

/** A tile's rectangle on the sheet (its content, without the gutter), sheet units. */
export function tileRect(level: number, tx: number, ty: number): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } {
  const size = TILE / bandOf(level);
  return { x: tx * size, y: ty * size, w: size, h: size };
}

/** The tiles of a level that a sheet rectangle touches (clamped to the sheet). */
export function tilesIn(g: TileGrid, level: number, x0: number, y0: number, x1: number, y1: number): Array<readonly [number, number]> {
  const size = TILE / bandOf(level);
  const nx = g.nx[level] as number;
  const ny = g.ny[level] as number;
  const a = Math.max(Math.floor(x0 / size), 0);
  const b = Math.min(Math.floor(x1 / size), nx - 1);
  const c = Math.max(Math.floor(y0 / size), 0);
  const d = Math.min(Math.floor(y1 / size), ny - 1);
  const out: Array<readonly [number, number]> = [];
  for (let ty = c; ty <= d; ty++) for (let tx = a; tx <= b; tx++) out.push([tx, ty]);
  return out;
}

/** A tile's page-table index within its sheet's table. */
export const entryOf = (g: TileGrid, level: number, tx: number, ty: number): number => (g.offset[level] as number) + ty * (g.nx[level] as number) + tx;

interface Resident { key: string; content: string; layer: number; used: number }

/**
 * The texture layers the tiles live in: `layers` of them, handed out by key (which sheet, level and
 * tile) and CONTENT (what the tile shows — the keys of the cells under it); a tile whose content moved
 * is stale and draws again. When the layers run out, the one used longest ago that this frame has not
 * touched is given up.
 */
export class TileCache {
  readonly layers: number;
  private readonly byKey = new Map<string, Resident>();
  private readonly byLayer: (Resident | null)[];
  private frame = 0;
  constructor(layers: number) { this.layers = layers; this.byLayer = Array.from({ length: layers }, () => null); }

  /** A new frame: what it touches is protected from eviction until the next. */
  tick(): void { this.frame += 1; }

  /** The layer holding this tile with this content, or null (absent, or stale). Touches it. */
  get(key: string, content: string): number | null {
    const r = this.byKey.get(key);
    if (!r || r.content !== content) return null;
    r.used = this.frame;
    return r.layer;
  }

  /** Is a stale copy of the tile resident (it may be shown until the fresh one is drawn)? */
  stale(key: string): number | null {
    const r = this.byKey.get(key);
    if (!r) return null;
    r.used = this.frame;
    return r.layer;
  }

  /**
   * A layer for this tile (its old one, a free one, or the least-recently-used one not touched this
   * frame), and the key of the tile it evicted (a page table pointing at it must forget it); null when
   * every layer is in use this frame.
   */
  put(key: string, content: string): { readonly layer: number; readonly evicted: string | null } | null {
    const old = this.byKey.get(key);
    if (old) { old.content = content; old.used = this.frame; return { layer: old.layer, evicted: null }; }
    let best = -1;
    let bestUsed = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.layers; i++) {
      const r = this.byLayer[i];
      if (!r) { best = i; break; }
      if (r.used < this.frame && r.used < bestUsed) { best = i; bestUsed = r.used; }
    }
    if (best < 0) return null;
    const prev = this.byLayer[best];
    if (prev) this.byKey.delete(prev.key);
    const r: Resident = { key, content, layer: best, used: this.frame };
    this.byLayer[best] = r;
    this.byKey.set(key, r);
    return { layer: best, evicted: prev ? prev.key : null };
  }

  /** Forget every tile whose key starts with `prefix` (a calendar gone, a style changed). */
  drop(prefix: string): void {
    for (const [k, r] of this.byKey) if (k.startsWith(prefix)) { this.byKey.delete(k); this.byLayer[r.layer] = null; }
  }

  get size(): number { return this.byKey.size; }
}
