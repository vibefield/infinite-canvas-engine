// @vitest-environment node
// THE RASTER BUDGET (design-015 §11.4; D6) — one ledger for every raster a kind keeps as a cache of its data. Pinned: a charge
// beyond the cap evicts the least recently used entries and no more, never one the owner says to keep this frame; a touch makes
// an entry the most recent; a release is not an eviction; a re-charge re-sizes; the stats read by owner.
import { describe, expect, it } from "vitest";
import { createRasterBudget } from "../src/engine/budget";

describe("the raster budget (D6)", () => {
  it("evicts the least recently used beyond the cap, and only as many as it must; a touch spares an entry; a release is no eviction", () => {
    const gone: string[] = [];
    const b = createRasterBudget(100);
    b.charge("board", "1", 40, () => gone.push("1"));
    b.charge("board", "2", 40, () => gone.push("2"));
    expect(b.trim()).toBe(0);
    b.touch("board", "1");   // 1 is now the most recent: 2 is the oldest
    b.charge("board", "3", 40, () => gone.push("3"));   // 120 > 100
    expect(b.stats().used).toBe(120);
    expect(b.trim()).toBe(40);
    expect(gone).toEqual(["2"]);
    expect(b.stats()).toMatchObject({ used: 80, entries: 2, evictions: 1, byOwner: { board: { bytes: 80, entries: 2 } } });
    b.release("board", "1");
    expect(b.stats().used).toBe(40);
    expect(gone).toEqual(["2"]);   // a release is the owner's own doing
  });

  it("never evicts what the owner keeps this frame — the rest goes oldest first, across owners", () => {
    const gone: string[] = [];
    const b = createRasterBudget(50);
    b.charge("board", "a", 30, () => gone.push("board a"));
    b.charge("notebook", "p1", 30, () => gone.push("notebook p1"));
    b.charge("board", "b", 30, () => gone.push("board b"));
    // 90 > 50: the oldest is `a`, but it is on screen — `p1` goes first, then `b` (the next oldest that may go): 30 ≤ 50
    expect(b.trim((owner, key) => owner === "board" && key === "a")).toBe(60);
    expect(gone).toEqual(["notebook p1", "board b"]);
    expect(b.stats()).toMatchObject({ used: 30, entries: 1, evictions: 2 });
  });

  it("…and keeps trimming while it is over the cap: an entry it may take goes even when it is the newest", () => {
    const gone: string[] = [];
    const b = createRasterBudget(50);
    b.charge("board", "a", 30, () => gone.push("a"));
    b.charge("board", "b", 30, () => gone.push("b"));
    b.charge("board", "c", 30, () => gone.push("c"));
    expect(b.trim((_o, key) => key === "a" || key === "b")).toBe(30);   // c alone may go; 60 > 50 remains, and nothing else may
    expect(gone).toEqual(["c"]);
    expect(b.stats().used).toBe(60);
  });

  it("a re-charge re-sizes an entry (the old bytes released) and counts once", () => {
    const b = createRasterBudget(1000);
    b.charge("board", "1", 40, () => {});
    b.charge("board", "1", 70, () => {});
    expect(b.stats()).toMatchObject({ used: 70, entries: 1 });
  });
});

describe("resident charges — the thumbnail arrays (K9 R2, K-L4 'thumbnails always')", () => {
  it("what resides is never evicted and never in the caches' way: the caches' room is what it leaves of the cap, `used` reads both", () => {
    const gone: string[] = [];
    const b = createRasterBudget(100);
    b.reside("photo", "thumbnails", 60);
    expect(b.room()).toBe(40);
    b.charge("board", "1", 30, () => gone.push("1"));
    expect(b.trim()).toBe(0);   // 30 ≤ the room of 40: nothing goes — before K9 the thumbnails counted (90 ≤ 100 still, but see below)
    b.charge("board", "2", 30, () => gone.push("2"));   // caches 60 > 40
    expect(b.trim(() => false)).toBe(30);
    expect(gone).toEqual(["1"]);   // the LRU cache — never the resident array, whatever `keep` says
    expect(b.stats()).toMatchObject({ used: 90, resident: 60, room: 40, entries: 2, evictions: 1, byOwner: { photo: { bytes: 60, entries: 1 }, board: { bytes: 30, entries: 1 } } });
    b.reside("photo", "thumbnails", 20);   // re-sized (a picture dropped, the array charged at what is in use)
    expect(b.stats()).toMatchObject({ used: 50, resident: 20, room: 80 });
    b.release("photo", "thumbnails");
    expect(b.stats()).toMatchObject({ used: 30, resident: 0, room: 100, entries: 1 });
  });

  it("the caches keep a FLOOR of the cap (a quarter) however much resides — and `used` says honestly when the resident arrays alone are over the cap", () => {
    const gone: string[] = [];
    const b = createRasterBudget(100);
    b.reside("photo", "thumbnails", 90);
    b.reside("board", "thumbnails", 50);   // 140 of a 100 cap: the thumbnails alone are over it
    expect(b.room()).toBe(25);
    b.charge("board", "1", 20, () => gone.push("1"));
    expect(b.trim()).toBe(0);   // within the floor: the detail (or raster) stands — before K9 every cache went every tick here
    b.charge("photo", "detail 7", 10, () => gone.push("d7"));   // 30 > 25
    expect(b.trim()).toBe(20);
    expect(gone).toEqual(["1"]);
    expect(b.stats()).toMatchObject({ used: 150, resident: 140, room: 25 });
    expect(b.stats().used).toBeGreaterThan(b.cap);
  });

  it("a host may set the floor itself", () => {
    const b = createRasterBudget(100, 10);
    b.reside("photo", "thumbnails", 100);
    expect(b.room()).toBe(10);
  });
});
