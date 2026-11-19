// SOFT LIGHT and the night's two numbers (petition I56), the pure half: the shade's arithmetic, what the mat's block
// carries for a config, the night's contrast exponent and its `fromDay` step against known numbers — and that a host
// which states none of them gets the block, the light and the night it always got. No GPU; the pixels are
// soft-light.dawn.test.ts's.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAT_CONFIG, type MatConfig, MatUniforms, STILL_MAT_FRAME, matUniformValues } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { DAY_LIGHT, lightValues, linear, linearToSrgb, luminance, matNightAlbedo, mixLight, nightAppearance, nightScale, type NightSpec } from "../src/mat/night";
import { SOFT_LIGHT, softShade, softValues } from "../src/mat/soft";
import { resetLightText } from "../src/light-text";
import { lightText, setLightText, shaderText, SOFT_LIGHT_NAMES, softLightWgsl } from "../src/shaders";
import { WGSL } from "../src/shaders.gen";
import { fakeDevice, installGpuFlags } from "./fake-gpu";
import { EIGENGRAU, MAT_COLORS, MAT_GRID, MAT_LIGHT, NIGHT, nightLight, type RGB } from "../src/theme";

const close = (a: number, b: number, eps: number) => expect(Math.abs(a - b), `${a} against ${b}`).toBeLessThan(eps);
const bytes = (c: RGB) => c.map((v) => Math.round(v * 255));
const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
const STRENGTH = MAT_GRID.gobo.plates.c.strength;
const soft = (more: Partial<MatConfig["gobo"]> = {}): MatConfig => ({ ...DEFAULT_MAT_CONFIG, gobo: { ...DEFAULT_MAT_CONFIG.gobo, model: "soft", ...more } });

/** The gentler night as a host states it (the numbers VibeField tuned for petition I56): the scale and the adaptation stated. */
const GENTLE: NightSpec = {
  kelvin: 4100, lux: 0.74, fill: 0.5, rodHue: { nm: 485, purity: 0.2 }, eigengrau: EIGENGRAU, litLuminance: 0, snow: 4 / 255, surround: 0.8,
  contrast: 0.855, fromDay: 1, exposure: 0.42, adaptation: 0.85,
};

describe("soft light's shade", () => {
  it("is the depth on the display, raised into the chain's light", () => {
    for (const d of [0.55, 0.7, 0.9]) for (const v of softShade(d, 0, 0)) close(v, d ** 2.2, 1e-12);
  });

  it("the sky's pull changes the hue and keeps the luminance; the Sun's lift is divided out of each channel", () => {
    for (const s of [0.2, 0.6, 1]) {
      const c = softShade(0.7, s, 0);
      close(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 0.7 ** 2.2, 1e-12);
      expect(c[2]).toBeGreaterThan(c[1]); expect(c[1]).toBeGreaterThan(c[0]);   // cooler: blue over green over red
    }
    const plain = softShade(0.7, 0.2, 0);
    const lifted = softShade(0.7, 0.2, 0.12);
    close(plain[0] / lifted[0], 1.12, 1e-12); close(plain[1] / lifted[1], 1 + 0.12 * 0.74, 1e-12); close(plain[2] / lifted[2], 1 + 0.12 * 0.34, 1e-12);
  });

  it("the tuned look: two-thirds of lit at its deepest, a little cooler than the ground", () => {
    expect(SOFT_LIGHT.shade).toEqual(softShade(0.7, 0.2, 0.12));
    const display = SOFT_LIGHT.shade.map((v) => v ** (1 / 2.2));
    // in thousandths of lit
    close((display[0] as number) * 1000, 654, 1); close((display[1] as number) * 1000, 675, 1); close((display[2] as number) * 1000, 707, 1);
    expect(SOFT_LIGHT.near.opacity).toBeLessThan(1);   // neither layer alone reaches the full shade: where they cross is the darkest place
    expect(SOFT_LIGHT.far.span).toBeGreaterThan(SOFT_LIGHT.near.span);
    expect(SOFT_LIGHT.far.disc).toBeGreaterThan(SOFT_LIGHT.near.disc);
  });
});

