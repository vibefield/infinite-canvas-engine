// The ground's colours and material numbers — the ENGINE's half of the theme.
//
// Two homes, one law: a colour literal lives here, in a pack's theme file
// (`packs/*/theme.ts`) or in the host's projection (`oracle/fixtures/
// vf-theme.ts` — VibeField's `--vf-*` tokens transcribed by name; at the fold,
// field-app's `canvas-appearance.ts` reading them off the stamped root), and
// nowhere else in src/, shaders/ or the lab — `test/theme.test.ts` enforces
// it. This file holds what the engine SHIPS: the types and the CSS-colour
// parser; `themeFrom` (a palette → the HEAD every pass reads, plus one section
// per registered pack — design-014); and the materials whose numbers are the
// engine's own, each with its lineage named — the shell's lines, shadow and
// lift (the CardShell's recipe, which DESIGN.md §5/§7 transcribe and
// tokens.css carries as `--ic-*`), the LINE grid's ink and law (`LINE_GRID`,
// the `line` glyph's — design-013 D-C1.4), and the magnet field's defaults (ICE's
// `DEFAULT_GRID_MAGNET_CONFIG`, with the glyph ruled to the dot at design-014).
// A product's palette, its committed surfaces and its reviewed grid are the
// product's: they reach the passes through `GroundTheme` and `FieldConfig`,
// never from here. The cutting mat's material and lights are the mat pack's
// (`packs/mat/theme.ts`); the frame's inks and the heat are the frame pack's.

import type { LineLaw } from "./lattice/line";

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

