import { describe, expect, it } from "vitest";
import {
  canPackAt,
  cloneShelfPage,
  coalesceHoles,
  coalesceShelves,
  createShelfPage,
  DEFAULT_ATLAS_GUTTER,
  freeRect,
  growShelfPage,
  initialPageSize,
  nextGrowthStep,
  packPage,
  packRect,
  pageOccupiedHeight,
  pageWaste,
  planPageGrowth,
  type ShelfPage,
  type SlotSize,
} from "../src/atlas-pack";
import type { Rect } from "../src/shapes";
import { makePrng } from "./prng";

const G = DEFAULT_ATLAS_GUTTER;
const sq = (n: number): SlotSize => ({ width: n, height: n });

/** Every rect handed out by `packRect`, tracked for the invariant checks. */
function packMany(page: ShelfPage, sizes: readonly SlotSize[]): (Rect | null)[] {
  return sizes.map((s) => packRect(page, s));
}

/** The invariant the whole module exists to hold. Returns the first violation. */
function checkInvariants(page: ShelfPage, live: readonly Rect[]): string | null {
  const g = page.gutter;
  for (const r of live) {
    if (r.x < g || r.y < g) return `rect ${JSON.stringify(r)} breaks the top/left margin`;
    if (r.x + r.width + g > page.width) return `rect ${JSON.stringify(r)} breaks the right margin`;
    if (r.y + r.height + g > page.height) return `rect ${JSON.stringify(r)} breaks the bottom margin`;
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i] as Rect;
      const b = live[j] as Rect;
      const apart =
        a.x + a.width + g <= b.x ||
        b.x + b.width + g <= a.x ||
        a.y + a.height + g <= b.y ||
        b.y + b.height + g <= a.y;
      if (!apart) return `rects ${JSON.stringify(a)} and ${JSON.stringify(b)} are closer than ${g}px`;
    }
  }
  return null;
}

describe("packRect — placement and gutters", () => {
  it("places the first rect inside the top/left margin", () => {
    const page = createShelfPage(1024, 1024);
    expect(packRect(page, sq(100))).toEqual({ x: G, y: G, width: 100, height: 100 });
    expect(page.usedArea).toBe(10_000);
  });

  it("advances along a shelf by width + gutter", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    expect(packRect(page, sq(100))).toEqual({ x: G + 100 + G, y: G, width: 100, height: 100 });
    expect(packRect(page, sq(100))?.x).toBe(G + 2 * (100 + G));
  });

  it("opens a new shelf below when the row is full, gutter included", () => {
    const page = createShelfPage(205, 1024); // floor((205 − G)/(100 + G)) = 1 column
    packRect(page, sq(100));
    const second = packRect(page, sq(100));
    expect(second).toEqual({ x: G, y: G + 100 + G, width: 100, height: 100 });
    expect(page.shelves).toHaveLength(2);
  });

  it("refuses a rect that cannot keep the bottom margin", () => {
    const page = createShelfPage(1024, 103); // 100 + 2*G = 104 needed
    expect(packRect(page, sq(100))).toBeNull();
    expect(createShelfPage(1024, 104).width).toBe(1024);
    expect(packRect(createShelfPage(1024, 104), sq(100))).not.toBeNull();
  });

  it("refuses non-positive sizes", () => {
    const page = createShelfPage(1024, 1024);
    expect(packRect(page, { width: 0, height: 10 })).toBeNull();
    expect(packRect(page, { width: 10, height: -1 })).toBeNull();
  });

  it("holds the gutter at every edge and between every pair (uniform board)", () => {
    const page = createShelfPage(4096, 4096);
    const rects = packMany(page, new Array(100).fill(sq(336))) as Rect[];
    expect(rects.every((r) => r !== null)).toBe(true);
    expect(checkInvariants(page, rects)).toBeNull();
  });

  it("packs the bench board 12 columns wide (floor((W − g)/(w + g)))", () => {
    const page = createShelfPage(4096, 4096);
    const rects = packMany(page, new Array(100).fill(sq(336))) as Rect[];
    const firstRow = rects.filter((r) => r.y === G);
    expect(firstRow).toHaveLength(12);
    expect(firstRow[11]?.x).toBe(G + 11 * (336 + G));
    expect(page.shelves).toHaveLength(9); // ceil(100/12)
    expect(pageOccupiedHeight(page)).toBe(G + 9 * (336 + G));
  });

  it("prefers a best-height-fit shelf over opening a new one", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(200)); // shelf A, height 200
    packRect(page, { width: 200, height: 50 }); // opens nothing; sits on A
    const tall = packRect(page, { width: 200, height: 300 }); // A is too short → shelf B
    expect(tall?.y).toBe(G + 200 + G);
    // A 60px rect now has both shelves available; the 200-high one fits tighter.
    const short = packRect(page, { width: 50, height: 60 });
    expect(short?.y).toBe(G);
  });
});

