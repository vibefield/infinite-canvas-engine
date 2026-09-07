/**
 * @ice/ground — the P0 ground stratum as ONE WebGPU canvas, on the engine
 * (design-013 §8, C2 2026-09-07). This barrel is the STRATIFIED profile's face
 * of the package: `groundField` — the field, the live portals, the flight's
 * second slot, the wires and the guides, drawn under the DOM planes on a
 * device of its own — the pole vocabulary it takes, the two kept leaves
 * (`instrumentSubmits`, the HiC adapter's probe), and core's grid config
 * vocabulary for app ergonomics. The COMPOSITED profile's ground and the whole
 * engine surface are `@ice/ground/compose` (`groundCompose`, `Ground`, the
 * passes); the packs are `@ice/ground/packs`; the raw-WebGPU boilerplate is
 * `@ice/ground/engine`.
 *
 * Off the react chain: react receives the layer as an OPAQUE factory
 * (`<InfiniteCanvas ground={groundField(...)}>`) and types it structurally;
 * imperative apps register `layer.reflector` themselves.
 *
 * ── WHAT LEFT AT C2 ──────────────────────────────────────────────────────────
 * three's `WebGPURenderer` + TSL, `ground()`, `groundHost`, design-011's
 * `GroundProgramDefinition`/`Instance` with its transition ladder, the pass
 * registry, the LRU, the snapshot capture and the `programs/*` subpaths — the
 * old stratified leg, nine files and their tests. Their claims live in the
 * plan's landing logs (`draft/design-013-implementation-plan.md` §C5); the
 * numbers C1's parity rig and C1d's A/B recorded against them are there too.
 * The naming question design-012 §11 Q7 parked ("should this be
 * `@ice/compositor`?") stays answered: `ground` is what it is.
 */
export {
  fieldConfigOf,
  groundField,
  mergeGridConfig,
  slotFieldConfig,
  type GroundComposeContext,
  type GroundDeclaration,
  type GroundField,
  type GroundFieldContext,
  type GroundFieldFactory,
  type GroundFieldHandle,
  type GroundFieldOptions,
  type GroundFieldStats,
  type GroundFieldStatus,
  type GroundHostOptions,
  type GroundHostStats,
} from "./compose/host";
// The magnet pole seam (design-010 §3.3; design-013 D-C2.2) + canned wirings
// (D5: the host imports neither helper — cursor vocabulary lives in the
// helper the app chose).
export {
  cursorVisualPoles,
  localPointerPoles,
  packPoles,
  NO_POINTER,
  type PackedPoles,
  type PointerInput,
  type Pole,
  type PoleSource,
} from "./compose/poles";
// The theme's engine half: what a host projects its palette into, and the
// engine's own for a host that projects none.
export {
  cssColor,
  ENGINE_GRID,
  ENGINE_PALETTE,
  ENGINE_THEMES,
  rgb,
  themeFrom,
  type GroundTheme,
  type Palette,
  type ThemeName,
  type TokenRef,
} from "./theme";
export type { FieldConfig } from "./field/layout";
export { DEFAULT_FIELD_CONFIG } from "./field/layout";
// `instrumentSubmits` is the idle-zero instrument — install it right after
// acquiring the device (`groundField({ onDevice })`), before any consumer. A
// kept LEAF (it names nothing of the engine), exported from both entries.
export { instrumentSubmits, type SubmitInstrument } from "./submit-instrument";
// The HiC seam (design-012 §8 gate 1): the adapter module is the ONLY place a
// HiC symbol is named, and its probe is what a composited build refuses on.
export {
  changedElements,
  copyElementToTexture,
  describeHicProbe,
  drawElementImage,
  getElementTransform,
  markAsSourceCanvas,
  onPaint,
  probeHic,
  requestPaint,
  type HicCapabilities,
  type HicProbeResult,
} from "./hic-adapter";
// The overlay collectors' pure halves (C1's copies, now the only ones).
export { SoupBuilder, parseCssColor, type OverlayFrame, type Rgba, type TriSoup } from "./compose/soup";
export { collectGuides } from "./compose/guides-collect";
export { collectWires } from "./compose/wires-collect";
// Config vocabulary re-exported for app ergonomics (canonical home: @ice/core).
export {
  DEFAULT_GRID_CONFIG,
  DEFAULT_GRID_MAGNET_CONFIG,
  DEFAULT_SNAP_GUIDES_CONFIG,
  DEFAULT_WIRES_CONFIG,
  type GridConfig,
  type GridMagnetConfig,
  type SnapGuidesConfig,
  type WiresConfig,
} from "@ice/core";
