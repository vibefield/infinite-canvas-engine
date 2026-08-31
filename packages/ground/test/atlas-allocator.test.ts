import type { Rect } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import {
  type AtlasAllocatorOptions,
  type AtlasEffects,
  createAtlasAllocator,
} from "../src/atlas-allocator";

/**
 * A fake device: it records every effect and keeps a page-sized occupancy map
 * so a copy landing on the wrong pixels is a test failure, not a review note.
 */
interface FakePage {
  id: number;
  width: number;
  height: number;
  retired: boolean;
  /** Which slot's pixels currently sit at each written rect. */
  written: { rect: Rect; source: string }[];
}

function makeDevice(opts: { preserveOnGrow?: boolean; canGrowInPlace?: boolean } = {}) {
  const canGrowInPlace = opts.canGrowInPlace ?? true;
  const preserveOnGrow = opts.preserveOnGrow ?? true;
  const pages: FakePage[] = [];
  const log: string[] = [];

  const effects: AtlasEffects<string> = {
    createPage(pageId, width, height) {
      log.push(`create ${pageId} ${width}x${height}`);
      pages.push({ id: pageId, width, height, retired: false, written: [] });
    },
    copySlot(pageId, rect, source) {
      log.push(`copy ${pageId} ${rect.x},${rect.y} ${rect.width}x${rect.height} ${source}`);
      const page = pages.find((p) => p.id === pageId);
      if (page === undefined) throw new Error(`copy into unknown page ${pageId}`);
      if (page.retired) throw new Error(`copy into retired page ${pageId}`);
      if (rect.x + rect.width > page.width || rect.y + rect.height > page.height) {
        throw new Error(`copy outside page ${pageId}`);
      }
      page.written = page.written.filter(
        (w) =>
          w.rect.x + w.rect.width <= rect.x ||
          rect.x + rect.width <= w.rect.x ||
          w.rect.y + w.rect.height <= rect.y ||
          rect.y + rect.height <= w.rect.y,
      );
      page.written.push({ rect: { ...rect }, source });
    },
    retirePage(pageId) {
      log.push(`retire ${pageId}`);
      const page = pages.find((p) => p.id === pageId);
      if (page === undefined) throw new Error(`retire unknown page ${pageId}`);
      page.retired = true;
    },
  };

  if (canGrowInPlace) {
    effects.growPage = (pageId, width, height) => {
      log.push(`grow ${pageId} ${width}x${height} ${preserveOnGrow ? "kept" : "blank"}`);
      const page = pages.find((p) => p.id === pageId);
      if (page === undefined) throw new Error(`grow unknown page ${pageId}`);
      page.width = width;
      page.height = height;
      if (!preserveOnGrow) page.written = [];
      return preserveOnGrow;
    };
  }

  return { effects, pages, log, live: () => pages.filter((p) => !p.retired) };
}

/**
 * The most recent write for a source. A moved or freed slot leaves its old
 * pixels behind in the page — nothing samples them and the next slot to take
 * that rect overwrites them, so the fake keeps them exactly as a real texture
 * would rather than tidying them away.
 */
function latest(page: FakePage | undefined, source: string): FakePage["written"][number] | undefined {
  const written = page?.written ?? [];
  for (let i = written.length - 1; i >= 0; i--) {
    const w = written[i];
    if (w !== undefined && w.source === source) return w;
  }
  return undefined;
}

/** Every live slot's own pixels sit at exactly its own rect. */
function everySlotResident(
  page: FakePage | undefined,
  slots: readonly { id: string; rect: Rect }[],
  sourceOf: (id: string) => string,
): boolean {
  return slots.every((s) => {
    const w = latest(page, sourceOf(s.id));
    return (
      w !== undefined &&
      w.rect.x === s.rect.x &&
      w.rect.y === s.rect.y &&
      w.rect.width === s.rect.width &&
      w.rect.height === s.rect.height
    );
  });
}

const sq = (n: number) => ({ width: n, height: n });
const BENCH = sq(336); // 168 CSS px at dpr 2 — the hic-bench board

function makeAllocator(device: ReturnType<typeof makeDevice>, options: AtlasAllocatorOptions = {}) {
  return createAtlasAllocator<string, string>(device.effects, options);
}

