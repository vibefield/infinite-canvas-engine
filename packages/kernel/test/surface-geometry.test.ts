/**
 * `geometry()` — the one call that answers every size question about a card's
 * pixels (design-013 D9, §7 row one).
 *
 * The headline case is the ZOOM-DRIFT FIXTURE, and it is here rather than in a
 * rig because it is the regression witness for a defect a rig took to find: an
 * 80×48 world card banded at 1, live zoom 1.9, dpr 2. Under the old two-writer
 * arrangement its slot was sized 160×96 while the platform rasterised 304×183
 * device px into it — 40,272 px written past the rect, into the gutter ring and
 * the neighbouring card's slot, raising no validation error and no copy
 * refusal (`ground/src/compositor/dom-source-binder.ts` ERRATA 2026-08-31,
 * CONFIRMED 2026-09-06). Both numbers now come out of one call, so the two
 * cannot disagree.
 */
import { describe, expect, it } from "vitest";
import { geometry } from "../src/surface-geometry";

// The zoom-drift rig's card, verbatim.
const CARD = { w: 80, h: 48 };
const DPR = 2;
const DRIFTED_ZOOM = 1.9;

describe("the zoom-drift fixture", () => {
  it("band: the host is sized in BAND space, so the raster IS the slot — drift 0", () => {
    const g = geometry(CARD, 1, DPR, DRIFTED_ZOOM, "band");
    // CSS box at the band, not the live zoom. This is the fix: the element
    // rasterises at its own box × the backing scale, which is what we asked
    // residency to hold.
    expect(g.cssSize).toEqual({ w: 80, h: 48 });
    expect(g.written).toEqual({ w: 160, h: 96 });
    expect(g.slotSize).toEqual(g.written);
    expect(g.rasterSize).toEqual(g.written);
    // Drift = what the platform writes minus what the slot holds. Zero.
    expect(g.written.w - g.slotSize.w).toBe(0);
    expect(g.written.h - g.slotSize.h).toBe(0);
  });

  it("band: placement is the live-zoom extent, and its ratio to the slot IS zoom/band", () => {
    const g = geometry(CARD, 1, DPR, DRIFTED_ZOOM, "band");
    expect(g.placement.w).toBeCloseTo(304, 10);
    expect(g.placement.h).toBeCloseTo(182.4, 10);
    // The residue the placement matrix carries. The hysteresis holds it in
    // [0.5, 2], which is why a band-space texture is never scaled absurdly.
    expect(g.placement.w / g.slotSize.w).toBeCloseTo(DRIFTED_ZOOM / 1, 10);
    expect(g.placement.h / g.slotSize.h).toBeCloseTo(DRIFTED_ZOOM / 1, 10);
  });

  it("crisp: the host is sized at the LIVE zoom, so written is the rig's measured 304×183", () => {
    const g = geometry(CARD, 1, DPR, DRIFTED_ZOOM, "crisp");
    expect(g.cssSize.w).toBeCloseTo(152, 10);
    expect(g.cssSize.h).toBeCloseTo(91.2, 10);
    // 91.2 css px came back from Chromium as 183 device px, not 182 — the
    // platform rounds UP, which is why this ceils.
    expect(g.written).toEqual({ w: 304, h: 183 });
    expect(g.slotSize).toEqual(g.written);
  });

  it("crisp: written and placement agree to within the ceil — that is what crisp buys", () => {
    const g = geometry(CARD, 1, DPR, DRIFTED_ZOOM, "crisp");
    expect(g.written.w - g.placement.w).toBe(0);
    expect(g.written.h - g.placement.h).toBeCloseTo(0.6, 10); // ceil(182.4) − 182.4
    expect(g.written.h - g.placement.h).toBeLessThan(1);
  });
});

