/**
 * The PAGED atlas-slot allocator for dom sources (design-012 §4 + §11 Q3,
 * RATIFIED 2026-08-31) — pure logic over `@ice/kernel`'s shelf math. Every
 * side-effect is injected (`AtlasEffects`): the allocator never names WebGPU,
 * HiC or the DOM, and a fake exercises every path. Wave-2 binds the effects to
 * the real device; nothing here changes when it does.
 *
 * What the ruling bought, and where each part lives:
 *
 * - **Paged, growing with content.** Pages start at the smallest power of two
 *   that holds the first slot and double toward the injected device limit
 *   (`maxPageSize` — pass `device.limits.maxTextureDimension2D`); a slot that
 *   fits nowhere opens another page. One texture bind serves every dom quad on
 *   a page, which is the whole point of the atlas over the per-card pool.
 * - **Gutters** — `@ice/kernel/atlas-pack`, 2 px by default.
 * - **Per-slot dirty.** `markDirty` on a paint event; `flush` drives
 *   destination-`origin` sub-rect copies through `copySlot`. There is no
 *   full-board path (design-012 §5 S4-3): `flush(limit)` is the only bulk
 *   iteration and it is budgeted.
 * - **Retention/LRU as slot free/reclaim** — but read the note on
 *   `reclaimPages` before choosing between the two reclaim doors: in a PAGED
 *   atlas they answer different questions.
 * - **Re-slot at a new size** — `resize`, for zoom-band and DPR changes.
 * - **The waste instrument** — `waste()`, reporting packing and allocation
 *   waste separately because `hic-bench` FINDINGS §6 proved textures are
 *   lazily backed and the two numbers therefore mean different things.
 */
import {
  cloneShelfPage,
  createShelfPage,
  DEFAULT_ATLAS_GUTTER,
  freeRect,
  growShelfPage,
  initialPageSize,
  packPage,
  packRect,
  pageOccupiedHeight,
  pageWaste,
  planPageGrowth,
  type PageSize,
  type Rect,
  type ShelfPage,
  type SlotSize,
} from "@ice/kernel";

/**
 * Whether the page holds this slot's current pixels.
 * - `empty` — nothing of this slot's is at this rect. The quad MUST NOT sample
 *   it (it would show another slot's pixels, or garbage).
 * - `stale` — the slot's pixels are here but out of date. Safe to sample for a
 *   frame; queued for re-copy.
 * - `resident` — current.
 */
export type SlotResidency = "empty" | "stale" | "resident";

export interface AtlasSlot<Id> {
  readonly id: Id;
  /** The page that currently backs this slot. Changes on re-slot and on growth. */
  readonly page: number;
  /** Device-pixel rect inside the page — the copy destination and the UV crop. */
  readonly rect: Rect;
  readonly residency: SlotResidency;
  readonly pinned: boolean;
  readonly lastUsedMs: number;
}

export interface AtlasPageView {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly slots: number;
}

/**
 * The injection seam. `Source` is opaque to the allocator — the binder's handle
 * for whatever produces pixels (an `Element` for dom sources).
 */
export interface AtlasEffects<Source> {
  /** Provide backing for a new page. Called once per page id. */
  createPage(pageId: number, width: number, height: number): void;
  /** Copy `source` into `rect` of `pageId` (the destination-`origin` sub-rect copy). */
  copySlot(pageId: number, rect: Rect, source: Source): void;
  /**
   * OPTIONAL. Resize this page's backing, keeping its id. Return `true` if the
   * old content survived at the same origins (a GPU texture-to-texture copy of
   * the old extent — always safe here, since growth never moves a slot), or
   * `false` if the new backing is blank, in which case every slot on the page
   * is re-marked `empty` and re-copied. Omit it entirely and growth reissues
   * the page under a NEW id via `createPage` + `retirePage`.
   */
  growPage?(pageId: number, width: number, height: number): boolean;
  /** OPTIONAL. The page's backing is no longer referenced — destroy it. */
  retirePage?(pageId: number): void;
}