/** Fill a board and drive every pending copy through the fake. */
function board(n: number, options: AtlasAllocatorOptions = {}, size = BENCH) {
  const device = makeDevice();
  const atlas = makeAllocator(device, options);
  for (let i = 0; i < n; i++) atlas.allocate(`c${i}`, size, `src${i}`);
  atlas.flush();
  return { device, atlas };
}

describe("allocate — placement, growth, refusal", () => {
  it("opens one page sized for the first slot and refuses nothing that fits", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device);
    const slot = atlas.allocate("a", BENCH, "srcA");
    expect(slot).not.toBeNull();
    expect(slot?.residency).toBe("empty");
    expect(device.log[0]).toBe("create 0 512x512");
    expect(atlas.pages()).toEqual([{ id: 0, width: 512, height: 512, slots: 1 }]);
  });

  it("grows one page rather than opening a second (one bind per dom quad)", () => {
    const { device, atlas } = board(100);
    expect(atlas.pages()).toHaveLength(1);
    expect(device.live()).toHaveLength(1);
    expect(device.log.filter((l) => l.startsWith("grow"))).toEqual([
      "grow 0 1024x512 kept",
      "grow 0 1024x1024 kept",
      "grow 0 2048x1024 kept",
      "grow 0 2048x2048 kept",
      "grow 0 4096x2048 kept",
      "grow 0 4096x4096 kept",
    ]);
  });

  it("firstPageSize skips the growth ladder for a known board", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 4096, height: 4096 } });
    for (let i = 0; i < 100; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    expect(device.log.filter((l) => l.startsWith("grow"))).toHaveLength(0);
    expect(atlas.pages()).toEqual([{ id: 0, width: 4096, height: 4096, slots: 100 }]);
  });

  it("opens a second page when the first cannot grow past the device limit", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxPageSize: 1024, minPageSize: 512 });
    for (let i = 0; i < 12; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    expect(atlas.pages().length).toBeGreaterThan(1);
    expect(atlas.pages()[0]).toMatchObject({ width: 1024, height: 1024, slots: 9 });
    expect(atlas.slots().every((s) => s.rect.width === 336)).toBe(true);
  });

  it("refuses a slot larger than the device limit instead of clipping it", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxPageSize: 1024 });
    expect(atlas.allocate("huge", sq(1100), "srcH")).toBeNull();
    expect(atlas.allocate("edge", sq(1021), "srcE")).toBeNull(); // 1021 + 2*2 > 1024
    expect(atlas.allocate("fits", sq(1020), "srcF")).not.toBeNull();
  });

  it("re-registering the same id keeps the rect and marks the pixels stale", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device);
    const first = atlas.allocate("a", BENCH, "srcA");
    atlas.flush();
    expect(atlas.get("a")?.residency).toBe("resident");
    const again = atlas.allocate("a", BENCH, "srcA2");
    expect(again?.rect).toEqual(first?.rect);
    expect(atlas.get("a")?.residency).toBe("stale");
    atlas.flush();
    expect(device.pages[0]?.written[0]?.source).toBe("srcA2");
  });
});

describe("growth and the content it does or does not preserve", () => {
  it("keeps residency when the device preserves content across a grow", () => {
    const device = makeDevice({ preserveOnGrow: true });
    const atlas = makeAllocator(device);
    atlas.allocate("a", BENCH, "srcA");
    atlas.flush();
    atlas.allocate("b", BENCH, "srcB"); // forces the first grow
    expect(atlas.get("a")?.residency).toBe("resident");
    expect(atlas.get("a")?.page).toBe(0);
    expect(atlas.pendingCopies()).toEqual(["b"]);
  });

  it("re-marks every slot empty when the device cannot preserve content", () => {
    const device = makeDevice({ preserveOnGrow: false });
    const atlas = makeAllocator(device);
    const before = atlas.allocate("a", BENCH, "srcA");
    atlas.flush();
    atlas.allocate("b", BENCH, "srcB");
    expect(atlas.get("a")?.residency).toBe("empty");
    expect(atlas.get("a")?.rect).toEqual(before?.rect); // growth never moves a slot
    expect(atlas.pendingCopies()).toEqual(["a", "b"]);
  });

  it("reissues the page under a new id when the device has no growPage at all", () => {
    const device = makeDevice({ canGrowInPlace: false });
    const atlas = makeAllocator(device);
    const before = atlas.allocate("a", BENCH, "srcA");
    atlas.flush();
    atlas.allocate("b", BENCH, "srcB");
    expect(atlas.get("a")?.page).toBe(1);
    expect(atlas.get("a")?.rect).toEqual(before?.rect);
    expect(atlas.get("a")?.residency).toBe("empty");
    expect(device.log).toContain("retire 0");
    expect(device.live()).toHaveLength(1);
    atlas.flush(); // the fake throws if a copy lands on a retired page
    expect(device.live()[0]?.written).toHaveLength(2);
  });
});