describe("the mat's block", () => {
  it("grows by seven vec4f AT ITS END: every field it had is where it was", () => {
    expect(MatUniforms.slots.presence.byte).toBe(864);
    expect(MatUniforms.slots.soft.byte).toBe(880);
    expect(MatUniforms.slots.night2.byte).toBe(976);
    expect(MatUniforms.size).toBe(992);
    expect(MatUniforms.fields.slice(-7).map(([name]) => name)).toEqual(["soft", "softNear", "softFar", "softDisc", "softShade", "softTilt", "night2"]);
  });

  it("under the defaults — no model, no light — the soft records are zero and the night's second is the identity", () => {
    const u = matUniformValues(VIEW, [10, 20], DEFAULT_MAT_CONFIG, STILL_MAT_FRAME, STRENGTH);
    for (const name of ["soft", "softNear", "softFar", "softDisc", "softShade", "softTilt"] as const) expect(u[name]).toEqual([0, 0, 0, 0]);
    expect(u.night2).toEqual([1, 0, 0, 0]);
    expect(() => MatUniforms.alloc(1).set(u)).not.toThrow();
    // the cone is the model whether unstated or stated, and a frame's tilt does not reach the block under it
    const stated = matUniformValues(VIEW, [10, 20], { ...DEFAULT_MAT_CONFIG, gobo: { ...DEFAULT_MAT_CONFIG.gobo, model: "cone", softLight: SOFT_LIGHT } }, { ...STILL_MAT_FRAME, tilt: [0.4, -0.2] }, STRENGTH);
    expect(stated.soft).toEqual([0, 0, 0, 0]); expect(stated.softTilt).toEqual([0, 0, 0, 0]);
  });

  it("under soft light the records are the config's: SOFT_LIGHT unless a host states its own; the frame's tilt beside the layers' travel", () => {
    const u = matUniformValues(VIEW, [10, 20], soft(), { ...STILL_MAT_FRAME, tilt: [0.4, -0.2] }, STRENGTH);
    expect(u.soft).toEqual([1, 0, SOFT_LIGHT.sway, SOFT_LIGHT.nightDisc]);
    expect(u.softNear).toEqual([0.84, 0.36, 1.15, 0]);
    expect(u.softFar).toEqual([0.1, 0.05, 1.5, 2.5]);
    expect(u.softDisc).toEqual([7.5, 12, 0.9, 0.5]);
    expect(u.softShade).toEqual([...SOFT_LIGHT.shade, 0]);
    expect(u.softTilt).toEqual([0.4, -0.2, 5, 14]);
    const own = { ...SOFT_LIGHT, mirror: true, sway: 0, near: { ...SOFT_LIGHT.near, disc: 15, opacity: 0 } };
    const v = matUniformValues(VIEW, [10, 20], soft({ softLight: own }), STILL_MAT_FRAME, STRENGTH);
    expect(v.soft.slice(0, 3)).toEqual([1, 1, 0]);
    expect(v.softDisc).toEqual([15, 12, 0, 0.5]);
    expect(v.softTilt.slice(0, 2)).toEqual([0, 0]);   // a still carries no tilt
    expect(softValues(true, own, undefined).softTilt).toEqual([0, 0, 5, 14]);
  });
});

