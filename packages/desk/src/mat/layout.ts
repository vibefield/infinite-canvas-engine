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

/**
 * THE SLOT'S VIEW BLOCK — the kit's `view` piece (`kitWgsl([..., "view"])`): one per slot, written by the mat once a frame and
 * bound by every kind drawn in the slot at `@group(0) @binding(0)` as `u` (`MatPass.view`); a kind never writes it. Every field
 * is a vec4f but `goboMatrix` (mat4x4f) and the four arrays, so nothing is padded; its size is `MatUniforms.size`.
 *
 * THE CONVENTIONS (petition I31; mat.wgsl's header says them for the WGSL): WORLD units — one is one CSS px at zoom 1, x right
 * and y DOWN; CSS px — the attachment's layout px, origin its top-left, y down, `(world − cam.xy) · zoom`; DEVICE px — the
 * attachment's texels, `CSS px · dpr` (a fragment's `@builtin(position).xy`); colours sRGB-encoded 0..1 unless marked LINEAR.
 * The fields, x · y · z · w:
 *
 * - `cam` — the camera: the world point at the attachment's top-left (x, y — UNWRAPPED world units: the projector is fixed in
 *   world), the zoom (z — CSS px per world unit, `mat_zoom`), the attachment's device px per CSS px (w — `mat_dpr`; below 1
 *   for a capture's thumbnail or the held desk copy, petition I29);
 * - `view` — the attachment's size (x, y — CSS px), the grain's clock (z — seconds), the OBJECTS' presentation opacity (w —
 *   0..1, the slot's × their own presence: what every kind multiplies its output by);
 * - `phase` — the camera wrapped to the lattice's coarse period (x, y — world units: the lattice's phase, which the lines are
 *   drawn from); z, w unused;
 * - `rungs` — the fine, mid and coarse rungs' spacings (x, y, z — world units); w unused;
 * - `lod` — the grid's fade-in window (x, y — CSS px of a rung's cell; `GRID.fadeIn`); z, w unused;
 * - `line` — a line's half-width thin and thick (x, y — DEVICE px) and its alpha thin and thick (z, w — 0..1): `line_weight`;
 * - `grain` — the grain's amplitude (x — sRGB, ±); y, z, w unused;
 * - `ground` — the mat's green (xyz — sRGB 0..1); w unused;
 * - `ink` — the lines' cream (xyz — sRGB 0..1); w unused;
 * - `plane` — world → the desk: the desk origin's x and z (x, y — metres, the projector's frame), metres per world unit (z),
 *   the desk's height (w — metres, y up): `desk_of`;
 * - `goboMatrix` — the projector: `projection · view` (· the pointer's tilt), column-major, desk metres → its clip space
 *   (WebGL's z range);
 * - `goboParams` — the blur ramp's sharp and soft depths (x, y — metres from the projector), the projector's near and far (z,
 *   w — metres): `blur_ratio`;
 * - `gobo` — the dapple's opacity (x — 0..1, 0 = no gobo), its blur at full softness (y — plate texels), the shade's mix (z —
 *   0..1) and its dark floor (w — 0..1): `sample_gobo`, `shade_mat`;
 * - `grade` — the saturation bump in shade (x); y, z, w unused;
 * - `noise` — the blue noise's offset (x, y — uv, re-rolled while the wind blows), one tile texel in uv (z — 1 / 128); w unused;
 * - `wind` — the gobo's clock (x — seconds) and the plate's wind strength (y); z, w unused;
 * - `night` — the NIGHT (mat/night.ts): its amount (x — 0..1, 0 = the day's chain exactly), the Moon's illuminance (y — lux),
 *   the exposure (z — scene → display), the snow (w — display units, peak to peak): `night_mat`, `mat_colour`;
 * - `moon` — the Moon's colour as the adapted eye takes it (xyz — LINEAR sRGB, Y = 1) and the sky's share in the shadow (w —
 *   0..1);
 * - `rod` — the rods' signal drawn as a colour (xyz — LINEAR sRGB, Y = 1); w unused;
 * - `eigengrau` — the dark the eye adds to everything (xyz — LINEAR sRGB); w unused;
 * - `portals` — the portal CHAIN (nav/portal.ts; `PORTAL_CHAIN` records, nearest face first): each face's centre (xy) and half
 *   extents (zw), CSS px of the attachment — `portal_cover`;
 * - `clips` — each face's corner radius (x — CSS px), on (y — 0/1: the first 0 ends the chain), top feather (z — CSS px; 0 =
 *   a hard edge); w unused;
 * - `ruler` — the RULERS (lattice/ruler.ts): on (x — 0/1), the margin, the band and the line width (y, z, w — CSS px);
 * - `rulerText` — the text's inset from the outer line, its gap after the tick, the major tick's length (x, y, z — CSS px), the
 *   atlas's texels per CSS px (w);
 * - `rulerAlpha` — the ink's presence on the frame's lines, the ticks and the labels (x, y, z — 0..1); w unused;
 * - `rulerOrigin` — the camera's wrap counts (x, y — exact integers), the finest labelled level (z — −1 = none); w unused;
 * - `rulerGlyph` — an atlas cell's width, height, advance and baseline (x, y, z, w — texels);
 * - `rulerAtlas` — the glyph atlas's width, height and cap height (x, y, z — texels) and its glyph count (w);
 * - `rulerSites` — per level (5): its spacing (x — world units), tick length (y — CSS px), tick presence and label presence
 *   (z, w — 0..1);
 * - `rulerFormat` — per level (5): mult and exp (x, y — a site's value is index · mult · 10^exp), the wrap period over the
 *   spacing (z); w unused;
 * - `box` — the slot's box on the attachment (x, y, w, h — CSS px): what is culled; the mat is fullscreen under the scissor;
 * - `light` — the camera the lamp's gobo is sampled under (`SlotLight`: x, y — world units at its top-left, z — its zoom) and
 *   the cross-fade toward `light2` (w — 0..1): `lit_desk`, `lit_gobo`;
 * - `light2` — the second light a flight hands the slot to (x, y, z as `light`'s); w unused;
 * - `presence` — the SLOT's presentation opacity (x — 0..1: what the mat itself is drawn at; `view.w` is its objects'); y, z,
 *   w unused.
 */
export const MatUniforms = defineStruct("MatUniforms", [
  ["cam", "vec4f"],
  ["view", "vec4f"],
  ["phase", "vec4f"],
  ["rungs", "vec4f"],
  ["lod", "vec4f"],
  ["line", "vec4f"],
  ["grain", "vec4f"],
  ["ground", "vec4f"],
  ["ink", "vec4f"],
  ["plane", "vec4f"],
  ["goboMatrix", "mat4x4f"],
  ["goboParams", "vec4f"],
  ["gobo", "vec4f"],
  ["grade", "vec4f"],
  ["noise", "vec4f"],
  ["wind", "vec4f"],
  ["night", "vec4f"],
  ["moon", "vec4f"],
  ["rod", "vec4f"],
  ["eigengrau", "vec4f"],
  ["portals", PORTAL_CHAIN_TYPE],
  ["clips", PORTAL_CHAIN_TYPE],
  ["ruler", "vec4f"],
  ["rulerText", "vec4f"],
  ["rulerAlpha", "vec4f"],
  ["rulerOrigin", "vec4f"],
  ["rulerGlyph", "vec4f"],
  ["rulerAtlas", "vec4f"],
  ["rulerSites", "array<vec4f, 5>"],
  ["rulerFormat", "array<vec4f, 5>"],
  ["box", "vec4f"],
  ["light", "vec4f"],
  ["light2", "vec4f"],
  ["presence", "vec4f"],
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