describe("dirty and flush — the only bulk path, and it is budgeted", () => {
  it("copies each pending slot once, empty before stale", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 2048, height: 2048 } });
    atlas.allocate("a", BENCH, "srcA");
    atlas.allocate("b", BENCH, "srcB");
    atlas.flush();
    atlas.markDirty("a"); // stale
    atlas.allocate("c", BENCH, "srcC"); // empty
    expect(atlas.pendingCopies()).toEqual(["c", "a"]);
    expect(atlas.flush()).toBe(2);
    expect(atlas.flush()).toBe(0);
  });

  it("honours a per-call budget so boot never becomes a full-board path", () => {
    const { atlas } = board(0);
    for (let i = 0; i < 20; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    expect(atlas.flush(5)).toBe(5);
    expect(atlas.pendingCopies()).toHaveLength(15);
    expect(atlas.flush(5)).toBe(5);
    expect(atlas.pendingCopies()).toHaveLength(10);
  });

  it("maxCopiesPerFlush supplies the default budget", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxCopiesPerFlush: 3 });
    for (let i = 0; i < 10; i++) atlas.allocate(`c${i}`, sq(64), `src${i}`);
    expect(atlas.flush()).toBe(3);
  });

  it("markDirty leaves a never-copied slot empty, not stale", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device);
    atlas.allocate("a", BENCH, "srcA");
    expect(atlas.markDirty("a")).toBe(true);
    expect(atlas.get("a")?.residency).toBe("empty");
    expect(atlas.markDirty("missing")).toBe(false);
  });

  it("copies land inside the page and never overlap another live slot", () => {
    const { device, atlas } = board(60);
    const page = device.live()[0];
    expect(page?.written).toHaveLength(60);
    expect(atlas.slots().every((s) => s.residency === "resident")).toBe(true);
    for (const w of page?.written ?? []) {
      expect(w.rect.x + w.rect.width).toBeLessThanOrEqual(page?.width ?? 0);
      expect(w.rect.y + w.rect.height).toBeLessThanOrEqual(page?.height ?? 0);
    }
  });
});