/**
 * The device limit assumed when an app injects none. 8192 is the floor every
 * WebGPU adapter guarantees for `maxTextureDimension2D`; a real app passes its
 * own. Named because the BINDER clamps its requests against the same number —
 * two copies of it drifting apart is a slot the allocator refuses to place.
 */
export const DEFAULT_MAX_PAGE_SIZE = 8192;

export interface AtlasAllocatorOptions {
  /** Slot separation in device px. Default 2 (design-012 §4 says 1–2). */
  readonly gutter?: number;
  /** Device limit — pass `device.limits.maxTextureDimension2D`. Default 8192. */
  readonly maxPageSize?: number;
  /** Floor for a first page. Default 256. */
  readonly minPageSize?: number;
  /**
   * Skip the growth ladder by sizing the first page for a known board. The
   * 100-card bench board costs six reallocations without this hint.
   */
  readonly firstPageSize?: PageSize;
  /** Default 4 (RGBA8) — only ever used to turn areas into byte budgets. */
  readonly bytesPerPixel?: number;
  /** Repack a page above this hole-to-occupied ratio. Default 0.2. */
  readonly fragmentationThreshold?: number;
  /**
   * The backstop trigger: consider a page whose packing waste exceeds this even
   * if little of it is in holes. Default 0.5. Fragmentation alone misses the
   * case that matters most — one tall slot opens a tall shelf and stretches the
   * occupied extent, which DILUTES the hole ratio while making the page emptier.
   * A shelf packer's worst waste is height slack, and height slack is invisible
   * to a hole count.
   */
  readonly repackWasteThreshold?: number;
  /** Never repack a page holding fewer live slots than this. Default 4. */
  readonly minRepackSlots?: number;
  /** Minimum packing-waste improvement for a repack to be worth its re-uploads. Default 0.05. */
  readonly minRepackGain?: number;
  /** Default copy budget for `flush()`. Default Infinity. */
  readonly maxCopiesPerFlush?: number;
}

export interface AtlasMove<Id> {
  readonly id: Id;
  readonly page: number;
  readonly from: Rect;
  readonly to: Rect;
}

export interface AtlasRepackPlan<Id> {
  readonly page: number;
  readonly moves: readonly AtlasMove<Id>[];
  readonly packingWasteBefore: number;
  readonly packingWasteAfter: number;
  /** @internal — hand it back to `applyRepack` untouched. */
  readonly layout: ShelfPage;
  /** @internal — guards against applying a plan the page has moved past. */
  readonly revision: number;
}

export interface AtlasWasteReport {
  pages: number;
  slots: number;
  /** Live slot pixels. */
  slotArea: number;
  /** Σ `width × occupiedHeight` — the band shelves reach into, i.e. what gets written. */
  occupiedArea: number;
  /** Σ `width × height` — addressable, NOT resident (FINDINGS §6: textures are lazily backed). */
  pageArea: number;
  /** Interior fragmentation across all pages. */
  holeArea: number;
  /** `1 − slotArea/occupiedArea`. The number comparable to the spike's 19.5 % gutter waste. */
  packingWastePct: number;
  /** `1 − slotArea/pageArea`. Growth overshoot; costs address space, not memory. */
  allocationWastePct: number;
  /** `holeArea/occupiedArea` — the repack trigger. */
  fragmentationPct: number;
  occupiedBytes: number;
  allocatedBytes: number;
}

