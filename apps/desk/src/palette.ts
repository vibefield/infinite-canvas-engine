// The app's PROJECTION of the product's palette into the desk (design-015 §5.2's `theme` hook;
// the D-B1.6 precedent groundlab set): VibeField's tokens from the oracle's fixture —
// `--vf-canvas-bg`, `--vf-select`, the note's `--vf-note-surface`, STICKY.md's pens, MINIMAT.md's
// vinyls — handed to the layer as ONE palette the kinds read their looks from (`PaperPalette`:
// `papers`/`pens` by the prop's value; `MiniMatPalette`: `vinyls`). The engine holds no note colour
// (the theme gate); this file is where the product's byte enters the desk.

import type { BoardPalette, CalendarPalette, MiniMatPalette, NotebookPalette, PaperPalette } from "@ice/desk/kinds";
import { BOARD_LOOK, CALENDAR_LOOK, MARKERS, NOTEBOOK_LOOK, notebookRuleInk, PALETTE, PENS, SURFACES, VINYLS } from "@ice/desk/oracle/fixtures/vf-theme";
import { type GroundTheme, type ThemeName, themeFrom } from "@ice/desk/theme";

export type DeskPalette = PaperPalette & MiniMatPalette & BoardPalette & NotebookPalette & CalendarPalette;

/** The palette for a theme: the fixture's roles, the note's one paper (`yellow` — the product's `--vf-note-surface`), its pens, the mini mats' vinyls. */
export const deskPalette = (name: ThemeName): DeskPalette => ({
  ...PALETTE[name], papers: { yellow: SURFACES.note }, pens: PENS, vinyls: VINYLS,
  board: BOARD_LOOK, markers: MARKERS,   // D3w: the whiteboard's materials and the dry-erase markers (BOARD.md)
  notebooks: { ...NOTEBOOK_LOOK, rule: notebookRuleInk()[3] },   // …the notebooks' page, ruling and covers (NOTEBOOK.md §4)
  calendars: CALENDAR_LOOK,   // …the desk calendar's paper, print, tapes and presences (CALENDAR.md §4)
});

/** The theme the passes read for a name — `themeFrom` on the fixture's palette, the oracle's `THEMES[name]` exactly. */
export const deskTheme = (name: ThemeName): GroundTheme => themeFrom(name, PALETTE[name]);

/** The OS's preference at the mount; a rig or the `d` key pins one. */
export const osTheme = (): ThemeName => (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