describe("free, reclaim and page retirement", () => {
  it("frees a slot and hands its space back", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 2048, height: 2048 } });
    atlas.allocate("a", BENCH, "srcA");
    const b = atlas.allocate("b", BENCH, "srcB");
    atlas.allocate("c", BENCH, "srcC");
    expect(atlas.free("b")).toBe(true);
    expect(atlas.free("b")).toBe(false);
    expect(atlas.get("b")).toBeUndefined();
    expect(atlas.allocate("d", BENCH, "srcD")?.rect).toEqual(b?.rect);
  });

  it("retires an emptied page but always keeps one standing", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxPageSize: 1024, minPageSize: 1024 });
    for (let i = 0; i < 12; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    expect(atlas.pages()).toHaveLength(2);
    for (let i = 9; i < 12; i++) atlas.free(`c${i}`); // empties page 1
    expect(atlas.pages()).toHaveLength(1);
    expect(device.log).toContain("retire 1");
    for (let i = 0; i < 9; i++) atlas.free(`c${i}`);
    expect(atlas.pages()).toHaveLength(1); // the last page stays
  });

  it("reclaimSlots frees the coldest unpinned slots to a budget", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 4096, height: 4096 } });
    for (let i = 0; i < 10; i++) {
      atlas.allocate(`c${i}`, BENCH, `src${i}`);
      atlas.touch(`c${i}`, i * 100);
    }
    atlas.pin("c0", true); // coldest, but pinned
    const slotBytes = 336 * 336 * 4;
    const freed = atlas.reclaimSlots(slotBytes * 7);
    expect(freed).toEqual(["c1", "c2", "c3"]);
    expect(atlas.get("c0")).toBeDefined();
    expect(atlas.slots()).toHaveLength(7);
    expect(atlas.reclaimSlots(slotBytes * 7)).toEqual([]);
  });

  it("reclaimPages retires whole pages, because that is what returns memory", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxPageSize: 1024, minPageSize: 1024 });
    for (let i = 0; i < 18; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    atlas.flush();
    expect(atlas.pages()).toHaveLength(2);
    // Page 0's slots are all colder than page 1's.
    for (let i = 0; i < 18; i++) atlas.touch(`c${i}`, i < 9 ? 10 : 5_000);
    const written = atlas.waste().occupiedBytes;
    const freed = atlas.reclaimPages(written / 2);
    expect(freed).toHaveLength(9);
    expect(freed).toContain("c0");
    expect(atlas.pages()).toHaveLength(1);
    expect(atlas.slots().map((s) => s.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `c${i + 9}`),
    );
  });

  it("reclaimPages never retires a page holding a pinned slot", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxPageSize: 1024, minPageSize: 1024 });
    for (let i = 0; i < 18; i++) {
      atlas.allocate(`c${i}`, BENCH, `src${i}`);
      atlas.touch(`c${i}`, i < 9 ? 10 : 5_000);
    }
    atlas.pin("c0", true);
    expect(atlas.reclaimPages(1)).toHaveLength(9); // page 1 goes; page 0 is pinned
    expect(atlas.get("c0")).toBeDefined();
    expect(atlas.reclaimPages(1)).toEqual([]); // nothing left to give
  });

  it("dispose retires every page", () => {
    const { device, atlas } = board(100);
    atlas.dispose();
    expect(device.live()).toHaveLength(0);
    expect(atlas.slots()).toHaveLength(0);
  });
});

describe("resize — the band/DPR re-slot", () => {
  it("is a no-op at an unchanged size", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device);
    const before = atlas.allocate("a", BENCH, "srcA");
    atlas.flush();
    expect(atlas.resize("a", BENCH)?.rect).toEqual(before?.rect);
    expect(atlas.get("a")?.residency).toBe("resident");
  });

  it("re-slots at the new size and demands a fresh copy", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 2048, height: 2048 } });
    atlas.allocate("a", BENCH, "srcA");
    atlas.allocate("b", BENCH, "srcB");
    atlas.flush();
    const grown = atlas.resize("a", sq(672)); // one zoom band up
    expect(grown?.rect.width).toBe(672);
    expect(grown?.residency).toBe("empty");
    expect(atlas.get("b")?.residency).toBe("resident"); // untouched
    atlas.flush();
    const written = latest(device.live()[0], "srcA");
    expect(written?.rect).toEqual(grown?.rect);
    expect(written?.rect.width).toBe(672);
  });

  it("shrinking releases the difference for reuse", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 1024, height: 1024 } });
    atlas.allocate("a", sq(500), "srcA");
    atlas.resize("a", sq(100));
    const b = atlas.allocate("b", sq(300), "srcB");
    expect(b).not.toBeNull();
    expect(atlas.waste().slotArea).toBe(100 * 100 + 300 * 300);
  });

  it("keeps the slot at its old size when the new one is refused", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { maxPageSize: 1024 });
    atlas.allocate("a", BENCH, "srcA");
    expect(atlas.resize("a", sq(2000))).toBeNull();
    const kept = atlas.get("a");
    expect(kept?.rect.width).toBe(336);
    expect(kept?.residency).toBe("empty");
    atlas.flush();
    expect(atlas.get("a")?.residency).toBe("resident");
  });

  it("resize of an unknown id is null", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device);
    expect(atlas.resize("nope", BENCH)).toBeNull();
  });
});

