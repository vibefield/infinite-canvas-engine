/**
 * The dev panel's params (D5a — the prototype's lab/params.ts on the desk): "reset IS the product" as a checkable claim — every
 * default projects to exactly what the desk draws with untouched (the mat's config and its rulers, the Moon, the mini mat's law,
 * the springs, core's nav settings) — and the snapshot's restore and reset keep their promises: a stale version is dropped,
 * unknown keys and mis-shaped arrays never land, colours merge by role, and a reset puts the numbers back IN PLACE (the layer's
 * builder holds the springs object).
 */
import { NAV_TRANSITION_DEFAULTS, ZOOM_THROUGH_DEFAULTS } from "@ice/core";
import { DEFAULT_MAT_CONFIG, SPRINGS } from "@ice/desk/host";
import { MAT_LIGHT, MINIMAT, themeFrom } from "@ice/desk/theme";
import { PALETTE } from "@ice/desk/oracle/fixtures/vf-theme";
import { describe, expect, it } from "vitest";
import { defaultParams, matConfigOf, PARAMS_VERSION, resetParams, restoreParams, snapshotParams, themeWith } from "../src/panel/params";

describe("the dev panel's defaults are the product", () => {
  it("each projects to exactly what the desk draws with untouched", () => {
    const p = defaultParams();
    expect(matConfigOf(p.mat, p.ruler)).toEqual(DEFAULT_MAT_CONFIG);
    expect(p.minimat).toEqual(MINIMAT);
    expect(p.minimat).not.toBe(MINIMAT); // a copy: the panel never writes the engine's constant
    expect(p.motion).toEqual(SPRINGS);
    expect(p.nav.responseMs).toBe(NAV_TRANSITION_DEFAULTS.responseMs);
    expect([p.nav.throughIn, p.nav.throughOut, p.nav.gate0, p.nav.gate1]).toEqual([ZOOM_THROUGH_DEFAULTS.in, ZOOM_THROUGH_DEFAULTS.out, ...ZOOM_THROUGH_DEFAULTS.gate]);
    expect(p.portal.on).toBe(true);
  });

  it("the Moon from the panel's numbers is the theme's own, and by day nothing is added", () => {
    const p = defaultParams();
    const dark = themeFrom("dark", PALETTE.dark);
    const light = themeFrom("light", PALETTE.light);
    expect(themeWith(dark, p).matLight).toEqual(MAT_LIGHT.dark);
    expect(themeWith(light, p)).toEqual(light);
  });
});

describe("the dev panel's snapshot", () => {
  it("restores over defaults: a stale version is dropped; unknown keys and mis-shaped arrays never land; colours merge by role", () => {
    const tweaked = defaultParams();
    tweaked.minimat.margin = 48;
    tweaked.ruler.on = true;
    tweaked.colors.dark.select = [1, 0, 0];
    const saved = JSON.parse(snapshotParams(tweaked));
    const back = restoreParams(saved);
    expect(back.minimat.margin).toBe(48);
    expect(back.ruler.on).toBe(true);
    expect(back.colors.dark.select).toEqual([1, 0, 0]);
    expect(restoreParams({ ...saved, version: PARAMS_VERSION + 1 }).minimat.margin).toBe(MINIMAT.margin);
    const hostile = restoreParams({ ...saved, nope: 1, grid: { fadeIn: [1, 2, 3] }, mat: { thin: "wide" }, colors: { light: { canvasBg: [0, 0] } } });
    expect("nope" in hostile).toBe(false);
    expect(hostile.grid.fadeIn).toEqual(defaultParams().grid.fadeIn);
    expect(hostile.mat.thin).toBe(defaultParams().mat.thin);
    expect(hostile.colors.light.canvasBg).toBeUndefined();
  });

  it("a reset puts the product back IN PLACE — the springs object the layer's builder holds stays that object", () => {
    const p = defaultParams();
    const springs = p.motion;
    p.motion.liftHz = 11;
    p.minimat.margin = 60;
    p.colors.light.canvasBg = [0, 0, 1];
    const r = resetParams(p);
    expect(r).toBe(p);
    expect(p.motion).toBe(springs);
    expect(p.motion).toEqual(SPRINGS);
    expect(p.minimat.margin).toBe(MINIMAT.margin);
    expect(p.colors).toEqual({ dark: {}, light: {} });
    expect(snapshotParams(p)).toBe(snapshotParams(defaultParams()));
  });
});
