/**
 * The panels barrel — the three v1-playground chrome panels ported to the v3
 * engine. The App (task 65) mounts these as `<InfiniteCanvas>` children /
 * overlays and owns the controlled state (gridConfig, theme, glow) they edit.
 */
export { SettingsPanel } from "./SettingsPanel";
export { InspectorPanel } from "./InspectorPanel";
export { NavigationBreadcrumbs } from "./NavigationBreadcrumbs";
export type { OverlapGlowConfig, OverlapGlowThemeColors, ThemeColors } from "./types";