export interface AtlasAllocator<Id, Source> {
  /**
   * Place a slot, or re-register an existing one (updating its source, and
   * re-slotting if the size changed). `null` when the size exceeds the device
   * limit — an honest refusal; the caller degrades, it never gets a clipped slot.
   */
  allocate(id: Id, size: SlotSize, source: Source): AtlasSlot<Id> | null;
  /** A paint event: the slot's pixels are out of date. */
  markDirty(id: Id): boolean;
  /** Zoom-band / DPR change. No-op at an unchanged size. `null` = refused, slot kept at its old size. */
  resize(id: Id, size: SlotSize): AtlasSlot<Id> | null;
  /** Release a slot's space. Retires the page if it empties (and is not the first). */
  free(id: Id): boolean;
  touch(id: Id, nowMs: number): void;
  pin(id: Id, pinned: boolean): void;
  /** Ids awaiting a copy, `empty` before `stale` — a blank card outranks a stale one. */
  pendingCopies(): Id[];
  /** Drive `copySlot` for up to `limit` pending slots. Returns how many were copied. */
  flush(limit?: number): number;
  /**
   * Slot-granular LRU: free the coldest unpinned slots until live slot bytes
   * fit the budget. This bounds ADDRESS space (and so page growth); it does not
   * return memory on its own — see `reclaimPages`.
   */
  reclaimSlots(budgetBytes: number): Id[];
  /**
   * Page-granular LRU: retire the coldest pages until written bytes fit the
   * budget. In a paged atlas this is the door that returns MEMORY — a page's
   * pixels are committed on first write and come back only when the page is
   * retired, so freeing scattered slots reclaims nothing. A page is as hot as
   * its hottest slot, and a page holding any pinned slot is never retired.
   */
  reclaimPages(budgetBytes: number): Id[];
  get(id: Id): AtlasSlot<Id> | undefined;
  slots(): AtlasSlot<Id>[];
  pages(): AtlasPageView[];
  waste(): AtlasWasteReport;
  /** The worst page above the fragmentation threshold, or `null`. Pure — nothing moves. */
  planRepack(): AtlasRepackPlan<Id> | null;
  /** Apply a plan. Moved slots become `empty`: their pixels are not at the new rect yet. */
  applyRepack(plan: AtlasRepackPlan<Id>): void;
  repackIfNeeded(): AtlasRepackPlan<Id> | null;
  /** Retire every page. The allocator is unusable afterwards. */
  dispose(): void;
}

interface SlotRecord<Id, Source> {
  id: Id;
  page: number;
  rect: Rect;
  size: SlotSize;
  source: Source;
  residency: SlotResidency;
  pinned: boolean;
  lastUsedMs: number;
  seq: number;
}

interface PageRecord<Id> {
  id: number;
  shelf: ShelfPage;
  slots: Set<Id>;
  revision: number;
}

