/**
 * Magnet-grid collector — the pure ECS→packed-sources half of the magnet pass
 * (design-010 §4; the `*-collect.ts` convention: imports ONLY core/kernel so
 * it unit-tests under happy-dom with no GPU and no three import).
 *
 * Ported from vibe-field draft/magnet-grid `main.js` (latticeWindow,
 * packCards) with the design-010 upgrades the experiment lacked:
 *  - rbush broad-phase over the ONE spatial index instead of an all-cards
 *    walk (D2 — document size becomes irrelevant by construction);
 *  - N poles from injected sources, packed as DEGENERATE rounded boxes
 *    (half = 0, r = 0 — reduces exactly to the point-charge formula, D3);
 *  - `maxSources` prioritization (largest screen area, then nearest to the
 *    viewport center; poles pack first and are never evicted);
 *  - `fadeZoom` — the field quiets below a zoom threshold (scale 0 skips the
 *    spatial query entirely: the cheap valve is also the right look).
 */
import {
  DEFAULT_GRID_MAGNET_CONFIG,
  type Entity,
  type GridConfig,
  type GridMagnetConfig,
  type World,
} from "@ice/core";
import { worldToScreen, type AABB, type SpatialEntry } from "@ice/kernel";
import type { GroundFrame } from "../pass";
import type { Pole } from "../poles";
import { readWidgetRect } from "./wires-collect";

/** Floats per packed source: [cx, cy, hx, hy] + [r, strength, 0, 0] (screen px). */
export const MAGNET_SOURCE_FLOATS = 8;
/** Source-buffer capacity — the scratch array and GPU buffer are sized to this. */
export const MAX_MAGNET_SOURCES = 256;
/** Per-level instance guard (vibe-field main.js:621 — a level beyond it draws nothing). */
export const MAX_MAGNET_INSTANCES = 220_000;

/** The broad-phase reader over the shared spatial index (ctx seam, design-010 §3.2). */
export type ReadSpatial = (bounds: AABB) => readonly SpatialEntry<Entity>[];

/** Resolve the partial config block over the defaults — the ONE resolution point. */
export function resolveMagnet(cfg: GridConfig): GridMagnetConfig {
  return { ...DEFAULT_GRID_MAGNET_CONFIG, ...cfg.magnet };
}

/** Closed-form fade ladder (grid.ts:72-74 re-expressed in JS for level skip). */
export function fadeOpacity(
  cssSpacing: number,
  fadeIn: readonly [number, number],
  fadeOut: readonly [number, number],
): number {
  const rise = (cssSpacing - fadeIn[0]) / Math.max(fadeIn[1] - fadeIn[0], 0.0001);
  const fall = 1 - (cssSpacing - fadeOut[0]) / Math.max(fadeOut[1] - fadeOut[0], 0.0001);
  return Math.min(Math.max(Math.min(rise, fall), 0), 1);
}

/**
 * The field zoom valve: 1 at `zoom ≥ fadeZoom`, lerping to 0 across
 * [0.7·fadeZoom, fadeZoom]. 0 disables the valve entirely.
 */
export function magnetFieldScale(zoom: number, fadeZoom: number): number {
  if (fadeZoom <= 0) return 1;
  const t = (zoom - 0.7 * fadeZoom) / (0.3 * fadeZoom);
  return Math.min(Math.max(t, 0), 1);
}

/** One lattice level's visible window + fade (vibe-field main.js:81-91 port). */
export interface MagnetLevel {
  /** Integer lattice coords of the window origin. */
  readonly i0: number;
  readonly j0: number;
  readonly cols: number;
  readonly rows: number;
  /** Instances to draw; 0 = level skipped (faded out or over the guard). */
  readonly count: number;
  /** Fade-ladder opacity × level weight (CPU-baked; the shader gets one alpha). */
  readonly alpha: number;
  /**
   * Coincidence skip (design-010 §5.4): when the NEXT level up is visible and
   * its spacing is an integer multiple m of this one, sites whose absolute
   * lattice index is ≡ 0 (mod m) on both axes drop out — replicating the
   * classic shader's max-composite look. 0 = no skip.
   */
  readonly skipModulo: number;
}

