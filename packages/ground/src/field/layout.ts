// The field's GPU records, declared ONCE. `Uniforms.wgsl` and `Card.wgsl` are
// prepended to every field shader by the engine; `uniformValues()` and
// `packSources()` fill them by name. There is no hand-indexed float anywhere.

import { defineStruct } from "../engine/struct";
import { atlasGeom, boxValues, type FadeIn, fineAlpha, lod, rungCounts, type View } from "../lattice/lod";
import { ENGINE_GRID, type RGB } from "../theme";
import { PORTAL_CHAIN_TYPE, portalValues, type Presentation } from "../nav/portal";

export const Uniforms = defineStruct("Uniforms", [
  ["cam", "vec4f"],    // camX, camY (world), zoom, dpr
  ["view", "vec4f"],   // cssW, cssH, pointerX, pointerY
  ["phase", "vec4f"],  // wrapped camX, camY, decade fade (stats only — no shader reads it), atlas step (world units)
  ["atlas", "vec4f"],  // atlas origin index i, j, atlas dims w, h
  ["rungs", "vec4f"],  // fine, mid, coarse spacing (world), unused
  ["cols", "vec4f"],   // instance columns for fine, mid, coarse, unused
  ["glyph", "vec4f"],  // restDir x, y, halfLen (CSS px), halfWidth (CSS px)
  ["dotRange", "vec4f"],    // dot radius min, max (CSS px), unused ×2
  ["needleRange", "vec4f"], // needle half-length min, max · half-width min, max (CSS px)
  ["field", "vec4f"],  // k, eps, polarity, alwaysAlign
  ["color", "vec4f"],  // ink r, g, b, base alpha
  ["flags", "vec4f"],  // sourceCount, pointerOn, unused ×2
  ["lod", "vec4f"],    // fadeIn lo, hi (a rung's own cell, CSS px), unused ×2
  ["portals", PORTAL_CHAIN_TYPE], // the portal CHAIN (nav/portal.ts): each face's centre xy, half extents xy (CSS px)
  ["clips", PORTAL_CHAIN_TYPE],   // each face's corner radius, on (0/1 — a 0 ends the chain), unused ×2
  ["box", "vec4f"],    // the slot's box on the attachment: x, y, w, h (CSS px) — what is instanced and culled (lod.ts `boxValues`)
] as const);

// One field SOURCE: a rounded rect in screen CSS px. A card is one of these,
// and so would be anything else that should bend the lattice.
export const Card = defineStruct("Card", [
  ["center_half", "vec4f"],  // centre xy, half extents xy (CSS px)
  ["shape", "vec4f"],        // corner radius, field strength, unused, unused
] as const);

export const MAX_SOURCES = 1024;

export interface FieldSource {
  /** Screen CSS px. */
  readonly cx: number; readonly cy: number;
  readonly hx: number; readonly hy: number;
  readonly r: number;
  readonly strength: number;
}

/** A closed size range, CSS px: `[min, max]`. */
export type GlyphRange = readonly [number, number];
/** No clamp at all — what the raw prototype draws; the A/B scenes state it. */
export const OPEN_RANGE: GlyphRange = [0, 1e9];

/** Order and floor a range so the shader's `clamp` is always well-formed. */
export function normaliseRange(r: GlyphRange): GlyphRange {
  const lo = Math.max(Math.min(r[0], r[1]), 0);
  const hi = Math.max(r[0], r[1], 0);
  return [lo, hi];
}

/** A glyph by name: the engine's `dot`, or a registered grid program's (`needle`, `mat` — packs/). */
export type GridGlyph = string;

