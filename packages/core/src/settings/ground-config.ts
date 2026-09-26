/**
 * Ground-layer (P0) pass configs — CANONICAL home (2026-07-16, the then @ice/ground
 * extraction): plain data shared by the ground renderer, the react facade's
 * `grid` prop, and apps. They live in core because core is the vocabulary
 * package every layer may import (ground cannot import react; react cannot
 * import ground — design-002 §6). Values are verbatim from the original
 * renderers: GridConfig from v1 GridRenderer.ts:5-35 (tuned to Apple
 * Freeform / FigJam), wires + snap-guides from their 2026 dom reflectors.
 */

/**
 * The grid's plain-data tuning — the react `grid` prop, `configureGrid`, and a
 * canvas type's `presentation.ground.grid` all take a partial of this.
 *
 * design-013 C2 (D-C2.1): the ground draws on the ENGINE's lattice — a derived
 * decade ladder (`mid = 20·10^k`, fine = mid/10, coarse = mid·10) that fades a
 * rung IN by its own cell size and never out — so the classic grid's three
 * fixed `spacings`, its `fadeOut` window and its per-level `levelWeight`
 * retired with the classic grid. They had no field meaning (the compose host
 * dropped them silently since B2); a partial still naming them is a type
 * error now, not a no-op.
 */
export interface GridConfig {
  /** Dot RGB color as [r, g, b] in 0-1 range — the field's ink. */
  dotColor: [number, number, number];
  /** Base dot opacity multiplier (0-1). */
  dotAlpha: number;
  /** CSS-pixel range a rung fades in over, by its own cell size: [start, end]. */
  fadeIn: [number, number];
  /** Dot radius range in CSS pixels [min, max]. Scaled by DPR internally. */
  dotRadius: [number, number];
  /**
   * Magnet-field tuning (design-010 §3.1). The ground's field is the engine's
   * one implementation since design-013; this block resolves over
   * {@link DEFAULT_GRID_MAGNET_CONFIG} and maps onto the field's config
   * (`fieldConfigOf` in the retired `@ice/ground/compose`; the desk reads `fadeIn` since D5b): `glyph`, `reach`, `polarity`,
   * `alwaysAlign`, `needleLength`, `needleWidth` — the rest of the block is
   * the old magnet grid's vocabulary with no field reader (named in C2's
   * landing log).
   *
   * `configureGrid` deep-merges this key one level, so a partial re-tune such
   * as `{ magnet: { reach: 80 } }` never clobbers the rest of the block.
   */
  magnet?: Partial<GridMagnetConfig>;
}

/**
 * Magnet-grid field + glyph parameters (design-010 §3.1). Deliberately free of
 * anything cursor-shaped: pole behavior (pressed-modulation, remote toggles,
 * strength curves) lives in whichever `PoleSource` the app wired (D5).
 */
export interface GridMagnetConfig {
  /** Needles orient along the field; dots stay on the lattice and swell with |field|. */
  glyph: "dot" | "needle";
  /** CSS px at which a lone source has influence 0.5 (k = 0.5·reach²). */
  reach: number;
  /** +1 attract (needles point at sources) / −1 repel. */
  polarity: 1 | -1;
  /** Widget-silhouette SDF sources on/off — no field reader since design-013 C2 (every on-screen card is a source). */
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

/**
 * Shared visual defaults inherited from the original analytic grid (the keys
 * that survived D-C2.1). The magnet block stays optional so apps can state only
 * the magnet values they tune; the field resolves the remainder itself.
 */
export const DEFAULT_GRID_CONFIG: GridConfig = {
  dotColor: [0.75, 0.77, 0.8],
  dotAlpha: 1.0,
  fadeIn: [8, 16],
  dotRadius: [0.75, 0.75],
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
