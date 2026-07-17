/**
 * layout.ts — insertSlot (drop-consume free-slot placement) and packLayout
 * (Clean Up shelf packing). Pinned properties: hint-wins-when-free, gutter
 * enforcement, incumbents never move (by construction — the fn returns one
 * point), pack idempotence, and reading-order preservation.
 */
import { describe, expect, it } from "vitest";
import { insertSlot, packLayout, type LayoutRect } from "../src";

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
});
