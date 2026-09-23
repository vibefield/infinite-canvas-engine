// The lab's parameter set is pure and round-trips: defaults are the product's,
// a style survives tweaks → build → tweaks, and a saved snapshot restores onto
// fresh defaults without letting unknown keys in.
import { describe, expect, it } from "vitest";
import { MOTION_DEFAULTS, SHADOW } from "@ice/ground/compose";
// the frame's style sheet and its theme section are the `vf-frame` pack's (design-014), not the engine's
import { type FrameStyle, PLAIN, PRODUCT, STYLES, styleViolations, vfSectionOf } from "@ice/ground/packs";
import { PRODUCT_GRID, THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { buildStyle, defaultParams, PARAMS_VERSION, restoreParams, snapshotParams, styleTweaksOf, themeWith } from "../src/params";

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
      expect(rebuilt).toEqual({ ...style, name });
    }
    expect(styleTweaksOf(PLAIN, "plain")).toEqual({ base: "plain", band: 10, well: 34, radius: 22, control: 0, clearance: 10, bayClearance: 6, fillet: 0 });
  });

  it("restore merges a snapshot onto fresh defaults, drops unknown keys, keeps colour overrides by role", () => {
    const p = defaultParams();
    p.field.reach = 123; p.style.band = 9; p.motion.revealHz = 4; p.colors.dark.frame = [0.1, 0.2, 0.3]; p.colors.light.hairline = [0, 0, 0, 0.2];
    const back = restoreParams(JSON.parse(snapshotParams(p)));
    expect(back).toEqual(p);
    const messy = restoreParams({ version: PARAMS_VERSION, field: { reach: 77, bogus: 1, dotRadius: [1, 2, 3] }, nonsense: true, colors: { dark: { frame: "red", card: [0.5, 0.5, 0.5] } } });
    expect(messy.field.reach).toBe(77);
    expect(messy.field.dotRadius).toEqual([...PRODUCT_GRID.dotRadius]);   // wrong arity: ignored
    expect((messy as unknown as { nonsense?: boolean }).nonsense).toBeUndefined();
    expect(messy.colors.dark).toEqual({ card: [0.5, 0.5, 0.5] });
    expect(restoreParams(null)).toEqual(defaultParams());
    // a snapshot from before the shell (no version, or an older one) is dropped whole —
    // its notch rows would otherwise resurrect the old geometry
    expect(restoreParams({ field: { reach: 77 }, style: { band: 3.5 } })).toEqual(defaultParams());
    expect(restoreParams({ version: PARAMS_VERSION - 1, field: { reach: 77 } })).toEqual(defaultParams());
  });

  it("the shell's rows build the style directly: the product has its two controls, a control of 0 is a shell without bays", () => {
    const p = defaultParams();
    expect(buildStyle(p.style).control).toBe(32);
    expect(buildStyle(p.style).btn.radius).toBe(16);
    p.style.control = 0;
    expect(buildStyle(p.style).btn.radius).toBe(0);
    expect(styleViolations(buildStyle(p.style), [77.5, 77.5])).toEqual([]);
    p.style.band = 2;
    expect(buildStyle(p.style).band).toBe(2);
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
