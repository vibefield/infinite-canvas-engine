// @vitest-environment node
// The compose layer's pure part: the react `grid` prop onto the field's config.
import { describe, expect, it } from "vitest";
import { fieldConfigOf } from "../../src/compose/host";
import { DEFAULT_FIELD_CONFIG } from "../../src/field/layout";

describe("groundCompose · configureGrid", () => {
  it("maps what maps — the magnet block, the ink, its alpha — and leaves the rest of the field alone", () => {
    const f = fieldConfigOf(DEFAULT_FIELD_CONFIG, { magnet: { glyph: "dot", reach: 90, polarity: -1, alwaysAlign: true, needleLength: 7, needleWidth: 0.4 }, dotColor: [0.1, 0.2, 0.3], dotAlpha: 0.5 });
    expect(f.glyph).toBe("dot"); expect(f.reach).toBe(90); expect(f.polarity).toBe(-1); expect(f.alwaysAlign).toBe(true);
    expect(f.halfLen).toBe(7); expect(f.halfWidth).toBe(0.4); expect(f.ink).toEqual([0.1, 0.2, 0.3]); expect(f.inkAlpha).toBe(0.5);
    expect(f.fadeIn).toBe(DEFAULT_FIELD_CONFIG.fadeIn); expect(f.mat).toBe(DEFAULT_FIELD_CONFIG.mat); expect(f.dotRadius).toBe(DEFAULT_FIELD_CONFIG.dotRadius);
  });
  it("a partial re-tune touches only its keys; the classic grid's keys have no field meaning", () => {
    const f = fieldConfigOf(DEFAULT_FIELD_CONFIG, { magnet: { reach: 80 }, spacings: [1, 2, 3], fadeOut: [1, 2] });
    expect(f).toEqual({ ...DEFAULT_FIELD_CONFIG, reach: 80 });
  });
});
