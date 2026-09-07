// The ground's colours and material numbers — the ENGINE's half of the theme.
//
// Two homes, one law: a colour literal lives here or in the host's projection
// (`lab/theme.ts` — VibeField's `--vf-*` tokens transcribed by name; at the fold,
// field-app's `canvas-appearance.ts` reading them off the stamped root), and
// nowhere else in src/, shaders/ or lab/ — `test/theme.test.ts` enforces it.
// This file holds what the engine SHIPS: the types and the CSS-colour parser;
// `themeFrom` (a palette → the numbers the passes read); and the materials
// whose numbers are the engine's own, each with its lineage named — the card
// chrome's lines, shadow, lift and heat (the CardShell's recipe, which
// DESIGN.md §5/§7 transcribe and tokens.css carries as `--ic-*`), the magnet
// field's defaults (ICE's `DEFAULT_GRID_MAGNET_CONFIG`), and the cutting mat
// with its two lights (the tree-shadow reference; MAT.md). A product's palette,
// its committed surfaces and its reviewed grid are the product's: they reach
// the passes through `GroundTheme` and `FieldConfig`, never from here.
// Split from the one-file projection on 2026-09-07, before B1 (the move).

import { DAY_LIGHT, dayLuminance, type MatLight, nightLight } from "./mat/night";

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];
export type ThemeName = "light" | "dark";

/**
 * Parse the CSS colour syntaxes tokens.css uses — `#rrggbb`, `rgb(r g b / p%)`,
 * `rgba(r, g, b, a)` — into sRGB 0..1 + alpha. The swap chain is a plain
 * 8-bit format, so what CSS shows is what the shader writes.
 */
export function cssColor(css: string): RGBA {
  const s = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const v = Number.parseInt(m[1] as string, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] === "%" ? Number(m[4]) / 100 : Number(m[4]);
    return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a];
  }
  throw new Error(`theme: unparsed colour "${css}"`);
}
export const rgb = (css: string): RGB => cssColor(css).slice(0, 3) as unknown as RGB;

/** A colour as the design kit names it, with its CSS value verbatim. */
export interface TokenRef {
  /** `--vf-*` = a tokens.css token (checked by name); anything else names its DESIGN.md source. */
  readonly token: string;
  readonly css: string;
}

/** The roles the ground paints, one token each, per theme. */
export interface Palette {
  readonly canvasBg: TokenRef;     // §2.1 the ground
  readonly fieldInk: TokenRef;     // §2.1 the selected magnet ground's ink
  readonly card: TokenRef;         // §2.2 the default card surface (both themes)
  readonly frame: TokenRef;        // §2.2 solid chrome — the revealed frame's material
  readonly hairline: TokenRef;     // §2.3 hairlines, always
  readonly select: TokenRef;       // §2.5 selection ring only
  readonly destructive: TokenRef;  // §2.5 failed / destructive — the close button, armed
  readonly onSolid: TokenRef;      // the glyph on a §2.5 solid
  readonly inkStrong: TokenRef;    // §2.4 the ramp: primary
  readonly ink: TokenRef;          //             secondary — button glyphs at rest
  readonly inkMuted: TokenRef;     //             tertiary — the open lock
  readonly fill: TokenRef;         // §7 button fill, resting
  readonly fillHover: TokenRef;    // §7 button fill, hover
  readonly glow: TokenRef;         // §7 overlap glow — the inset haze toward the hot point (GLOW.md)
  readonly rim: TokenRef;          // §7 overlap rim — the edge band lit at the hot point
}


/** §2.3 / §7 line weights, card units (= CSS px at zoom 1; they ride the card's transform). */
export const LINES = { hairline: 1, ring: 1.5 } as const;

/**
 * §5 the card's ambient shadow, exactly: `0 20px 40px rgba(0,0,0,0.15)` resting,
 * `0 30px 60px rgba(0,0,0,0.22)` lifted. A CSS blur radius is 2σ; the offset is
 * the y term. The recipe has no dark variant — on a dark ground it is faint by
 * design, as the product's DOM card is today.
 */
export const SHADOW = {
  rest: { sigma: 20, offset: 20, alpha: 0.15 },
  lifted: { sigma: 30, offset: 30, alpha: 0.22 },
} as const;

/** §7 Lift: `scale(liftScale)` (ChromeSettings.liftScale, 1.05) · opacity 0.75 for the whole hold. */
export const LIFT = { scale: 1.05, opacity: 0.75 } as const;

/**
 * §7 the overlap glow and rim — a drop target's HEAT (GLOW.md): the LIFTED card is
 * an emitting surface floating `height` above the target, and the target receives
 * its light through the source's own distance field. `height` is the §5 lift
 * recipe's own number — the lifted shadow's 30 px offset is how far the card
 * floats. The colours and the tier alphas [reject `c`, accept `t`] and the rim's
 * width are the CardShell's `--ic-glow-*` / `--ic-rim-*` tokens by name; the
 * CardShell's blur, offset and radial (a hot-POINT anatomy, what CSS could do)
 * are retired by the light — DESIGN.md §7's row is amended when this leaves
 * draft/. Card units: they ride the card's transform, as LINES do.
 */
