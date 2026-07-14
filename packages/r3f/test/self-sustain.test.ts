/**
 * Ambient-animation rate cap (design-004 §3 amendment 2026-07-14): the pure
 * scheduling decision the GLViews frame-pass tail applies. Interaction
 * feedback (lift) stays native-rate; Hot islands and stagger backlogs are
 * scheduled at the cap; a quiet pass parks the loop.
 */
import { describe, expect, it } from "vitest";
import { RATE_CAP_SLACK_MS, selfSustainPlan } from "../src/self-sustain";

const stats = (over: Partial<Parameters<typeof selfSustainPlan>[0]> = {}) => ({
  anyHot: false,
  pendingPaints: 0,
  liftAnimating: false,
  ...over,
});

describe("selfSustainPlan", () => {
  it("parks the loop when nothing wants a frame", () => {
    expect(selfSustainPlan(stats(), 0, 60)).toBe("none");
  });

  it("lift eases run at native refresh — immediate even under a cap", () => {
    expect(selfSustainPlan(stats({ liftAnimating: true }), 0, 60)).toBe("now");
    // …and even when Hot islands would otherwise be throttled alongside.
    expect(selfSustainPlan(stats({ liftAnimating: true, anyHot: true }), 0, 60)).toBe("now");
  });

  it("Hot islands schedule the next pass one capped interval after pass START", () => {
    const plan = selfSustainPlan(stats({ anyHot: true }), 2, 60);
    expect(plan).toBeCloseTo(1000 / 60 - 2 - RATE_CAP_SLACK_MS, 6);
  });

  it("a stagger backlog (pendingPaints) is animation-rate work, not native-rate", () => {
    // The 5-Hot vs cap-4 board leaves pendingPaints ≥ 1 EVERY pass — if the
    // backlog re-invalidated immediately the cap would never engage (the
    // 2026-07-13 audit's permanent `pending 1`).
    const plan = selfSustainPlan(stats({ anyHot: true, pendingPaints: 1 }), 0, 60);
    expect(plan).toBeCloseTo(1000 / 60 - RATE_CAP_SLACK_MS, 6);
  });

  it("a slow pass that already ate the interval re-invalidates immediately", () => {
    expect(selfSustainPlan(stats({ anyHot: true }), 20, 60)).toBe("now");
  });

  it("Infinity restores the uncapped pre-amendment behavior", () => {
    expect(selfSustainPlan(stats({ anyHot: true }), 0, Number.POSITIVE_INFINITY)).toBe("now");
  });

  it("nonsense caps (≤ 0) clamp to 1 fps instead of freezing animation forever", () => {
    const plan = selfSustainPlan(stats({ anyHot: true }), 0, 0);
    expect(plan).toBeCloseTo(1000 - RATE_CAP_SLACK_MS, 6);
  });
});
