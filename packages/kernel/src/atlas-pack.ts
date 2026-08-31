/**
 * Shelf packing for the atlas-slot allocator (design-012 §4, Q3 RATIFIED
 * 2026-08-31) — pure rect math over a plain page struct. No ids, no sources,
 * no GPU: `ground/atlas-allocator.ts` owns identity, residency and effects;
 * this module owns only where a rect may sit, what it costs, and when a page
 * should grow.
 *
 * **Gutters.** Every placed rect is separated from its neighbours AND from the
 * page edge by at least `gutter` px, so a linear tap at a slot's border never
 * reaches a neighbour's texels. 2 px is the default (design-012 §4 says
 * "1–2 px"): 1 px covers a bilinear tap's half-texel reach at dpr 1, 2 px
 * covers non-integer scaling and mip level 1.
 *
 * **Shelves, not skyline.** Slots are top-aligned on horizontal shelves whose
 * height is fixed by the first slot to open them. The band below a short slot
 * on a tall shelf is unusable by construction — that loss is real and shows up
 * in `pageWaste().packingWastePct` rather than hiding. A skyline packer would
 * recover some of it at the cost of an O(n) contour per placement and a much
 * harder free/coalesce story; shelves keep free + coalesce O(holes on one
 * shelf), which is what makes the retention half of the ratified design cheap.
 *
 * **Growth never moves a slot.** Shelves are anchored at y=0 and grow right and
 * down, so widening a page only lengthens every shelf's tail and heightening it
 * only adds room below. Every existing rect stays valid at the same origin —
 * the property that lets a page grow with content (Q3) without a repack.
 */
import type { Rect } from "./shapes";

/** Default slot separation, in device px. See the gutter note above. */
export const DEFAULT_ATLAS_GUTTER = 2;

export interface SlotSize {
  width: number;
  height: number;
}

export interface PageSize {
  width: number;
  height: number;
}

/**
 * One horizontal band. `height` is fixed when the shelf opens; `cursorX` is the
 * next free content-origin x (it starts at `gutter` and retracts when the
 * right-most slot is freed).
 */
export interface Shelf {
  y: number;
  height: number;
  cursorX: number;
}

/**
 * A packed page. Mutated in place by the functions below (a packer is state by
 * nature — the kernel law it obeys is "no ECS/DOM/GPU", not "no mutation";
 * `spatial-index` sets the same precedent).
 */
export interface ShelfPage {
  width: number;
  height: number;
  readonly gutter: number;
  shelves: Shelf[];
  /**
   * Reusable interior holes. Each spans its shelf's FULL height (freeing a
   * short slot on a tall shelf releases the whole band — the sub-shelf
   * remainder was never addressable), so `hole.y` identifies its shelf and
   * coalescing is a one-dimensional merge.
   */
  holes: Rect[];
  /** Σ of the areas handed out by `packRect` and not yet freed. */
  usedArea: number;
}

export interface PageWaste {
  /** `width × height` — addressable space, NOT memory (textures are lazily backed). */
  pageArea: number;
  /** `width × occupiedHeight` — the band shelves actually reach into. */
  occupiedArea: number;
  /** Live slot pixels. */
  usedArea: number;
  /** Interior fragmentation: reusable holes left by freed slots. */
  holeArea: number;
  /** `1 − usedArea/occupiedArea` — the number comparable to the spike's 19.5 %. */
  packingWastePct: number;
  /** `1 − usedArea/pageArea` — how much of the allocation is unspent. */
  allocationWastePct: number;
  /** `holeArea/occupiedArea` — the repack trigger. */
  fragmentationPct: number;
}

export function createShelfPage(width: number, height: number, gutter = DEFAULT_ATLAS_GUTTER): ShelfPage {
  return { width, height, gutter, shelves: [], holes: [], usedArea: 0 };
}

export function cloneShelfPage(page: ShelfPage): ShelfPage {
  return {
    width: page.width,
    height: page.height,
    gutter: page.gutter,
    shelves: page.shelves.map((s) => ({ ...s })),
    holes: page.holes.map((h) => ({ ...h })),
    usedArea: page.usedArea,
  };
}