describe("the waste instrument", () => {
  /**
   * THE STATED BOUND. The spike's uniform-card atlas paid 19.5 % gutter waste
   * (hic-bench FINDINGS §6: a 3744² square atlas over 100 × 336² cards). The
   * paged allocator must beat that decisively on the same board; 12 % is the
   * bound, chosen to leave headroom for the ragged last row (whose size varies
   * with the column count a page-width step lands on) while staying far below
   * the number it replaces. Measured: 9.45 %.
   */
  it("holds packing waste under 12 % on the uniform 168×168 dpr-2 board", () => {
    const { atlas } = board(100);
    const w = atlas.waste();
    expect(w.slots).toBe(100);
    expect(w.pages).toBe(1);
    expect(w.slotArea).toBe(100 * 336 * 336);
    expect(w.packingWastePct).toBeLessThan(0.12);
    expect(w.packingWastePct).toBeCloseTo(0.0945, 4);
    expect(w.fragmentationPct).toBe(0);
  });

  it("reports allocation waste separately — growth overshoot is address space, not memory", () => {
    const { atlas } = board(100);
    const w = atlas.waste();
    // The page doubled to 4096² where 4096×3044 would do. FINDINGS §6 measured
    // `createTexture` at 0.0 MB with all cost at first write, so the unwritten
    // tail is addressable, not resident — hence two numbers, not one.
    expect(w.pageArea).toBe(4096 * 4096);
    expect(w.occupiedArea).toBe(4096 * (2 + 9 * 338));
    expect(w.allocationWastePct).toBeCloseTo(0.3271, 4);
    expect(w.allocatedBytes).toBe(4096 * 4096 * 4);
    expect(w.occupiedBytes).toBe(w.occupiedArea * 4);
  });

  it("a hinted page spends what it needs: 9.45 % packing, 9.45 % allocation", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 4096, height: 3044 } });
    for (let i = 0; i < 100; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    const w = atlas.waste();
    expect(w.packingWastePct).toBeCloseTo(0.0945, 4);
    expect(w.allocationWastePct).toBeCloseTo(0.0945, 4);
  });

  it("reports zeroes before anything is allocated", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device);
    expect(atlas.waste()).toMatchObject({ pages: 0, slots: 0, packingWastePct: 0, occupiedBytes: 0 });
  });

  it("gutters are the whole cost when the board packs perfectly", () => {
    const device = makeDevice();
    // 10 × (100 + 2) + 2 = 1022 → exactly 10 columns and 10 rows of 100px slots.
    const atlas = makeAllocator(device, { firstPageSize: { width: 1022, height: 1022 } });
    for (let i = 0; i < 100; i++) atlas.allocate(`c${i}`, sq(100), `src${i}`);
    const w = atlas.waste();
    expect(w.pages).toBe(1);
    expect(w.packingWastePct).toBeCloseTo(1 - (100 * 100 * 100) / (1022 * 1022), 6);
    expect(w.packingWastePct).toBeLessThan(0.05); // 4.2 % — gutters alone
  });
});