describe("the night's two numbers", () => {
  const sage = linear(MAT_COLORS.ground);
  const today = MAT_LIGHT.dark;

  it("a theme that states neither has the light it always had: no new key, the identity in the block, the pinned colours", () => {
    expect(Object.keys(today).sort()).toEqual(["eigengrau", "exposure", "fill", "lux", "moon", "night", "rod", "snow"]);
    expect(lightValues(today).night2).toEqual([1, 0, 0, 0]);
    expect(lightValues(DAY_LIGHT).night2).toEqual([1, 0, 0, 0]);
    expect(nightScale(today, [0.3, 0.3, 0.3])).toBe(today.exposure);
    expect(matNightAlbedo(today, sage)).toBe(sage);
    expect(bytes(nightAppearance(today, sage, 1))).toEqual([49, 60, 64]);
    expect(bytes(nightAppearance(today, sage, today.fill))).toEqual([28, 32, 39]);
    expect(Object.keys(mixLight(today, DAY_LIGHT, 0.5)).sort()).toEqual(Object.keys(today).sort());
  });

  it("today's night on paper, the numbers the gentler one answers: a shadowed white sheet is darker than the lit mat", () => {
    const sheet = linear([0.955, 0.948, 0.925]);
    expect(bytes(nightAppearance(today, sheet, 1))).toEqual([84, 93, 98]);
    expect(bytes(nightAppearance(today, sheet, today.fill))).toEqual([38, 45, 52]);
    expect(today.fill).toBe(NIGHT.fill);
  });

  it("a stated exposure and adaptation are used as they are, and the two numbers ride the light", () => {
    const L = nightLight(GENTLE, MAT_COLORS.ground);
    expect(L.exposure).toBe(0.42); expect(L.contrast).toBe(0.855); expect(L.fromDay).toBe(1); expect(L.fill).toBe(0.5);
    close(L.moon[0], 1.05835, 1e-4); close(L.moon[2], 0.93377, 1e-4);   // the Moon discounted by D = 0.85, not by CIECAM02's 0.66
    expect(lightValues(L).night2).toEqual([0.855, 1, 0, 0]);
  });

  it("the gentler night: one scale for the mat and for paper, and a shadow that keeps half the light", () => {
    const L = nightLight(GENTLE, MAT_COLORS.ground);
    const mat = matNightAlbedo(L, sage);
    for (const i of [0, 1, 2] as const) close(mat[i], sage[i] ** 2.2, 1e-12);   // the mat's night from what its day shows
    expect(bytes(nightAppearance(L, mat, 1))).toEqual([52, 69, 72]);
    expect(bytes(nightAppearance(L, mat, L.fill))).toEqual([41, 53, 59]);
    const sheet = linear([0.955, 0.948, 0.925]);   // a kind hands its own linear albedo: no further step
    const lit = nightAppearance(L, sheet, 1);
    const shade = nightAppearance(L, sheet, L.fill);
    expect(bytes(lit)).toEqual([154, 168, 172]);
    expect(bytes(shade)).toEqual([115, 129, 135]);
    expect(bytes(nightAppearance(L, linear([0.965, 0.906, 0.663]), 1))).toEqual([150, 155, 141]);
    // what was wrong is gone: the shadowed sheet stands well over the lit mat
    const Y = (c: RGB) => luminance(linear(c));
    expect(Y(shade)).toBeGreaterThan(2 * Y(nightAppearance(L, mat, 1)));
    expect(Y(lit) / Y(shade)).toBeLessThan(2);
  });

  it("the fit under both: the lit ground is displayed at the stated luminance, through the mat's own steps", () => {
    const { exposure: _stated, adaptation: _given, ...fit } = GENTLE;
    const L = nightLight({ ...fit, litLuminance: 0.06, snow: 0 }, MAT_COLORS.ground);
    const shown = nightAppearance(L, matNightAlbedo(L, sage), 1);
    close(luminance(linear(shown)), 0.06, 1e-9);
    // and with neither number, the fit is the one the theme always made
    const plain = nightLight({ kelvin: NIGHT.kelvin, lux: NIGHT.lux, fill: NIGHT.fill, rodHue: NIGHT.rodHue, eigengrau: EIGENGRAU, litLuminance: 0.06, snow: 0, surround: NIGHT.surround }, MAT_COLORS.ground);
    close(luminance(linear(nightAppearance(plain, sage, 1))), 0.06, 1e-9);
    expect(linearToSrgb(plain.eigengrau[0])).toBeGreaterThan(0);
  });

  it("the reading light lerps them toward a light that states neither: none is 1 and 0", () => {
    const L = nightLight(GENTLE, MAT_COLORS.ground);
    const m = mixLight(L, DAY_LIGHT, 0.25);
    close(m.contrast as number, 0.855 + (1 - 0.855) * 0.25, 1e-12);
    close(m.fromDay as number, 0.75, 1e-12);
    expect(mixLight(L, DAY_LIGHT, 0)).toBe(L); expect(mixLight(L, DAY_LIGHT, 1)).toBe(DAY_LIGHT);
  });
});