export function collectMagnetLevels(frame: GroundFrame, cfg: GridConfig): MagnetLevel[] {
  const { camera } = frame;
  const out: MagnetLevel[] = [];
  const opacities = cfg.spacings.map((s) => fadeOpacity(s * camera.zoom, cfg.fadeIn, cfg.fadeOut));
  for (let i = 0; i < cfg.spacings.length; i++) {
    const spacing = cfg.spacings[i] as number;
    const opacity = opacities[i] as number;
    const weight = cfg.levelWeight[0] + i * cfg.levelWeight[1];
    const alpha = opacity * weight * cfg.dotAlpha;
    if (opacity < 0.01 || alpha <= 0) {
      out.push({ i0: 0, j0: 0, cols: 0, rows: 0, count: 0, alpha: 0, skipModulo: 0 });
      continue;
    }
    const worldW = frame.width / camera.zoom;
    const worldH = frame.height / camera.zoom;
    const i0 = Math.floor(camera.x / spacing) - 1;
    const j0 = Math.floor(camera.y / spacing) - 1;
    const i1 = Math.ceil((camera.x + worldW) / spacing) + 1;
    const j1 = Math.ceil((camera.y + worldH) / spacing) + 1;
    const cols = Math.max(1, i1 - i0);
    const rows = Math.max(1, j1 - j0);
    const count = cols * rows;
    if (count > MAX_MAGNET_INSTANCES) {
      out.push({ i0: 0, j0: 0, cols: 0, rows: 0, count: 0, alpha: 0, skipModulo: 0 });
      continue;
    }
    let skipModulo = 0;
    const next = cfg.spacings[i + 1];
    if (next !== undefined && (opacities[i + 1] as number) >= 0.01) {
      const ratio = next / spacing;
      if (Number.isInteger(ratio) && ratio > 1) skipModulo = ratio;
    }
    out.push({ i0, j0, cols, rows, count, alpha, skipModulo });
  }
  return out;
}

interface WidgetCandidate {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  r: number;
  area: number;
  centerDist: number;
}

/**
 * Pack field sources into `out` (stride {@link MAGNET_SOURCE_FLOATS}, screen
 * CSS px). Returns the packed count. `fieldScale` multiplies every strength
 * (the zoom valve); 0 short-circuits to an empty buffer — no spatial query.
 */
export function collectMagnetSources(
  world: World,
  frame: GroundFrame,
  magnet: GridMagnetConfig,
  fieldScale: number,
  poles: readonly Pole[],
  readSpatial: ReadSpatial | undefined,
  out: Float32Array,
): number {
  if (fieldScale <= 0) return 0;
  const { camera } = frame;
  const cap = Math.min(magnet.maxSources, MAX_MAGNET_SOURCES, Math.floor(out.length / MAGNET_SOURCE_FLOATS));
  let n = 0;

  // Poles first — never evicted by widgets (design-010 §4).
  for (const pole of poles) {
    if (n >= cap) break;
    if (!(pole.strength > 0)) continue;
    const s = pole.space === "screen" ? pole : worldToScreen(pole.x, pole.y, camera);
    const o = n * MAGNET_SOURCE_FLOATS;
    out[o + 0] = s.x;
    out[o + 1] = s.y;
    out[o + 2] = 0;
    out[o + 3] = 0;
    out[o + 4] = 0;
    out[o + 5] = pole.strength * fieldScale;
    out[o + 6] = 0;
    out[o + 7] = 0;
    n++;
  }

  if (!magnet.widgets || readSpatial === undefined || magnet.widgetStrength <= 0 || n >= cap) {
    return n;
  }

  // Broad-phase: viewport ∪ influence halo. The shader's reject cutoff is
  // pad = √(k/0.02) = 5·reach CSS px (influence 0.02 ≈ invisible), scaled by
  // per-source √strength — query with the strength-scaled halo so nothing the
  // shader could show is culled here.
  const haloCss = 5 * magnet.reach * Math.sqrt(Math.max(magnet.widgetStrength * fieldScale, 0.0001));
  const pad = haloCss / camera.zoom;
  const hits = readSpatial({
    minX: camera.x - pad,
    minY: camera.y - pad,
    maxX: camera.x + frame.width / camera.zoom + pad,
    maxY: camera.y + frame.height / camera.zoom + pad,
  });

  const viewCx = frame.width / 2;
  const viewCy = frame.height / 2;
  const candidates: WidgetCandidate[] = [];
  for (const hit of hits) {
    // The index also carries wires/ports (they share it) — the rect reader is
    // the widget filter: Position + non-zero MeasuredSize|Size only.
    const rect = readWidgetRect(world, hit.id);
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) continue;
    const hx = (rect.width / 2) * camera.zoom;
    const hy = (rect.height / 2) * camera.zoom;
    const center = worldToScreen(rect.x + rect.width / 2, rect.y + rect.height / 2, camera);
    candidates.push({
      cx: center.x,
      cy: center.y,
      hx,
      hy,
      r: Math.min(magnet.widgetRadius * camera.zoom, hx, hy),
      area: hx * hy,
      centerDist: (center.x - viewCx) ** 2 + (center.y - viewCy) ** 2,
    });
  }

  const budget = cap - n;
  if (candidates.length > budget) {
    candidates.sort((a, b) => b.area - a.area || a.centerDist - b.centerDist);
    candidates.length = budget;
  }

  const strength = magnet.widgetStrength * fieldScale;
  for (const c of candidates) {
    const o = n * MAGNET_SOURCE_FLOATS;
    out[o + 0] = c.cx;
    out[o + 1] = c.cy;
    out[o + 2] = c.hx;
    out[o + 3] = c.hy;
    out[o + 4] = c.r;
    out[o + 5] = strength;
    out[o + 6] = 0;
    out[o + 7] = 0;
    n++;
  }
  return n;
}
