// VibeField's projection into the ground — the PRODUCT's half of the theme, as a
// FIXTURE: the oracle's parity target and the groundlab app's palette. The real
// projection is field-app's `canvas-appearance.ts` when VibeField adopts the new
// profile (after B8); nothing in `@ice/ground`'s compose entry imports this.
//
// Every colour here is a token from `vibe-field/DESIGN.md` (§2 Color · §5
// Elevation & materials · §7 Interactive states), transcribed WITH ITS NAME,
// the same discipline as `packages/design-kit/src/tokens.css`: the doc moves
// first, then this file. The product's reviewed grid tuning
// (`packages/field-app/src/field/canvas-appearance.ts`) is transcribed beside
// it. `test/vf-theme.test.ts` cross-checks every value against the real
// tokens.css, DESIGN.md and canvas-appearance.ts when the repo is beside us.
// At the fold this file does not move: it is the shape field-app's
// `canvas-appearance.ts` takes, reading `--vf-*` off the stamped root instead
// of transcribing. The engine's half — the types, the parser, `themeFrom`, the
// chrome and mat materials — is `src/theme.ts`. Transcribed 2026-09-01; split
// out 2026-09-07.

import { ENGINE_GRID, type GroundTheme, type Palette, type RGB, rgb, themeFrom, type ThemeName } from "../../src/theme";

export const PALETTE: Record<ThemeName, Palette> = {
  light: {
    canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" },
    fieldInk: { token: "--vf-canvas-magnet-ink", css: "#a6a6a6" },
    card: { token: "--vf-card", css: "#1c1c1e" },
    frame: { token: "--vf-chrome-solid", css: "#ffffff" },
    hairline: { token: "--vf-hairline", css: "rgb(0 0 0 / 5%)" },
    select: { token: "--vf-select", css: "#4a90d9" },
    destructive: { token: "--vf-red", css: "#ff453a" },
    onSolid: { token: "--vf-state-on-solid", css: "#ffffff" },
    inkStrong: { token: "--vf-foreground", css: "#1c1c1e" },
    ink: { token: "--vf-text-secondary", css: "rgb(28 28 30 / 70%)" },
    inkMuted: { token: "--vf-text-tertiary", css: "rgb(28 28 30 / 45%)" },
    fill: { token: "§7 black/5", css: "rgb(0 0 0 / 5%)" },
    fillHover: { token: "§7 black/10", css: "rgb(0 0 0 / 10%)" },
    // tokens.css carries these as channel triplets (`255, 255, 255`) for `rgba(var(--ic-glow-color), α)`
    glow: { token: "--ic-glow-color", css: "rgb(255 255 255)" },
    rim: { token: "--ic-rim-color", css: "rgb(224 224 224)" },
  },
  dark: {
    canvasBg: { token: "--vf-canvas-bg", css: "#171717" },
    fieldInk: { token: "--vf-canvas-magnet-ink", css: "#8a8a8a" },
    card: { token: "--vf-card", css: "#1c1c1e" },
    // DESIGN.md §2.2 "solid chrome: light white · dark neutral-800". tokens.css's
    // `--vf-chrome-solid` carries the chrome MATERIAL colour (#1c1c1e) in dark,
    // which is also `--vf-card` — a frame in it would vanish against the card.
    // The doc is the authority; the drift is reported, not repeated.
    frame: { token: "§2.2 solid chrome dark (neutral-800)", css: "#262626" },
    hairline: { token: "--vf-hairline", css: "rgb(255 255 255 / 10%)" },
    select: { token: "--vf-select", css: "#4a90d9" },
    destructive: { token: "--vf-red", css: "#ff453a" },
    onSolid: { token: "--vf-state-on-solid", css: "#ffffff" },
    inkStrong: { token: "--vf-foreground", css: "#f5f5f7" },
    ink: { token: "--vf-text-secondary", css: "rgb(245 245 247 / 70%)" },
    inkMuted: { token: "--vf-text-tertiary", css: "rgb(245 245 247 / 45%)" },
    fill: { token: "§7 white/10", css: "rgb(255 255 255 / 10%)" },
    fillHover: { token: "§7 white/20", css: "rgb(255 255 255 / 20%)" },
    glow: { token: "--ic-glow-color", css: "rgb(110 110 110)" },
    rim: { token: "--ic-rim-color", css: "rgb(92 92 92)" },
  },
};

/**
 * §2.2 committed content surfaces — a card's own colour, carried across BOTH
 * themes like an iOS widget on any wallpaper. The lab hands these out; the
 * product's widgets bring their own.
 */
export const CARD_SURFACES = {
  card: { token: "--vf-card", css: "#1c1c1e" },
  deep: { token: "--vf-card-deep", css: "#000000" },
  note: { token: "--vf-note-surface", css: "#f6e7a9" },
  folder: { token: "--vf-folder-surface", css: "#1d1d2b" },
} as const;
export type SurfaceName = keyof typeof CARD_SURFACES;
export const surface = (name: SurfaceName): RGB => rgb(CARD_SURFACES[name].css);

/**
 * The product's reviewed magnet grid — `defaultCanvasAppearance().magnetGrid`
 * and `worldGrid.dotAlpha` in canvas-appearance.ts, which ICE's magnet build
 * consumes with the same field law this ground has (k = 0.5·reach², halo
 * ∝ √strength, rest alpha 0.72 dot / 0.35 needle · dotAlpha). The presets and
 * the window are the engine's laws (`ENGINE_GRID`), restated here so the
 * product's set is complete; `test/vf-theme.test.ts` holds them equal.
 */
export const PRODUCT_GRID = {
  glyph: "dot" as "dot" | "needle",
  reach: 60,
  polarity: 1 as 1 | -1,
  widgetStrength: 0.1,
  alwaysAlign: false,
  needleLength: 5,
  needleWidth: 0.55,
  dotAlpha: 1,
  dotRadius: ENGINE_GRID.dotRadius,
  needleHalfLen: ENGINE_GRID.needleHalfLen,
  needleHalfWidth: ENGINE_GRID.needleHalfWidth,
  fadeIn: ENGINE_GRID.fadeIn,
} as const;

/** VibeField's two themes, as the passes read them. */
export const THEMES: Record<ThemeName, GroundTheme> = {
  light: themeFrom("light", PALETTE.light, PRODUCT_GRID),
  dark: themeFrom("dark", PALETTE.dark, PRODUCT_GRID),
};
