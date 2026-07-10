import { describe, expect, it } from "vitest";
import { computeIslandPhase, selectEvictions, type EvictionCandidate } from "../src/eviction";

function c(
  id: number,
  phase: EvictionCandidate<number>["phase"],
  bytes: number,
  lastUsedMs: number,
): EvictionCandidate<number> {
  return { id, phase, bytes, lastUsedMs };
}

describe("selectEvictions (ported v1 suite)", () => {
  it("returns [] when total ≤ budget", () => {
    const candidates = [c(1, "Warm", 100, 0), c(2, "Cold", 100, 0)];
    expect(selectEvictions(candidates, 200, 200)).toEqual([]);
    expect(selectEvictions(candidates, 199, 200)).toEqual([]);
    expect(selectEvictions([], 0, 100)).toEqual([]);
  });

  it("evicts Cold widgets before Warm widgets", () => {
    const candidates = [c(1, "Warm", 100, 0), c(2, "Cold", 100, 0), c(3, "Cold", 100, 100)];
    expect(selectEvictions(candidates, 300, 150)).toEqual([2, 3]);
  });

  it("evicts Warm widgets only after all Cold are gone", () => {
    const candidates = [c(1, "Warm", 100, 0), c(2, "Cold", 100, 50)];
    expect(selectEvictions(candidates, 200, 50)).toEqual([2, 1]);
  });

  it("evicts Dormant only after Cold and Warm", () => {
    const candidates = [c(1, "Dormant", 100, 0), c(2, "Warm", 100, 50), c(3, "Cold", 100, 100)];
    expect(selectEvictions(candidates, 300, 0)).toEqual([3, 2, 1]);
  });

  it("within a phase, oldest lastUsedMs evicts first", () => {
    const candidates = [c(1, "Cold", 100, 1000), c(2, "Cold", 100, 100), c(3, "Cold", 100, 500)];
    expect(selectEvictions(candidates, 300, 150)).toEqual([2, 3]);
  });

  it("never evicts Hot or Waking", () => {
    const candidates = [c(1, "Hot", 100, 0), c(2, "Waking", 100, 0), c(3, "Cold", 100, 0)];
    expect(selectEvictions(candidates, 300, 0)).toEqual([3]);
  });

  it("stops as soon as the budget is satisfied", () => {
    const candidates = [
      c(1, "Cold", 50, 0),
      c(2, "Cold", 50, 50),
      c(3, "Cold", 50, 100),
      c(4, "Cold", 50, 150),
    ];
    expect(selectEvictions(candidates, 200, 80)).toEqual([1, 2, 3]);
  });
});

describe("computeIslandPhase (v1 truth table, RFC-002)", () => {
  it("pins the full table", () => {
    // active, visible, animating, hasFbo → phase
    expect(computeIslandPhase(false, true, true, true)).toBe("Dormant"); // !active dominates
    expect(computeIslandPhase(true, true, true, false)).toBe("Hot"); // animating dominates fbo
    expect(computeIslandPhase(true, true, true, true)).toBe("Hot");
    expect(computeIslandPhase(true, true, false, true)).toBe("Warm"); // retained texture
    expect(computeIslandPhase(true, true, false, false)).toBe("Waking"); // must paint first
    expect(computeIslandPhase(true, false, false, true)).toBe("Cold"); // culled
    expect(computeIslandPhase(true, false, true, true)).toBe("Cold"); // culled ignores animation
  });

  it("cull round-trip with retained FBO re-enters Warm; after eviction re-enters Waking", () => {
    expect(computeIslandPhase(true, true, false, true)).toBe("Warm");
    expect(computeIslandPhase(true, true, false, false)).toBe("Waking");
  });
});