describe("the light's two texts", () => {
  // the page's text is module state: each row starts from a page that has composed nothing (the tests' own door)
  beforeEach(() => resetLightText());
  afterAll(() => resetLightText());
  const count = (text: string, piece: string) => text.split(piece).length - 1;

  it("unasked, the mat's text is mat.wgsl itself: the cone's, token for token, with nothing of soft light in it", () => {
    expect(lightText()).toBe("cone");
    expect(shaderText(MAT_SHADER_FILES).mat).toBe(WGSL["mat/mat.wgsl"]);
    for (const word of ["soft_gobo", "soft_layer", "u.soft", "night2", "cone_"]) expect(WGSL["mat/mat.wgsl"], word).not.toContain(word);
  });

  it("the soft light's text: the cone's four definitions renamed, every other line of mat.wgsl standing, soft.wgsl after it", () => {
    setLightText("soft");
    const text = shaderText(MAT_SHADER_FILES).mat;
    expect(text).toBe(softLightWgsl(WGSL["mat/mat.wgsl"], WGSL["mat/soft.wgsl"]));
    for (const name of SOFT_LIGHT_NAMES) {
      expect(count(text, `\nfn ${name}(`), name).toBe(1);        // the one every caller reaches: soft.wgsl's
      expect(count(text, `\nfn cone_${name}(`), name).toBe(1);   // the cone's own, under its new name
    }
    expect(count(text, "\nfn soft_gobo(")).toBe(1);
    // before soft.wgsl stands the cone's text whole: undo the four renames and it is mat.wgsl, byte for byte
    const soft = WGSL["mat/soft.wgsl"];
    expect(text.endsWith(`\n${soft}`)).toBe(true);
    expect(text.slice(0, text.length - soft.length - 1).replaceAll("\nfn cone_", "\nfn ")).toBe(WGSL["mat/mat.wgsl"]);
    // only the light's file has a second text; the kit's `light` piece is that file, so every kind's program follows
    expect(shaderText(MAT_SHADER_FILES).wind).toBe(WGSL["mat/wind.wgsl"]);
    expect(shaderText({ light: "mat/mat.wgsl" }).light).toBe(text);
    expect(lightText()).toBe("soft");
  });

  it("ONE text per page: once any program composed the light, a change throws and nothing moves; the text in force asked again is a no-op", () => {
    setLightText("soft"); setLightText("cone"); setLightText("soft");   // before anything composed, the choice is free
    shaderText({ wind: "mat/wind.wgsl" });                              // another file composes nothing of the light
    setLightText("cone");
    expect(shaderText({ light: "mat/mat.wgsl" }).light).toBe(WGSL["mat/mat.wgsl"]);
    expect(() => setLightText("soft")).toThrow(/already composed from the "cone" text/);
    expect(lightText()).toBe("cone");
    expect(shaderText(MAT_SHADER_FILES).mat).toBe(WGSL["mat/mat.wgsl"]);
    expect(() => setLightText("cone")).not.toThrow();
    resetLightText();
    setLightText("soft");
    shaderText(MAT_SHADER_FILES);
    expect(() => setLightText("cone")).toThrow(/already composed from the "soft" text/);
    expect(lightText()).toBe("soft");
  });

  it("softLightWgsl refuses a mat that does not define each of the four exactly once", () => {
    expect(() => softLightWgsl("\nfn project_gobo() {}\n", "")).toThrow(/defines shade_mat 0 times/);
    expect(() => softLightWgsl(`${WGSL["mat/mat.wgsl"]}\nfn mat_colour() {}\n`, "")).toThrow(/defines mat_colour 2 times/);
  });
});

