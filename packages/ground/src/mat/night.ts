// The NIGHT — the cutting mat under the Moon (MAT.md). A PURE module, no GPU:
// the physics that turns the theme's choices (a colour temperature, an
// illuminance, a hue for the rods, Eigengrau, an exposure rule) into the
// numbers the mat shader reads, and a CPU mirror of that shader for the tests
// and the doc. No colour is CHOSEN here — theme.ts chooses, this file computes.
//
// The model, per pixel (mat.wgsl `night_mat` is the same arithmetic):
//   cone = albedo · moon · shade          the mat under the Moon, as the partly adapted cones take it
//   rod  = V'(cone) / V'(white)           the rods' signal (Larson, Rushmeier & Piatko 1997)
//   L    = lux · Y(cone) / π              cd/m² on the desk
//   m    = CIE 191:2010's mesopic weight at L
//   see  = mix(rod · rodHue, cone, m)     what the eye reports
//   disp = eigengrau + see · exposure     the dark's own grey under it; the appearance's scale
//   out  = sRGB(disp) + snow              encoded, then the rods' own noise

import type { RGB } from "../theme.ts";

/** What the mat is lit by — a theme's light. `night` 0 is the reference's day chain, bit for bit. */
export interface MatLight {
  /** 0 = the day (the reference's chain, exactly) · 1 = the night · between: a cross-fade of the two on the display. */
  readonly night: number;
  /** The Moon's illuminance on the desk, lux — where on the mesopic ramp the eye sits. */
  readonly lux: number;
  /** Scene → display: the scale the adapted eye's report is drawn at. */
  readonly exposure: number;
  /** The rods' own noise, display units, peak to peak. */
  readonly snow: number;
  /** The Moon's colour as the (partly) adapted eye takes it — linear sRGB at Y = 1. */
  readonly moon: RGB;
  /** The sky's share of the light where the Moon is blocked. */
  readonly fill: number;
  /** The rods' signal drawn as a colour — linear sRGB at Y = 1. */
  readonly rod: RGB;
  /** The dark the eye adds to everything — linear sRGB. */
  readonly eigengrau: RGB;
}

/** The day: the reference's chain, untouched — every night number inert. */
export const DAY_LIGHT: MatLight = { night: 0, lux: 0, exposure: 0, snow: 0, moon: [1, 1, 1], fill: 0, rod: [1, 1, 1], eigengrau: [0, 0, 0] };

/** The night as the theme states it (theme.ts `NIGHT`). */
export interface NightSpec {
  /** The Moon's colour temperature, K. */
  readonly kelvin: number;
  /** Its illuminance on the desk, lux. */
  readonly lux: number;
  /** The sky's share in the shadow. */
  readonly fill: number;
  /** The rods' hue: a spectral wavelength (470–500 nm) and how far from white toward it. */
  readonly rodHue: { readonly nm: number; readonly purity: number };
  /** Eigengrau, sRGB 0..1. */
  readonly eigengrau: RGB;
  /** The display luminance (linear, Eigengrau included) the moonlit ground is drawn at — the appearance's one scale. */
  readonly litLuminance: number;
  /** The rods' noise, display units peak to peak. */
  readonly snow: number;
  /** CIECAM02's surround factor F for the degree of adaptation: 1 average · 0.9 dim · 0.8 dark. */
  readonly surround: number;
}

// ---- colour science, the standard numbers
/** sRGB (IEC 61966-2-1) ↔ CIE 1931 XYZ, D65 — rows. */
const RGB2XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]] as const;
const XYZ2RGB = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]] as const;
const mul = (M: readonly [RGB, RGB, RGB], v: RGB): RGB => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
/** A colour from its three channels by index — a tuple's literal index needs no guard. */
const tri = (f: (i: 0 | 1 | 2) => number): RGB => [f(0), f(1), f(2)];
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
export const linear = (c: RGB): RGB => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
/** Photopic luminance Y of a linear sRGB colour. */
export const luminance = (c: RGB): number => RGB2XYZ[1][0] * c[0] + RGB2XYZ[1][1] * c[1] + RGB2XYZ[1][2] * c[2];

/**
 * Scotopic luminance V' from XYZ — Larson, Rushmeier & Piatko 1997's regression
 * (the one the night-rendering literature uses: Jensen et al. 2000, Kirk & O'Brien 2011).
 * The rods peak at 507 nm: greens and blues keep their brightness by night, reds die.
 */
export function scotopic(c: RGB): number {
  const [X, Y, Z] = mul(RGB2XYZ, c);
  return Y * (1.33 * (1 + (Y + Z) / Math.max(X, 1e-6)) - 1.68);
}
const SCOTOPIC_WHITE = scotopic([1, 1, 1]);
/** The rods' signal, white = 1 — what the shader calls `rod`. */
export const rodSignal = (c: RGB): number => Math.max(scotopic(c), 0) / SCOTOPIC_WHITE;

/** CIE 191:2010's mesopic adaptation coefficient (first order, seeded by the photopic luminance): 0 at 0.005 cd/m² (the rods alone), 1 at 5 (the cones alone). */
export const mesopicWeight = (L: number): number => Math.min(Math.max(0.767 + 0.3334 * Math.log10(Math.max(L, 1e-9)), 0), 1);

/** CIECAM02's degree of chromatic adaptation at an adapting luminance (cd/m²): how much of the illuminant's colour the eye discounts. */
export const degreeOfAdaptation = (LA: number, F: number): number => F * (1 - (1 / 3.6) * Math.exp((-LA - 42) / 92));

