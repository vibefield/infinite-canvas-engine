// @vitest-environment node
// The host's pure part: the react `grid` prop onto the field's config, the
// re-tune merge, and a canvas type's declaration onto a slot's config (C2).
import { describe, expect, it } from "vitest";
import { fieldConfigOf, mergeGridConfig, slotFieldConfig } from "../../src/compose/host";
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
  it("a partial re-tune touches only its keys; the magnet block's unmapped keys have no field meaning", () => {
    const f = fieldConfigOf(DEFAULT_FIELD_CONFIG, { magnet: { reach: 80, widgets: false, maxSources: 12, fadeZoom: 0.3 } });
    expect(f).toEqual({ ...DEFAULT_FIELD_CONFIG, reach: 80 });
  });
  it("configureGrid's merge is one level deep on the magnet block", () => {
    const m = mergeGridConfig({ dotAlpha: 0.5, magnet: { reach: 80, glyph: "dot" } }, { magnet: { reach: 40 } });
    expect(m).toEqual({ dotAlpha: 0.5, magnet: { reach: 40, glyph: "dot" } });
    expect(mergeGridConfig({}, {})).toEqual({});
  });
  it("a slot's config is the base, the type's declaration over it, the re-tunes over that — and the base ITSELF with nothing to apply", () => {
    expect(slotFieldConfig(DEFAULT_FIELD_CONFIG, undefined, {})).toBe(DEFAULT_FIELD_CONFIG);
    expect(slotFieldConfig(DEFAULT_FIELD_CONFIG, {}, {})).toBe(DEFAULT_FIELD_CONFIG);
    const declared = slotFieldConfig(DEFAULT_FIELD_CONFIG, { glyph: "line", grid: { dotAlpha: 0.4, magnet: { reach: 90 } } }, {});
    expect(declared).toEqual({ ...DEFAULT_FIELD_CONFIG, glyph: "line", inkAlpha: 0.4, reach: 90 });
    // the react prop's re-tune wins over the type's grid, and never touches the type's glyph unless it names one
    const tuned = slotFieldConfig(DEFAULT_FIELD_CONFIG, { glyph: "line", grid: { dotAlpha: 0.4 } }, { dotAlpha: 0.9, magnet: { reach: 30 } });
    expect(tuned).toEqual({ ...DEFAULT_FIELD_CONFIG, glyph: "line", inkAlpha: 0.9, reach: 30 });
    expect(slotFieldConfig(DEFAULT_FIELD_CONFIG, { glyph: "line" }, { magnet: { glyph: "needle" } }).glyph).toBe("needle");
  });
});
