// THE PAGES' INK ON THE DEVICE (NOTEBOOK.md §8; D3t-b) — the cache the notebook kind keeps on one desk: the pass's eight ink
// layers handed out LRU to the pages in view that have ink (the prototype's `inkTable`), each a CPU raster the layer mirrors
// (notebook/raster.ts). A page's raster is a CACHE of its strokes — the notebook's data children (design-015 §5.1): replayed
// whole when the strokes it holds are not the page's (a stroke undone or redone, a peer's, the look changed, the layer evicted);
// the pen in hand draws into it a segment at a time, each the moment it is final, uploading only the rectangle it touched; and
// the stroke it lifts is ADOPTED — the raster already holds it, so the page's strokes growing by exactly that one is no replay.
// A stroke's identity is its pen, its pace and its path as its cell keeps them (`pageStrokeKey`): the table compares the page's
// list with what the raster drew.

import type { RasterBudget, RGB } from "@ice/desk";
import { INK_H, INK_LAYERS, INK_TABLE, INK_W, type InkPoint } from "./ink";
import { drawSegment, drawStroke, type InkRect, PageRaster, scaleOf, segmentsOf, unionRect } from "./raster";

/**
 * A stroke's identity on its page — what a raster compares: its pen, its pace (the cell's `times`; an untimed stroke's `speed`) and
 * its path (the cell's `points`). Two dots on one spot in two pens are two strokes.
 */
export const pageStrokeKey = (ink: string, points: string, times: string, speed: number): string => `${ink}|${times !== "" ? times : `@${speed}`}|${points}`;

/** A stroke as a page's raster draws it: its identity (`pageStrokeKey`), its pen by name, its samples with their widths. */
export interface PageStroke {
  readonly key: string;
  readonly ink: string;
  readonly points: readonly InkPoint[];
}

/** The pen in hand's stroke (the pen driver's): its page, its pen, its samples so far (grown in place), lifted or not; its key once lifted. */
export interface LiveStroke {
  readonly page: number;
  readonly ink: string;
  readonly points: InkPoint[];
  lifted: boolean;
  key: string;
}

/** The pages a record names and the layer each is in (the pass's `NotebookDraw.ink`). */
export interface InkTable {
  readonly pages: readonly number[];
  readonly layers: readonly number[];
}

/** Where a raster's bytes go: the notebook pass's layers (`NotebookPass.uploadInk`). */
export interface InkUploader {
  uploadInk(layer: number, bytes: Uint8Array<ArrayBuffer>, x?: number, y?: number, w?: number, h?: number): void;
}

interface Slot {
  key: string | null;
  raster: PageRaster | null;
  /** The strokes the raster holds whole, in the order drawn; null — nothing yet (a replay is due). */
  drawn: string[] | null;
  look: unknown;
  /** A live stroke partly drawn over them, and how many of its segments are down. */
  live: LiveStroke | null;
  segs: number;
  used: number;
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);

export class PageInk {
  private readonly slots: Slot[] = Array.from({ length: INK_LAYERS }, () => ({ key: null, raster: null, drawn: null, look: null, live: null, segs: 0, used: 0 }));
  private clock = 0;
  /** Whole-page replays since the cache was made (a witness: the pen's own stroke lands with none). */
  replays = 0;
  /** THE BUDGET (D6): each layer's CPU raster (5.6 MB) charged as it is made; evicted, the layer replays from its strokes when next used. */
  private readonly budget: RasterBudget | undefined;
  constructor(budget?: RasterBudget) { this.budget = budget; }

  /** The budget's ask (D6): a layer's raster is kept while its page was in a table this frame. */
  keeps(key: string): boolean {
    const s = this.slots[Number(key)];
    return s !== undefined && s.used === this.clock;
  }

