// The cutting mat's GPU records, declared once. `MatUniforms` is what both mat
// entries read — the wind pass (plate → animated silhouette) and the fullscreen
// mat pass — and, since K4a (design-016 K-L3), the SLOT'S ONE VIEW BLOCK: the mat
// writes it once a frame and every kind drawn in the slot binds the same buffer
// (`MatPass.view`) at @group(0) @binding(0), never a copy of its own.
// `matUniformValues()` fills it by name from the frame, the config and the
// theme's numbers; nothing is hand-indexed.

import { defineStruct } from "../engine/struct";
import { boxValues, type FadeIn, lod, type View } from "../lattice/lod";
import type { LineLaw } from "../lattice/line";
import { finestLabelled, labelReach, type RulerLaw, rulerLevels, wrapsOf } from "../lattice/ruler";
import { MAT_COLORS, MAT_GRID, type RGB } from "../theme";
import { PORTAL_CHAIN_TYPE, portalValues, type Presentation } from "../nav/portal";
import type { CameraState } from "../nav/flight";
import { HERO_PROJECTOR, type Mat4, projectorMatrix } from "./projector";
import { DAY_LIGHT, lightValues, type MatLight } from "./night";

export const MatUniforms = defineStruct("MatUniforms", [
  ["cam", "vec4f"],         // camX, camY (world, UNwrapped — the projector is fixed in world), zoom, dpr
  ["view", "vec4f"],        // cssW, cssH, grain time (s), the OBJECTS' presentation opacity (the slot's × their own presence — what every kind multiplies by)
  ["phase", "vec4f"],       // wrapped camX, camY (the lattice's phase), unused ×2
  ["rungs", "vec4f"],       // fine, mid, coarse spacing (world), unused
  ["lod", "vec4f"],         // fadeIn lo, hi (CSS px), unused ×2
  ["line", "vec4f"],        // half-width thin, thick (DEVICE px), alpha thin, thick
  ["grain", "vec4f"],       // amplitude, unused ×3
  ["ground", "vec4f"],      // the mat's green (sRGB), unused
  ["ink", "vec4f"],         // the line cream (sRGB), unused
  ["plane", "vec4f"],       // desk origin x, z (m), metres per world unit, desk y (m)
  ["goboMatrix", "mat4x4f"],
  ["goboParams", "vec4f"],  // sharp, soft, near, far — the blur ramp's depths and the projector's clip range
  ["gobo", "vec4f"],        // opacity, blur radius (plate texels), shade mix, dark floor
  ["grade", "vec4f"],       // saturation bump, unused ×3
  ["noise", "vec4f"],       // blue-noise offset x, y, texel size, unused
  ["wind", "vec4f"],        // gobo time (s), plate strength, unused ×2
  ["night", "vec4f"],       // the NIGHT (mat/night.ts): amount (0 = the day's chain, exactly), the Moon's lux, exposure, snow
  ["moon", "vec4f"],        // the Moon's colour as the adapted eye takes it (linear sRGB, Y = 1), the sky's share in the shadow
  ["rod", "vec4f"],         // the rods' signal drawn as a colour (linear sRGB, Y = 1), unused
  ["eigengrau", "vec4f"],   // the dark the eye adds (linear sRGB), unused
  ["portals", PORTAL_CHAIN_TYPE], // the portal CHAIN (nav/portal.ts): each face's centre xy, half extents xy (CSS px)
  ["clips", PORTAL_CHAIN_TYPE],   // each face's corner radius, on (0/1 — a 0 ends the chain), unused ×2
  ["ruler", "vec4f"],       // the RULERS (RULER.md; lattice/ruler.ts): on (0/1), margin, band, line width (CSS px)
  ["rulerText", "vec4f"],   // the text's inset from the outer line, its gap after the tick, the major tick's length (CSS px), the atlas's texels per CSS px
  ["rulerAlpha", "vec4f"],  // ink presence: the frame's lines, the ticks, the labels, unused
  ["rulerOrigin", "vec4f"], // the lattice's wrap count of camX, camY (exact integers), the finest labelled level (−1 = none), unused
  ["rulerGlyph", "vec4f"],  // the glyph atlas: cell width, cell height, advance, baseline (texels)
  ["rulerAtlas", "vec4f"],  // the glyph atlas: width, height, cap height (texels), glyph count
  ["rulerSites", "array<vec4f, 5>"],  // per level: spacing (world), tick length (CSS px), tick presence, label presence
  ["rulerFormat", "array<vec4f, 5>"], // per level: mult, exp (a site's value = index · mult · 10^exp), wrap period over spacing, unused
  ["box", "vec4f"],         // the slot's box on the attachment: x, y, w, h (CSS px) — stats only; the mat is fullscreen under the scissor
  ["light", "vec4f"],       // the LIGHT (MINIMAT.md §4): the camera the lamp's gobo is sampled under — x, y, zoom — and the cross-fade toward `light2`
  ["light2", "vec4f"],      // the second light a flight hands the slot to: x, y, zoom, unused
  ["presence", "vec4f"],    // the SLOT's presentation opacity — what the mat itself is drawn at (K4a, K-L3: the one view block carries both), unused ×3
] as const);