describe("freeRect — holes, cursor retraction, coalescing", () => {
  it("retracts the shelf cursor when the right-most rect is freed", () => {
    const page = createShelfPage(1024, 1024);
    const a = packRect(page, sq(100)) as Rect;
    const b = packRect(page, sq(100)) as Rect;
    expect(page.shelves[0]?.cursorX).toBe(b.x + 100 + G);
    expect(freeRect(page, b)).toBe(true);
    expect(page.shelves[0]?.cursorX).toBe(b.x);
    expect(page.holes).toHaveLength(0);
    expect(page.usedArea).toBe(10_000);
    expect(a.x).toBe(G);
  });

  it("leaves a hole when an interior rect is freed", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const b = packRect(page, sq(100)) as Rect;
    packRect(page, sq(100));
    freeRect(page, b);
    expect(page.holes).toEqual([{ x: b.x, y: G, width: 100, height: 100 }]);
  });

  it("releases the FULL shelf band, not just the freed rect's height", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(200)); // shelf height 200
    const short = packRect(page, { width: 100, height: 40 }) as Rect;
    packRect(page, sq(150));
    freeRect(page, short);
    expect(page.holes[0]?.height).toBe(200);
    // …so a 200-high rect can reuse the band a 40-high rect vacated.
    expect(packRect(page, { width: 100, height: 200 })?.x).toBe(short.x);
  });

  it("coalesces gutter-adjacent holes, gutter included in the merged span", () => {
    const page = createShelfPage(1024, 1024);
    const a = packRect(page, sq(100)) as Rect;
    const b = packRect(page, sq(100)) as Rect;
    packRect(page, sq(100));
    freeRect(page, a);
    freeRect(page, b);
    expect(page.holes).toHaveLength(1);
    expect(page.holes[0]).toEqual({ x: G, y: G, width: 100 + G + 100, height: 100 });
  });

  it("absorbs holes into the cursor when the retraction reaches them", () => {
    const page = createShelfPage(1024, 1024);
    const a = packRect(page, sq(100)) as Rect;
    const b = packRect(page, sq(100)) as Rect;
    freeRect(page, a); // hole
    freeRect(page, b); // tail → retracts over the hole
    expect(page.holes).toHaveLength(0);
    expect(page.shelves).toHaveLength(0); // trailing empty shelf dropped
    expect(page.usedArea).toBe(0);
  });

  it("returns false for a rect belonging to no shelf", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    expect(freeRect(page, { x: G, y: 900, width: 100, height: 100 })).toBe(false);
  });

  it("refuses a SECOND free of the same interior rect, accounting intact", () => {
    // The caller's bookkeeping is wrong either way; the page must not make it
    // worse. Unguarded, this subtracted the area twice and pushed a second
    // hole over the first — space the packer would then hand out twice.
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const b = packRect(page, sq(100)) as Rect;
    packRect(page, sq(100));
    expect(freeRect(page, b)).toBe(true);
    const holes = page.holes.map((h) => ({ ...h }));
    const used = page.usedArea;

    expect(freeRect(page, b)).toBe(false);
    expect(page.usedArea).toBe(used);
    expect(page.holes).toEqual(holes);
    // …and the space is still handed out exactly once.
    expect(packRect(page, sq(100))?.x).toBe(b.x);
    expect(packRect(page, sq(100))?.x).not.toBe(b.x);
  });

  it("refuses a SECOND free of the tail rect, cursor intact", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const b = packRect(page, sq(100)) as Rect;
    expect(freeRect(page, b)).toBe(true);
    const cursor = page.shelves[0]?.cursorX;
    const used = page.usedArea;

    expect(freeRect(page, b)).toBe(false);
    expect(page.shelves[0]?.cursorX).toBe(cursor);
    expect(page.usedArea).toBe(used);
    expect(page.holes).toHaveLength(0);
  });

  it("reuses a hole before extending into fresh space", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const b = packRect(page, sq(100)) as Rect;
    packRect(page, sq(100));
    freeRect(page, b);
    expect(packRect(page, sq(100))).toEqual({ x: b.x, y: G, width: 100, height: 100 });
    expect(page.holes).toHaveLength(0);
  });

  it("splits a hole it does not fill, keeping the gutter", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const b = packRect(page, { width: 300, height: 100 }) as Rect;
    packRect(page, sq(100));
    freeRect(page, b);
    const placed = packRect(page, { width: 100, height: 100 }) as Rect;
    expect(placed.x).toBe(b.x);
    expect(page.holes).toEqual([{ x: b.x + 100 + G, y: G, width: 300 - 100 - G, height: 100 }]);
  });

  it("absorbs a merged hole into the cursor when the tail was freed first", () => {
    const page = createShelfPage(1024, 1024);
    const rects = packMany(page, new Array(3).fill(sq(100))) as Rect[];
    freeRect(page, rects[2] as Rect); // tail first → cursor retracts, no hole
    freeRect(page, rects[0] as Rect);
    freeRect(page, rects[1] as Rect); // merges left, and now reaches the cursor
    expect(page.holes).toHaveLength(0);
    expect(page.shelves).toHaveLength(0);
  });

  it("declines a hole whose width remainder could not hold a gutter", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const b = packRect(page, { width: 100 + G, height: 100 }) as Rect; // slack exactly G
    packRect(page, sq(100));
    freeRect(page, b);
    // Taking the hole would strand G px and break the merge on the next free.
    const placed = packRect(page, sq(100)) as Rect;
    expect(placed.x).not.toBe(b.x);
    expect(page.holes).toEqual([{ x: b.x, y: G, width: 100 + G, height: 100 }]);
    // An exact fit is still taken, and freeing it restores the hole exactly.
    const exact = packRect(page, { width: 100 + G, height: 100 }) as Rect;
    expect(exact.x).toBe(b.x);
    freeRect(page, exact);
    expect(page.holes).toEqual([{ x: b.x, y: G, width: 100 + G, height: 100 }]);
  });

  it("merges adjacent empty shelves so a tall rect can use the vacated band", () => {
    const page = createShelfPage(1024, 1024);
    const a = packRect(page, sq(100)) as Rect;
    const b = packRect(page, { width: 1000, height: 100 }) as Rect; // shelf B (full width)
    const c = packRect(page, { width: 1000, height: 100 }) as Rect; // shelf C
    packRect(page, { width: 1000, height: 100 }); // shelf D — keeps B/C interior
    freeRect(page, a);
    freeRect(page, b);
    freeRect(page, c);
    // A+B+C are now one empty band; D still pins the bottom.
    expect(page.shelves).toHaveLength(2);
    expect(page.shelves[0]?.height).toBe(100 + G + 100 + G + 100);
    expect(packRect(page, { width: 500, height: 300 })).toEqual({ x: G, y: G, width: 500, height: 300 });
  });

  it("coalesceHoles and coalesceShelves are idempotent", () => {
    const page = createShelfPage(1024, 1024);
    const a = packRect(page, sq(100)) as Rect;
    packRect(page, sq(100));
    freeRect(page, a);
    const before = JSON.stringify(page);
    coalesceHoles(page);
    coalesceShelves(page);
    expect(JSON.stringify(page)).toBe(before);
  });
});