export interface FieldConfig {
  readonly glyph: GridGlyph;
  /** A rung fades in between these cell sizes, CSS px (lod.ts `FadeIn`). */
  readonly fadeIn: FadeIn;
  /** CSS px at which a source's influence is 0.5. */
  readonly reach: number;
  /** The glyph's BASE half-length / half-width, CSS px — what the cell fit and the field scale. */
  readonly halfLen: number;
  readonly halfWidth: number;
  /**
   * The PRESET size ranges, CSS px: whatever the cell fit and the field make of
   * the base size, the drawn dot radius / needle half-length / needle
   * half-width is clamped into these, last. `OPEN_RANGE` disables a clamp.
   */
  readonly dotRadius: GlyphRange;
  readonly needleHalfLen: GlyphRange;
  readonly needleHalfWidth: GlyphRange;
  readonly polarity: 1 | -1;
  readonly alwaysAlign: boolean;
  /** §2.1 `--vf-canvas-magnet-ink` for the theme in force — the host projects it from `theme.ts`. */
  readonly ink: RGB;
  /** The product's `dotAlpha`; the glyph shaders scale their rest/field alphas by it. */
  readonly inkAlpha: number;
  readonly fineSchedule: "auto" | "instanced" | "fullscreen";
  /** A grid program's own config, by glyph name (the mat's gobo, plate and wind: `ext.mat`); absent = the program's defaults. */
  readonly ext?: Readonly<Record<string, unknown>>;
}

export interface FieldFrame {
  readonly view: View & { readonly dpr: number };
  readonly pointer: { readonly x: number; readonly y: number; readonly on: boolean };
  /**
   * The zoom this slot's grid is DRESSED for (PORTAL.md §9): its fade-in window and glyph
   * size presets scale by `view.zoom / lodZoom`, so the grid looks like the grid at
   * `lodZoom` scaled — a portal shows its inside as it will look at the arrival, an
   * arriving slot lands on its own dressing, a departed one keeps the cut's. Absent = the
   * view's zoom: the root at rest, dressed for where it is.
   */
  readonly lodZoom?: number;
  /** A grid program's per-frame clocks, by glyph name (the mat's time, gobo time, tilt: `ext.mat`); absent = a still. */
  readonly ext?: Readonly<Record<string, unknown>>;
  /** Opacity and the portal clip (nav/portal.ts); absent = everything, at full strength. */
  readonly present?: Presentation;
}

/** The ENGINE's grid — ICE's own defaults (theme.ts `ENGINE_GRID`) until a host projects its product's (lab/theme.ts `PRODUCT_GRID` and its theme's ink). */
export const DEFAULT_FIELD_CONFIG: FieldConfig = {
  glyph: ENGINE_GRID.glyph, reach: ENGINE_GRID.reach, halfLen: ENGINE_GRID.needleLength, halfWidth: ENGINE_GRID.needleWidth,
  dotRadius: ENGINE_GRID.dotRadius, needleHalfLen: ENGINE_GRID.needleHalfLen, needleHalfWidth: ENGINE_GRID.needleHalfWidth,
  fadeIn: ENGINE_GRID.fadeIn,
  polarity: ENGINE_GRID.polarity, alwaysAlign: ENGINE_GRID.alwaysAlign,
  ink: ENGINE_GRID.ink.rgb, inkAlpha: ENGINE_GRID.dotAlpha, fineSchedule: "auto",
};

/** The floors a dressed preset keeps, CSS px: a glyph never vanishes into the AA (dot radius, needle half-length, half-width). */
export const DRESS_FLOOR = { dot: 0.5, len: 0.5, wid: 0.3 } as const;

/**
 * The config a slot renders with when its grid is dressed for `lodZoom` (PORTAL.md §9): the
 * fade-in window, the size presets AND the field's reach scale by `σ = zoom / lodZoom` — the
 * grid at `lodZoom` scaled whole, the bend around a miniature card a miniature bend — the
 * presets floored so a glyph stays a glyph. σ = 1 is the identity — the object itself, not
 * a copy.
 */
export function dressConfig(cfg: FieldConfig, zoom: number, lodZoom?: number): FieldConfig {
  if (lodZoom === undefined || !(lodZoom > 0) || lodZoom === zoom) return cfg;
  const s = zoom / lodZoom;
  const range = (r: GlyphRange, floor: number): GlyphRange => { const [lo, hi] = normaliseRange(r); return [Math.max(lo * s, floor), Math.max(hi * s, floor)]; };
  return {
    ...cfg,
    reach: cfg.reach * s,
    fadeIn: [cfg.fadeIn[0] * s, cfg.fadeIn[1] * s],
    halfLen: cfg.halfLen * s, halfWidth: cfg.halfWidth * s,
    dotRadius: range(cfg.dotRadius, DRESS_FLOOR.dot), needleHalfLen: range(cfg.needleHalfLen, DRESS_FLOOR.len), needleHalfWidth: range(cfg.needleHalfWidth, DRESS_FLOOR.wid),
  };
}

