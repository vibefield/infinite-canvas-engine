import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  PointerVersion,
  SelectionVersion,
  SpatialVersion,
  bumpVersion,
  makeVersionGuard,
} from "../src/helpers/version-stamps";

// Resources are schema-global handles but their VALUES are per-world, so a fresh world per test
// keeps them isolated (no reset needed).

describe("bumpVersion", () => {
  it("initializes an unset stamp to 1 and increments thereafter", () => {
    const w = createWorld();
    expect(w.getResource(PointerVersion)).toBeUndefined();

    bumpVersion(w, PointerVersion);
    expect(w.getResource(PointerVersion)?.v).toBe(1);

    bumpVersion(w, PointerVersion);
    bumpVersion(w, PointerVersion);
    expect(w.getResource(PointerVersion)?.v).toBe(3);
  });

  it("keeps stamps independent per resource", () => {
    const w = createWorld();
    bumpVersion(w, SelectionVersion);
    bumpVersion(w, SelectionVersion);
    bumpVersion(w, SpatialVersion);

    expect(w.getResource(SelectionVersion)?.v).toBe(2);
    expect(w.getResource(SpatialVersion)?.v).toBe(1);
    expect(w.getResource(PointerVersion)).toBeUndefined();
  });
});

describe("makeVersionGuard", () => {
  it("fires once on the first call, then only when the watched version changes", () => {
    const w = createWorld();
    const guard = makeVersionGuard(w, [PointerVersion]);

    // First call establishes the baseline — the gated system runs once at startup.
    expect(guard()).toBe(true);
    // No change since → skip.
    expect(guard()).toBe(false);
    expect(guard()).toBe(false);

    bumpVersion(w, PointerVersion);
    expect(guard()).toBe(true); // fires exactly once for the change
    expect(guard()).toBe(false);
  });

  it("fires when ANY of several watched versions changes", () => {
    const w = createWorld();
    const guard = makeVersionGuard(w, [PointerVersion, SelectionVersion, SpatialVersion]);

    expect(guard()).toBe(true); // baseline
    expect(guard()).toBe(false);

    bumpVersion(w, SelectionVersion);
    expect(guard()).toBe(true);
    expect(guard()).toBe(false);

    // Two changes between checks still yield a single fire.
    bumpVersion(w, SpatialVersion);
    bumpVersion(w, PointerVersion);
    expect(guard()).toBe(true);
    expect(guard()).toBe(false);
  });

  it("gives independent guards independent baselines", () => {
    const w = createWorld();
    bumpVersion(w, PointerVersion); // v = 1 before either guard exists

    const a = makeVersionGuard(w, [PointerVersion]);
    expect(a()).toBe(true); // baseline against v = 1
    expect(a()).toBe(false);

    const b = makeVersionGuard(w, [PointerVersion]);
    expect(b()).toBe(true); // fresh guard, its own baseline
    expect(b()).toBe(false);
    // `a` is unaffected by `b`'s baselining.
    expect(a()).toBe(false);
  });
});