describe("page growth", () => {
  it("initialPageSize takes the next power of two, clamped, and refuses the impossible", () => {
    expect(initialPageSize(sq(336), 256, 8192)).toEqual({ width: 512, height: 512 });
    expect(initialPageSize(sq(10), 256, 8192)).toEqual({ width: 256, height: 256 });
    expect(initialPageSize({ width: 1000, height: 60 }, 256, 8192)).toEqual({ width: 1024, height: 1024 });
    expect(initialPageSize(sq(5000), 256, 8192)).toEqual({ width: 8192, height: 8192 });
    expect(initialPageSize(sq(8190), 256, 8192)).toBeNull(); // 8190 + 2*G > 8192
  });

  it("nextGrowthStep doubles the shorter side, ties to width, and stops at the limit", () => {
    expect(nextGrowthStep({ width: 512, height: 512 }, 8192)).toEqual({ width: 1024, height: 512 });
    expect(nextGrowthStep({ width: 1024, height: 512 }, 8192)).toEqual({ width: 1024, height: 1024 });
    expect(nextGrowthStep({ width: 8192, height: 4096 }, 8192)).toEqual({ width: 8192, height: 8192 });
    expect(nextGrowthStep({ width: 8192, height: 8192 }, 8192)).toBeNull();
    expect(nextGrowthStep({ width: 6000, height: 6000 }, 8192)).toEqual({ width: 8192, height: 6000 });
  });

  it("planPageGrowth returns the current extent when no growth is needed", () => {
    const page = createShelfPage(1024, 1024);
    expect(planPageGrowth(page, sq(100), 8192)).toEqual({ width: 1024, height: 1024 });
  });

  it("planPageGrowth walks the ladder to the first extent that fits", () => {
    const page = createShelfPage(512, 512);
    packRect(page, sq(336));
    expect(planPageGrowth(page, sq(336), 8192)).toEqual({ width: 1024, height: 512 });
  });

  it("planPageGrowth returns null when the device limit cannot hold the rect", () => {
    const page = createShelfPage(1024, 1024);
    expect(planPageGrowth(page, sq(4000), 2048)).toBeNull();
  });

  it("growth never moves a placed rect", () => {
    const page = createShelfPage(512, 512);
    const rects = packMany(page, new Array(1).fill(sq(336))).filter((r): r is Rect => r !== null);
    const before = rects.map((r) => ({ ...r }));
    growShelfPage(page, { width: 4096, height: 4096 });
    expect(rects).toEqual(before);
    expect(checkInvariants(page, rects)).toBeNull();
    // and the grown page keeps packing from the same shelves
    expect(packRect(page, sq(336))?.y).toBe(G);
  });

  it("growShelfPage refuses to shrink", () => {
    const page = createShelfPage(1024, 1024);
    expect(() => growShelfPage(page, { width: 512, height: 1024 })).toThrow(/grow only/);
  });

  it("drives the bench board from 512² to 4096² in six steps", () => {
    const page = createShelfPage(512, 512, G);
    const steps: string[] = [];
    for (let i = 0; i < 100; i++) {
      if (packRect(page, sq(336)) !== null) continue;
      const target = planPageGrowth(page, sq(336), 8192);
      expect(target).not.toBeNull();
      growShelfPage(page, target as { width: number; height: number });
      steps.push(`${page.width}x${page.height}`);
      expect(packRect(page, sq(336))).not.toBeNull();
    }
    expect(steps).toEqual(["1024x512", "1024x1024", "2048x1024", "2048x2048", "4096x2048", "4096x4096"]);
  });
});