/** The roles the ground's HEAD paints, one token each, per theme. A pack's palette adds its own (`VfPalette`, packs/vf-frame). */
export interface Palette {
  readonly canvasBg: TokenRef;     // §2.1 the ground
  readonly fieldInk: TokenRef;     // §2.1 the selected magnet ground's ink
  readonly card: TokenRef;         // §2.2 the default card surface (both themes)
  readonly hairline: TokenRef;     // §2.3 hairlines, always
  readonly select: TokenRef;       // §2.5 selection ring only
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
  /** design-014's ruling: the engine's default is the DOT; the needle is a pack (`GridMagnetConfig.glyph` still defaults to "needle" — a re-tune's word, not the engine's). */
  glyph: "dot" as "dot" | "needle",
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
 * The engine's LINE GRID — the `line` glyph's ink and law (design-013 §8,
 * D-C1.4; field/line-glyph.ts). The glyph is the ENGINE's, so its ink is the
 * engine's to ship: one entry per theme, and both start from the OLD leg's
 * number. The TSL line grid drew its lines in `GridConfig.dotColor` — the very
 * field the dots use (`programs/line-grid-renderer.ts` `uColor`, from
 * `core/settings/ground-config.ts` `DEFAULT_GRID_CONFIG.dotColor`, which is
 * `ENGINE_GRID.ink` above) — and that config carries no theme, so the old grid
 * drew ONE colour under both. They are two entries here because a theme is
 * where a product would part them; until one does they are the same number,
 * and this paragraph is why.
 *
 * The law is `lattice/line.ts`'s `LineLaw`, with both of its decade terms
 * deliberately FLAT. The width is one device px at every zoom and every rung
 * (D-C1.4) — `thin === thick`, and the number is the cutting mat's `thin`
 * (`packs/mat/theme.ts` MAT_GRID.line), the reference's hairline. The weight is
 * the old grid's fixed `0.42`: `line-grid-renderer.ts` multiplies its coverage
 * by `dotAlpha · 0.42`, and `levelWeight [1, 0]` gives every level the same
 * weight — so `alphaThin === alphaThick`. The mat's own law thickens and
 * darkens over the decade; a host that wants that hierarchy here passes its own
 * law through `FieldConfig.ext.line` (`LineConfig`).
 */
export const LINE_GRID: {
  readonly ink: Readonly<Record<ThemeName, { readonly token: string; readonly rgb: RGB }>>;
  readonly law: LineLaw;
} = {
  ink: {
    light: { token: "ICE DEFAULT_GRID_CONFIG.dotColor (the old TSL line grid's ink)", rgb: ENGINE_GRID.ink.rgb },
    dark: { token: "ICE DEFAULT_GRID_CONFIG.dotColor (the old TSL line grid's ink)", rgb: ENGINE_GRID.ink.rgb },
  },
  law: { thin: 0.5, thick: 0.5, alphaThin: 0.42, alphaThick: 0.42 },
};

/**
 * The ENGINE's own palette (design-013 C2): what `groundField` draws with when a
 * host projects none, and the base a host overrides a role of (pointerlab keeps
 * its `#0d1117`; the widgetlab apps their `--canvas-bg`). ICE ships no design
 * system, so every role names the ICE number it is: the ground and the dark
 * ink are widgetlab's two `ThemeColors` pairs (`App.tsx`, the v1 playground's
 * defaults), the light ink is `DEFAULT_GRID_CONFIG.dotColor` (`ENGINE_GRID.ink`
 * above, in hex), the select accent is `DEFAULT_WIRES_CONFIG.selectedColor`.
 * The card and the hairline are the neutral pair a plate under a DOM card is
 * never seen as (the stratified profile draws no frames), kept legal for the
 * compose host all the same.
 */
export const ENGINE_PALETTE: Readonly<Record<ThemeName, Palette>> = {
  light: {
    canvasBg: { token: "ICE widgetlab ThemeColors.bgLight", css: "#fafafa" },
    fieldInk: { token: "ICE DEFAULT_GRID_CONFIG.dotColor (widgetlab dotLight)", css: "#bfc4cc" },
    card: { token: "ICE engine card (white)", css: "#ffffff" },
    hairline: { token: "ICE engine hairline", css: "rgba(0, 0, 0, 0.08)" },
    select: { token: "ICE DEFAULT_WIRES_CONFIG.selectedColor", css: "#4a90d9" },
  },
  dark: {
    canvasBg: { token: "ICE widgetlab ThemeColors.bgDark", css: "#171717" },
    fieldInk: { token: "ICE widgetlab ThemeColors.dotDark", css: "#595e66" },
    card: { token: "ICE engine card (neutral-800)", css: "#262626" },
    hairline: { token: "ICE engine hairline", css: "rgba(255, 255, 255, 0.1)" },
    select: { token: "ICE DEFAULT_WIRES_CONFIG.selectedColor", css: "#4a90d9" },
  },
};

/** Everything the passes read, as numbers: the HEAD every program shares, and one section per registered pack (`packs`, by the pack's name). */
export interface GroundTheme {
  readonly name: ThemeName;
  readonly canvasBg: RGB;
  readonly fieldInk: RGB;
  readonly fieldInkAlpha: number;
  readonly card: RGB;
  readonly hairline: RGBA;
  readonly select: RGB;
  /** The `line` glyph's ink for this theme — the engine's own material (`LINE_GRID`), not a palette role. */
  readonly lineInk: RGB;
  /** §5 shadow strength multiplier; 1 = the recipe as written. */
  readonly shadow: number;
  /** A pack's section under its name — a card program's (`vf-frame`) or a grid program's (`mat`); what its `theme()` projected. */
  readonly packs: Readonly<Record<string, unknown>>;
}

/** A pack as `themeFrom` reads it: its section's key (a card program's `name`, a grid program's `glyph`) and its projection. */
export interface ThemeSource<P> {
  readonly name?: string;
  readonly glyph?: string;
  theme?(palette: P, name: ThemeName): unknown;
}

/**
 * A theme from a palette — the host's projection (the fixture builds
 * VibeField's two): the head from the head's roles, and a section per pack
 * from the same palette (a pack's palette type extends `Palette` with its own
 * roles). `grid` lends the field's ink alpha.
 */
export function themeFrom<P extends Palette>(name: ThemeName, p: P, grid: { readonly dotAlpha: number } = ENGINE_GRID, packs: ReadonlyArray<ThemeSource<P>> = []): GroundTheme {
  const sections: Record<string, unknown> = {};
  for (const pack of packs) {
    const key = pack.name ?? pack.glyph;
    if (key === undefined || pack.theme === undefined) continue;
    sections[key] = pack.theme(p, name);
  }
  return {
    name,
    canvasBg: rgb(p.canvasBg.css),
    fieldInk: rgb(p.fieldInk.css),
    fieldInkAlpha: grid.dotAlpha,
    card: rgb(p.card.css),
    hairline: cssColor(p.hairline.css),
    select: rgb(p.select.css),
    lineInk: LINE_GRID.ink[name].rgb,
    shadow: 1,
    packs: sections,
  };
}

/** The engine's two themes from its own palette (`ENGINE_PALETTE`): `groundField`'s default, and a host's base to override a role of. */
export const ENGINE_THEMES: Readonly<Record<ThemeName, GroundTheme>> = {
  light: themeFrom("light", ENGINE_PALETTE.light),
  dark: themeFrom("dark", ENGINE_PALETTE.dark),
};
