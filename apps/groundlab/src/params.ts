// The lab's tweakable parameter set — pure: defaults, the frame-style builder,
// and snapshot/restore. The panel binds to it; the harness and the tests read
// it without a DOM. Every default is the product's (theme.ts) or the
// prototype's (choreography / motion), so "reset" IS the product.

import { type CornerSpec, EIGENGRAU, FIT, type FadeIn, type FieldConfig, type FitBand, type FlightTuning, type FrameStyle, type GlyphRange, type GroundTheme, HEAT, LINES, MATERIAL, MAT_COLORS, MAT_GRID, MOTION_DEFAULTS, type MatConfig, type MatLight, type Material, type MotionTuning, NAV, NIGHT, PORTAL_CAP, PORTAL_GATE, PRODUCT, PRODUCT_CORNER, type PlateName, type RGB, type RGBA, type STYLES, type ThemeName, composeStyle, dayLuminance, nightLight } from "@ice/ground/compose";
import { PRODUCT_GRID, THEMES } from "@ice/ground/oracle/fixtures/vf-theme";

/**
 * The corner composition as the panel edits it (sheet.ts `CornerSpec`, every
 * field explicit). `tangent` means the fillet is derived (ear − thickness);
 * off, `fillet` is the number.
 */
export interface CornerTweaks {
  thickness: number;
  control: number;
  clearance: number;
  bayClearance: number;
  fillet: number;
  tangent: boolean;
  shelf: number;
  radius: number;
}
export function cornerTweaksOf(c: CornerSpec): CornerTweaks {
  return {
    thickness: c.thickness, control: c.control, clearance: c.clearance, bayClearance: c.bayClearance ?? c.clearance,
    fillet: c.fillet ?? c.control / 2 + c.clearance - c.thickness, tangent: c.fillet === undefined, shelf: c.shelf ?? 0, radius: c.radius,
  };
}
export function cornerSpecOf(t: CornerTweaks, name = "composed"): CornerSpec {
  return { name, thickness: t.thickness, control: t.control, clearance: t.clearance, bayClearance: t.bayClearance, ...(t.tangent ? {} : { fillet: t.fillet }), shelf: t.shelf, radius: t.radius };
}

/**
 * A style as the panel edits it. The RAW rows are the truth `buildStyle` reads
 * (one number per row, the BR shelf its own); `corner` is the composition that
 * generated them — editing it regenerates every raw row (`composeTweaks`),
 * editing a raw row leaves the composition behind.
 */
export interface StyleTweaks {
  base: keyof typeof STYLES;
  corner: CornerTweaks;
  thickness: number;
  notchW: number;       // TL TR BL
  shelfW: number;       // BR — the wide notch
  notchH: number;
  rho: number;
  rfH: number;
  rfV: number;
  rfVShelf: number;
  baseR: number;
  /** The revealed outer radius; 0 = concentric with the content (baseR + thickness). */
  outerR: number;
  btnInset: number;
  btnRadius: number;
  btnGlyphW: number;
  btnGlyphR: number;
}

export function styleTweaksOf(s: FrameStyle, base: keyof typeof STYLES, corner: CornerTweaks = cornerTweaksOf(PRODUCT_CORNER)): StyleTweaks {
  return {
    base, corner: { ...corner }, thickness: s.thickness, notchW: s.nw[0], shelfW: s.nw[2], notchH: s.nh[0], rho: s.rho[0],
    rfH: s.rfH[0], rfV: s.rfV[0], rfVShelf: s.rfV[2], baseR: s.baseR[0], outerR: s.outerR ?? 0,
    btnInset: s.btn.insetX, btnRadius: s.btn.radius, btnGlyphW: s.btn.glyphW, btnGlyphR: s.btn.glyphR,
  };
}

/** Regenerate the raw rows from the composition. */
export const composeTweaks = (t: StyleTweaks): StyleTweaks => styleTweaksOf(composeStyle(cornerSpecOf(t.corner, t.base)), t.base, t.corner);