export type PlateName = "c" | "b";

/** The rulers printed on the mat (RULER.md): the law's numbers, and whether this slot prints them at all — the ROOT does, a portal's inside never. */
export interface RulerConfig extends RulerLaw { readonly on: boolean }

/**
 * What the pass knows about the glyph atlas it samples for the labels
 * (`MatPass.setGlyphs`): "0123456789-." in that order, one cell each, drawn
 * `PAD` texels in from the cell's left edge with the baseline `baseline`
 * texels under the cell's top, at `scale` texels per CSS px of the ruler's
 * text size. The lab renders it from the product's mono stack at the device's
 * ratio; the oracle reads a committed one (lab/assets/glyphs-mono-2x.r8).
 */
export interface GlyphAtlasMeta {
  readonly scale: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly advance: number;
  readonly baseline: number;
  readonly cap: number;
  readonly width: number;
  readonly height: number;
  readonly count: number;
}
/** Texels between a cell's left edge and its glyph's origin — room for a bearing either way. */
export const GLYPH_PAD = 2;
/**
 * The glyphs the atlas holds, in cell order: the rulers' twelve first (ruler.wgsl indexes them by
 * this), then the capitals and the few marks a mini mat's printed NAME may use (MINIMAT.md §2) —
 * the design's print label is mono capitals. An atlas holds at least the rulers' twelve.
 */
export const GLYPHS = "0123456789-." + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + " &'/·#()+:";
/** The rulers' own glyphs — the first this many of `GLYPHS`, what every atlas must hold. */
export const RULER_GLYPHS = 12;
/** No atlas uploaded: a 1×1 empty cell — labels sample nothing. */
export const NO_GLYPHS: GlyphAtlasMeta = { scale: 1, cellW: 1, cellH: 1, advance: 1, baseline: 1, cap: 1, width: 1, height: 1, count: 0 };

/** The mat's tuning — theme.ts's numbers unless a host tweaks them. */
export interface MatConfig {
  readonly line: LineLaw;
  readonly grain: number;
  readonly ground: RGB;
  readonly ink: RGB;
  readonly gobo: {
    readonly opacity: number;
    readonly blurTexels: number;
    readonly shadeMix: number;
    readonly darkFloor: number;
    readonly saturate: number;
    readonly sharp: number;
    readonly soft: number;
    readonly plate: PlateName;
  };
  readonly plane: { readonly metresPerUnit: number; readonly originX: number; readonly originZ: number; readonly deskY: number };
  /** The rulers (RULER.md); off unless a host prints them on this slot. */
  readonly ruler: RulerConfig;
}

/**
 * The LIGHT a slot is lit by (MINIMAT.md §4) — the camera the lamp's gobo is sampled under, not the one
 * the slot draws under. The root at rest is lit by its own lamp (absent = that). A mini mat's inside is
 * lit by the lamp of the desk the mini mat lies on — `a` is the host's camera — so the dapple runs across
 * the mini mat as across any object on the desk. While a flight, or a zoom-through's re-dressing, hands
 * one desk's lamp to the other, the two are cross-faded: `t` of the way to `b`. Each camera is in the
 * frame it belongs to; none need share the slot's.
 */
export interface SlotLight { readonly a: CameraState; readonly b?: CameraState; readonly t?: number }

/** What moves per frame — the host owns every clock and the tilt. */
export interface MatFrame {
  /** Seconds; drives the grain's drift. */
  readonly time: number;
  /** Seconds; drives the wind. Advanced by the host at its wind speed. */
  readonly goboTime: number;
  /** `projection · view` (· tilt), column-major — `projector.ts`. */
  readonly goboMatrix: Mat4;
  /** Blue-noise UV offset for this frame — random while animating, fixed for a still. */
  readonly noise: readonly [number, number];
}

export const DEFAULT_MAT_CONFIG: MatConfig = {
  line: MAT_GRID.line,
  grain: MAT_GRID.grain,
  ground: MAT_COLORS.ground,
  ink: MAT_COLORS.line,
  gobo: {
    opacity: MAT_GRID.gobo.opacity, blurTexels: MAT_GRID.gobo.blurTexels,
    shadeMix: MAT_GRID.gobo.shadeMix, darkFloor: MAT_GRID.gobo.darkFloor, saturate: MAT_GRID.gobo.saturate,
    sharp: MAT_GRID.gobo.sharp, soft: MAT_GRID.gobo.soft, plate: MAT_GRID.gobo.plate,
  },
  plane: MAT_GRID.plane,
  ruler: { on: false, ...MAT_GRID.ruler },
};

export const HERO_MATRIX: Mat4 = projectorMatrix(HERO_PROJECTOR);
export const STILL_MAT_FRAME: MatFrame = { time: 0, goboTime: 0, goboMatrix: HERO_MATRIX, noise: [0, 0] };