/** Bottom edge (exclusive, gutter included) of the last shelf; 0 on an untouched page. */
export function pageOccupiedHeight(page: ShelfPage): number {
  const last = page.shelves[page.shelves.length - 1];
  return last === undefined ? 0 : last.y + last.height + page.gutter;
}

export function pageWaste(page: ShelfPage): PageWaste {
  const pageArea = page.width * page.height;
  const occupiedArea = page.width * pageOccupiedHeight(page);
  let holeArea = 0;
  for (const h of page.holes) holeArea += h.width * h.height;
  return {
    pageArea,
    occupiedArea,
    usedArea: page.usedArea,
    holeArea,
    packingWastePct: occupiedArea === 0 ? 0 : 1 - page.usedArea / occupiedArea,
    allocationWastePct: pageArea === 0 ? 0 : 1 - page.usedArea / pageArea,
    fragmentationPct: occupiedArea === 0 ? 0 : holeArea / occupiedArea,
  };
}

/**
 * Where a rect of this size would go in a page of size `width × height`,
 * without touching the page. `null` = nowhere.
 *
 * Candidates are scored `[heightSlack, widthSlack, tail?]`, lowest first: a
 * best-height fit first (shelf height is the irrecoverable dimension), then the
 * tightest width, then holes ahead of shelf tails at equal fit — filling
 * interior fragmentation beats extending into fresh space.
 */
function findPlacement(page: ShelfPage, width: number, height: number, size: SlotSize): Rect | null {
  const g = page.gutter;
  if (size.width <= 0 || size.height <= 0) return null;

  // [heightSlack, widthSlack, isTail, x, y] — lowest wins, compared in order.
  let best: [number, number, number, number, number] | null = null;
  const better = (c: [number, number, number, number, number]): boolean => {
    if (best === null) return true;
    for (let i = 0; i < c.length; i++) {
      const a = c[i] as number;
      const b = best[i] as number;
      if (a !== b) return a < b;
    }
    return false;
  };

  // A hole never extends past the page edge it was cut from, so it stays legal
  // under any growth — no width check against the (possibly grown) page.
  for (const hole of page.holes) {
    if (hole.width < size.width || hole.height < size.height) continue;
    // Take a hole only on an exact width fit or one leaving a usable remainder.
    // A remainder of 1..gutter px could not hold anything anyway, and dropping
    // it would detach the slack from the free list — the freed rect would then
    // no longer be gutter-adjacent to its right-hand neighbour and the two
    // could never coalesce again. The randomized suite found the leak.
    if (hole.width !== size.width && hole.width - size.width <= g) continue;
    const c: [number, number, number, number, number] = [
      hole.height - size.height,
      hole.width - size.width,
      0,
      hole.x,
      hole.y,
    ];
    if (better(c)) best = c;
  }

  for (const shelf of page.shelves) {
    if (shelf.height < size.height) continue;
    const tail = width - g - shelf.cursorX;
    if (tail < size.width) continue;
    const c: [number, number, number, number, number] = [
      shelf.height - size.height,
      tail - size.width,
      1,
      shelf.cursorX,
      shelf.y,
    ];
    if (better(c)) best = c;
  }

  if (best !== null) return { x: best[3], y: best[4], width: size.width, height: size.height };

  const bottom = pageOccupiedHeight(page);
  const y = bottom === 0 ? g : bottom;
  if (y + size.height + g <= height && g + size.width + g <= width) {
    return { x: g, y, width: size.width, height: size.height };
  }
  return null;
}

/** True when `size` fits a page whose shelves are `page`'s but whose extent is `width × height`. */
export function canPackAt(page: ShelfPage, width: number, height: number, size: SlotSize): boolean {
  return findPlacement(page, width, height, size) !== null;
}