export function buildStyle(t: StyleTweaks): FrameStyle {
  return {
    name: t.base, thickness: t.thickness,
    nw: [t.notchW, t.notchW, t.shelfW, t.notchW], nh: [t.notchH, t.notchH, t.notchH, t.notchH],
    rho: [t.rho, t.rho, t.rho, t.rho], rfH: [t.rfH, t.rfH, t.rfH, t.rfH], rfV: [t.rfV, t.rfV, t.rfVShelf, t.rfV],
    baseR: [t.baseR, t.baseR, t.baseR, t.baseR],
    ...(t.outerR > 0 ? { outerR: t.outerR } : {}),
    btn: { insetX: t.btnInset, insetY: t.btnInset, radius: t.btnRadius, glyphW: t.btnGlyphW, glyphR: t.btnGlyphR },
  };
}

/** The colour roles the panel exposes, per theme, as the theme object carries them. */
export type ColorRole = "canvasBg" | "fieldInk" | "card" | "frame" | "hairline" | "select" | "destructive" | "ink" | "inkStrong" | "inkMuted" | "fill" | "fillHover";
export const COLOR_ROLES: readonly ColorRole[] = ["canvasBg", "fieldInk", "card", "frame", "hairline", "select", "destructive", "ink", "inkStrong", "inkMuted", "fill", "fillHover"];
export type ColorOverrides = Record<ThemeName, Partial<Record<ColorRole, RGB | RGBA>>>;

/** Deep-mutable: the panel writes into what the engine only reads. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly number[] ? T[K] : T[K] extends object ? Mutable<T[K]> : T[K] };

/**
 * The cutting mat as the panel edits it: the line law, the grain, the two
 * material colours, the gobo (opacity, blur, grade, the plate, the wind rate
 * and the tilt strength) and the world→desk scale. `matConfigOf` projects it
 * into the engine's `MatConfig`; `wind` and `tilt` are the lab's clocks.
 */
export interface MatTweaks {
  thin: number; thick: number; alphaThin: number; alphaThick: number;
  grain: number;
  ground: RGB; ink: RGB;
  opacity: number; blurTexels: number; shadeMix: number; darkFloor: number; saturate: number;
  sharp: number; soft: number;
  plate: PlateName;
  /** Seconds of gobo time per second; 0 freezes the mat (grain and wind) and it renders on demand. */
  wind: number;
  tilt: number;
  metresPerUnit: number;
}

export function defaultMatTweaks(): MatTweaks {
  const g = MAT_GRID.gobo;
  return {
    thin: MAT_GRID.line.thin, thick: MAT_GRID.line.thick, alphaThin: MAT_GRID.line.alphaThin, alphaThick: MAT_GRID.line.alphaThick,
    grain: MAT_GRID.grain, ground: MAT_COLORS.ground, ink: MAT_COLORS.line,
    opacity: g.opacity, blurTexels: g.blurTexels, shadeMix: g.shadeMix, darkFloor: g.darkFloor, saturate: g.saturate,
    sharp: g.sharp, soft: g.soft, plate: g.plate, wind: g.wind, tilt: g.tilt,
    metresPerUnit: MAT_GRID.plane.metresPerUnit,
  };
}

export function matConfigOf(t: MatTweaks): MatConfig {
  return {
    line: { thin: t.thin, thick: t.thick, alphaThin: t.alphaThin, alphaThick: t.alphaThick },
    grain: t.grain, ground: t.ground, ink: t.ink,
    gobo: { opacity: t.opacity, blurTexels: t.blurTexels, shadeMix: t.shadeMix, darkFloor: t.darkFloor, saturate: t.saturate, sharp: t.sharp, soft: t.soft, plate: t.plate },
    plane: { ...MAT_GRID.plane, metresPerUnit: t.metresPerUnit },
  };
}

/**
 * The NIGHT as the panel edits it (theme.ts `NIGHT`, MAT.md): the Moon's colour
 * temperature and illuminance, the sky's share in the shadow, the rods' hue, the
 * one scale (the lit sage over the day's), the snow — and `night`, the amount,
 * which cross-fades the two lights on the display. `nightLightOf` projects it
 * for the dark theme; the light theme is always the day.
 */