describe("repack — the incremental fragmentation policy", () => {
  function fragment() {
    const device = makeDevice();
    const atlas = makeAllocator(device, { firstPageSize: { width: 1024, height: 1024 } });
    for (let i = 0; i < 16; i++) atlas.allocate(`c${i}`, sq(200), `src${i}`);
    atlas.flush();
    for (let i = 0; i < 16; i += 2) atlas.free(`c${i}`);
    return { device, atlas };
  }

  it("stays quiet below the fragmentation threshold", () => {
    const { atlas } = board(100);
    expect(atlas.planRepack()).toBeNull();
    expect(atlas.repackIfNeeded()).toBeNull();
  });

  it("stays quiet on a page with too few slots to be worth the re-uploads", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, {
      firstPageSize: { width: 1024, height: 1024 },
      minRepackSlots: 20,
    });
    for (let i = 0; i < 16; i++) atlas.allocate(`c${i}`, sq(200), `src${i}`);
    for (let i = 0; i < 16; i += 2) atlas.free(`c${i}`);
    expect(atlas.waste().fragmentationPct).toBeGreaterThan(0.2);
    expect(atlas.planRepack()).toBeNull();
  });

  it("plans a repack that removes the holes and reports the gain", () => {
    const { atlas } = fragment();
    const before = atlas.waste();
    expect(before.fragmentationPct).toBeGreaterThan(0.2);
    const plan = atlas.planRepack();
    expect(plan).not.toBeNull();
    expect(plan?.page).toBe(0);
    expect(plan?.packingWasteAfter).toBeLessThan(plan?.packingWasteBefore ?? 0);
    expect(plan?.moves.length).toBeGreaterThan(0);
    // Planning is pure: nothing has moved yet.
    expect(atlas.waste()).toEqual(before);
  });

  it("applying it moves slots, empties them, and clears the fragmentation", () => {
    const { device, atlas } = fragment();
    const plan = atlas.repackIfNeeded();
    expect(plan).not.toBeNull();
    const after = atlas.waste();
    expect(after.holeArea).toBe(0);
    expect(after.slots).toBe(8);
    expect(after.packingWastePct).toBeLessThan(plan?.packingWasteBefore ?? 0);
    for (const move of plan?.moves ?? []) {
      expect(atlas.get(move.id)?.rect).toEqual(move.to);
      // A moved slot's pixels are not at the new rect: `empty`, never `stale`.
      expect(atlas.get(move.id)?.residency).toBe("empty");
    }
    expect(atlas.pendingCopies()).toEqual(plan?.moves.map((m) => m.id));
    atlas.flush();
    expect(
      everySlotResident(device.live()[0], atlas.slots(), (id) => `src${id.slice(1)}`),
    ).toBe(true);
  });

  it("carries from/to so a binder may satisfy a move with a texture copy", () => {
    const { atlas } = fragment();
    const plan = atlas.repackIfNeeded();
    for (const move of plan?.moves ?? []) {
      expect(move.from).not.toEqual(move.to);
      expect(move.from.width).toBe(move.to.width);
      expect(move.from.height).toBe(move.to.height);
      expect(move.page).toBe(0);
    }
  });

  it("refuses a plan the page has moved past", () => {
    const { atlas } = fragment();
    const plan = atlas.planRepack();
    atlas.allocate("late", sq(200), "srcLate");
    expect(() => atlas.applyRepack(plan as NonNullable<typeof plan>)).toThrow(/stale repack plan/);
  });

  it("a second repack finds nothing left to win", () => {
    const { atlas } = fragment();
    expect(atlas.repackIfNeeded()).not.toBeNull();
    expect(atlas.repackIfNeeded()).toBeNull();
  });

  /**
   * One tall slot fixes a tall shelf; short slots then sit on it wasting its
   * height, and the extent it stretched DILUTES holes/occupied below the
   * fragmentation threshold. Height slack is a shelf packer's worst waste and
   * a hole count cannot see it, so the waste backstop has to be the trigger.
   */
  function heightSlack(options: AtlasAllocatorOptions = {}) {
    const device = makeDevice();
    const atlas = makeAllocator(device, {
      firstPageSize: { width: 2048, height: 2048 },
      ...options,
    });
    atlas.allocate("tall", { width: 200, height: 1200 }, "srcTall");
    for (let i = 0; i < 20; i++) atlas.allocate(`c${i}`, sq(200), `src${i}`);
    atlas.free("tall");
    return { device, atlas };
  }

  it("catches height slack that the hole ratio hides", () => {
    const { atlas } = heightSlack();
    const w = atlas.waste();
    expect(w.fragmentationPct).toBeLessThan(0.2); // the named trigger misses it
    expect(w.packingWastePct).toBeGreaterThan(0.5); // the backstop does not

    const plan = atlas.repackIfNeeded();
    expect(plan).not.toBeNull();
    expect(atlas.waste().packingWastePct).toBeLessThan(0.05);
  });

  it("respects a disabled backstop", () => {
    const { atlas } = heightSlack({ repackWasteThreshold: 1 });
    expect(atlas.planRepack()).toBeNull();
  });

  it("declines a repack whose gain does not clear minRepackGain", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, {
      firstPageSize: { width: 1024, height: 1024 },
      minRepackGain: 0.9,
    });
    for (let i = 0; i < 16; i++) atlas.allocate(`c${i}`, sq(200), `src${i}`);
    for (let i = 0; i < 16; i += 2) atlas.free(`c${i}`);
    expect(atlas.planRepack()).toBeNull();
  });
});

