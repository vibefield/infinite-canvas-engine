/**
 * Hysteresis-banded zoom-resolution policy — ported from v1 `ZoomBands.ts`
 * (RFC-002). An island FBO is allocated at `widget bounds × dpr × band(zoom)`;
 * while zoom stays within `[band × 0.5, band × 2]` no repaint is needed.
 * Bands are powers of 2 (each covers a 4× display range).
 */
export const ZOOM_BANDS = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16] as const;
const MIN_BAND = 0.0625;
const MAX_BAND = 16;

/** Smallest band ≥ zoom (clamped to the ladder). */
export function selectBand(zoom: number): number {
  if (zoom <= MIN_BAND) return MIN_BAND;
  if (zoom >= MAX_BAND) return MAX_BAND;
  for (const b of ZOOM_BANDS) {
    if (zoom <= b) return b;
  }
  return MAX_BAND;
}

/**
 * True when zoom left the `[band × 0.5, band × 2]` window of the band the
 * island was painted at. `paintedBand ≤ 0` = never painted (handled elsewhere).
 */
export function isOutOfBand(currentZoom: number, paintedBand: number): boolean {
  if (paintedBand <= 0) return false;
  const ratio = currentZoom / paintedBand;
  return ratio > 2 || ratio < 0.5;
}

/** FBO pixel size for a widget at a band (v1: `bounds × dpr × band`, min 1px). */
export function fboPixelSize(
  worldWidth: number,
  worldHeight: number,
  dpr: number,
  band: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(worldWidth * dpr * band)),
    height: Math.max(1, Math.round(worldHeight * dpr * band)),
  };
}