export function createAtlasAllocator<Id, Source>(
  effects: AtlasEffects<Source>,
  options: AtlasAllocatorOptions = {},
): AtlasAllocator<Id, Source> {
  const gutter = options.gutter ?? DEFAULT_ATLAS_GUTTER;
  const maxPageSize = options.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const minPageSize = options.minPageSize ?? 256;
  const bytesPerPixel = options.bytesPerPixel ?? 4;
  const fragmentationThreshold = options.fragmentationThreshold ?? 0.2;
  const repackWasteThreshold = options.repackWasteThreshold ?? 0.5;
  const minRepackSlots = options.minRepackSlots ?? 4;
  const minRepackGain = options.minRepackGain ?? 0.05;
  const maxCopiesPerFlush = options.maxCopiesPerFlush ?? Number.POSITIVE_INFINITY;

  const slots = new Map<Id, SlotRecord<Id, Source>>();
  const pages: PageRecord<Id>[] = [];
  let nextPageId = 0;
  let nextSeq = 0;

  const view = (s: SlotRecord<Id, Source>): AtlasSlot<Id> => ({
    id: s.id,
    page: s.page,
    rect: { ...s.rect },
    residency: s.residency,
    pinned: s.pinned,
    lastUsedMs: s.lastUsedMs,
  });

  const pageOf = (id: number): PageRecord<Id> | undefined => pages.find((p) => p.id === id);

  function openPage(size: PageSize): PageRecord<Id> {
    const record: PageRecord<Id> = {
      id: nextPageId++,
      shelf: createShelfPage(size.width, size.height, gutter),
      slots: new Set<Id>(),
      revision: 0,
    };
    pages.push(record);
    effects.createPage(record.id, size.width, size.height);
    return record;
  }

  function grow(page: PageRecord<Id>, target: PageSize): void {
    if (effects.growPage === undefined) {
      // No in-place resize: reissue under a new id. Every slot's pixels are
      // gone, but its RECT survives — growth is origin-preserving.
      const previous = page.id;
      page.id = nextPageId++;
      effects.createPage(page.id, target.width, target.height);
      effects.retirePage?.(previous);
      for (const id of page.slots) {
        const slot = slots.get(id);
        if (slot === undefined) continue;
        slot.page = page.id;
        slot.residency = "empty";
      }
    } else if (!effects.growPage(page.id, target.width, target.height)) {
      for (const id of page.slots) {
        const slot = slots.get(id);
        if (slot !== undefined) slot.residency = "empty";
      }
    }
    growShelfPage(page.shelf, target);
    page.revision++;
  }

  /** Place a size somewhere: an existing page, a grown page, or a new one. */
  function place(size: SlotSize): { page: PageRecord<Id>; rect: Rect } | null {
    for (const page of pages) {
      const rect = packRect(page.shelf, size);
      if (rect !== null) return { page, rect };
    }
    // Growing an existing page keeps the bind count down; do it before opening
    // another, and take the first page that can grow so pages fill in order.
    for (const page of pages) {
      const target = planPageGrowth(page.shelf, size, maxPageSize);
      if (target === null) continue;
      grow(page, target);
      const rect = packRect(page.shelf, size);
      if (rect !== null) return { page, rect };
    }
    const hint = pages.length === 0 ? options.firstPageSize : undefined;
    const first =
      hint === undefined
        ? initialPageSize(size, minPageSize, maxPageSize, gutter)
        : { width: Math.min(hint.width, maxPageSize), height: Math.min(hint.height, maxPageSize) };
    if (first === null) return null; // larger than the device can hold, at any page size
    const page = openPage(first);
    let rect = packRect(page.shelf, size);
    if (rect === null) {
      // A hinted first page can be too small for the slot that opened it; the
      // ladder still applies.
      const target = planPageGrowth(page.shelf, size, maxPageSize);
      if (target !== null) {
        grow(page, target);
        rect = packRect(page.shelf, size);
      }
    }
    return rect === null ? null : { page, rect };
  }

  function detach(slot: SlotRecord<Id, Source>): void {
    const page = pageOf(slot.page);
    if (page === undefined) return;
    freeRect(page.shelf, slot.rect);
    page.slots.delete(slot.id);
    page.revision++;
  }

  function retireIfEmpty(page: PageRecord<Id>): void {
    // One page always survives: a board that empties will need it again, and
    // retire/create thrash on the last page buys nothing (the texture is
    // lazily backed, so an idle empty page costs no memory — FINDINGS §6).
    if (page.slots.size > 0 || pages.length <= 1) return;
    const index = pages.indexOf(page);
    if (index < 0) return;
    pages.splice(index, 1);
    effects.retirePage?.(page.id);
  }

  function attach(slot: SlotRecord<Id, Source>, placed: { page: PageRecord<Id>; rect: Rect }): void {
    slot.page = placed.page.id;
    slot.rect = placed.rect;
    slot.residency = "empty";
    placed.page.slots.add(slot.id);
    placed.page.revision++;
  }

  function reslot(slot: SlotRecord<Id, Source>, size: SlotSize): AtlasSlot<Id> | null {
    const previousSize = slot.size;
    detach(slot);
    const placed = place(size);
    if (placed !== null) {
      slot.size = size;
      attach(slot, placed);
      return view(slot);
    }
    // Refused. The space we just released is guaranteed to take the old size
    // back, though possibly at a different rect — hence `empty`.
    const restored = place(previousSize);
    if (restored === null) throw new Error("atlas: lost a slot's own space on a failed re-slot");
    attach(slot, restored);
    return null;
  }

  function freeSlot(slot: SlotRecord<Id, Source>): void {
    const page = pageOf(slot.page);
    detach(slot);
    slots.delete(slot.id);
    if (page !== undefined) retireIfEmpty(page);
  }

  function pendingRecords(): SlotRecord<Id, Source>[] {
    const pending: SlotRecord<Id, Source>[] = [];
    for (const slot of slots.values()) {
      if (slot.residency !== "resident") pending.push(slot);
    }
    pending.sort((a, b) => {
      const rank = (s: SlotRecord<Id, Source>) => (s.residency === "empty" ? 0 : 1);
      return rank(a) - rank(b) || a.seq - b.seq;
    });
    return pending;
  }

  function planRepack(): AtlasRepackPlan<Id> | null {
    let best: AtlasRepackPlan<Id> | null = null;
    for (const page of pages) {
      if (page.slots.size < minRepackSlots) continue;
      const before = pageWaste(page.shelf);
      // Cheap pre-filter only; `minRepackGain` below is the real decision.
      if (
        before.fragmentationPct <= fragmentationThreshold &&
        before.packingWastePct <= repackWasteThreshold
      ) {
        continue;
      }

      const members = [...page.slots]
        .map((id) => slots.get(id))
        .filter((s): s is SlotRecord<Id, Source> => s !== undefined)
        .sort((a, b) => a.seq - b.seq);
      const packed = packPage(
        page.shelf.width,
        page.shelf.height,
        gutter,
        members.map((s) => s.size),
      );
      if (packed === null) continue; // no better layout exists — keep the page we have

      const after = pageWaste(packed.page);
      const gain = before.packingWastePct - after.packingWastePct;
      if (gain < minRepackGain) continue;

      const moves: AtlasMove<Id>[] = [];
      members.forEach((slot, i) => {
        const to = packed.rects[i] as Rect;
        if (slot.rect.x !== to.x || slot.rect.y !== to.y) {
          moves.push({ id: slot.id, page: page.id, from: { ...slot.rect }, to: { ...to } });
        }
      });

      if (best === null || gain > best.packingWasteBefore - best.packingWasteAfter) {
        best = {
          page: page.id,
          moves,
          packingWasteBefore: before.packingWastePct,
          packingWasteAfter: after.packingWastePct,
          layout: packed.page,
          revision: page.revision,
        };
      }
    }
    return best;
  }

  function applyRepack(plan: AtlasRepackPlan<Id>): void {
    const page = pageOf(plan.page);
    if (page === undefined || page.revision !== plan.revision) {
      throw new Error("atlas: stale repack plan — the page moved on; re-plan");
    }
    page.shelf = cloneShelfPage(plan.layout);
    page.revision++;
    for (const move of plan.moves) {
      const slot = slots.get(move.id);
      if (slot === undefined) continue;
      slot.rect = { ...move.to };
      // The pixels at the new rect belong to whoever used to live there, so
      // this is `empty`, not `stale`: the quad must not sample it until the
      // copy lands. See the repack note in the module header.
      slot.residency = "empty";
    }
  }

  return {
    allocate(id, size, source) {
      const existing = slots.get(id);
      if (existing !== undefined) {
        existing.source = source;
        if (existing.size.width !== size.width || existing.size.height !== size.height) {
          return reslot(existing, size);
        }
        if (existing.residency === "resident") existing.residency = "stale";
        return view(existing);
      }
      const placed = place(size);
      if (placed === null) return null;
      const slot: SlotRecord<Id, Source> = {
        id,
        page: placed.page.id,
        rect: placed.rect,
        size: { ...size },
        source,
        residency: "empty",
        pinned: false,
        lastUsedMs: 0,
        seq: nextSeq++,
      };
      slots.set(id, slot);
      placed.page.slots.add(id);
      placed.page.revision++;
      return view(slot);
    },

    markDirty(id) {
      const slot = slots.get(id);
      if (slot === undefined) return false;
      // A slot that never had pixels stays `empty` — it is not merely stale.
      if (slot.residency === "resident") slot.residency = "stale";
      return true;
    },

    resize(id, size) {
      const slot = slots.get(id);
      if (slot === undefined) return null;
      if (slot.size.width === size.width && slot.size.height === size.height) return view(slot);
      return reslot(slot, size);
    },

    free(id) {
      const slot = slots.get(id);
      if (slot === undefined) return false;
      freeSlot(slot);
      return true;
    },

    touch(id, nowMs) {
      const slot = slots.get(id);
      if (slot !== undefined) slot.lastUsedMs = nowMs;
    },

    pin(id, pinned) {
      const slot = slots.get(id);
      if (slot !== undefined) slot.pinned = pinned;
    },

    pendingCopies() {
      return pendingRecords().map((s) => s.id);
    },

    flush(limit) {
      const budget = limit ?? maxCopiesPerFlush;
      let copied = 0;
      for (const slot of pendingRecords()) {
        if (copied >= budget) break;
        effects.copySlot(slot.page, { ...slot.rect }, slot.source);
        slot.residency = "resident";
        copied++;
      }
      return copied;
    },

    reclaimSlots(budgetBytes) {
      const area = (s: SlotRecord<Id, Source>) => s.rect.width * s.rect.height;
      let live = 0;
      for (const slot of slots.values()) live += area(slot) * bytesPerPixel;
      if (live <= budgetBytes) return [];

      const candidates = [...slots.values()].filter((s) => !s.pinned);
      candidates.sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.seq - b.seq);
      const freed: Id[] = [];
      for (const slot of candidates) {
        if (live <= budgetBytes) break;
        live -= area(slot) * bytesPerPixel;
        freeSlot(slot);
        freed.push(slot.id);
      }
      return freed;
    },

    reclaimPages(budgetBytes) {
      const written = () =>
        pages.reduce((n, p) => n + p.shelf.width * pageOccupiedHeight(p.shelf) * bytesPerPixel, 0);
      const freed: Id[] = [];

      while (written() > budgetBytes && pages.length > 1) {
        let victim: PageRecord<Id> | null = null;
        let victimHeat = Number.POSITIVE_INFINITY;
        for (const page of pages) {
          if (page.slots.size === 0) continue;
          // A page is as hot as its hottest slot: retiring it kills every slot
          // on it, so one live card keeps the whole page.
          let heat = Number.NEGATIVE_INFINITY;
          let pinned = false;
          for (const id of page.slots) {
            const slot = slots.get(id);
            if (slot === undefined) continue;
            if (slot.pinned) pinned = true;
            heat = Math.max(heat, slot.lastUsedMs);
          }
          if (pinned) continue;
          if (heat < victimHeat) {
            victim = page;
            victimHeat = heat;
          }
        }
        if (victim === null) break; // every page is pinned or empty

        for (const id of [...victim.slots]) {
          const slot = slots.get(id);
          if (slot === undefined) continue;
          freeSlot(slot);
          freed.push(id);
        }
        // freeSlot retires the page as it empties. If it could not (it is the
        // last one standing), stop rather than spin.
        if (pages.includes(victim)) break;
      }
      return freed;
    },

    get(id) {
      const slot = slots.get(id);
      return slot === undefined ? undefined : view(slot);
    },

    slots() {
      return [...slots.values()].sort((a, b) => a.seq - b.seq).map(view);
    },

    pages() {
      return pages.map((p) => ({
        id: p.id,
        width: p.shelf.width,
        height: p.shelf.height,
        slots: p.slots.size,
      }));
    },

    waste() {
      let slotArea = 0;
      let occupiedArea = 0;
      let pageArea = 0;
      let holeArea = 0;
      for (const page of pages) {
        const w = pageWaste(page.shelf);
        slotArea += w.usedArea;
        occupiedArea += w.occupiedArea;
        pageArea += w.pageArea;
        holeArea += w.holeArea;
      }
      return {
        pages: pages.length,
        slots: slots.size,
        slotArea,
        occupiedArea,
        pageArea,
        holeArea,
        packingWastePct: occupiedArea === 0 ? 0 : 1 - slotArea / occupiedArea,
        allocationWastePct: pageArea === 0 ? 0 : 1 - slotArea / pageArea,
        fragmentationPct: occupiedArea === 0 ? 0 : holeArea / occupiedArea,
        occupiedBytes: occupiedArea * bytesPerPixel,
        allocatedBytes: pageArea * bytesPerPixel,
      };
    },

    planRepack,
    applyRepack,

    repackIfNeeded() {
      const plan = planRepack();
      if (plan !== null) applyRepack(plan);
      return plan;
    },

    dispose() {
      for (const page of pages) effects.retirePage?.(page.id);
      pages.length = 0;
      slots.clear();
    },
  };
}
