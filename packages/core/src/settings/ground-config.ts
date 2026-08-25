/**
 * Ground-layer (P0) pass configs — CANONICAL home (2026-07-16, the @ice/ground
 * extraction): plain data shared by the ground renderer, the react facade's
 * `grid` prop, and apps. They live in core because core is the vocabulary
 * package every layer may import (ground cannot import react; react cannot
 * import ground — design-002 §6). Values are verbatim from the original
 * renderers: GridConfig from v1 GridRenderer.ts:5-35 (tuned to Apple
 * Freeform / FigJam), wires + snap-guides from their 2026 dom reflectors.
 */

export interface GridConfig {
  /** World-unit spacings for up to 3 grid levels [fine, medium, coarse]. */
  spacings: [number, number, number];
  /** Dot RGB color as [r, g, b] in 0-1 range. */
  dotColor: [number, number, number];
  /** Base dot opacity multiplier (0-1). */
  dotAlpha: number;
  /** CSS-pixel range where a grid level fades in: [start, end]. */
  fadeIn: [number, number];
  /** CSS-pixel range where a grid level fades out: [start, end]. */
  fadeOut: [number, number];
  /** Dot radius range in CSS pixels [min, max]. Scaled by DPR internally. */
  dotRadius: [number, number];
  /** Per-level opacity weight: level i gets (base + i * step). */
  levelWeight: [number, number];
  /**
   * The magnet mode (design-010): a field-reactive lattice replacing the
   * classic grid's PIXELS, not its interfaces. Absent or `enabled: false`
   * ⇒ the classic analytic grid, byte-identical to pre-magnet builds.
   * `configureGrid` deep-merges THIS key one level (design-010 §3.1) so a
   * partial re-tune (e.g. `{ magnet: { reach: 80 } }`) never clobbers the
   * rest of the block. Partial by declaration: the grid pass resolves it over
   * {@link DEFAULT_GRID_MAGNET_CONFIG} — apps state only what they change.
   */
  magnet?: Partial<GridMagnetConfig>;
}

/**
 * Magnet-grid field + glyph parameters (design-010 §3.1). Deliberately free of
 * anything cursor-shaped: pole behavior (pressed-modulation, remote toggles,
 * strength curves) lives in whichever `PoleSource` the app wired (D5).
 */
export interface GridMagnetConfig {
  /** Master switch. false = classic analytic grid (the default). */
  enabled: boolean;
  /** Needles orient along the field; dots stay on the lattice and swell with |field|. */
  glyph: "dot" | "needle";
  /** CSS px at which a lone source has influence 0.5 (k = 0.5·reach²). */
  reach: number;
  /** +1 attract (needles point at sources) / −1 repel. */
  polarity: 1 | -1;
  /** Widget-silhouette SDF sources on/off (needs the readSpatial ctx seam). */
  widgets: boolean;
  /** Field strength of every widget source (per-widget override is a named §8 seam). */
  widgetStrength: number;
  /** Widget corner radius, CSS px (the engine cannot see CSS border-radius). */
  widgetRadius: number;
  /** Needles only: orient fully along the field at ANY magnitude. */
  alwaysAlign: boolean;
  /** Needle half-length, CSS px ("dot" glyph reads this as max swell radius). */
  needleLength: number;
  /** Needle half-width, CSS px. */
  needleWidth: number;
  /** Source-buffer cap (≤256); the broad-phase prioritizes within it (D2). */
  maxSources: number;
  /** Zoom below which the FIELD lerps to 0 — rest ticks remain (0 = never). */
  fadeZoom: number;
}

/** Experiment-calibrated defaults (vibe-field draft/magnet-grid HUD values). */
export const DEFAULT_GRID_MAGNET_CONFIG: GridMagnetConfig = {
  enabled: false,
  glyph: "needle",
  reach: 60,
  polarity: 1,
  widgets: true,
  widgetStrength: 1,
  widgetRadius: 12,
  alwaysAlign: false,
  needleLength: 5,
  needleWidth: 0.55,
  maxSources: 256,
  fadeZoom: 0,
};

/** Verbatim from v1 GridRenderer.ts:27-35 (Apple Freeform / FigJam feel).
 *  Deliberately does NOT carry a `magnet` block: ABSENCE is the off state.
 *  An explicit `{enabled: false}` here would ride every consumer that spreads
 *  this default into its own grid state (the widgetlab/vibe-field shape) and
 *  deep-merge "off" over a factory-level enable at the configureGrid seam —
 *  found live on the M17 build's first screenshot (design-010 §3.1 amendment). */
export const DEFAULT_GRID_CONFIG: GridConfig = {
  spacings: [20, 100, 500],
  dotColor: [0.75, 0.77, 0.8],
  dotAlpha: 1.0,
  fadeIn: [8, 16],
  fadeOut: [120, 200],
  dotRadius: [0.75, 0.75],
  levelWeight: [1.0, 0.0],
};

/** Minimal-neutral wire styling (design-004 §6: chrome is subdued; wires defer to content). */
export interface WiresConfig {
  /** Default wire stroke (CSS color). */
  wireColor: string;
  /** Accent stroke for a Selected wire. */
  selectedColor: string;
  wireWidth: number;
  selectedWidth: number;
  /** Materialized-port dot radius (CSS px) + colors (idle vs during a connect drag). */
  portRadius: number;
  portColor: string;
  portActiveColor: string;
}

export const DEFAULT_WIRES_CONFIG: WiresConfig = {
  wireColor: "rgba(120, 132, 145, 0.9)",
  selectedColor: "#4a90d9",
  wireWidth: 1.5,
  selectedWidth: 2,
  portRadius: 4,
  portColor: "rgba(120, 132, 145, 0.9)",
  portActiveColor: "#4a90d9",
};

/** v1 `DEFAULT_SNAP_GUIDE_CONFIG` (SnapGuideRenderer.ts), field for field. */
export interface SnapGuidesConfig {
  /** Guide line + spacing bar color as [r, g, b] in 0-1 range. */
  color: [number, number, number];
  /** Stroke width in screen px (constant across zoom). */
  lineWidth: number;
  /** Alignment-line alpha. */
  guideAlpha: number;
  /** Equal-spacing bar alpha. */
  spacingAlpha: number;
  /** End-tick half-length in screen px (v1 shader barHeight). */
  tickPx: number;
}

export const DEFAULT_SNAP_GUIDES_CONFIG: SnapGuidesConfig = {
  color: [1.0, 0.0, 0.55], // v1 magenta/pink
  lineWidth: 1,
  guideAlpha: 0.8,
  spacingAlpha: 0.7,
  tickPx: 4,
};