export interface NightTweaks {
  night: number; kelvin: number; lux: number; fill: number; rodNm: number; rodPurity: number; litOverDay: number; snow: number;
}

export function defaultNightTweaks(): NightTweaks {
  return { night: 1, kelvin: NIGHT.kelvin, lux: NIGHT.lux, fill: NIGHT.fill, rodNm: NIGHT.rodHue.nm, rodPurity: NIGHT.rodHue.purity, litOverDay: NIGHT.litOverDay, snow: NIGHT.snow };
}

export function nightLightOf(t: NightTweaks, ground: RGB): MatLight {
  const light = nightLight({
    kelvin: t.kelvin, lux: t.lux, fill: t.fill, rodHue: { nm: t.rodNm, purity: t.rodPurity }, eigengrau: EIGENGRAU,
    litLuminance: t.litOverDay * dayLuminance(ground), snow: t.snow, surround: NIGHT.surround,
  }, ground);
  return { ...light, night: t.night };
}

/**
 * The portal flight as the panel edits it: ICE's NAV_TRANSITION_DEFAULTS and
 * FIT_DEFAULTS (nav/flight.ts), plus the lab's own choice of which grid a
 * folder opens onto. `flightTuning` / `fitBand` project it for the engine.
 */
export interface NavTweaks {
  responseMs: number; exitResponseFactor: number; durationPerOctave: number; baseOctaves: number; freezeOctaves: number; capFactor: number;
  /** The grid a NEW folder's inside gets: the next one along, or a fixed one. */
  childGlyph: "cycle" | "dot" | "needle" | "mat";
  fitPad: number; fitMin: number; fitMax: number;
}
export function defaultNavTweaks(): NavTweaks {
  return { responseMs: NAV.responseMs, exitResponseFactor: NAV.exitResponseFactor, durationPerOctave: NAV.durationPerOctave, baseOctaves: NAV.baseOctaves, freezeOctaves: NAV.freezeOctaves, capFactor: NAV.capFactor, childGlyph: "cycle", fitPad: FIT.pad, fitMin: FIT.minZoom, fitMax: FIT.maxZoom };
}
export const flightTuning = (t: NavTweaks): FlightTuning => ({ ...NAV, responseMs: t.responseMs, exitResponseFactor: t.exitResponseFactor, durationPerOctave: t.durationPerOctave, baseOctaves: t.baseOctaves, freezeOctaves: t.freezeOctaves, capFactor: t.capFactor });
export const fitBand = (t: NavTweaks): FitBand => ({ pad: t.fitPad, minZoom: Math.min(t.fitMin, t.fitMax), maxZoom: Math.max(t.fitMin, t.fitMax) });

/** The live portal as the panel edits it (nav/portal.ts, PORTAL.md): on/off, the gate (CSS px of a face's short side), the per-frame cap. */
export interface PortalTweaks {
  on: boolean; gate: [number, number]; cap: number;
  /** A portal's grid is dressed for its inside's arrival (PORTAL.md §9); off = the lattice at the portal's own zoom. */
  dress: boolean;
  /** Zoom-through: entering and leaving as cuts when a face covers / uncovers the view (§8). */
  through: boolean;
  /** How long a frame takes to re-dress after a through-cut, ms. */
  redressMs: number;
}
export const defaultPortalTweaks = (): PortalTweaks => ({ on: true, gate: [PORTAL_GATE[0], PORTAL_GATE[1]], cap: PORTAL_CAP, dress: true, through: true, redressMs: 320 });

/** The §7 heat as the panel edits it (theme.ts `HEAT`, GLOW.md) — assignable to `Heat`; a scene resets it. */
export interface HeatTweaks { height: number; alpha: [number, number]; rim: { width: number; alpha: [number, number] } }
export const defaultHeatTweaks = (): HeatTweaks => ({ height: HEAT.height, alpha: [...HEAT.alpha], rim: { width: HEAT.rim.width, alpha: [...HEAT.rim.alpha] } });

/** Bumped when a saved snapshot's meaning changes; an old snapshot is dropped, not merged. */
export const PARAMS_VERSION = 3;

