// @vitest-environment node
// The §7 overlap heat's pure parts (GLOW.md, card/heat.ts · motion.ts ·
// choreography.ts · layout.ts): the light a lifted card casts is the half-plane
// irradiance through the source's field, the record carries the source's
// silhouette, the uniforms carry the theme's knobs, and the presence is a
// spring on the drop signal — the CardShell's 220 ms ease.
import { describe, expect, it } from "vitest";
import { MATERIAL, REST, resolve } from "../../src/card/choreography";
import { heatValues, irradiance, overlaps, sourceOf } from "../../src/card/heat";
import { Frame, FrameUniforms, frameUniformValues, frameValues } from "../../src/card/layout";
import { MOTION_DEFAULTS, newMotion, pinMotion, stepMotion, toMotion, type CardMotion } from "../../src/card/motion";
import { PRODUCT } from "../../src/card/sheet";
import { HEAT, LIFT } from "../../src/theme";
import { THEMES } from "../../oracle/fixtures/vf-theme";

describe("heat — the light", () => {
  it("is the half-plane irradiance: 1 deep under the source, ½ at its silhouette, h²/4d² far away, monotone", () => {
    const h = 30;
    expect(irradiance(-1000, h)).toBeCloseTo(1, 3);
    expect(irradiance(0, h)).toBe(0.5);
    expect(irradiance(1000, h)).toBeCloseTo(0, 3);
    expect(irradiance(300, h)).toBeCloseTo((h * h) / (4 * 300 * 300), 4);
    expect(irradiance(-30, h)).toBeCloseTo(1 - irradiance(30, h), 12);      // symmetric about the edge
    let prev = 2;
    for (let d = -200; d <= 200; d += 5) { const v = irradiance(d, h); expect(v).toBeLessThan(prev); prev = v; }
    // the height is the softness: at d = h the light is ½(1 − 1/√2), whatever h is
    for (const hh of [10, 30, 90]) expect(irradiance(hh, hh)).toBeCloseTo(0.5 * (1 - Math.SQRT1_2), 12);
    expect(irradiance(0, 0)).toBe(0.5);                                         // a zero height is guarded
  });
  it("the source is the lifted card's OUTER silhouette as drawn — lift scale included", () => {
    const rect = { centre: [100, 50] as const, contentHalf: [75, 45] as const, radius: 14 };
    const S = sourceOf(resolve(PRODUCT, rect, { ...REST, reveal: 0, held: 1, lift: LIFT.scale }, MATERIAL));
    expect(S).toEqual({ x: 100, y: 50, hx: 75 * LIFT.scale, hy: 45 * LIFT.scale, r: 14 * LIFT.scale });
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);   // touching is not overlapping
  });
});

describe("heat — the record and the uniforms", () => {
  const rect = { centre: [100, 50] as const, contentHalf: [64, 32] as const, radius: 12 };
  const G = resolve(PRODUCT, rect, { ...REST, hot: 0.5, hotTier: 1, hotAt: [120, 60], hotHalf: [40, 20], hotR: 7 }, MATERIAL);
  it("resolve passes the heat through, clamped; REST is cold", () => {
    expect(G.hot).toEqual([120, 60, 0.5, 1]); expect(G.src).toEqual([40, 20, 7, 0]);
    expect(resolve(PRODUCT, rect).hot).toEqual([0, 0, 0, 0]); expect(resolve(PRODUCT, rect).src).toEqual([0, 0, 0, 0]);
    expect(resolve(PRODUCT, rect, { ...REST, hot: 3, hotTier: -1 }).hot.slice(2)).toEqual([1, 0]);
  });
  it("the record carries `hot` and `src` as two vec4s (256 → 288 B); the uniforms carry the two colours and the two knob vectors", () => {
    expect(frameValues(G, [0, 0, 0]).hot).toEqual([120, 60, 0.5, 1]); expect(frameValues(G, [0, 0, 0]).src).toEqual([40, 20, 7, 0]);
    expect(Frame.slots.hot.type).toBe("vec4f"); expect(Frame.slots.src.type).toBe("vec4f"); expect(Frame.size).toBe(288);
    for (const f of ["colGlow", "colRim", "glowK", "rimK"] as const) expect(FrameUniforms.slots[f].type).toBe("vec4f");
    const u = frameUniformValues({ camX: 0, camY: 0, zoom: 1, dpr: 2, width: 100, height: 100 }, THEMES.dark, false);
    expect(u.glowK).toEqual([30, 0.25, 0.5, 0]);         // the height, α reject, α accept
    expect(u.rimK).toEqual([1.5, 0.55, 0.85, 0]);        // width, α reject, α accept
    expect(u.colGlow).toEqual([...THEMES.dark.glow, 1]); expect(u.colRim).toEqual([...THEMES.dark.rim, 1]);
    expect(heatValues(THEMES.light, { ...HEAT, height: 10 }).glowK).toEqual([10, 0.25, 0.5, 0]);
  });
});

describe("heat — the motion", () => {
  const input = { hoverClose: false, hoverLock: false, pressClose: false, pressLock: false };
  const run = (m: CardMotion, seconds: number, dt = 1 / 120) => { let live = false; for (let t = 0; t < seconds; t += dt) live = stepMotion(m, dt, input); return live; };
  it("presence springs to 1 on the signal in ~210 ms without overshoot, and falls back when it clears with the source held", () => {
    const m = newMotion(); m.hotTarget = true; m.hotTier = 1; m.hotAt = [5, 6]; m.hotHalf = [7, 8]; m.hotR = 9;
    let peak = 0; let at95 = -1; const dt = 1 / 120;
    for (let t = 0; t < 0.6; t += dt) { stepMotion(m, dt, input); peak = Math.max(peak, m.hot); if (at95 < 0 && m.hot >= 0.95) at95 = t + dt; }
    expect(m.hot).toBe(1); expect(peak).toBeLessThanOrEqual(1);
    expect(at95).toBeGreaterThan(0.15); expect(at95).toBeLessThan(0.28);
    expect(toMotion(m)).toMatchObject({ hot: 1, hotTier: 1, hotAt: [5, 6], hotHalf: [7, 8], hotR: 9 });
    m.hotTarget = false;
    expect(run(m, 0.05)).toBe(true);
    run(m, 0.6);
    expect(m.hot).toBe(0); expect(m.hotAt).toEqual([5, 6]); expect(m.hotHalf).toEqual([7, 8]);
  });
  it("the tier snaps while the card is cold and cross-fades while it is warm", () => {
    const m = newMotion(); m.hotTier = 1; run(m, 0.05);
    expect(m.tierK).toBe(1);
    m.hotTarget = true; run(m, 0.6); expect(m.hot).toBe(1);
    m.hotTier = 0; run(m, 0.05);
    expect(m.tierK).toBeGreaterThan(0.3); expect(m.tierK).toBeLessThan(1);
    run(m, 0.6); expect(m.tierK).toBe(0);
    expect(MOTION_DEFAULTS.hotHz).toBe(3.6); expect(MOTION_DEFAULTS.hotDamp).toBe(1);
  });
  it("pinMotion makes a STILL — held = lifted, lit at 1 by a source with its tier — that a step leaves alone", () => {
    const m = pinMotion(newMotion(), { held: true, hot: { x: 1, y: 2, hx: 3, hy: 4, r: 5, tier: 0 } });
    expect(m).toMatchObject({ lift: 1, hot: 1, hotAt: [1, 2], hotHalf: [3, 4], hotR: 5, tierK: 0, hotTier: 0 });
    expect(stepMotion(m, 1 / 60, input)).toBe(false);
    expect(m.hot).toBe(1);
  });
});
