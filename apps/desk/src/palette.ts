// The app's palette (design-015 §5.2's `theme` hook): the SHIPPED default — `deskPalette`/`deskTheme`
// from `@ice/desk/objects` (D7, D-D7-C.1), VibeField's tokens (`--vf-canvas-bg`, `--vf-select`, the
// note's `--vf-note-surface`, STICKY.md's pens, MINIMAT.md's vinyls, the board's, the notebooks' and
// the calendar's materials) handed to the layer as ONE palette the kinds read their looks from. Until
// D7 this file built it from the oracle's fixture, which the package does not ship; the app now takes
// exactly what a third party takes. The engine holds no note colour (the theme gate).

import type { ThemeName } from "@ice/desk";

export { type DeskPalette, deskPalette, deskTheme } from "@ice/desk/objects";

/** The OS's preference at the mount; a rig or the `d` key pins one. */
export const osTheme = (): ThemeName => (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