describe("pageWaste — the instrument", () => {
  it("reports zeroes on an untouched page", () => {
    expect(pageWaste(createShelfPage(1024, 1024))).toMatchObject({
      occupiedArea: 0,
      usedArea: 0,
      packingWastePct: 0,
      allocationWastePct: 1,
      fragmentationPct: 0,
    });
  });

  it("separates packing waste from allocation waste on the bench board", () => {
    const page = createShelfPage(4096, 4096);
    packMany(page, new Array(100).fill(sq(336)));
    const w = pageWaste(page);
    expect(w.usedArea).toBe(100 * 336 * 336);
    expect(w.occupiedArea).toBe(4096 * (G + 9 * 338));
    expect(w.pageArea).toBe(4096 * 4096);
    expect(w.packingWastePct).toBeCloseTo(0.0945, 4);
    expect(w.allocationWastePct).toBeCloseTo(0.3271, 4);
    expect(w.fragmentationPct).toBe(0);
  });

  it("counts freed slots as fragmentation, not as used area", () => {
    const page = createShelfPage(1024, 1024);
    const rects = packMany(page, new Array(9).fill(sq(200))) as Rect[];
    const before = pageWaste(page).usedArea;
    freeRect(page, rects[1] as Rect); // interior of row 0 → a hole
    const after = pageWaste(page);
    expect(after.usedArea).toBe(before - 200 * 200);
    expect(after.holeArea).toBe(200 * 200);
    expect(after.fragmentationPct).toBeGreaterThan(0);
  });
});

