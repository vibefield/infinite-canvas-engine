// @vitest-environment node
// The NIGHT (MAT.md): the physics in src/mat/night.ts against known numbers,
// the theme's night against its rules and its pinned colours, the shader
// against the CPU mirror's constants. No GPU.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAT_CONFIG, MatUniforms, STILL_MAT_FRAME, matUniformValues } from "../../src/mat/layout";
import { D65, DAY_LIGHT, dayLuminance, degreeOfAdaptation, hueTint, lightValues, linear, linearToSrgb, luminance, mesopicWeight, nightAppearance, nightReport, planckianXY, rodSignal, scotopic, spectralXY, xyToLinear } from "../../src/mat/night";
import { MAT, MAT_COLORS, MAT_GRID, MAT_LIGHT, NIGHT, type RGB, rgb } from "../../src/theme";
import { THEMES } from "../../oracle/fixtures/vf-theme.ts";

const ground = resolve(import.meta.dirname, "../..");
const close = (a: number, b: number, eps: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(eps);
const bytes = (c: readonly number[]) => c.map((v) => Math.round(v * 255));
/** A displayed colour's luminance, in linear light. */
const Y = (c: RGB) => luminance(linear(c));

describe("the night's physics", () => {
  it("the Planckian locus (Kang's fit): 6500 K sits just under D65, the locus warms as it cools, every point converts at Y = 1", () => {
    const [x, y] = planckianXY(6500);
    close(x, 0.3135, 2e-3); close(y, 0.3237, 2e-3);
    for (const c of xyToLinear(D65[0], D65[1])) close(c, 1, 2e-3);
    for (const T of [2000, 2856, 4100, 5500, 6500, 10000]) close(luminance(xyToLinear(...planckianXY(T))), 1, 1e-6);
    const moon = xyToLinear(...planckianXY(NIGHT.kelvin));
    expect(moon[0]).toBeGreaterThan(moon[1]); expect(moon[1]).toBeGreaterThan(moon[2]);   // 4100 K: redder than the Sun's D65, not bluer
    const cold = xyToLinear(...planckianXY(10000)); expect(cold[2]).toBeGreaterThan(cold[0]);
    let prev = planckianXY(2000)[0];
    for (const T of [3000, 4000, 5000, 8000, 12000]) { const [xt] = planckianXY(T); expect(xt).toBeLessThan(prev); prev = xt; }
  });

  it("the Purkinje shift: the rods (V′ peaks at 507 nm) keep the greens and blues and lose the reds; white is 1", () => {
    close(rodSignal([1, 1, 1]), 1, 1e-12);
    const rel = (css: string) => { const c = linear(rgb(css)); return rodSignal(c) / luminance(c); };
    expect(rel(MAT.ground.css)).toBeGreaterThan(0.9);      // the sage keeps 95 % of its brightness relative to white
    expect(rel("#ff453a")).toBeLessThan(0.3);              // --vf-red dies
    expect(rel("#ffd60a")).toBeLessThan(0.55);             // --vf-yellow fades
    expect(rel("#4a90d9")).toBeGreaterThan(1.5);           // --vf-select brightens
    expect(rel(MAT.line.css)).toBeLessThan(rel(MAT.ground.css));   // the cream lines lose more than the sage
    expect(scotopic([1, 0, 0])).toBeLessThan(scotopic([0, 0, 1]));
  });

  it("CIE 191's mesopic weight: the rods alone under 0.005 cd/m², the cones alone from 5, a fifth cone at the moonlit sage", () => {
    expect(mesopicWeight(0.005)).toBe(0); expect(mesopicWeight(0.001)).toBe(0);
    close(mesopicWeight(5), 1, 1e-3); expect(mesopicWeight(100)).toBe(1);
    close(mesopicWeight(0.02), 0.2, 0.01);
    for (let L = 0.001; L < 10; L *= 1.5) expect(mesopicWeight(L * 1.5)).toBeGreaterThanOrEqual(mesopicWeight(L));
  });

  it("CIECAM02's degree of adaptation: two thirds by moonlight in a dark surround, the whole surround factor by day", () => {
    close(degreeOfAdaptation(0.02, 0.8), 0.66, 0.01);
    close(degreeOfAdaptation(1000, 0.8), 0.8, 1e-3);
    expect(degreeOfAdaptation(0.02, 1)).toBeGreaterThan(degreeOfAdaptation(0.02, 0.8));
  });

  it("the rods' hue: white at purity 0, a blue past the green at 485 nm, Y = 1 throughout; the locus interpolates and clamps to its reach", () => {
    for (const c of hueTint(485, 0)) close(c, 1, 2e-3);
    const t = hueTint(485, 0.18);
    expect(t[2]).toBeGreaterThan(t[1]); expect(t[1]).toBeGreaterThan(t[0]); close(luminance(t), 1, 1e-6);
    expect(spectralXY(485)).toEqual([0.0687, 0.2007]);
    close(spectralXY(487.5)[0], (0.0687 + 0.0454) / 2, 1e-9);
    expect(spectralXY(400)).toEqual(spectralXY(470)); expect(spectralXY(600)).toEqual(spectralXY(500));
  });

  it("the day's displayed luminance: the reference's chain shows the linearised albedo, so the display decodes it once more", () => {
    close(dayLuminance(MAT_COLORS.ground), luminance(linear(linear(MAT_COLORS.ground))), 1e-12);
    close(dayLuminance(MAT_COLORS.ground), 0.0845, 1e-3);
    expect(bytes(linear(MAT_COLORS.ground))).toEqual([61, 90, 48]);   // the sage on screen by day
  });
});

describe("the theme's night", () => {
  const L = MAT_LIGHT.dark;
  const sage = linear(MAT_COLORS.ground);
  const cream = linear(MAT_COLORS.line);

  it("is the dark theme's light; the light theme's is the day, and the day is inert", () => {
    expect(THEMES.dark.matLight).toBe(L); expect(THEMES.light.matLight).toBe(DAY_LIGHT);
    expect(L.night).toBe(1); expect(DAY_LIGHT.night).toBe(0);
    expect(lightValues(DAY_LIGHT).night).toEqual([0, 0, 0, 0]);
  });

  it("the Moon as the eye takes it: warm, discounted by CIECAM02's D at the moonlit sage; the lux, the sky's share, the snow and Eigengrau are the theme's", () => {
    expect(L.moon[0]).toBeGreaterThan(1); expect(L.moon[2]).toBeLessThan(1);
    const raw = xyToLinear(...planckianXY(NIGHT.kelvin));
    const D = degreeOfAdaptation((NIGHT.lux * luminance(sage)) / Math.PI, NIGHT.surround);
    close(D, 0.66, 0.01);
    for (const i of [0, 1, 2] as const) close(L.moon[i], 1 + (1 - D) * (raw[i] - 1), 1e-12);
    expect(L.fill).toBe(NIGHT.fill); expect(L.lux).toBe(NIGHT.lux); expect(L.snow).toBe(NIGHT.snow);
    expect(L.eigengrau).toEqual(linear(rgb(NIGHT.eigengrau.css)));
    expect(bytes(L.eigengrau.map(linearToSrgb))).toEqual([22, 22, 29]);
    close(luminance(L.eigengrau) / luminance(linear(THEMES.dark.canvasBg)), 1, 0.05);   // the dark's own grey sits at the dark ground's luminance
  });

  it("the one scale: the moonlit sage is displayed at half the sunlit sage's luminance, Eigengrau included", () => {
    close(Y(nightAppearance(L, sage, 1)), NIGHT.litOverDay * dayLuminance(MAT_COLORS.ground), 1e-6);
  });

  it("what the green becomes: a slate blue-green in the Moon, a colourless blue-grey in the shadow (the rods alone), never under Eigengrau", () => {
    const lit = nightAppearance(L, sage, 1);
    const sh = nightAppearance(L, sage, L.fill);
    expect(bytes(lit)).toEqual([49, 60, 64]);
    expect(bytes(sh)).toEqual([28, 32, 39]);
    // in the shadow the mesopic weight is 0: the report is the rods' hue and nothing else
    const rep = nightReport(L, sage, L.fill);
    const k = rep[0] / L.rod[0];
    for (const i of [0, 1, 2] as const) close(rep[i], k * L.rod[i], 1e-12);
    close(mesopicWeight((L.lux * luminance([sage[0] * L.moon[0] * L.fill, sage[1] * L.moon[1] * L.fill, sage[2] * L.moon[2] * L.fill])) / Math.PI), 0, 1e-12);
    // the Purkinje story in one number: the green survives in the light, goes in the shadow
    const green = (c: RGB) => (c[1] - c[0]) / (c[2] - c[0]);
    expect(green(lit)).toBeGreaterThan(green(sh));
    for (const i of [0, 1, 2] as const) expect(sh[i]).toBeGreaterThanOrEqual(linearToSrgb(L.eigengrau[i]) - 1e-9);
    expect(Y(sh)).toBeLessThan(Y(lit));
  });

  it("the cream lines: pale grey with a trace of warmth in the Moon; their contrast over the sage is a third of the day's", () => {
    const lit = nightAppearance(L, cream, 1);
    expect(bytes(lit)).toEqual([76, 82, 84]);
    const night = Y(lit) / Y(nightAppearance(L, sage, 1));
    const day = dayLuminance(MAT_COLORS.line) / dayLuminance(MAT_COLORS.ground);
    expect(night).toBeLessThan(day / 2);
    expect(night).toBeGreaterThan(1.5);   // still lines
  });

  it("packs into MatUniforms by name, the day's default inert, and the shader carries the same constants and the day's exact exit", () => {
    const view = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
    const u = matUniformValues(view, [10, 20], DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, MAT_GRID.gobo.plates.c.strength, undefined, L);
    expect(u.night).toEqual([1, L.lux, L.exposure, L.snow]);
    expect(u.moon).toEqual([...L.moon, L.fill]);
    expect(u.rod.slice(0, 3)).toEqual([...L.rod]);
    expect(u.eigengrau.slice(0, 3)).toEqual([...L.eigengrau]);
    expect(() => MatUniforms.alloc(1).set(u)).not.toThrow();
    expect(matUniformValues(view, [10, 20], DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, 1).night).toEqual([0, 0, 0, 0]);
    const wgsl = readFileSync(join(ground, "shaders/mat/mat.wgsl"), "utf8");
    for (const k of ["0.767 + 0.3334", "1.33 * (1.0 + (Y + Z)", "- 1.68", "0.3183098862", "0.4342944819", "0.0031308"]) expect(wgsl).toContain(k);
    expect(wgsl).toContain("if (u.night.x <= 0.0) { return shade_mat(u, albedo, gobo); }");
    expect(readFileSync(join(ground, "shaders/mat/mat-pass.wgsl"), "utf8")).toContain("mat_colour(u, albedo, gobo, bn.y)");
  });
});
