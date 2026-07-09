import { describe, expect, it } from "vitest";
import { computeSnapGuides, type EntityBounds } from "../src/snap";
import { inRange, makePrng } from "./prng";

const b = (x: number, y: number, width = 100, height = 100): EntityBounds => ({
  x,
  y,
  width,
  height,
});

describe("computeSnapGuides: edge/center alignment", () => {
  it("snaps a left edge to a reference right edge within threshold (v1 case)", () => {
    // ref: 0..100; dragged raw x = 102 → within 5 of 100 → snapDx = -2.
    const res = computeSnapGuides(b(102, 200), [b(0, 200)], 5);
    expect(res.snapDx).toBe(-2);
    expect(res.guides.some((g) => g.axis === "x" && g.position === 100)).toBe(true);
  });

  it("does not snap beyond the threshold", () => {
    // Offset y too, so no axis has an alignment candidate.
    const res = computeSnapGuides(b(106, 500), [b(0, 200)], 5);
    expect(res.snapDx).toBe(0);
    expect(res.snapDy).toBe(0);
    expect(res.guides).toHaveLength(0);
  });

  it("snaps center-to-center", () => {
    // ref center x = 50; dragged center = 53 → snapDx = -3.
    const res = computeSnapGuides(b(3, 300), [b(0, 0)], 5);
    expect(res.snapDx).toBe(-3);
    expect(res.guides.some((g) => g.type === "center" && g.position === 50)).toBe(true);
  });

  it("nearest candidate wins per axis", () => {
    // Two refs: edges at 100 (dist 2) and 104 (dist 2 from right edge? make distinct):
    // dragged left edge at 102: ref A right edge 100 (dist 2), ref B left edge 105 (dist 3).
    const res = computeSnapGuides(b(102, 0), [b(0, 0), b(105, 300, 100, 10)], 5);
    expect(res.snapDx).toBe(-2);
  });

  it("axes snap independently", () => {
    // ref spans 0..100 on both axes (default 100×100).
    const res = computeSnapGuides(b(102, 103), [b(0, 0)], 5);
    expect(res.snapDx).toBe(-2); // left(102) → right edge (100)
    expect(res.snapDy).toBe(-3); // top(103) → bottom edge (100)
  });
});

describe("computeSnapGuides: equal spacing", () => {
  it("centers between two neighbors when gaps nearly equal (Case 1)", () => {
    // A: 0..100, B: 300..400; dragged 100 wide at x=149 → gaps 49/51 → snap to 150.
    const res = computeSnapGuides(b(149, 0), [b(0, 0), b(300, 0)], 5);
    expect(res.snapDx).toBeCloseTo(1, 6);
    expect(res.spacings.length).toBeGreaterThan(0);
    expect(res.spacings[0]?.gap).toBeCloseTo(50, 6);
  });

  it("extends an existing gap pattern to the right (Case 2)", () => {
    // A: 0..100, B: 150..250 (gap 50); dragged at 302 → gap 52 → snap to 300.
    const res = computeSnapGuides(b(302, 0), [b(0, 0), b(150, 0)], 5);
    expect(res.snapDx).toBeCloseTo(-2, 6);
  });

  it("ignores references outside the perpendicular band", () => {
    // Same X layout but references are far below the dragged row.
    const res = computeSnapGuides(b(149, 0), [b(0, 500), b(300, 500)], 5);
    expect(res.snapDx).toBe(0);
    expect(res.spacings).toHaveLength(0);
  });

  it("alignment beats equal spacing on the same axis (merge rule)", () => {
    // Alignment candidate: ref right edge at 100 vs dragged left 102 (dist 2).
    // Equal-spacing candidate would move it elsewhere — alignment must win.
    const res = computeSnapGuides(b(102, 0), [b(0, 0), b(300, 0)], 5);
    expect(res.snapDx).toBe(-2);
  });
});

describe("computeSnapGuides: properties", () => {
  it("|snap| never exceeds the threshold; results are finite (property)", () => {
    const rand = makePrng(1234);
    for (let i = 0; i < 300; i++) {
      const threshold = inRange(rand, 1, 12);
      const dragged = b(
        inRange(rand, -500, 500),
        inRange(rand, -500, 500),
        inRange(rand, 10, 200),
        inRange(rand, 10, 200),
      );
      const refs: EntityBounds[] = [];
      const n = 1 + Math.floor(rand() * 5);
      for (let k = 0; k < n; k++) {
        refs.push(
          b(
            inRange(rand, -600, 600),
            inRange(rand, -600, 600),
            inRange(rand, 10, 200),
            inRange(rand, 10, 200),
          ),
        );
      }
      const res = computeSnapGuides(dragged, refs, threshold);
      expect(Number.isFinite(res.snapDx)).toBe(true);
      expect(Number.isFinite(res.snapDy)).toBe(true);
      expect(Math.abs(res.snapDx)).toBeLessThanOrEqual(threshold + 1e-9);
      expect(Math.abs(res.snapDy)).toBeLessThanOrEqual(threshold + 1e-9);
      for (const g of res.guides) expect(Number.isFinite(g.position)).toBe(true);
    }
  });

  it("is idempotent at the snapped position (no oscillation, design-003 §5.2)", () => {
    const rand = makePrng(5678);
    for (let i = 0; i < 200; i++) {
      const threshold = inRange(rand, 2, 8);
      const dragged = b(inRange(rand, -300, 300), inRange(rand, -300, 300));
      const refs = [b(inRange(rand, -350, 350), inRange(rand, -350, 350))];
      const first = computeSnapGuides(dragged, refs, threshold);
      const snapped = b(dragged.x + first.snapDx, dragged.y + first.snapDy);
      const second = computeSnapGuides(snapped, refs, threshold);
      expect(Math.abs(second.snapDx)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(second.snapDy)).toBeLessThanOrEqual(1e-9);
    }
  });
});