describe("packPage — the repack primitive", () => {
  it("packs tallest first and returns rects positionally matched to sizes", () => {
    const sizes: SlotSize[] = [sq(50), sq(300), sq(120)];
    const out = packPage(1024, 1024, G, sizes);
    expect(out).not.toBeNull();
    const { rects } = out as { rects: Rect[] };
    expect(rects).toHaveLength(3);
    expect(rects[1]).toEqual({ x: G, y: G, width: 300, height: 300 }); // tallest first
    expect(rects.map((r) => `${r.width}`)).toEqual(["50", "300", "120"]);
    expect(checkInvariants(out?.page as ShelfPage, rects)).toBeNull();
  });

  it("returns null when the set does not fit the extent", () => {
    expect(packPage(512, 512, G, [sq(300), sq(300), sq(300)])).toBeNull();
  });

  it("recovers the fragmentation a checkerboard free leaves behind", () => {
    const page = createShelfPage(1024, 1024);
    const rects = packMany(page, new Array(16).fill(sq(200))) as Rect[];
    const live: Rect[] = [];
    rects.forEach((r, i) => {
      if (i % 2 === 0) freeRect(page, r);
      else live.push(r);
    });
    const fragmented = pageWaste(page);
    // 5 columns × 4 rows; two of the eight freed rects were row tails and
    // retracted their cursor instead of leaving a hole.
    expect(fragmented.holeArea).toBe(6 * 200 * 200);
    expect(fragmented.fragmentationPct).toBeGreaterThan(0.28);

    const out = packPage(page.width, page.height, page.gutter, live.map((r) => ({ width: r.width, height: r.height })));
    expect(out).not.toBeNull();
    const repacked = pageWaste((out as { page: ShelfPage }).page);
    expect(repacked.holeArea).toBe(0);
    expect(repacked.usedArea).toBe(fragmented.usedArea);
    expect(repacked.packingWastePct).toBeLessThan(fragmented.packingWastePct);
    expect(checkInvariants((out as { page: ShelfPage }).page, (out as { rects: Rect[] }).rects)).toBeNull();
  });
});

