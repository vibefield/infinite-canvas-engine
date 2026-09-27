/**
 * The dev panel's params (D5a — the prototype's lab/params.ts on the desk): "reset IS the product" as a checkable claim — every
 * default projects to exactly what the desk draws with untouched (the mat's config and its rulers, the Moon, the mini mat's law,
 * the springs, core's nav settings) — and the snapshot's restore and reset keep their promises: a stale version is dropped,
 * unknown keys and mis-shaped arrays never land, colours merge by role, and a reset puts the numbers back IN PLACE (the layer's
 * builder holds the springs object). K1: the product is the engine's grid with the rulers PRINTED (`DESK_GRID`, the grid `App.tsx`
 * mounts), a snapshot saved before that default (version 1) is dropped, and the panel APPLIES itself at install — its saved desk or
 * the product — driven here through its DOM-free binding.
 */
import { NAV_TRANSITION_DEFAULTS, NavTransitionSettings, ZOOM_THROUGH_DEFAULTS } from "@ice/core";
import { DEFAULT_MAT_CONFIG, type DeskLayerHandle, GRID, type MatConfig, SPRINGS, type ThemeName } from "@ice/desk";
import { MAT_LIGHT, MINIMAT, themeFrom } from "@ice/desk";
import { PALETTE } from "@ice/desk/oracle/fixtures/vf-theme";
import { describe, expect, it } from "vitest";
import { createDeskEngine } from "../src/desk";
import { bindDeskParams, type ParamStore } from "../src/panel/panel";
import { DESK_GRID, defaultParams, matConfigOf, PARAMS_VERSION, resetParams, restoreParams, snapshotParams, themeWith } from "../src/panel/params";

describe("the dev panel's defaults are the product", () => {
  it("the product's grid is the engine's with the rulers printed — and the engine's own default still prints none", () => {
    expect(DESK_GRID.mat).toEqual({ ...DEFAULT_MAT_CONFIG, ruler: { ...DEFAULT_MAT_CONFIG.ruler, on: true } });
    expect(DESK_GRID.fadeIn).toEqual(GRID.fadeIn);
    expect(DEFAULT_MAT_CONFIG.ruler.on).toBe(false);
  });

  it("each projects to exactly what the desk draws with untouched", () => {
    const p = defaultParams();
    expect(matConfigOf(p.mat, p.ruler)).toEqual(DESK_GRID.mat);
    expect(p.ruler.on).toBe(true);
    expect(p.grid.fadeIn).toEqual(DESK_GRID.fadeIn);
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
    tweaked.ruler.on = false;
    tweaked.colors.dark.select = [1, 0, 0];
    const saved = JSON.parse(snapshotParams(tweaked));
    const back = restoreParams(saved);
    expect(back.minimat.margin).toBe(48);
    expect(back.ruler.on).toBe(false);
    expect(back.colors.dark.select).toEqual([1, 0, 0]);
    expect(restoreParams({ ...saved, version: PARAMS_VERSION + 1 }).minimat.margin).toBe(MINIMAT.margin);
    const hostile = restoreParams({ ...saved, nope: 1, grid: { fadeIn: [1, 2, 3] }, mat: { thin: "wide" }, colors: { light: { canvasBg: [0, 0] } } });
    expect("nope" in hostile).toBe(false);
    expect(hostile.grid.fadeIn).toEqual(defaultParams().grid.fadeIn);
    expect(hostile.mat.thin).toBe(defaultParams().mat.thin);
    expect(hostile.colors.light.canvasBg).toBeUndefined();
  });

  it("a snapshot saved under version 1 — when the rulers' default was off — is dropped: they print", () => {
    const v1 = { ...JSON.parse(snapshotParams(defaultParams())), version: 1, ruler: { ...defaultParams().ruler, on: false } };
    expect(restoreParams(v1).ruler.on).toBe(true);
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

describe("the dev panel applies itself at install (K1)", () => {
  const KEY = "ice-desk-panel";
  /** The panel bound over a real desk engine, a handle that records the mats it is configured with, and a store double. */
  function install(saved?: unknown) {
    const mats: Partial<MatConfig>[] = [];
    const handle = { configureMat: (m: Partial<MatConfig>) => mats.push(m), configureFadeIn: () => {}, tuneLaw: () => {}, setPortals: () => {} } as unknown as DeskLayerHandle;
    const kept = new Map<string, string>(saved === undefined ? [] : [[KEY, JSON.stringify(saved)]]);
    const store: ParamStore = { read: (k) => (kept.has(k) ? JSON.parse(kept.get(k) as string) : null), write: (k, v) => { kept.set(k, v); }, clear: (k) => { kept.delete(k); } };
    const engine = createDeskEngine(undefined, []);
    const theme = { name: (): ThemeName => "light", set: () => {}, apply: () => {} };
    const params = defaultParams();
    const bound = bindDeskParams({ engine, handle, params, theme, storageKey: KEY }, store);
    return { mats, kept, engine, params, bound };
  }

  it("nothing saved: the product is projected before the first frame — the rulers printed — and nothing is kept", () => {
    const { mats, kept, engine, bound } = install();
    expect(mats).toHaveLength(1);
    expect(mats[0]).toEqual(DESK_GRID.mat);
    expect(engine.world.getResource(NavTransitionSettings)?.responseMs).toBe(NAV_TRANSITION_DEFAULTS.responseMs);
    expect(bound.touched).toBe(false);
    expect(kept.size).toBe(0);
    engine.dispose();
  });

  it("a saved desk takes effect on a fresh boot: its rulers off are what the desk is configured with", () => {
    const off = defaultParams();
    off.ruler.on = false;
    const { mats, kept, params, engine, bound } = install(JSON.parse(snapshotParams(off)));
    expect(params.ruler.on).toBe(false);
    expect(mats.at(-1)?.ruler?.on).toBe(false);
    expect(bound.touched).toBe(true);
    expect(JSON.parse(kept.get(KEY) as string).ruler.on).toBe(false);
    engine.dispose();
  });

  it("a snapshot a version bump dropped is cleared, and the product projected in its place", () => {
    const { mats, kept, engine, bound } = install({ ...JSON.parse(snapshotParams(defaultParams())), version: 1, ruler: { ...defaultParams().ruler, on: false } });
    expect(mats.at(-1)).toEqual(DESK_GRID.mat);
    expect(bound.touched).toBe(false);
    expect(kept.has(KEY)).toBe(false);
    engine.dispose();
  });
});
