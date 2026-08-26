/**
 * Production grid wiring — BUILD-TIME selection, not a runtime mode facade.
 *
 * Keep this module intentionally tiny and import exactly one implementation.
 * The unselected renderer then has no path from the package entry graph and
 * is absent from the production bundle. To restore the classic grid, change
 * only the implementation path below to `./grid-classic-pass`.
 */
export { createGridPass } from "./grid-magnet-pass";
export type { GridPass, GridPassDeps, GridPassFactory } from "./grid-contract";