export interface Heat {
  readonly height: number;
  readonly alpha: readonly [number, number];
  readonly rim: { readonly width: number; readonly alpha: readonly [number, number] };
}
export const HEAT: Heat = { height: SHADOW.lifted.offset, alpha: [0.25, 0.5], rim: { width: 1.5, alpha: [0.55, 0.85] } };

/**
 * The magnet field's ENGINE defaults — ICE's own numbers, transcribed with their
 * names: design-010 §3.1 `DEFAULT_GRID_MAGNET_CONFIG` (glyph, reach, polarity,
 * alignment, the needle) and `DEFAULT_GRID_CONFIG` (the one ink ICE ships, its
 * alpha) in `core/settings/ground-config.ts` — `test/theme.test.ts` reads them
 * back when the ICE repo is beside us. The rest are the ground's own laws
 * (README §4): the glyph size PRESETS (a dot rests at 1.5 CSS px and swells to
 * `needleLength × 1.05`; a needle runs 0.55–1.0 × its length and 0.85–1.15 × its
 * width — proposed `GridMagnetConfig` additions) and the fade-in window by a
 * rung's own cell (one octave under the decade's 20 px bottom, so zoom 1 lands
 * on a full lattice). A product projects its reviewed numbers over these
 * (lab/theme.ts, from canvas-appearance.ts); the passes boot on these.
 */
export const ENGINE_GRID = {
  glyph: "needle" as "dot" | "needle",
  reach: 60,
  polarity: 1 as 1 | -1,
  alwaysAlign: false,
  needleLength: 5,
  needleWidth: 0.55,
  ink: { token: "ICE DEFAULT_GRID_CONFIG.dotColor", rgb: [0.75, 0.77, 0.8] as RGB },
  dotAlpha: 1,
  dotRadius: [1.5, 5.25] as const,
  needleHalfLen: [2.75, 5] as const,
  needleHalfWidth: [0.4675, 0.6325] as const,
  fadeIn: [10, 20] as const,
} as const;

/**
 * The CUTTING MAT — the third grid: a hairline lattice on a green mat, ported
 * from research/tree-shadow/prototype (the oryzo "hero desk"). Its colours are
 * a material's, carried across both themes like a card's committed surface;
 * the numbers are the reference's, transcribed with their names. DESIGN.md has
 * no cutting-mat row yet (it is a research port) — the token names below say
 * where each value came from, and adding the material to the doc is the step
 * before any of this leaves draft/.
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
/** The same two, parsed — what a pass reads (nothing outside this file parses a colour). */
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
 * sees by it. Every number here is a choice with its source; `mat/night.ts` turns
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

/** Everything the passes read, as numbers. */
export interface GroundTheme {
  readonly name: ThemeName;
  readonly canvasBg: RGB;
  readonly fieldInk: RGB;
  readonly fieldInkAlpha: number;
  readonly card: RGB;
  readonly frame: RGB;
  readonly hairline: RGBA;
  readonly select: RGB;
  readonly destructive: RGB;
  readonly onSolid: RGB;
  readonly inkStrong: RGBA;
  readonly ink: RGBA;
  readonly inkMuted: RGBA;
  readonly fill: RGBA;
  readonly fillHover: RGBA;
  readonly glow: RGB;
  readonly rim: RGB;
  /** §5 shadow strength multiplier; 1 = the recipe as written. */
  readonly shadow: number;
  /** The cutting mat's light (mat/night.ts): the Sun by day, the Moon by night. */
  readonly matLight: MatLight;
}

/** A theme from a palette — the host's projection (lab/theme.ts builds VibeField's two); `grid` lends the field's ink alpha. */
export function themeFrom(name: ThemeName, p: Palette, grid: { readonly dotAlpha: number } = ENGINE_GRID): GroundTheme {
  return {
    name,
    canvasBg: rgb(p.canvasBg.css),
    fieldInk: rgb(p.fieldInk.css),
    fieldInkAlpha: grid.dotAlpha,
    card: rgb(p.card.css),
    frame: rgb(p.frame.css),
    hairline: cssColor(p.hairline.css),
    select: rgb(p.select.css),
    destructive: rgb(p.destructive.css),
    onSolid: rgb(p.onSolid.css),
    inkStrong: cssColor(p.inkStrong.css),
    ink: cssColor(p.ink.css),
    inkMuted: cssColor(p.inkMuted.css),
    fill: cssColor(p.fill.css),
    fillHover: cssColor(p.fillHover.css),
    glow: rgb(p.glow.css),
    rim: rgb(p.rim.css),
    shadow: 1,
    matLight: MAT_LIGHT[name],
  };
}
