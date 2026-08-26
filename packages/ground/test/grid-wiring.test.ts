/**
 * Compile-time grid selection contract. Importing the classic implementation
 * here is test-only; the production entry reaches only `grid.ts`.
 */
import { describe, expect, it } from "vitest";
import { createGridPass as createClassicGridPass } from "../src/passes/grid-classic-pass";
import type { GridPassFactory } from "../src/passes/grid-contract";
import { createGridPass as createMagnetGridPass } from "../src/passes/grid-magnet-pass";
import { createGridPass } from "../src/passes/grid";

const interchangeableFactories: readonly GridPassFactory[] = [
  createClassicGridPass,
  createMagnetGridPass,
];

describe("grid build-time wiring", () => {
  it("keeps both implementations on the same parent-facing contract", () => {
    expect(interchangeableFactories).toHaveLength(2);
  });

  it("wires the magnet implementation into the production entry", () => {
    expect(createGridPass).toBe(createMagnetGridPass);
  });
});