/**
 * Place a rect, mutating the page. `null` when it does not fit — the caller
 * decides whether to grow (`nextGrowthStep`) or open another page.
 */
export function packRect(page: ShelfPage, size: SlotSize): Rect | null {
  const rect = findPlacement(page, page.width, page.height, size);
  if (rect === null) return null;
  const g = page.gutter;

  const holeIndex = page.holes.findIndex((h) => h.x === rect.x && h.y === rect.y);
  if (holeIndex >= 0) {
    const hole = page.holes[holeIndex] as Rect;
    const remainder = hole.width - rect.width - g;
    if (remainder > 0) {
      page.holes[holeIndex] = { x: hole.x + rect.width + g, y: hole.y, width: remainder, height: hole.height };
    } else {
      page.holes.splice(holeIndex, 1);
    }
  } else {
    const shelf = page.shelves.find((s) => s.y === rect.y);
    if (shelf === undefined) {
      page.shelves.push({ y: rect.y, height: rect.height, cursorX: rect.x + rect.width + g });
    } else {
      shelf.cursorX = rect.x + rect.width + g;
    }
  }

  page.usedArea += rect.width * rect.height;
  return rect;
}

/**
 * Return a rect to the page. `false` when it belongs to no shelf here (a
 * foreign or already-freed rect — the caller's bookkeeping is wrong).
 *
 * The rect's shelf band becomes reusable in full: a right-most rect retracts
 * the shelf cursor (absorbing any holes the retraction reaches), anything else
 * becomes a hole and coalesces with its neighbours.
 */
export function freeRect(page: ShelfPage, rect: Rect): boolean {
  const shelf = page.shelves.find((s) => s.y === rect.y);
  if (shelf === undefined) return false;
  const g = page.gutter;
  page.usedArea -= rect.width * rect.height;

  if (rect.x + rect.width + g === shelf.cursorX) {
    shelf.cursorX = rect.x;
  } else {
    page.holes.push({ x: rect.x, y: shelf.y, width: rect.width, height: shelf.height });
  }
  // Both branches, always in this order: merging can produce a hole that now
  // reaches the cursor (free the tail slot FIRST and every hole to its left
  // stays stranded otherwise — the randomized suite caught exactly that),
  // and absorbing can empty a shelf.
  coalesceHoles(page);
  absorbHolesAtCursor(page, shelf);
  coalesceShelves(page);
  return true;
}

/** Retract a shelf cursor over every hole that now touches it. */
function absorbHolesAtCursor(page: ShelfPage, shelf: Shelf): void {
  const g = page.gutter;
  for (;;) {
    const i = page.holes.findIndex((h) => h.y === shelf.y && h.x + h.width + g === shelf.cursorX);
    if (i < 0) return;
    shelf.cursorX = (page.holes[i] as Rect).x;
    page.holes.splice(i, 1);
  }
}

/**
 * Merge holes that are gutter-adjacent on the same shelf. The gutter between
 * them joins the merged hole: it is addressable again once the slots either
 * side of it are gone.
 */
export function coalesceHoles(page: ShelfPage): void {
  const g = page.gutter;
  page.holes.sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: Rect[] = [];
  for (const hole of page.holes) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.y === hole.y && prev.x + prev.width + g === hole.x) {
      prev.width = hole.x + hole.width - prev.x;
    } else {
      merged.push({ ...hole });
    }
  }
  page.holes = merged;
}

/**
 * Reclaim vertical space: drop trailing empty shelves, and merge adjacent
 * empty ones into a single taller shelf. Without the merge, a page that fully
 * cycles its content keeps its original height ladder forever and can no
 * longer accept a slot taller than any single old shelf.
 */
export function coalesceShelves(page: ShelfPage): void {
  const g = page.gutter;
  const isEmpty = (s: Shelf) => s.cursorX === g;

  const merged: Shelf[] = [];
  for (const shelf of page.shelves) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && isEmpty(prev) && isEmpty(shelf)) {
      prev.height = shelf.y + shelf.height - prev.y;
    } else {
      merged.push(shelf);
    }
  }
  while (merged.length > 0 && isEmpty(merged[merged.length - 1] as Shelf)) merged.pop();
  page.shelves = merged;
}

