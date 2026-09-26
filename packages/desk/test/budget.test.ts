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