export interface Params {
  version: number;
  field: {
    glyph: FieldConfig["glyph"];
    reach: number; strength: number; halfLen: number; halfWidth: number;
    polarity: 1 | -1; alwaysAlign: boolean; inkAlpha: number;
    fineSchedule: FieldConfig["fineSchedule"];
    range: "preset" | "open";
    dotRadius: GlyphRange; needleHalfLen: GlyphRange; needleHalfWidth: GlyphRange;
    fadeIn: FadeIn;
  };
  mat: MatTweaks;
  night: NightTweaks;
  nav: NavTweaks;
  style: StyleTweaks;
  motion: Mutable<MotionTuning>;
  material: Mutable<Material>;
  lines: { hairline: number; ring: number };
  heat: HeatTweaks;
  portal: PortalTweaks;
  colors: ColorOverrides;
}

export function defaultParams(): Params {
  return {
    version: PARAMS_VERSION,
    field: {
      glyph: PRODUCT_GRID.glyph, reach: PRODUCT_GRID.reach, strength: PRODUCT_GRID.widgetStrength,
      halfLen: PRODUCT_GRID.needleLength, halfWidth: PRODUCT_GRID.needleWidth,
      polarity: PRODUCT_GRID.polarity, alwaysAlign: PRODUCT_GRID.alwaysAlign, inkAlpha: PRODUCT_GRID.dotAlpha,
      fineSchedule: "auto", range: "preset",
      dotRadius: [...PRODUCT_GRID.dotRadius], needleHalfLen: [...PRODUCT_GRID.needleHalfLen], needleHalfWidth: [...PRODUCT_GRID.needleHalfWidth],
      fadeIn: [...PRODUCT_GRID.fadeIn],
    },
    mat: defaultMatTweaks(),
    night: defaultNightTweaks(),
    nav: defaultNavTweaks(),
    style: styleTweaksOf(PRODUCT, "product"),
    motion: { ...MOTION_DEFAULTS },
    material: { shadow: { rest: { ...MATERIAL.shadow.rest }, lifted: { ...MATERIAL.shadow.lifted } }, lift: { ...MATERIAL.lift } },
    lines: { ...LINES },
    heat: defaultHeatTweaks(),
    portal: defaultPortalTweaks(),
    colors: { dark: {}, light: {} },
  };
}

/** The theme in force with the panel's colour overrides applied — and, for the dark theme, its night as the panel has it (over the panel's mat ground). */
export function themeWith(name: ThemeName, colors: ColorOverrides, night?: NightTweaks, ground: RGB = MAT_COLORS.ground): GroundTheme {
  return { ...THEMES[name], ...colors[name], ...(night && name === "dark" ? { matLight: nightLightOf(night, ground) } : {}) } as GroundTheme;
}

/** Deep-merge a saved snapshot onto fresh defaults: unknown keys are dropped, missing keys stay default. */
export function restoreParams(saved: unknown): Params {
  const out = defaultParams();
  if ((saved as { version?: unknown } | null)?.version !== PARAMS_VERSION) return out;
  const merge = (dst: Record<string, unknown>, src: unknown) => {
    if (!src || typeof src !== "object") return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!(k in dst)) continue;
      const d = dst[k];
      if (Array.isArray(d)) { if (Array.isArray(v) && v.length === d.length && v.every((x) => typeof x === "number")) dst[k] = [...v]; }
      else if (d && typeof d === "object") merge(d as Record<string, unknown>, v);
      else if (typeof v === typeof d) dst[k] = v;
    }
  };
  merge(out as unknown as Record<string, unknown>, saved);
  // colour overrides are open sets, merged by role
  const src = saved as { colors?: Partial<ColorOverrides> } | null;
  for (const t of ["dark", "light"] as const) {
    const over = src?.colors?.[t];
    if (!over || typeof over !== "object") continue;
    for (const role of COLOR_ROLES) { const c = (over as Record<string, unknown>)[role]; if (Array.isArray(c) && (c.length === 3 || c.length === 4) && c.every((x) => typeof x === "number")) out.colors[t][role] = [...c] as unknown as RGB | RGBA; }
  }
  return out;
}

export const snapshotParams = (p: Params): string => JSON.stringify(p, null, 1);