describe("the strategy table", () => {
  it("agrees exactly when the band IS the live zoom — the A-vs-A control", () => {
    // The rig's own control: at zoom == band, the old arrangement escaped 0 px,
    // five runs of five. The two strategies must be indistinguishable there, or
    // the difference between them is not what this function says it is.
    const band = geometry(CARD, 2, DPR, 2, "band");
    const crisp = geometry(CARD, 2, DPR, 2, "crisp");
    expect(band.cssSize).toEqual(crisp.cssSize);
    expect(band.written).toEqual(crisp.written);
    expect(band.slotSize).toEqual(crisp.slotSize);
    expect(band.placement).toEqual(crisp.placement);
  });

  it("differs only in what is rastered — placement is the same card either way", () => {
    const band = geometry(CARD, 1, DPR, DRIFTED_ZOOM, "band");
    const crisp = geometry(CARD, 1, DPR, DRIFTED_ZOOM, "crisp");
    expect(band.placement).toEqual(crisp.placement);
    expect(band.written).not.toEqual(crisp.written);
  });

  it("band ignores the live zoom for sizing; crisp ignores the band", () => {
    const a = geometry(CARD, 1, DPR, 1, "band");
    const b = geometry(CARD, 1, DPR, 1.9, "band");
    expect(a.written).toEqual(b.written); // a zoom inside the band re-slots nothing

    const c = geometry(CARD, 1, DPR, 1.9, "crisp");
    const d = geometry(CARD, 8, DPR, 1.9, "crisp");
    expect(c.written).toEqual(d.written); // the band is not a crisp input
  });

  it("backingScale is dpr — flat, measured, and independent of the zoom", () => {
    // The rig measured 2.000× at dpr 2 across every live zoom tested, and
    // 1.000× against a deliberately 1× bitmap. That flatness is what lets
    // `band` size the host and know what comes back.
    for (const zoom of [0.25, 1, 1.9, 4]) {
      expect(geometry(CARD, 1, 2, zoom, "band").backingScale).toBe(2);
      expect(geometry(CARD, 1, 1, zoom, "band").backingScale).toBe(1);
    }
  });
});

describe("ceil, and the floor of one pixel", () => {
  it("ceils EVERY fractional css × dpr, on each axis independently", () => {
    // 33 × 1.5 = 49.5 → 50; 17 × 1.5 = 25.5 → 26. Rounding down (or to
    // nearest) re-opens the write-past-the-slot the ceil exists to close.
    const g = geometry({ w: 33, h: 17 }, 1, 1.5, 1, "band");
    expect(g.written).toEqual({ w: 50, h: 26 });
  });

  it("never returns a zero-px destination — a slot of no pixels is not a slot", () => {
    const g = geometry({ w: 0, h: 0.0001 }, 0.0625, 1, 1, "band");
    expect(g.written).toEqual({ w: 1, h: 1 });
    expect(g.slotSize).toEqual({ w: 1, h: 1 });
    expect(g.rasterSize).toEqual({ w: 1, h: 1 });
  });

  it("leaves cssSize and placement EXACT — the placement matrix must not lie", () => {
    const g = geometry({ w: 33, h: 17 }, 1, 1.5, 0.5, "band");
    expect(g.cssSize).toEqual({ w: 33, h: 17 });
    expect(g.placement).toEqual({ w: 33 * 0.5 * 1.5, h: 17 * 0.5 * 1.5 });
  });
});

describe("band 0", () => {
  it("throws, naming the gate the caller skipped", () => {
    // "Never banded" means no destination. Residency's own predicate is
    // `band > 0`, so a 0 can only arrive through a caller that skipped it, and
    // a coerced band 1 would hand back a complete, plausible geometry for a
    // card that has no pixels anywhere.
    expect(() => geometry(CARD, 0, 2, 1, "band")).toThrow(/band 0/);
    expect(() => geometry(CARD, 0, 2, 1, "band")).toThrow(/SurfaceBand\.band > 0/);
    expect(() => geometry(CARD, 0, 2, 1, "crisp")).toThrow(/never banded/);
  });

  it("throws on a negative or NaN band too — the same class of caller error", () => {
    expect(() => geometry(CARD, -1, 2, 1, "band")).toThrow(/geometry\(\)/);
    expect(() => geometry(CARD, Number.NaN, 2, 1, "band")).toThrow(/geometry\(\)/);
  });
});
