// @vitest-environment node
// The compose layer's pure part: the react `grid` prop onto the field's config.
import { describe, expect, it } from "vitest";
import { fieldConfigOf } from "../../src/compose/host";
import { DEFAULT_FIELD_CONFIG } from "../../src/field/layout";
import { DEFAULT_MAT_CONFIG, matConfigOf, withMat } from "../../src/packs/mat";

describe("groundCompose · configureGrid", () => {
  it("maps what maps — the magnet block, the ink, its alpha — and leaves the rest of the field alone", () => {
    // a grid PROGRAM's own config rides `ext` since design-014; the mat's must come through untouched
    const base = withMat(DEFAULT_FIELD_CONFIG, DEFAULT_MAT_CONFIG);
    const f = fieldConfigOf(base, { magnet: { glyph: "dot", reach: 90, polarity: -1, alwaysAlign: true, needleLength: 7, needleWidth: 0.4 }, dotColor: [0.1, 0.2, 0.3], dotAlpha: 0.5 });
    expect(f.glyph).toBe("dot"); expect(f.reach).toBe(90); expect(f.polarity).toBe(-1); expect(f.alwaysAlign).toBe(true);
    expect(f.halfLen).toBe(7); expect(f.halfWidth).toBe(0.4); expect(f.ink).toEqual([0.1, 0.2, 0.3]); expect(f.inkAlpha).toBe(0.5);
    expect(f.fadeIn).toBe(base.fadeIn); expect(matConfigOf(f)).toBe(DEFAULT_MAT_CONFIG); expect(f.dotRadius).toBe(base.dotRadius);
  });
  it("a partial re-tune touches only its keys; the classic grid's keys have no field meaning", () => {
    const f = fieldConfigOf(DEFAULT_FIELD_CONFIG, { magnet: { reach: 80 }, spacings: [1, 2, 3], fadeOut: [1, 2] });
    expect(f).toEqual({ ...DEFAULT_FIELD_CONFIG, reach: 80 });
  });
});
