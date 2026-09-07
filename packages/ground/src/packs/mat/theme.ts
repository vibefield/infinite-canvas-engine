// The cutting mat's THEME half (design-014: a pack's theme section) — the
// material's two colours, the line law and the gobo's numbers, and the NIGHT.
// A colour literal lives here or in the engine's theme.ts or the host's
// projection, and nowhere else — `test/compose/theme.test.ts` enforces it.
// Moved from the engine's theme.ts at design-014.

import { type RGB, rgb, type ThemeName } from "../../theme";
import { DAY_LIGHT, dayLuminance, type MatLight, nightLight } from "./night";

/**
 * The CUTTING MAT — the third grid: a hairline lattice on a green mat, ported
 * from research/tree-shadow/prototype (the oryzo "hero desk"). Its colours are
 * a material's, carried across both themes like a card's committed surface;
 * the numbers are the reference's, transcribed with their names.
 *
 * The reference draws its albedo through `srgbToLinear` and then `pow(2.2)`
 * again, grades in HSB, and writes `pow(1/2.2)` straight to the swap chain: the
 * mat on screen is the LINEARISED sage, a dark green. That chain is the look
 * and is kept verbatim (mat.wgsl), so `ground` and `line` below are the values
 * the chain STARTS from, not what a pixel measures.
 */
export const MAT = {
  ground: { token: "hero cuttingMatAlbedo `sage`", css: "#86a078" },   // 134 160 120
  line: { token: "hero cuttingMatAlbedo `cream`", css: "#e8dcbe" },    // 232 220 190
} as const;
/** The same two, parsed — what the pass reads (nothing outside a theme home parses a colour). */
export const MAT_COLORS: { readonly ground: RGB; readonly line: RGB } = { ground: rgb(MAT.ground.css), line: rgb(MAT.line.css) };

/**
 * The mat's line law and the gobo's numbers (research/tree-shadow/prototype:
 * shaders.js `cuttingMatAlbedo` · `sampleGobo` · `heroFrag`, scenes.js `hero`).
 * Line widths are DEVICE px — the reference's hairlines are 0.5 / 0.75 of a
 * framebuffer pixel; the alphas ride the engine's `fadeIn` window (line.ts).
 */
export const MAT_GRID = {
  line: { thin: 0.5, thick: 0.75, alphaThin: 0.14, alphaThick: 0.28 },
  /** ±8/255 on the green channel (0.4× red, 0.35× blue): static hash + drifting value noise + blue noise. */
  grain: 8 / 255,
  gobo: {
    opacity: 1,
    /** `getGoboBlurRatio(z, params) * 2.0` — the blur radius in plate texels at full softness. */
    blurTexels: 2,
    /** heroFrag: `shade = mix(1, coaster·(0.5 + 0.5·gobo), 0.975)`; then HSB s += (1−shade)·0.1, v *= shade. */
    shadeMix: 0.975, darkFloor: 0.5, saturate: 0.1,
    /** scenes.js `hero.params` — the blur ramp's two linear depths (metres from the projector). */
    sharp: 0.372991, soft: 0.79059,
    /** The plates: R silhouette, G wind amp 1, B phase, A amps 2+3; each with its wind strength. */
    plates: { c: { strength: 0.38847005 }, b: { strength: 0.4630597 } },
    plate: "c" as "c" | "b",
    /** gobo.js: `time += dt·(speed + 1 + r)` at speed 4; the lab's 0 = frozen. */
    wind: 5,
    /** hero `mouseStrength` — radians of projector tilt per unit of smoothed pointer NDC. */
    tilt: 0.003,
  },
  /**
   * World → desk: the hero's view at its default height is 0.2227 m over the
   * window's height (900 px in the reference shots), so one world unit (a CSS
   * px at zoom 1) is 0.2227 / 900 m and the dapple spans the same screen at
   * zoom 1. The mat's centre (the reference's coaster) is world (0, 0); the
   * desk plane is `y = 0.7471` in the projector's frame.
   */
  plane: { metresPerUnit: 0.2227 / 900, originX: -0.0105761, originZ: -0.0485146, deskY: 0.7471 },
} as const;

/**
 * The NIGHT — the cutting mat in the dark theme (MAT.md). The mat is a material and
 * keeps its sage and cream in both themes; what the theme changes is the LIGHT: the
 * Sun by day (the reference's chain, verbatim), the Moon by night — and the eye that
 * sees by it. Every number here is a choice with its source; `night.ts` turns
 * them into the shader's numbers.
 */
export const NIGHT = {
  /** Full moonlight is REDDER than sunlight — ≈ 4100 K against the Sun's ≈ 5500 (Ciocca & Wang 2013); the blue of a moonlit scene is the eye's, not the light's. */
  kelvin: 4100,
  /** A full Moon high in a clear sky: 0.1–0.3 lux on the ground, a million times under the Sun's. Where on the mesopic ramp the eye sits. */
  lux: 0.2,
  /** The sky's share in the shadow — the same air scatters the same fraction of the Moon as of the Sun, ≈ 0.15–0.2 of the direct light at 45°. */
  fill: 0.18,
  /** The rods' signal drawn as a colour: white pulled 18 % toward 485 nm — the low-purity blue the night-rendering literature gives scotopic vision (Jensen et al. 2000; Khan & Pattanaik 2004). */
  rodHue: { nm: 485, purity: 0.18 },
  /** Eigengrau — the "intrinsic grey" the eye reports with no light at all (the rods' own dark noise); the value the term is given. */
  eigengrau: { token: "Eigengrau (the dark's own grey)", css: "#16161d" },
  /** The appearance's one scale: the moonlit sage is drawn at HALF the sunlit one's displayed luminance — the million can't be shown; the adapted eye's report is. */
  litOverDay: 0.5,
  /** The rods' own noise on the display: ±2/255, blue noise, achromatic. */
  snow: 4 / 255,
  /** CIECAM02's surround factor for the eye's adaptation to the Moon's colour: 0.8, a dark surround. */
  surround: 0.8,
} as const;

/** Eigengrau, parsed — what a host hands `nightLight` (lab/params.ts rebuilds the night from its panel). */
export const EIGENGRAU: RGB = rgb(NIGHT.eigengrau.css);

/** The light the mat pass reads, per theme: the Sun (the reference's chain, bit for bit) by day, the Moon by night. */
export const MAT_LIGHT: Record<ThemeName, MatLight> = {
  light: DAY_LIGHT,
  dark: nightLight({
    kelvin: NIGHT.kelvin, lux: NIGHT.lux, fill: NIGHT.fill, rodHue: NIGHT.rodHue, eigengrau: EIGENGRAU,
    litLuminance: NIGHT.litOverDay * dayLuminance(MAT_COLORS.ground), snow: NIGHT.snow, surround: NIGHT.surround,
  }, MAT_COLORS.ground),
};
