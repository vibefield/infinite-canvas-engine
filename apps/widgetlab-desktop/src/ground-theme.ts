/**
 * The desktop app's theme, projected ONCE — the page's background and the
 * ground's `GroundTheme` from the same state (design-013 C4, D-C4.12).
 *
 * The C2 ground is OPAQUE (D-C2.6): its canvas clears to `theme.canvasBg` and the
 * DOM planes sit above it. So an app that paints `--canvas-bg` from a light/dark
 * toggle and hands the ground a hardcoded theme does not have a light mode — it
 * has a dark board under a light page, which is exactly what `App.tsx` shipped
 * from B8 (composited arm) and C2 (stratified arm) until this module existed.
 *
 * One state, two surfaces, one projection: {@link useAppTheme} writes
 * `--canvas-bg` and calls the live layer's `setTheme` in the same effect, and
 * {@link groundThemeFor} is the only place the app's `ThemeColors` become a
 * `GroundTheme`. The rigs import THIS, not a copy of it (`docs/UI_SYSTEM.md`'s
 * catalog rule, applied to a harness): the light-mode phase of the `app` and
 * `stratified` rigs grades the shipping projection.
 *
 * What is substituted, and what is not: the app owns its background and its dot
 * ink (`ThemeColors`), so those two roles come from state; every other role — the
 * card, the frame, the hairline, the select accent, and the two PACK sections the
 * `vf-frame` card program and the `mat` glyph read — stays the product palette
 * `THEMES` is built from, so the card frame keeps its look on both arms.
 */
import type { GroundFieldHandle, GroundTheme } from "@ice/ground";
import { themeFrom } from "@ice/ground";
import type { GroundComposeContext, GroundComposeHandle } from "@ice/ground/compose";
import { PALETTE, PRODUCT_GRID, VF_PACKS } from "@ice/ground/oracle/fixtures/vf-theme";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import type { ThemeColors } from "./panels";

/** v1's theme constants (App.tsx verbatim), here because the ground projection and the rigs both read them. */
export const DEFAULT_THEME_COLORS: ThemeColors = {
  dotLight: "#BFC4CC",
  dotDark: "#595E66",
  bgLight: "#FAFAFA",
  bgDark: "#171717",
};

/** The page's `--canvas-bg` for a theme — and the ground's `canvasBg`, which is the point. */
export function pageBackground(dark: boolean, colors: ThemeColors): string {
  return dark ? colors.bgDark : colors.bgLight;
}

/** The field's ink for a theme (the grid's dot colour, which `effectiveGrid` also carries). */
export function fieldInkColor(dark: boolean, colors: ThemeColors): string {
  return dark ? colors.dotDark : colors.dotLight;
}

/**
 * The app's `ThemeColors` as a `GroundTheme`: the product palette with the app's
 * background and dot ink substituted, through the same `themeFrom` + `PRODUCT_GRID`
 * + `VF_PACKS` the fixture's `THEMES` is built with.
 */
export function groundThemeFor(dark: boolean, colors: ThemeColors): GroundTheme {
  const name = dark ? "dark" : "light";
  return themeFrom(
    name,
    {
      ...PALETTE[name],
      canvasBg: { token: "widgetlab-desktop --canvas-bg", css: pageBackground(dark, colors) },
      fieldInk: { token: "widgetlab-desktop ThemeColors.dot", css: fieldInkColor(dark, colors) },
    },
    PRODUCT_GRID,
    VF_PACKS,
  );
}

/** Either arm's ground handle: the composited one carries `compose`, the stratified one `field`. */
export type AppGroundHandle = GroundComposeHandle | GroundFieldHandle;

/** Either arm's factory, as `<InfiniteCanvas ground>` takes it (`GroundFieldContext` IS `GroundComposeContext`). */
export type AppGroundFactory = (ctx: GroundComposeContext) => AppGroundHandle;

/** Re-project a live layer, whichever arm built it. A layer that has not mounted yet is a no-op — the factory reads the ref. */
export function applyGroundTheme(handle: AppGroundHandle | null, theme: GroundTheme): void {
  if (handle === null) return;
  if ("compose" in handle) handle.compose.setTheme(theme);
  else handle.field.setTheme(theme);
}

/**
 * The whole pattern, as one hook: the memoised projection, a ref the ground
 * FACTORY reads at the mount (so the factory memo keeps its `[gpu]` identity and a
 * theme switch never re-boots the canvas), and the effect that paints the page and
 * re-projects the live layer together.
 */
export function useAppTheme(
  dark: boolean,
  colors: ThemeColors,
  layerRef: RefObject<AppGroundHandle | null>,
): RefObject<GroundTheme> {
  const theme = useMemo(() => groundThemeFor(dark, colors), [dark, colors]);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    document.documentElement.style.setProperty("--canvas-bg", pageBackground(dark, colors));
    applyGroundTheme(layerRef.current, theme);
  }, [dark, colors, theme, layerRef]);
  return themeRef;
}