/** The Planckian locus in CIE 1931 xy — Kang et al. 2002's fit, 1667–25000 K. */
export function planckianXY(T: number): readonly [number, number] {
  const t = 1 / T;
  const t2 = t * t;
  const t3 = t2 * t;
  const x = T <= 4000 ? -0.2661239e9 * t3 - 0.2343589e6 * t2 + 0.8776956e3 * t + 0.17991 : -3.0258469e9 * t3 + 2.1070379e6 * t2 + 0.2226347e3 * t + 0.24039;
  const x2 = x * x;
  const x3 = x2 * x;
  const y = T <= 2222 ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683 : T <= 4000 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867 : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** A chromaticity as linear sRGB at Y = 1. */
export const xyToLinear = (x: number, y: number): RGB => mul(XYZ2RGB, [x / y, 1, (1 - x - y) / y]);

/** D65's chromaticity — sRGB's white. */
export const D65: readonly [number, number] = [0.3127, 0.329];
/** The spectral locus, CIE 1931 2°, 470–500 nm at 5 nm — the blue-cyan reach where the rods' hue is placed. */
const LOCUS = [[470, 0.1241, 0.0578], [475, 0.1096, 0.0868], [480, 0.0913, 0.1327], [485, 0.0687, 0.2007], [490, 0.0454, 0.295], [495, 0.0235, 0.4127], [500, 0.0082, 0.5384]] as const;
type Knot = (typeof LOCUS)[number];
export function spectralXY(nm: number): readonly [number, number] {
  const w = Math.min(Math.max(nm, LOCUS[0][0]), LOCUS[6][0]);
  let i = 0;
  while (i < LOCUS.length - 2 && (LOCUS[i + 1] as Knot)[0] <= w) i++;
  const [w0, x0, y0] = LOCUS[i] as Knot;
  const [w1, x1, y1] = LOCUS[i + 1] as Knot;
  const t = (w - w0) / (w1 - w0);
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}
/** White pulled `purity` of the way toward a spectral hue, as linear sRGB at Y = 1. */
export function hueTint(nm: number, purity: number): RGB {
  const [sx, sy] = spectralXY(nm);
  return xyToLinear(D65[0] + (sx - D65[0]) * purity, D65[1] + (sy - D65[1]) * purity);
}

/**
 * The reference's day chain writes the LINEARISED albedo to the swap chain as sRGB
 * (README §4e), so what the display shows for a lit pixel is that value decoded once
 * more: the day's displayed luminance of a ground colour.
 */
export const dayLuminance = (groundSrgb: RGB): number => luminance(linear(linear(groundSrgb)));

/** The eye's report of a linear albedo under `light` at `shade` (1 lit · `fill` in full shadow) — linear, before Eigengrau and the exposure. */
export function nightReport(light: MatLight, albedoLinear: RGB, shade: number): RGB {
  const cone: RGB = [albedoLinear[0] * light.moon[0] * shade, albedoLinear[1] * light.moon[1] * shade, albedoLinear[2] * light.moon[2] * shade];
  const rod = rodSignal(cone);
  const m = mesopicWeight((light.lux * luminance(cone)) / Math.PI);
  return tri((i) => (1 - m) * rod * light.rod[i] + m * cone[i]);
}

/** The shader's `night_mat` on the CPU: what the display shows (sRGB 0..1), the snow left out. */
export function nightAppearance(light: MatLight, albedoLinear: RGB, shade: number): RGB {
  const see = nightReport(light, albedoLinear, shade);
  return tri((i) => linearToSrgb(light.eigengrau[i] + see[i] * light.exposure));
}

/** The theme's night, computed for a ground colour (sRGB 0..1): the light the mat pass reads. */
export function nightLight(spec: NightSpec, groundSrgb: RGB): MatLight {
  const ground = linear(groundSrgb);
  const [px, py] = planckianXY(spec.kelvin);
  const moonRaw = xyToLinear(px, py);
  // the eye adapts to the Moon's colour only as far as this little light lets it (CIECAM02's D at the moonlit ground's luminance)
  const D = degreeOfAdaptation((spec.lux * luminance(ground)) / Math.PI, spec.surround);
  const moon: RGB = [1 + (1 - D) * (moonRaw[0] - 1), 1 + (1 - D) * (moonRaw[1] - 1), 1 + (1 - D) * (moonRaw[2] - 1)];
  const eigengrau = linear(spec.eigengrau);
  const light: MatLight = { night: 1, lux: spec.lux, exposure: 1, snow: spec.snow, moon, fill: spec.fill, rod: hueTint(spec.rodHue.nm, spec.rodHue.purity), eigengrau };
  // the one scale: the lit ground's report, drawn so the display's luminance there (Eigengrau included) is the theme's number
  const above = Math.max(spec.litLuminance - luminance(eigengrau), 0);
  return { ...light, exposure: above / Math.max(luminance(nightReport(light, ground, 1)), 1e-9) };
}

/** The light's four vec4s, by name (MatUniforms). */
export function lightValues(l: MatLight): { night: number[]; moon: number[]; rod: number[]; eigengrau: number[] } {
  return {
    night: [l.night, l.lux, l.exposure, l.snow],
    moon: [l.moon[0], l.moon[1], l.moon[2], l.fill],
    rod: [l.rod[0], l.rod[1], l.rod[2], 0],
    eigengrau: [l.eigengrau[0], l.eigengrau[1], l.eigengrau[2], 0],
  };
}