describe("the whole lifecycle, driven through the fake", () => {
  it("allocate → dirty → free → coalesce → grow → re-slot → repack → reclaim", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { minPageSize: 512, maxPageSize: 4096 });

    for (let i = 0; i < 40; i++) atlas.allocate(`c${i}`, BENCH, `src${i}`);
    expect(atlas.flush()).toBe(40);

    for (let i = 0; i < 40; i += 3) atlas.markDirty(`c${i}`);
    expect(atlas.flush()).toBe(14);

    for (let i = 1; i < 40; i += 2) atlas.free(`c${i}`);
    expect(atlas.slots()).toHaveLength(20);

    atlas.resize("c0", sq(672));
    expect(atlas.get("c0")?.rect.width).toBe(672);

    const plan = atlas.repackIfNeeded();
    expect(plan).not.toBeNull();
    atlas.flush();
    expect(atlas.slots().every((s) => s.residency === "resident")).toBe(true);

    for (const s of atlas.slots()) atlas.touch(s.id, Number(s.id.slice(1)));
    atlas.reclaimSlots(0);
    expect(atlas.slots()).toHaveLength(0);
    expect(atlas.waste().slotArea).toBe(0);
    expect(atlas.pages()).toHaveLength(1);

    // …and the emptied atlas still works.
    expect(atlas.allocate("again", BENCH, "srcAgain")).not.toBeNull();
    expect(atlas.flush()).toBe(1);
  });

  it("never lets two live slots overlap on a page, across 300 mixed operations", () => {
    const device = makeDevice();
    const atlas = makeAllocator(device, { minPageSize: 512, maxPageSize: 2048 });
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const live = new Set<string>();
    let next = 0;
    const OPS = 300;
    for (let op = 0; op < OPS; op++) {
      const roll = rand();
      if (roll < 0.5) {
        const id = `s${next++}`;
        const size = { width: 16 + Math.floor(rand() * 400), height: 16 + Math.floor(rand() * 400) };
        if (atlas.allocate(id, size, `src${id}`) !== null) live.add(id);
      } else if (roll < 0.7 && live.size > 0) {
        const id = [...live][Math.floor(rand() * live.size)] as string;
        atlas.free(id);
        live.delete(id);
      } else if (roll < 0.85 && live.size > 0) {
        const id = [...live][Math.floor(rand() * live.size)] as string;
        atlas.resize(id, { width: 16 + Math.floor(rand() * 400), height: 16 + Math.floor(rand() * 400) });
      } else {
        atlas.flush(3);
        atlas.repackIfNeeded();
      }

      // Every fourth op, and always the last. Nothing repairs an overlap on its
      // own, so a violation survives until it is looked for; the pairwise sweep
      // is quadratic and does not need to run on every step.
      if (op % 4 !== 0 && op !== OPS - 1) continue;

      const byPage = new Map<number, { id: string; rect: Rect }[]>();
      for (const slot of atlas.slots()) {
        const list = byPage.get(slot.page) ?? [];
        list.push({ id: String(slot.id), rect: slot.rect });
        byPage.set(slot.page, list);
      }
      for (const [pageId, list] of byPage) {
        const page = device.live().find((p) => p.id === pageId);
        expect(page, `op ${op}: slot on a retired or unknown page ${pageId}`).toBeDefined();
        for (let i = 0; i < list.length; i++) {
          const a = (list[i] as { rect: Rect }).rect;
          expect(a.x).toBeGreaterThanOrEqual(2);
          expect(a.x + a.width + 2).toBeLessThanOrEqual(page?.width ?? 0);
          expect(a.y + a.height + 2).toBeLessThanOrEqual(page?.height ?? 0);
          for (let j = i + 1; j < list.length; j++) {
            const b = (list[j] as { rect: Rect }).rect;
            const apart =
              a.x + a.width + 2 <= b.x ||
              b.x + b.width + 2 <= a.x ||
              a.y + a.height + 2 <= b.y ||
              b.y + b.height + 2 <= a.y;
            expect(apart, `op ${op}: overlap on page ${pageId}`).toBe(true);
          }
        }
      }
    }
    expect(atlas.slots().length).toBe(live.size);
  });
});
