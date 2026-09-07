// The glyph size chain, mirrored on the CPU — the same arithmetic the four
// PASS 2 entries run (magnet.wgsl: fit_hl / fit_hw · the influence mix ·
// dot_radius / needle_len / needle_wid). Pure: numbers in, numbers out. The
// test sweeps it to prove the preset ranges hold; a host can ask it what a
// glyph will measure before drawing one. Size depends on the cell and the
// field only — every rung draws the same size (lod.ts).

import { rungAlpha } from "../lattice/lod";
import { type FieldConfig, normaliseRange } from "./layout";

export { rungAlpha };

export interface SizeInputs {
  /** This rung's cell on screen, CSS px. */
  readonly cellPx: number;
  /** Field influence at the site, 0..1. */
  readonly influence: number;
}

export interface GlyphSize {
  readonly dot: number;    // radius, CSS px
  readonly len: number;    // needle half-length, CSS px
  readonly wid: number;    // needle half-width, CSS px
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clampTo = (x: number, r: readonly [number, number]) => { const [lo, hi] = normaliseRange(r); return Math.min(Math.max(x, lo), hi); };

/** The size chain WITHOUT the preset clamp. */
export function rawGlyphSize(cfg: Pick<FieldConfig, "halfLen" | "halfWidth">, s: SizeInputs): GlyphSize {
  const cell = Math.max(s.cellPx, 1e-6);
  const hl = Math.min(cfg.halfLen, cell * 0.42);
  const hw = Math.min(cfg.halfWidth, cell * 0.42 * 0.22);
  return {
    dot: mix(hl * 0.16, hl * 1.05, s.influence),
    len: mix(hl * 0.55, hl, s.influence),
    wid: mix(hw * 0.85, hw * 1.15, s.influence),
  };
}

/** The size chain as drawn: the raw size, clamped into the preset ranges. */
export function glyphSize(cfg: Pick<FieldConfig, "halfLen" | "halfWidth" | "dotRadius" | "needleHalfLen" | "needleHalfWidth">, s: SizeInputs): GlyphSize {
  const raw = rawGlyphSize(cfg, s);
  return { dot: clampTo(raw.dot, cfg.dotRadius), len: clampTo(raw.len, cfg.needleHalfLen), wid: clampTo(raw.wid, cfg.needleHalfWidth) };
}