describe("the mat pass under each text", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); resetLightText(); });
  beforeEach(() => resetLightText());
  afterEach(() => { vi.restoreAllMocks(); });
  const prepare = (mat: CuttingMat, device: GPUDevice, cfg: MatConfig, goboTime = 0) => { mat.newFrame(); return mat.prepare(device.createCommandEncoder(), VIEW, [10, 20], cfg, { ...STILL_MAT_FRAME, goboTime }); };

  it("the cone's text: one level of the silhouette whatever is asked, no chain, and soft light asked of it is said ONCE", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    prepare(mat, device, DEFAULT_MAT_CONFIG);
    const level0 = mat.silhouette;
    expect(mat.windPasses).toBe(1); expect(mat.chainPasses).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    prepare(mat, device, soft(), 1);
    prepare(mat, device, soft(), 2);
    expect(mat.silhouette).toBe(level0);
    expect(mat.chainPasses).toBe(0);
    expect(mat.viewBytes.slice(MatUniforms.slots.soft.byte, MatUniforms.slots.soft.byte + 16)).toEqual(new Uint8Array(16));   // the block says the cone: every kind agrees with the mat
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/gobo\.model "soft" needs the soft light's text: call setLightText\("soft"\)/);
    // a night that states a contrast or fromDay is told once too, of its own: the cone's text reads neither
    const gentle = nightLight(GENTLE, MAT_COLORS.ground);
    for (const t of [3, 4]) { mat.newFrame(); mat.prepare(device.createCommandEncoder(), VIEW, [10, 20], DEFAULT_MAT_CONFIG, { ...STILL_MAT_FRAME, goboTime: t }, undefined, gentle); }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1]?.[0])).toMatch(/a night's contrast or fromDay needs the soft light's text/);
    mat.dispose();
  });

  it("the soft light's text: the cone still hands one level and draws no chain; soft light hands the chain, drawn once per silhouette", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLightText("soft");
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    prepare(mat, device, DEFAULT_MAT_CONFIG);
    const level0 = mat.silhouette;
    const bound = mat.assetVersion;
    expect(mat.chainPasses).toBe(0);
    prepare(mat, device, soft());                       // the same silhouette, met by soft light for the first time: its chain is drawn
    expect(mat.silhouette).not.toBe(level0);
    expect(mat.assetVersion).toBeGreaterThan(bound);    // a kind that binds the silhouette binds again
    expect(mat.windPasses).toBe(1); expect(mat.chainPasses).toBe(1);
    prepare(mat, device, soft());                       // nothing moved: neither pass
    expect(mat.windPasses).toBe(1); expect(mat.chainPasses).toBe(1);
    prepare(mat, device, soft(), 1);                    // the wind blew: both
    expect(mat.windPasses).toBe(2); expect(mat.chainPasses).toBe(2);
    expect(new Float32Array(mat.viewBytes.slice(MatUniforms.slots.soft.byte, MatUniforms.slots.soft.byte + 4).buffer)[0]).toBe(1);
    prepare(mat, device, DEFAULT_MAT_CONFIG, 1);        // back under the cone: level 0 alone again
    expect(mat.silhouette).toBe(level0);
    expect(mat.chainPasses).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    mat.dispose();
  });

  it("the wind's strength is the slot's when its config states one, the theme's for its plate when not", async () => {
    const { device } = fakeDevice();
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const strength = () => new Float32Array(mat.viewBytes.slice(MatUniforms.slots.wind.byte, MatUniforms.slots.wind.byte + 16).buffer)[1];
    prepare(mat, device, DEFAULT_MAT_CONFIG);
    expect(strength()).toBeCloseTo(MAT_GRID.gobo.plates.c.strength, 6);
    prepare(mat, device, { ...DEFAULT_MAT_CONFIG, gobo: { ...DEFAULT_MAT_CONFIG.gobo, strength: 0 } });
    expect(strength()).toBe(0);
    expect(mat.windPasses).toBe(2);   // another strength is another silhouette
    mat.dispose();
  });
});
