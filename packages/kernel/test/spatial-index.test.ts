import { describe, expect, it } from "vitest";
import { SpatialIndex } from "../src/spatial-index";

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("SpatialIndex", () => {
  it("inserts, searches by rect, and searches by point with tolerance", () => {
    const idx = new SpatialIndex<number>();
    idx.upsert(1, box(0, 0, 100, 100));
    idx.upsert(2, box(200, 200, 300, 300));

    expect(idx.search(box(50, 50, 60, 60)).map((e) => e.id)).toEqual([1]);
    expect(idx.searchPoint(250, 250).map((e) => e.id)).toEqual([2]);
    // 4px tolerance reaches an entry 3px away.
    expect(idx.searchPoint(103, 50, 4).map((e) => e.id)).toEqual([1]);
    expect(idx.searchPoint(103, 50, 0)).toHaveLength(0);
  });

  it("upsert moves an entry instead of duplicating it (O(log n) removal path)", () => {
    const idx = new SpatialIndex<number>();
    idx.upsert(1, box(0, 0, 10, 10));
    idx.upsert(1, box(500, 500, 510, 510));

    expect(idx.size).toBe(1);
    expect(idx.search(box(0, 0, 20, 20))).toHaveLength(0);
    expect(idx.search(box(490, 490, 520, 520)).map((e) => e.id)).toEqual([1]);
  });

  it("remove deletes; removing a missing id is a no-op", () => {
    const idx = new SpatialIndex<number>();
    idx.upsert(1, box(0, 0, 10, 10));
    idx.remove(1);
    expect(idx.size).toBe(0);
    expect(idx.search(box(0, 0, 20, 20))).toHaveLength(0);
    expect(() => idx.remove(99)).not.toThrow();
  });

  it("clear empties everything (per-frame index, nav switches rebuild)", () => {
    const idx = new SpatialIndex<number>();
    for (let i = 0; i < 50; i++) idx.upsert(i, box(i * 10, 0, i * 10 + 5, 5));
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.search(box(-1e9, -1e9, 1e9, 1e9))).toHaveLength(0);
  });
});