  /**
   * The table for one book's pages in view this frame (`pages` in the pass's order): every page with ink — strokes, or the live
   * stroke on it — gets a layer (kept if it has one, else the least recently used is taken), its raster brought up to its
   * strokes (replayed, or the live stroke's new final segments drawn) and uploaded (whole after a replay, else the touched
   * rectangle). `book` is the book's id on this desk; `len × height` the page's open extent in page units. Without an uploader
   * (no pass yet) nothing is drawn and the table is empty — the next frame tries again.
   */
  table(book: number, pages: readonly number[], strokesOf: (page: number) => readonly PageStroke[], live: LiveStroke | null, colourOf: (ink: string) => RGB, look: unknown, up: InkUploader | undefined, len: number, height: number): InkTable {
    this.clock += 1;
    const out: { pages: number[]; layers: number[] } = { pages: [], layers: [] };
    if (up === undefined) return out;
    const [sx, sy] = scaleOf(len, height);
    for (const page of pages) {
      if (out.pages.length >= INK_TABLE) break;
      const strokes = strokesOf(page);
      const lv = live !== null && live.page === page ? live : null;
      const key = `${book}:${page}`;
      if (strokes.length === 0 && lv === null) {
        // no ink (the last stroke undone): the page gives its layer back — only pages with ink hold one
        const held = this.slots.find((s) => s.key === key);
        if (held !== undefined) { held.key = null; held.drawn = null; held.live = null; held.segs = 0; held.used = 0; }
        continue;
      }
      let i = this.slots.findIndex((s) => s.key === key);
      if (i < 0) {
        i = 0;
        for (let k = 1; k < this.slots.length; k++) if ((this.slots[k] as Slot).used < (this.slots[i] as Slot).used) i = k;
        const s = this.slots[i] as Slot;
        s.key = key; s.drawn = null; s.live = null; s.segs = 0;
      }
      const s = this.slots[i] as Slot;
      if (s.raster === null) {
        s.raster = new PageRaster();
        s.drawn = null;   // a fresh raster holds nothing: the page replays into it
        const layer = i;
        this.budget?.charge("notebook", String(layer), INK_W * INK_H * 4, () => { const q = this.slots[layer] as Slot; q.raster = null; q.drawn = null; q.live = null; q.segs = 0; });
      } else this.budget?.touch("notebook", String(i));
      const want = strokes.map((st) => st.key);
      let rect: InkRect | null = null;
      let whole = false;
      if (s.drawn === null || s.look !== look || !same(s.drawn, want) || (s.live !== null && s.live !== lv)) {
        s.raster.clear();
        for (const st of strokes) drawStroke(s.raster, colourOf(st.ink), st.points, sx, sy);
        s.drawn = want; s.look = look; s.live = null; s.segs = 0;
        whole = true;
        this.replays += 1;
      }
      if (lv !== null) {
        if (s.live !== lv) { s.live = lv; s.segs = 0; }
        const final = segmentsOf(lv.points.length, lv.lifted);
        const colour = colourOf(lv.ink);
        for (let k = s.segs + 1; k <= final; k++) rect = unionRect(rect, drawSegment(s.raster, colour, lv.points, k, sx, sy));
        s.segs = final;
        // lifted: the raster holds it whole — it is one of the strokes it drew (adopted when its child lands)
        if (lv.lifted) { s.drawn = [...(s.drawn ?? []), lv.key]; s.live = null; s.segs = 0; }
      }
      if (whole) up.uploadInk(i, s.raster.bytes);
      else if (rect !== null) up.uploadInk(i, s.raster.bytes, rect.x, rect.y, rect.w, rect.h);
      s.used = this.clock;
      out.pages.push(page);
      out.layers.push(i);
    }
    return out;
  }

  /** A page's raster as its layer holds it (a witness), or undefined when it has none. */
  rasterOf(book: number, page: number): PageRaster | undefined {
    return this.slots.find((s) => s.key === `${book}:${page}`)?.raster ?? undefined;
  }

  /** A book left the desk: its layers are free (their rasters kept for the next page to take). */
  forget(book: number): void {
    for (const s of this.slots) if (s.key?.startsWith(`${book}:`) === true) { s.key = null; s.drawn = null; s.live = null; s.segs = 0; s.used = 0; }
  }

  /** Everything dropped (the desk ends). */
  dispose(): void {
    for (const [i, s] of this.slots.entries()) { if (s.raster !== null) this.budget?.release("notebook", String(i)); s.key = null; s.raster = null; s.drawn = null; s.live = null; }
  }
}
