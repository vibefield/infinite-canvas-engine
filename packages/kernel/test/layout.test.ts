/**
 * layout.ts — insertSlot (drop-consume free-slot placement) and packLayout
 * (Clean Up shelf packing). Pinned properties: hint-wins-when-free, gutter
 * enforcement, incumbents never move (by construction — the fn returns one
 * point), pack idempotence, and reading-order preservation.
 */
import { describe, expect, it } from "vitest";
import { insertSlot, layerGraph, packLayout, type LayoutRect } from "../src";

/** Mirror of the module's crowding rule: closer than gutter on both axes. */
function crowds(a: LayoutRect, b: LayoutRect, gutter: number): boolean {
  return (
    a.x < b.x + b.w + gutter &&
    b.x < a.x + a.w + gutter &&
    a.y < b.y + b.h + gutter &&
    b.y < a.y + a.h + gutter
  );
}

function assertNoCrowding(rects: readonly LayoutRect[], gutter: number): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(crowds(rects[i] as LayoutRect, rects[j] as LayoutRect, gutter)).toBe(false);
    }
  }
}

describe("insertSlot", () => {
  it("no incumbents → the hint verbatim", () => {
    expect(insertSlot([], { w: 50, h: 50 }, { x: 33, y: -7 }, 10)).toEqual({ x: 33, y: -7 });
  });

  it("free hint → the hint verbatim (deliberate empty-space drops win)", () => {
    const incumbents = [{ x: 0, y: 0, w: 100, h: 100 }];
    expect(insertSlot(incumbents, { w: 50, h: 50 }, { x: 300, y: 300 }, 10)).toEqual({ x: 300, y: 300 });
  });

  it("hint on top of an incumbent → nearest edge-aligned slot, gutter kept", () => {
    const incumbents = [{ x: 0, y: 0, w: 100, h: 100 }];
    const slot = insertSlot(incumbents, { w: 50, h: 50 }, { x: 40, y: 25 }, 10);
    // Nearest candidate to a right-of-center hint: flush right, top-aligned.
    expect(slot).toEqual({ x: 110, y: 0 });
    assertNoCrowding([...incumbents, { ...slot, w: 50, h: 50 }], 10);
  });

  it("gutter-crowding counts as occupied even without overlap", () => {
    const incumbents = [{ x: 0, y: 0, w: 100, h: 100 }];
    // 5px clear of the incumbent's right edge — inside the 10px gutter.
    const slot = insertSlot(incumbents, { w: 50, h: 50 }, { x: 105, y: 0 }, 10);
    expect(slot).toEqual({ x: 110, y: 0 });
  });

  it("the pile scenario: repeated same-hint drops fan out, never crowd", () => {
    const gutter = 16;
    const size = { w: 60, h: 60 };
    const hint = { x: 100, y: 100 };
    const rects: LayoutRect[] = [{ x: 100, y: 100, w: 60, h: 60 }];
    for (let n = 0; n < 5; n++) {
      const slot = insertSlot(rects, size, hint, gutter);
      rects.push({ ...slot, ...size });
    }
    assertNoCrowding(rects, gutter);
    expect(new Set(rects.map((r) => `${r.x},${r.y}`)).size).toBe(rects.length);
  });

  it("newcomer too big for every gap → always finds a free spot (fallback path)", () => {
    const gutter = 10;
    const incumbents: LayoutRect[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        incumbents.push({ x: c * 60, y: r * 60, w: 50, h: 50 });
      }
    }
    const slot = insertSlot(incumbents, { w: 200, h: 200 }, { x: 60, y: 60 }, gutter);
    assertNoCrowding([...incumbents, { ...slot, w: 200, h: 200 }], gutter);
  });
});