/**
 * The smallest page that could ever hold `size`: the next power of two on both
 * sides, clamped into `[minSize, maxSize]`. `null` when the device limit cannot
 * hold the slot at all — the honest answer is a refusal, not a clipped slot.
 */
export function initialPageSize(
  size: SlotSize,
  minSize: number,
  maxSize: number,
  gutter = DEFAULT_ATLAS_GUTTER,
): PageSize | null {
  const need = Math.max(size.width, size.height) + 2 * gutter;
  if (need > maxSize) return null;
  let side = Math.max(minSize, 1);
  while (side < need) side *= 2;
  side = Math.min(side, maxSize);
  return { width: side, height: side };
}

/**
 * The next growth step for a page: double the SHORTER side (ties go to width),
 * capped at the device limit. `null` when both sides are already at the limit.
 *
 * Doubling overshoots — the 100-card uniform board lands on 4096×4096 where
 * 4096×3044 would do, 34 % more addressable space than it spends. That is
 * deliberate: `hic-bench` FINDINGS §6 measured `createTexture` at 0.0 MB and
 * all cost at first write, so the unwritten tail is addressable, not resident,
 * while every growth step IS a real texture realloc. The alternative that lost
 * was growing height in exact shelf increments (tight pages, ~9 reallocs for
 * that board instead of 3). `pageWaste` reports both numbers so the assumption
 * stays visible: `packingWastePct` for packing quality, `allocationWastePct`
 * for the overshoot.
 */
export function nextGrowthStep(current: PageSize, maxSize: number): PageSize | null {
  const { width, height } = current;
  if (width >= maxSize && height >= maxSize) return null;
  if (width <= height && width < maxSize) return { width: Math.min(width * 2, maxSize), height };
  if (height < maxSize) return { width, height: Math.min(height * 2, maxSize) };
  return { width: Math.min(width * 2, maxSize), height };
}

/**
 * The page extent that would admit `size`, growing from the page's current one.
 * `null` when the device limit is reached without room. Pure — the caller
 * applies ONE growth to the answer rather than reallocating per step.
 */
export function planPageGrowth(page: ShelfPage, size: SlotSize, maxSize: number): PageSize | null {
  let extent: PageSize = { width: page.width, height: page.height };
  while (!canPackAt(page, extent.width, extent.height, size)) {
    const step = nextGrowthStep(extent, maxSize);
    if (step === null) return null;
    extent = step;
  }
  return extent;
}

/** Widen/heighten a page in place. Existing rects keep their origins (see the module note). */
export function growShelfPage(page: ShelfPage, size: PageSize): void {
  if (size.width < page.width || size.height < page.height) {
    throw new Error("atlas: pages grow only — shrinking would move live slots");
  }
  page.width = size.width;
  page.height = size.height;
}

/**
 * Repack a set of sizes into a fresh page of the given extent, tallest first —
 * the classic shelf-packing order, and the only reason a repack is worth its
 * re-uploads. Returns rects positionally matched to `sizes`, or `null` if the
 * set does not fit (the caller keeps the page it has).
 */
export function packPage(
  width: number,
  height: number,
  gutter: number,
  sizes: readonly SlotSize[],
): { page: ShelfPage; rects: Rect[] } | null {
  const order = sizes.map((_, i) => i);
  order.sort((a, b) => {
    const sa = sizes[a] as SlotSize;
    const sb = sizes[b] as SlotSize;
    return sb.height - sa.height || sb.width - sa.width || a - b;
  });

  const page = createShelfPage(width, height, gutter);
  const rects: (Rect | undefined)[] = new Array(sizes.length);
  for (const i of order) {
    const rect = packRect(page, sizes[i] as SlotSize);
    if (rect === null) return null;
    rects[i] = rect;
  }
  return { page, rects: rects as Rect[] };
}