describe("adversarial shapes", () => {
  it("packs wildly heterogeneous sizes without violating the invariant", () => {
    const page = createShelfPage(2048, 2048);
    const sizes: SlotSize[] = [
      { width: 1900, height: 12 },
      { width: 12, height: 900 },
      sq(400),
      { width: 700, height: 33 },
      sq(1),
      { width: 33, height: 700 },
      sq(256),
      { width: 1000, height: 200 },
    ];
    const rects = packMany(page, sizes).filter((r): r is Rect => r !== null);
    expect(rects).toHaveLength(sizes.length);
    expect(checkInvariants(page, rects)).toBeNull();
  });

  it("names the worst case: one tall rect fixes a shelf height that short rects then waste", () => {
    // The known shelf-packing loss, measured rather than assumed.
    const page = createShelfPage(1024, 1024);
    packRect(page, { width: 10, height: 500 }); // opens a 500-high shelf
    for (let i = 0; i < 20; i++) packRect(page, { width: 40, height: 10 });
    const w = pageWaste(page);
    expect(w.packingWastePct).toBeGreaterThan(0.8);
    // A skyline packer would recover this band; shelves report it instead.
    expect(page.shelves).toHaveLength(1);
  });

  it("a rect wider than the page never packs, at any height", () => {
    const page = createShelfPage(512, 4096);
    expect(packRect(page, { width: 509, height: 10 })).toBeNull(); // 509 + 2*G > 512
    expect(packRect(page, { width: 508, height: 10 })).not.toBeNull();
  });

  it("gutter 0 and gutter 4 both hold their own invariant", () => {
    for (const g of [0, 1, 2, 4]) {
      const page = createShelfPage(1000, 1000, g);
      const rects = packMany(page, new Array(20).fill(sq(150))).filter((r): r is Rect => r !== null);
      expect(checkInvariants(page, rects), `gutter ${g}`).toBeNull();
    }
  });
});

describe("property: randomized allocate/free never overlaps and never loses space", () => {
  it("holds over 40 seeds × 300 operations", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = makePrng(seed);
      const page = createShelfPage(2048, 2048);
      const live: Rect[] = [];

      for (let op = 0; op < 300; op++) {
        const freeing = live.length > 0 && rand() < 0.4;
        if (freeing) {
          const i = Math.floor(rand() * live.length);
          const rect = live[i] as Rect;
          expect(freeRect(page, rect), `seed ${seed} op ${op}`).toBe(true);
          live.splice(i, 1);
        } else {
          const size = {
            width: 8 + Math.floor(rand() * 300),
            height: 8 + Math.floor(rand() * 300),
          };
          const rect = packRect(page, size);
          if (rect !== null) live.push(rect);
        }
        const violation = checkInvariants(page, live);
        expect(violation, `seed ${seed} op ${op}`).toBeNull();
        // usedArea is the sum of what is live — the waste instrument's numerator
        // cannot drift, or every number it reports is a lie.
        const sum = live.reduce((n, r) => n + r.width * r.height, 0);
        expect(page.usedArea, `seed ${seed} op ${op}`).toBe(sum);
      }

      // Freeing everything returns the page to its initial state — no leaked
      // holes, no stranded shelves.
      for (const rect of live) expect(freeRect(page, rect)).toBe(true);
      expect(page.usedArea).toBe(0);
      expect(page.holes).toHaveLength(0);
      expect(page.shelves).toHaveLength(0);
      expect(pageOccupiedHeight(page)).toBe(0);
    }
  });

  it("cloneShelfPage is a deep copy — a dry-run pack cannot touch the live page", () => {
    const page = createShelfPage(1024, 1024);
    packRect(page, sq(100));
    const clone = cloneShelfPage(page);
    packRect(clone, sq(100));
    expect(page.shelves[0]?.cursorX).toBe(G + 100 + G);
    expect(clone.shelves[0]?.cursorX).toBe(G + 2 * (100 + G));
    expect(canPackAt(page, 1024, 1024, sq(100))).toBe(true);
    expect(page.usedArea).toBe(10_000);
  });
});
