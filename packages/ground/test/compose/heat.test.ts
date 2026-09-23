// @vitest-environment node
// The §7 overlap heat's pure parts (GLOW.md, packs/vf-frame/heat.ts ·
// card/motion.ts · packs/vf-frame/choreography.ts · card/layout.ts): the light a
// lifted card casts is the half-plane irradiance through the source's field, the
// record carries the source's silhouette, the pack's uniform SLOTS carry the
// theme's knobs, and the presence is a spring on the drop signal — the
// CardShell's 220 ms ease. The heat is the frame pack's since design-014; the
// engine's motion still runs its presence and its tier.
import { describe, expect, it } from "vitest";
import { FRAME_HEAD_BYTES, frameStruct, frameUniformStruct, frameUniformValues, frameValues } from "../../src/card/layout";
import { MOTION_DEFAULTS, newMotion, pinMotion, stepMotion, toMotion, type CardMotion } from "../../src/card/motion";
import {
  HEAT, MATERIAL, PRODUCT, VF_EXT, VF_REST, VF_UNIFORMS,
  heatValues, irradiance, overlaps, resolve, sourceOf, vfSectionOf, vfUniformValues,
} from "../../src/packs/vf-frame";
import { LIFT } from "../../src/theme";
import { THEMES } from "../../oracle/fixtures/vf-theme";

// both structs are BUILT per card program since design-014; these are the vf-frame pack's
const Frame = frameStruct(VF_EXT);
const FrameUniforms = frameUniformStruct(VF_UNIFORMS);

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
  it("the source is the lifted card's OUTER silhouette as drawn — the content scaled by the lift; the shell is un-revealed", () => {
    const rect = { centre: [100, 50] as const, contentHalf: [75, 45] as const, radius: 14 };
    const S = sourceOf(resolve(PRODUCT, rect, { ...VF_REST, reveal: 0, held: 1, lift: LIFT.scale }, MATERIAL));
    expect(S).toEqual({ x: 100, y: 50, hx: 75 * LIFT.scale, hy: 45 * LIFT.scale, r: 14 * LIFT.scale });
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);   // touching is not overlapping
  });
});

describe("heat — the record and the uniforms", () => {
  const rect = { centre: [100, 50] as const, contentHalf: [64, 32] as const, radius: 12 };
  const G = resolve(PRODUCT, rect, { ...VF_REST, hot: 0.5, hotTier: 1, hotAt: [120, 60], hotHalf: [40, 20], hotR: 7 }, MATERIAL);
  it("resolve passes the heat through, clamped; REST is cold", () => {
    expect(G.hot).toEqual([120, 60, 0.5, 1]); expect(G.src).toEqual([40, 20, 7, 0]);
    expect(resolve(PRODUCT, rect).hot).toEqual([0, 0, 0, 0]); expect(resolve(PRODUCT, rect).src).toEqual([0, 0, 0, 0]);
    expect(resolve(PRODUCT, rect, { ...VF_REST, hot: 3, hotTier: -1 }).hot.slice(2)).toEqual([1, 0]);
  });
  it("the record carries `hot` and `src` as the HEAD's last two vec4s; the pack's uniform slots carry the two colours and the two knob vectors", () => {
    expect(frameValues(G, [0, 0, 0]).hot).toEqual([120, 60, 0.5, 1]); expect(frameValues(G, [0, 0, 0]).src).toEqual([40, 20, 7, 0]);
    expect(Frame.slots.hot.type).toBe("vec4f"); expect(Frame.slots.src.type).toBe("vec4f");
    // the two vec4s are the head's last 32 B (128 → 160 since the pane's face joined the head, 2026-09-23), and the pack's tail slots follow
    expect(FRAME_HEAD_BYTES).toBe(160);
    expect(Frame.slots.hot.byte).toBe(FRAME_HEAD_BYTES - 32); expect(Frame.slots.src.byte).toBe(FRAME_HEAD_BYTES - 16);
    expect(Frame.size).toBe(FRAME_HEAD_BYTES + 16 * VF_EXT);
    // the heat's four vectors left the uniform HEAD for the pack's `uext`: slots 8..11
    const t = vfSectionOf(THEMES.dark);
    const uext = vfUniformValues(t, HEAT);
    expect(FrameUniforms.slots.uext.type).toBe(`array<vec4f, ${VF_UNIFORMS}>`);
    expect(uext).toHaveLength(4 * VF_UNIFORMS);
    expect(uext.slice(40, 44)).toEqual([30, 0.25, 0.5, 0]);         // glowK: the height, α reject, α accept
    expect(uext.slice(44, 48)).toEqual([1.5, 0.55, 0.85, 0]);       // rimK: width, α reject, α accept
    expect(uext.slice(32, 36)).toEqual([...t.glow, 1]); expect(uext.slice(36, 40)).toEqual([...t.rim, 1]);
    // and they reach the block through the program's slots, never the head
    const u = frameUniformValues({ camX: 0, camY: 0, zoom: 1, dpr: 2, width: 100, height: 100 }, THEMES.dark, false, undefined, undefined, uext);
    expect(u.uext).toBe(uext);
    expect(frameUniformValues({ camX: 0, camY: 0, zoom: 1, dpr: 2, width: 100, height: 100 }, THEMES.dark, false)).not.toHaveProperty("uext");
    expect(heatValues(vfSectionOf(THEMES.light), { ...HEAT, height: 10 }).glowK).toEqual([10, 0.25, 0.5, 0]);
  });
});

describe("heat — the motion", () => {
  // design-014: `stepMotion` runs the ENGINE's springs only — the buttons' and the lock's
  // moved to the pack (`stepVfSprings`, test/compose/card.test.ts), so no button input here.
  const run = (m: CardMotion, seconds: number, dt = 1 / 120) => { let live = false; for (let t = 0; t < seconds; t += dt) live = stepMotion(m, dt); return live; };
  it("presence springs to 1 on the signal in ~210 ms without overshoot, and falls back when it clears with the source held", () => {
    const m = newMotion(); m.hotTarget = true; m.hotTier = 1; m.hotAt = [5, 6]; m.hotHalf = [7, 8]; m.hotR = 9;
    let peak = 0; let at95 = -1; const dt = 1 / 120;
    for (let t = 0; t < 0.6; t += dt) { stepMotion(m, dt); peak = Math.max(peak, m.hot); if (at95 < 0 && m.hot >= 0.95) at95 = t + dt; }
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
    expect(stepMotion(m, 1 / 60)).toBe(false);
    expect(m.hot).toBe(1);
  });
});
