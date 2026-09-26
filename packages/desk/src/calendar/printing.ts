// The PRINT'S TILES at work (CALENDAR.md §6; D3t-c) — the prototype's tile scheduling (lab/calendar.ts `tableFor` ·
// `contentOf` · `tileSheet` · `forget`), moved as a driver the calendar kind's local runs once a frame: a sheet in play
// keeps the coarse levels resident for the whole sheet and the view's level (and the one under it) for what is in view,
// each tile keyed by WHAT IT SHOWS (the keys of the cells under it), so an entry written redraws only the tiles over its
// cell. A tile nothing is printed in is marked empty and costs nothing; out of the frame's budget a stale copy may stand in
// for a frame, else the shader falls back a rung. The tiles are a CACHE of the print, and the print a function of the
// events: nothing here is a fact.
//
// DOM-free: the raster is the host's seam (`PrintRaster` — desk/host/print.ts draws a rectangle of a print on an
// OffscreenCanvas and measures the type), the pass takes what it hands back. The Node oracle has no raster: it PINS a
// sheet's committed tiles (`pin` — the fixture's bytes, one level), and a sheet pinned so is never drawn live.

import type { HandMetrics } from "../paper/text";
import { anyIn, type PrintFace, type SheetPrint } from "./print";
import { BASE_LEVELS, bandOf, EMPTY, entryOf, GUTTER, MISSING, TileCache, type TileGrid, tileRect, tilesIn } from "./tiles";

/** What the pass takes a tile as: the host's canvas (TILE_TEX², straight alpha) — a type only. */
export type TileSource = HTMLCanvasElement | OffscreenCanvas;

/**
 * THE PRINT'S RASTER (the host's seam, as `TextRaster` is the note's): the hand's face and its metrics (undefined while the
 * face loads — the print waits rather than set the hand in a stand-in face), a version that turns over when a face lands,
 * the type's widths, and a rectangle of a print drawn into a tile at `band` texels a unit.
 */
export interface PrintRaster {
  hand(): { readonly face: PrintFace; readonly metrics: HandMetrics } | undefined;
  version(): number;
  measure(font: string, text: string): number;
  tile(print: SheetPrint, x: number, y: number, w: number, h: number, band: number): TileSource;
  /** The same rectangle as RGBA bytes, TILE_TEX² × 4, row 0 at the top — a fixture's (a rig reads the live print through it). */
  bytes(print: SheetPrint, x: number, y: number, w: number, h: number, band: number): Uint8Array<ArrayBuffer>;
}

/** What the driver asks of the calendar's pass: its layers, a tile uploaded or written, a page table written. */
export interface PrintPass {
  readonly layers: number;
  uploadTile(layer: number, source: TileSource): void;
  writeTileBytes(layer: number, bytes: Uint8Array<ArrayBuffer>): void;
  writeTable(slot: number, grid: TileGrid, table: Int32Array): void;
}

/** A sheet's committed tiles (a fixture): one level's tiles by `tx:ty`, RGBA TILE_TEX² each, and the ones nothing prints in. */
export interface PinnedSheet {
  readonly level: number;
  readonly tiles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  readonly empty: ReadonlySet<string>;
}

