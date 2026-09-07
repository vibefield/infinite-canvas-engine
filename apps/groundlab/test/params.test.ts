// The lab's parameter set is pure and round-trips: defaults are the product's,
// a style survives tweaks → build → tweaks, and a saved snapshot restores onto
// fresh defaults without letting unknown keys in.
import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS, SHADOW } from "@ice/ground/compose";
// the frame's style sheet and its theme section are the `vf-frame` pack's (design-014), not the engine's
import { type FrameStyle, PRODUCT, REFERENCE, STYLES, styleViolations, vfSectionOf } from "@ice/ground/packs";
import { PRODUCT_GRID, THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { buildStyle, composeTweaks, defaultParams, PARAMS_VERSION, restoreParams, snapshotParams, styleTweaksOf, themeWith } from "../src/params";

describe("lab params", () => {
  it("defaults are the product: grid, presets, rung mode, style, springs, material", () => {
    const p = defaultParams();
    expect(p.field.reach).toBe(PRODUCT_GRID.reach);
    expect(p.field.dotRadius).toEqual([...PRODUCT_GRID.dotRadius]);
    expect(p.field.fadeIn).toEqual([...PRODUCT_GRID.fadeIn]);
    expect(p.motion).toEqual(MOTION_DEFAULTS);
    expect(p.material.shadow).toEqual(SHADOW);
    expect(buildStyle(p.style)).toEqual({ ...PRODUCT, name: "product" });
    expect(styleViolations(buildStyle(p.style), [120, 70])).toEqual([]);
  });

  it("a style round-trips through its tweaks for every shipped base", () => {
    for (const [name, style] of Object.entries(STYLES) as [keyof typeof STYLES, FrameStyle][]) {
      const rebuilt = buildStyle(styleTweaksOf(style, name));
      // the panel edits one number per row: corners collapse to TL's value, the BR shelf keeps its own
      expect(rebuilt.thickness).toBe(style.thickness);
      expect(rebuilt.nw[2]).toBe(style.nw[2]);
      expect(rebuilt.rfV[2]).toBe(style.rfV[2]);
      expect(rebuilt.btn).toEqual({ ...style.btn, insetY: style.btn.insetX });
    }
    expect(buildStyle(styleTweaksOf(REFERENCE, "reference")).nw).toEqual([100.91, 100.91, 515.77, 100.91]);
  });

  it("restore merges a snapshot onto fresh defaults, drops unknown keys, keeps colour overrides by role", () => {
    const p = defaultParams();
    p.field.reach = 123; p.style.thickness = 9; p.motion.revealHz = 4; p.colors.dark.frame = [0.1, 0.2, 0.3]; p.colors.light.hairline = [0, 0, 0, 0.2];
    const back = restoreParams(JSON.parse(snapshotParams(p)));
    expect(back).toEqual(p);
    const messy = restoreParams({ version: PARAMS_VERSION, field: { reach: 77, bogus: 1, dotRadius: [1, 2, 3] }, nonsense: true, colors: { dark: { frame: "red", card: [0.5, 0.5, 0.5] } } });
    expect(messy.field.reach).toBe(77);
    expect(messy.field.dotRadius).toEqual([...PRODUCT_GRID.dotRadius]);   // wrong arity: ignored
    expect((messy as unknown as { nonsense?: boolean }).nonsense).toBeUndefined();
    expect(messy.colors.dark).toEqual({ card: [0.5, 0.5, 0.5] });
    expect(restoreParams(null)).toEqual(defaultParams());
    // a snapshot from before the composition (no version, or an older one) is dropped whole —
    // its raw style rows would otherwise resurrect the old geometry
    expect(restoreParams({ field: { reach: 77 }, style: { thickness: 3.5 } })).toEqual(defaultParams());
    expect(restoreParams({ version: PARAMS_VERSION - 1, field: { reach: 77 } })).toEqual(defaultParams());
  });

  it("the composition rows regenerate the raw rows; a raw edit leaves the composition behind", () => {
    const p = defaultParams();
    p.style.corner.control = 30; p.style = composeTweaks(p.style);
    expect(p.style.btnRadius).toBe(15);
    expect(p.style.outerR).toBe(15 + p.style.corner.clearance);
    expect(p.style.btnInset).toBe(p.style.outerR);
    expect(p.style.rho).toBe(p.style.outerR);          // uniform ring: bay arc = ear
    expect(p.style.rfH).toBe(p.style.outerR - p.style.thickness);   // tangent fillet
    expect(styleViolations(buildStyle(p.style), [77.5, 77.5])).toEqual([]);
    p.style.thickness = 2;                               // raw edit: the effective style follows, the composition does not
    expect(buildStyle(p.style).thickness).toBe(2);
    expect(p.style.corner.thickness).toBe(8);
  });

  it("colour overrides land in the right home — the head's on the head, the frame's in its pack's section", () => {
    const t = themeWith("dark", { dark: { frame: [1, 0, 0], canvasBg: [0, 1, 0] }, light: {} });
    expect(vfSectionOf(t).frame).toEqual([1, 0, 0]);
    expect(vfSectionOf(t).ink).toEqual(vfSectionOf(THEMES.dark).ink);   // the rest of the section is untouched
    expect(t.canvasBg).toEqual([0, 1, 0]);
    expect(t.card).toEqual(THEMES.dark.card);
    expect(themeWith("light", { dark: { frame: [1, 0, 0] }, light: {} })).toEqual(THEMES.light);
  });
});
