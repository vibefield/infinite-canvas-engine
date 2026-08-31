/**
 * `SurfaceDemand` — the pure half of the demand doctrine (design-012 §4,
 * decision 7). These are the decisions the compositor makes hundreds of times a
 * second, so they are pinned here rather than inferred from a rig's output.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SURFACE_DEMAND,
  PAUSED_SURFACE_DEMAND,
  demandIntervalMs,
  foldDemand,
  toFpsBucket,
} from "../src/surface/contract";

describe("fps buckets", () => {
  it("rounds DOWN, so nobody buys a rate they did not ask for", () => {
    // 24 fps yields 15, not 30. Demand is a ceiling a surface must justify;
    // rounding up would hand out headroom on request.
    expect(toFpsBucket(24)).toBe(15);
    expect(toFpsBucket(59)).toBe(30);
    expect(toFpsBucket(1)).toBe(0);
  });

  it("passes exact bucket values through untouched", () => {
    for (const bucket of [0, 2, 5, 10, 15, 30, 60] as const) {
      expect(toFpsBucket(bucket)).toBe(bucket);
    }
  });

  it("clamps a rate above the top bucket rather than inventing one", () => {
    // A CSS-keyframe card self-invalidates at ~240/s (hic-bench §5); it does
    // not get a 240 bucket for asking.
    expect(toFpsBucket(240)).toBe(60);
  });
});

describe("demand intervals", () => {
  it("turns a bucket into the minimum gap between uploads", () => {
    expect(demandIntervalMs({ mode: "live", fpsBucket: 30, interactive: false })).toBeCloseTo(33.33, 1);
    expect(demandIntervalMs({ mode: "live", fpsBucket: 2, interactive: false })).toBe(500);
  });

  it("owes nothing at all when paused or at bucket 0", () => {
    // Infinity, not a large number: "never, until demand changes" is a
    // different statement from "very rarely", and the throttle parks on it.
    expect(demandIntervalMs(PAUSED_SURFACE_DEMAND)).toBe(Number.POSITIVE_INFINITY);
    expect(demandIntervalMs({ mode: "live", fpsBucket: 0, interactive: false })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("folding demand against what the engine knows", () => {
  it("folds invisibility to PAUSED at the source", () => {
    // What makes an off-screen animating card genuinely free rather than
    // merely cheap (design-012 §4).
    expect(foldDemand(DEFAULT_SURFACE_DEMAND, { visible: false })).toEqual(PAUSED_SURFACE_DEMAND);
  });

  it("lets interaction outrank a low bucket", () => {
    const folded = foldDemand(
      { mode: "live", fpsBucket: 2, interactive: false },
      { visible: true, interactive: true },
    );
    expect(folded.interactive).toBe(true);
    expect(folded.fpsBucket).toBe(2); // its own ceiling still stands
  });

  it("gives an interactive surface a real rate when it declared none", () => {
    const folded = foldDemand(
      { mode: "live", fpsBucket: 0, interactive: false },
      { visible: true, interactive: true },
    );
    expect(folded.fpsBucket).toBe(60);
  });

  it("but interaction NEVER outranks invisibility", () => {
    // A card being typed into while scrolled off-screen still has no pixels
    // anyone can see.
    expect(
      foldDemand(DEFAULT_SURFACE_DEMAND, { visible: false, interactive: true }),
    ).toEqual(PAUSED_SURFACE_DEMAND);
  });

  it("leaves a paused-by-choice surface paused when it is visible", () => {
    const folded = foldDemand(PAUSED_SURFACE_DEMAND, { visible: true });
    expect(folded.mode).toBe("paused");
    expect(demandIntervalMs(folded)).toBe(Number.POSITIVE_INFINITY);
  });
});