/** A sheet rectangle in view (sheet units). */
export interface SheetView { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** A string's 32-bit FNV-1a, as a tile's content key. */
export function fnv(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${h.toString(36)}:${s.length}`;
}

/** What a tile of a print shows — the keys of the cells under it and the sheet's own. */
export function contentOf(print: SheetPrint, x: number, y: number, w: number, h: number): string {
  const L = print.sheet;
  let s = print.keys[print.keys.length - 1] as string;
  const c0 = Math.max(0, Math.floor((x - L.x0) / L.cw));
  const c1 = Math.min(6, Math.floor((x + w - L.x0) / L.cw));
  const r0 = Math.max(0, Math.floor((y - L.y0) / L.ch));
  const r1 = Math.min(L.rows - 1, Math.floor((y + h - L.y0) / L.ch));
  if (x + w >= L.x0 && x <= L.x0 + 7 * L.cw && y + h >= L.y0 && y <= L.y0 + L.rows * L.ch) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) s += `|${print.keys[r * 7 + c]}`;
  }
  return fnv(s);
}

export interface PrintTilesOptions {
  readonly grid: TileGrid;
  /** The clock the frame's budget runs on (ms). */
  readonly now?: () => number;
  /** The most raster a frame spends, ms (a tile is ~0.3–1 ms): the rest come on the frames after. */
  readonly budgetMs?: number;
}

/** The tile driver of one desk's pads: the layers' cache, each slot's page table, the frame's budget. */
export class PrintTiles {
  readonly grid: TileGrid;
  private readonly now: () => number;
  private readonly budgetMs: number;
  private cache: TileCache | null = null;
  private readonly tables = new Map<number, { owner: string; table: Int32Array; dirty: boolean }>();
  private t0 = 0;
  private pendingN = 0;
  private starvedN = 0;
  private drawnN = 0;

  constructor(opts: PrintTilesOptions) {
    this.grid = opts.grid;
    this.now = opts.now ?? (() => Date.now());
    this.budgetMs = opts.budgetMs ?? 6;
  }

  /** Tiles still to draw after the last frame (the desk asks for another). */
  pending(): number { return this.pendingN; }
  /** Tiles drawn since the driver was made (a witness). */
  drawn(): number { return this.drawnN; }
  /** Tiles the last frame wanted and no layer could hold (every one in use by that frame) — a witness. */
  starved(): number { return this.starvedN; }
  /** Resident tiles. */
  resident(): number { return this.cache?.size ?? 0; }

  private cacheOf(pass: PrintPass): TileCache {
    this.cache ??= new TileCache(pass.layers);
    return this.cache;
  }

  /** A new frame: its budget starts now; what it touches is kept from eviction until the next. */
  begin(pass: PrintPass): void {
    this.cacheOf(pass).tick();
    this.pendingN = 0;
    this.starvedN = 0;
    this.t0 = this.now();
  }

  /** A sheet's page table in `slot`, owned by (pad, month): made again (all missing) when the owner changes. */
  private tableFor(slot: number, owner: string): { owner: string; table: Int32Array; dirty: boolean } {
    let t = this.tables.get(slot);
    if (t === undefined || t.owner !== owner) { t = { owner, table: new Int32Array(this.grid.count).fill(MISSING), dirty: true }; this.tables.set(slot, t); }
    return t;
  }

  /**
   * Bring a sheet's tiles up to date for this frame: the coarse levels for the whole sheet, the view's level (and the one
   * under it) for what is in view — resident ones kept, empty ones marked, the rest drawn (the view's centre first) within the
   * frame's budget. `owner` names the sheet (`${pad}:${month}`); a sheet with no print yet (its face loading) keeps its table.
   */
  sheet(pass: PrintPass, raster: PrintRaster, owner: string, slot: number, print: SheetPrint, view: SheetView, level: number, rungs: 1 | 2 = 2): void {
    const cache = this.cacheOf(pass);
    const T = this.tableFor(slot, owner);
    const want: { l: number; tx: number; ty: number; d: number }[] = [];
    for (let l = 0; l < BASE_LEVELS; l++) for (const [tx, ty] of tilesIn(this.grid, l, 0, 0, this.grid.W, this.grid.H)) want.push({ l, tx, ty, d: -1 });
    const cx = (view.x0 + view.x1) / 2;
    const cy = (view.y0 + view.y1) / 2;
    for (let l = Math.max(BASE_LEVELS, level - rungs + 1); l <= level; l++) {
      for (const [tx, ty] of tilesIn(this.grid, l, view.x0, view.y0, view.x1, view.y1)) {
        const r = tileRect(l, tx, ty);
        want.push({ l, tx, ty, d: (l === level ? 0 : 1e9) + Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const t of want) {
      const r = tileRect(t.l, t.tx, t.ty);
      const g = GUTTER / bandOf(t.l);
      const content = contentOf(print, r.x - g, r.y - g, r.w + 2 * g, r.h + 2 * g);
      const key = `${owner}:${t.l}:${t.tx}:${t.ty}`;
      const e = entryOf(this.grid, t.l, t.tx, t.ty);
      const have = cache.get(key, content);
      if (have !== null) { if (T.table[e] !== have) { T.table[e] = have; T.dirty = true; } continue; }
      if (!anyIn(print, r.x - g, r.y - g, r.w + 2 * g, r.h + 2 * g)) { if (T.table[e] !== EMPTY) { T.table[e] = EMPTY; T.dirty = true; } continue; }
      if (this.now() - this.t0 > this.budgetMs) {
        // out of time: a stale copy may stand in for a frame; else it waits, its level's fallback showing
        const v = cache.stale(key) ?? MISSING;
        if (T.table[e] !== v) { T.table[e] = v; T.dirty = true; }
        this.pendingN += 1;
        continue;
      }
      // every layer in use by this very frame: the tile STARVES (its level's fallback shows) — not pending, so a view that wants more
      // tiles than the layers hold does not keep the desk awake redrawing them (the prototype's did); a frame that moves retries it
      const put = cache.put(key, content);
      if (put === null) { this.starvedN += 1; continue; }
      if (put.evicted !== null) this.forget(put.evicted);
      const band = bandOf(t.l);
      pass.uploadTile(put.layer, raster.tile(print, r.x - g, r.y - g, (r.w + 2 * g), (r.h + 2 * g), band));
      this.drawnN += 1;
      T.table[e] = put.layer;
      T.dirty = true;
    }
  }

  /**
   * A sheet's COMMITTED tiles (a still's — the Node oracle's, a rig's pin): its table names the fixture's level alone (the rest
   * missing: the shader falls back to it from any density), each tile written once into a layer of its own. The table is the
   * pinned sheet's EXACTLY: a pin under an owner that pinned another sheet before (the oracle's pad 1 in September, scene after
   * scene) keeps none of that sheet's entries — a blank pin is a blank sheet.
   */
  pin(pass: PrintPass, owner: string, slot: number, pinned: PinnedSheet): void {
    const cache = this.cacheOf(pass);
    const T = this.tableFor(slot, `pin:${owner}`);
    const named = new Set<number>();
    for (const at of [...pinned.tiles.keys(), ...pinned.empty]) {
      const [tx, ty] = at.split(":").map(Number) as [number, number];
      named.add(entryOf(this.grid, pinned.level, tx, ty));
    }
    for (let e = 0; e < T.table.length; e++) if (!named.has(e) && T.table[e] !== MISSING) { T.table[e] = MISSING; T.dirty = true; }
    for (const [at, bytes] of pinned.tiles) {
      const [tx, ty] = at.split(":").map(Number) as [number, number];
      const key = `pin:${owner}:${pinned.level}:${tx}:${ty}`;
      const e = entryOf(this.grid, pinned.level, tx, ty);
      let layer = cache.get(key, "pin");
      if (layer === null) {
        const put = cache.put(key, "pin");
        if (put === null) continue;
        if (put.evicted !== null) this.forget(put.evicted);
        pass.writeTileBytes(put.layer, bytes);
        layer = put.layer;
      }
      if (T.table[e] !== layer) { T.table[e] = layer; T.dirty = true; }
    }
    for (const at of pinned.empty) {
      const [tx, ty] = at.split(":").map(Number) as [number, number];
      const e = entryOf(this.grid, pinned.level, tx, ty);
      if (T.table[e] !== EMPTY) { T.table[e] = EMPTY; T.dirty = true; }
    }
  }

  /** The frame's page tables that moved, into the pass. */
  end(pass: PrintPass): void {
    for (const [slot, t] of this.tables) if (t.dirty) { pass.writeTable(slot, this.grid, t.table); t.dirty = false; }
  }

  /** A tile gave up its layer: every table pointing at it forgets it (the shader falls back a level). */
  private forget(key: string): void {
    const parts = key.split(":");
    const pin = parts[0] === "pin";
    const at = pin ? 1 : 0;
    const owner = `${pin ? "pin:" : ""}${parts[at]}:${parts[at + 1]}`;
    const e = entryOf(this.grid, Number(parts[at + 2]), Number(parts[at + 3]), Number(parts[at + 4]));
    for (const [, t] of this.tables) if (t.owner === owner && (t.table[e] as number) >= 0) { t.table[e] = MISSING; t.dirty = true; }
  }

  /** A pad gone: its tiles and its tables (by its slots) forgotten. */
  drop(pad: number, slots: readonly number[]): void {
    this.cache?.drop(`${pad}:`);
    this.cache?.drop(`pin:${pad}:`);
    for (const s of slots) { const t = this.tables.get(s); if (t !== undefined) { t.owner = ""; t.table.fill(MISSING); t.dirty = true; } }
  }
}

