import { describe, expect, it } from "vitest";
import { fboPixelSize, isOutOfBand, selectBand, ZOOM_BANDS } from "../src/zoom-bands";

describe("ZoomBands (ported v1 suite)", () => {
  describe("selectBand", () => {
    it("clamps below the smallest band to the smallest band", () => {
      expect(selectBand(0.001)).toBe(ZOOM_BANDS[0]);
      expect(selectBand(0.01)).toBe(ZOOM_BANDS[0]);
    });

    it("clamps above the largest band to the largest band", () => {
      expect(selectBand(100)).toBe(16);
    });

    it("returns the smallest band ≥ zoom for in-range values", () => {
      expect(selectBand(1)).toBe(1);
      expect(selectBand(1.5)).toBe(2);
      expect(selectBand(0.4)).toBe(0.5);
      expect(selectBand(2.1)).toBe(4);
      expect(selectBand(8)).toBe(8);
    });

    it("returns the same band when called with the band value itself", () => {
      for (const b of ZOOM_BANDS) {
        expect(selectBand(b)).toBe(b);
      }
    });
  });

  describe("isOutOfBand", () => {
    it("returns false when paintedBand is unset (≤ 0)", () => {
      expect(isOutOfBand(1, 0)).toBe(false);
      expect(isOutOfBand(5, -1)).toBe(false);
    });

    it("returns false within the [band × 0.5, band × 2] tolerance window", () => {
      expect(isOutOfBand(1, 1)).toBe(false);
      expect(isOutOfBand(1.99, 1)).toBe(false);
      expect(isOutOfBand(0.51, 1)).toBe(false);
      expect(isOutOfBand(2, 1)).toBe(false); // exactly at edge
      expect(isOutOfBand(0.5, 1)).toBe(false); // exactly at edge
    });

    it("returns true outside the tolerance window", () => {
      expect(isOutOfBand(2.01, 1)).toBe(true);
      expect(isOutOfBand(0.49, 1)).toBe(true);
      expect(isOutOfBand(8, 1)).toBe(true);
      expect(isOutOfBand(0.1, 1)).toBe(true);
    });
  });

  describe("fboPixelSize", () => {
    it("is bounds × dpr × band, rounded, min 1px", () => {
      expect(fboPixelSize(200, 100, 2, 0.5)).toEqual({ width: 200, height: 100 });
      expect(fboPixelSize(0.1, 0.1, 1, 0.0625)).toEqual({ width: 1, height: 1 });
    });
  });
});