/** The reach the bake uses to reject sources — mirrors `pad` in atlas-bake.wgsl. */
export function fieldReachPx(reach: number): number {
  const k = 0.5 * reach * reach;
  return Math.sqrt(Math.max(k, 1) / 0.02);
}

/**
 * The widest reach a glyph can have, CSS px — what the atlas margin is derived
 * from. The dot's swollen radius (1.05× the base half-length), or a preset FLOOR
 * if a host sets one above it (the clamp can only lift a size that far).
 */
export const glyphReachPx = (cfg: Pick<FieldConfig, "halfLen" | "dotRadius" | "needleHalfLen">): number =>
  Math.max(cfg.halfLen * 1.05, normaliseRange(cfg.dotRadius)[0], normaliseRange(cfg.needleHalfLen)[0]);

export function uniformValues(f: FieldFrame, cfg: FieldConfig, sourceCount: number) {
  const l = lod(f.view);
  const geom = atlasGeom(f.view, l, glyphReachPx(cfg), fineAlpha(l, f.view.zoom, cfg.fadeIn));
  const counts = rungCounts(f.view, l);
  const k = 0.5 * cfg.reach * cfg.reach;
  return {
    cam: [f.view.camX, f.view.camY, f.view.zoom, f.view.dpr],
    view: [f.view.width, f.view.height, f.pointer.x, f.pointer.y],
    phase: [geom.phaseX, geom.phaseY, l.fade, geom.step],
    atlas: [geom.originI, geom.originJ, geom.w, geom.h],
    rungs: [l.fine, l.mid, l.coarse, 0],
    cols: [counts[0].cols, counts[1].cols, counts[2].cols, 0],
    glyph: [0, 1, cfg.halfLen, cfg.halfWidth],
    dotRange: [...normaliseRange(cfg.dotRadius), 0, 0],
    needleRange: [...normaliseRange(cfg.needleHalfLen), ...normaliseRange(cfg.needleHalfWidth)],
    field: [k, 25, cfg.polarity, cfg.alwaysAlign ? 1 : 0],
    color: [cfg.ink[0], cfg.ink[1], cfg.ink[2], cfg.inkAlpha * (f.present?.opacity ?? 1)],
    flags: [sourceCount, f.pointer.on ? 1 : 0, 0, 0],
    lod: [cfg.fadeIn[0], Math.max(cfg.fadeIn[1], cfg.fadeIn[0] + 1e-3), 0, 0],
    ...portalValues(f.present),
    box: boxValues(f.view),
  };
}

/**
 * Pack the sources that can reach the viewport, in order. The cull pad is the
 * FIELD's reach: a source off-screen still bends the lattice inside it. Returns
 * the packed count; this is the CPU cull the study's "CPU cull + instance" row.
 */
export function packSources(
  sources: readonly FieldSource[],
  view: { readonly width: number; readonly height: number; readonly box?: View["box"] },
  reach: number,
  into: { set(values: { center_half: number[]; shape: number[] }, index: number): void; readonly count: number },
): number {
  const pad0 = fieldReachPx(reach);
  const b = view.box ?? { x: 0, y: 0, w: view.width, h: view.height };
  let n = 0;
  for (const s of sources) {
    if (n >= into.count) break;
    const pad = pad0 * Math.sqrt(Math.max(s.strength, 0.0001));
    if (s.cx + s.hx + pad < b.x || s.cy + s.hy + pad < b.y || s.cx - s.hx - pad > b.x + b.w || s.cy - s.hy - pad > b.y + b.h) continue;
    into.set({ center_half: [s.cx, s.cy, s.hx, s.hy], shape: [s.r, s.strength, 0, 0] }, n);
    n += 1;
  }
  return n;
}