export const NOISE_SIZE = 128;
export const PLATE_SIZE = 512;

export function matUniformValues(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, f: MatFrame, plateStrength: number, present?: Presentation, light: MatLight = DAY_LIGHT, glyphs: GlyphAtlasMeta = NO_GLYPHS, lit?: SlotLight) {
  const l = lod(view);
  const r = cfg.ruler;
  // one set of levels serves both rulers: the wider reach decides which levels can carry their labels
  const levels = rulerLevels(l, view.zoom, r, Math.max(labelReach(view.camX, view.zoom, view.width), labelReach(view.camY, view.zoom, view.height)));
  return {
    cam: [view.camX, view.camY, view.zoom, view.dpr],
    view: [view.width, view.height, f.time, present === undefined ? 1 : present.objects === undefined ? present.opacity : present.opacity * present.objects],
    phase: [((view.camX % l.wrapPeriod) + l.wrapPeriod) % l.wrapPeriod, ((view.camY % l.wrapPeriod) + l.wrapPeriod) % l.wrapPeriod, 0, 0],
    rungs: [l.fine, l.mid, l.coarse, 0],
    lod: [fadeIn[0], Math.max(fadeIn[1], fadeIn[0] + 1e-3), 0, 0],
    line: [cfg.line.thin, cfg.line.thick, cfg.line.alphaThin, cfg.line.alphaThick],
    grain: [cfg.grain, 0, 0, 0],
    ground: [cfg.ground[0], cfg.ground[1], cfg.ground[2], 0],
    ink: [cfg.ink[0], cfg.ink[1], cfg.ink[2], 0],
    plane: [cfg.plane.originX, cfg.plane.originZ, cfg.plane.metresPerUnit, cfg.plane.deskY],
    goboMatrix: f.goboMatrix,
    goboParams: [cfg.gobo.sharp, cfg.gobo.soft, HERO_PROJECTOR.near, HERO_PROJECTOR.far],
    gobo: [cfg.gobo.opacity, cfg.gobo.blurTexels, cfg.gobo.shadeMix, cfg.gobo.darkFloor],
    grade: [cfg.gobo.saturate, 0, 0, 0],
    noise: [f.noise[0], f.noise[1], 1 / NOISE_SIZE, 0],
    wind: [f.goboTime, plateStrength, 0, 0],
    ...lightValues(light),
    ...portalValues(present),
    ruler: [r.on ? 1 : 0, r.margin, r.band, r.line],
    rulerText: [r.text.top, r.text.gap, r.tick[2], glyphs.scale],
    rulerAlpha: [r.alpha.frame, r.alpha.tick, r.alpha.label, 0],
    rulerOrigin: [wrapsOf(view.camX, l.wrapPeriod), wrapsOf(view.camY, l.wrapPeriod), finestLabelled(levels), 0],
    rulerGlyph: [glyphs.cellW, glyphs.cellH, glyphs.advance, glyphs.baseline],
    rulerAtlas: [glyphs.width, glyphs.height, glyphs.cap, glyphs.count],
    rulerSites: levels.flatMap((L) => [L.spacing, L.tickLen, L.tickAlpha, L.labelAlpha]),
    rulerFormat: levels.flatMap((L) => [L.mult, L.exp, L.perWrap, 0]),
    box: boxValues(view),
    ...slotLightValues(view, lit),
    // the slot's own opacity, which the mat is drawn at; `view.w` above is the objects' (what the ground's `objectsOf` hands the kinds'
    // `SlotContext.present`). One view block per slot carries both (K4a, design-016 K-L3), so every kind reads it as it always read its copy
    presence: [present?.opacity ?? 1, 0, 0, 0],
  };
}

/**
 * A light with its ends collapsed: a handover at t ≤ 0 is `a` alone, at t ≥ 1 `b` alone — so a slot
 * at either end of one is lit through exactly the path a slot lit by that camera always takes.
 */
export function settleLight(lit: SlotLight | undefined): SlotLight | undefined {
  if (!lit?.b) return lit;
  const t = lit.t ?? 0;
  return t <= 0 ? { a: lit.a } : t >= 1 ? { a: lit.b } : lit;
}
/** Is a slot lit by its own camera — no light, or one that settles on the camera it draws under? */
export function litByOwn(view: View, lit: SlotLight | undefined): boolean {
  const s = settleLight(lit);
  return !s || (!s.b && s.a.x === view.camX && s.a.y === view.camY && s.a.zoom === view.zoom);
}

/** The `light` / `light2` records: the slot's own camera unless it is lit from elsewhere (`SlotLight`). */
function slotLightValues(view: View, lit: SlotLight | undefined): { light: number[]; light2: number[] } {
  const own = { x: view.camX, y: view.camY, zoom: view.zoom };
  const s = settleLight(lit);
  const a = s?.a ?? own;
  const b = s?.b ?? a;
  const t = s?.b ? (s.t ?? 0) : 0;
  return { light: [a.x, a.y, a.zoom, t], light2: [b.x, b.y, b.zoom, 0] };
}