describe("packLayout", () => {
  it("empty input → empty output", () => {
    expect(packLayout([], { gutter: 10 })).toEqual([]);
  });

  it("single item stays at its own bbox top-left (default origin)", () => {
    expect(packLayout([{ x: 40, y: 70, w: 100, h: 100 }], { gutter: 10 })).toEqual([{ x: 40, y: 70 }]);
  });

  it("mixed widget sizes pack without crowding and respect maxWidth", () => {
    const gutter = 19;
    const items: LayoutRect[] = [
      { x: 500, y: 0, w: 329, h: 155 },
      { x: 0, y: 10, w: 155, h: 155 },
      { x: 900, y: 5, w: 329, h: 345 },
      { x: 20, y: 400, w: 155, h: 155 },
      { x: 300, y: 420, w: 329, h: 155 },
    ];
    const placed = packLayout(items, { gutter, origin: { x: 0, y: 0 }, maxWidth: 700 });
    const rects = items.map((it, i) => ({ ...(placed[i] as { x: number; y: number }), w: it.w, h: it.h }));
    assertNoCrowding(rects, gutter);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(700);
      expect(r.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves reading order: the top-left item leads the first row", () => {
    const items: LayoutRect[] = [
      { x: 400, y: 5, w: 100, h: 100 }, // reading order 2nd (same band, right)
      { x: 0, y: 0, w: 100, h: 100 }, // reading order 1st
      { x: 100, y: 300, w: 100, h: 100 }, // reading order 3rd
    ];
    const placed = packLayout(items, { gutter: 10, origin: { x: 0, y: 0 }, maxWidth: 500 });
    expect(placed[1]).toEqual({ x: 0, y: 0 }); // 1st → origin
    expect(placed[0]).toEqual({ x: 110, y: 0 }); // 2nd → beside it
    expect(placed[2]).toEqual({ x: 220, y: 0 }); // 3rd → row still has room
  });

  it("idempotent: a packed layout re-packs to itself", () => {
    const gutter = 19;
    const items: LayoutRect[] = [
      { x: 700, y: 90, w: 329, h: 345 },
      { x: 10, y: 0, w: 155, h: 155 },
      { x: 350, y: 30, w: 329, h: 155 },
      { x: 40, y: 500, w: 155, h: 155 },
    ];
    const opts = { gutter, maxWidth: 700 };
    const first = packLayout(items, opts);
    const applied = items.map((it, i) => ({ ...(first[i] as { x: number; y: number }), w: it.w, h: it.h }));
    expect(packLayout(applied, opts)).toEqual(first);
  });

  it("default origin keeps the cluster at its own top-left", () => {
    const items: LayoutRect[] = [
      { x: 1000, y: 2000, w: 100, h: 100 },
      { x: 1300, y: 2050, w: 100, h: 100 },
    ];
    const placed = packLayout(items, { gutter: 10, maxWidth: 500 });
    expect(placed[0]).toEqual({ x: 1000, y: 2000 });
  });

  it("fills the air beside a tall item instead of opening a new shelf", () => {
    // A tall column first, then smalls: the old shelf packer pushed every
    // small below the tall card (row height = tallest member); bottom-left
    // packs them beside it.
    const items: LayoutRect[] = [
      { x: 0, y: 0, w: 100, h: 300 },
      { x: 200, y: 10, w: 100, h: 100 },
      { x: 350, y: 10, w: 100, h: 100 },
      { x: 500, y: 10, w: 100, h: 100 },
    ];
    const placed = packLayout(items, { gutter: 10, origin: { x: 0, y: 0 }, maxWidth: 320 });
    expect(placed[0]).toEqual({ x: 0, y: 0 });
    expect(placed[1]).toEqual({ x: 110, y: 0 });
    expect(placed[2]).toEqual({ x: 220, y: 0 });
    expect(placed[3]).toEqual({ x: 110, y: 110 }); // beside the tall card, NOT below it
  });

  it("flows around obstacles and never crowds them", () => {
    const gutter = 20;
    const obstacles: LayoutRect[] = [{ x: 0, y: 0, w: 100, h: 100 }];
    const items: LayoutRect[] = [
      { x: 10, y: 10, w: 100, h: 100 },
      { x: 20, y: 20, w: 100, h: 100 },
    ];
    const placed = packLayout(items, { gutter, origin: { x: 0, y: 0 }, maxWidth: 400, obstacles });
    const rects = items.map((it, i) => ({ ...(placed[i] as { x: number; y: number }), w: it.w, h: it.h }));
    assertNoCrowding([...obstacles, ...rects], gutter);
  });
});

describe("layerGraph", () => {
  it("a wired chain flows left-to-right in edge order, single row", () => {
    const nodes = [
      { w: 100, h: 60 },
      { w: 120, h: 60 },
      { w: 90, h: 60 },
    ];
    // Edges REVERSE the index order — layout must follow wires, not indices.
    const placed = layerGraph(nodes, [
      [2, 1],
      [1, 0],
    ], { gapX: 40, gapY: 20 });
    const [a, b, c] = placed as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    expect(c.x).toBe(0); // source column
    expect(b.x).toBeGreaterThan(c.x);
    expect(a.x).toBeGreaterThan(b.x);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y); // equal-height single-node columns align
  });

  it("a diamond stacks the middle layer in one column, centered", () => {
    const nodes = [
      { w: 100, h: 50 },
      { w: 100, h: 50 },
      { w: 100, h: 50 },
      { w: 100, h: 50 },
    ];
    const placed = layerGraph(nodes, [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ], { gapX: 40, gapY: 20 });
    const [s, m1, m2, t] = placed as Array<{ x: number; y: number }>;
    expect(m1?.x).toBe(m2?.x); // same middle column
    expect((m2?.y as number) - (m1?.y as number)).toBe(70); // h + gapY stack
    expect(t?.x).toBeGreaterThan(m1?.x as number);
    // Source and sink center on the two-node column: 120 total → mid 35.
    expect(s?.y).toBe(35);
    expect(t?.y).toBe(35);
  });

  it("untangles a fully-reversed bipartite matching to zero crossings", () => {
    // Sources 0..3 wire to sinks in REVERSE (0→7, 1→6, 2→5, 3→4): index
    // order = maximal crossings. The ordering pass must flip the sink column.
    const nodes = Array.from({ length: 8 }, () => ({ w: 100, h: 50 }));
    const placed = layerGraph(nodes, [
      [0, 7],
      [1, 6],
      [2, 5],
      [3, 4],
    ], { gapX: 40, gapY: 20 });
    const y = (i: number): number => (placed[i] as { y: number }).y;
    expect(y(7)).toBeLessThan(y(6)); // sink column reversed → wires parallel
    expect(y(6)).toBeLessThan(y(5));
    expect(y(5)).toBeLessThan(y(4));
    // Parallel wires: each source aligns with its sink row.
    expect(y(0)).toBe(y(7));
    expect(y(3)).toBe(y(4));
  });

  it("a long chain wraps into stacked bands under maxWidth", () => {
    const nodes = Array.from({ length: 6 }, () => ({ w: 100, h: 50 }));
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) edges.push([i, i + 1]);
    const placed = layerGraph(nodes, edges, { gapX: 40, gapY: 20, maxWidth: 500 });
    for (const p of placed) expect(p.x + 100).toBeLessThanOrEqual(500);
    const p = placed as Array<{ x: number; y: number }>;
    expect(p[0]?.x).toBeLessThan(p[1]?.x as number); // band 1 flows left→right
    expect(p[1]?.x).toBeLessThan(p[2]?.x as number);
    expect(p[3]?.x).toBe(p[0]?.x); // carriage return
    expect(p[3]?.y).toBeGreaterThan(p[0]?.y as number); // band 2 below band 1
    expect(p[3]?.x).toBeLessThan(p[4]?.x as number);
  });

  it("a cycle terminates and still places every node at finite coords", () => {
    const nodes = [
      { w: 100, h: 50 },
      { w: 100, h: 50 },
    ];
    const placed = layerGraph(nodes, [
      [0, 1],
      [1, 0],
    ], { gapX: 40, gapY: 20 });
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect((placed[1] as { x: number }).x).toBeGreaterThan((placed[0] as { x: number }).x); // kept edge 0→1 wins
  });
});
