// The desk's DEV PANEL parameters (D5a — the prototype's lab/params.ts, ported to the desk): pure — the defaults, the
// projections into what the desk's layer and core take (the theme with its colours and its night, the mat's config with its
// rulers, the lattice's fade-in, the mini mat's law, the springs, core's nav tunings), snapshot and restore. Every default
// is the product's or the engine's (theme.ts, core's settings), so "reset" IS the product. Carried from the lab: the mat, the
// rulers, the grid, the night, the colours, the mini mat, the springs, the flight's response and the zoom-through, the live
// insides. Not carried: the paper's, the hand's and the notebook's laws and the flight's octave model — the desk's kinds take
// those at construction (`handle.tuneLaw` is the live door, taught to the mini mat first) and ICE's flight is core's
// (design-006: its response is the one live number).

import { NAV_TRANSITION_DEFAULTS, ZOOM_THROUGH_DEFAULTS } from "@ice/core";
import { DEFAULT_MAT_CONFIG, type GridConfig, type MatConfig, type ObjectSprings, type PlateName, type RulerConfig, SPRINGS } from "@ice/desk";
import { dayLuminance, EIGENGRAU, GRID, type GroundTheme, type MatLight, MINIMAT, NIGHT, nightLight, type RGB, type ThemeName } from "@ice/desk";

/** Deep-mutable: the panel writes into what the engine only reads. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly number[] ? T[K] : T[K] extends object ? Mutable<T[K]> : T[K] };

/**
 * The PRODUCT's grid (design-016 §3, K1): the engine's, with the rulers PRINTED. The engine's own default leaves them off — a host
 * prints them on the root slot (RULER.md §5) — and this desk is that host: `App.tsx` mounts its layer with this, and every default
 * below reads it, so "reset to product" is it.
 */
export const DESK_GRID: GridConfig = { fadeIn: GRID.fadeIn, mat: { ...DEFAULT_MAT_CONFIG, ruler: { ...DEFAULT_MAT_CONFIG.ruler, on: true } } };

/** The cutting mat as the panel edits it: the line law, the grain, the two material colours, the gobo, the world→desk scale. */
export interface MatTweaks {
  thin: number; thick: number; alphaThin: number; alphaThick: number;
  grain: number;
  ground: RGB; ink: RGB;
  opacity: number; blurTexels: number; shadeMix: number; darkFloor: number; saturate: number;
  sharp: number; soft: number;
  plate: PlateName;
  metresPerUnit: number;
}
export function defaultMatTweaks(): MatTweaks {
  const c = DESK_GRID.mat;
  return {
    thin: c.line.thin, thick: c.line.thick, alphaThin: c.line.alphaThin, alphaThick: c.line.alphaThick,
    grain: c.grain, ground: [...c.ground] as RGB, ink: [...c.ink] as RGB,
    opacity: c.gobo.opacity, blurTexels: c.gobo.blurTexels, shadeMix: c.gobo.shadeMix, darkFloor: c.gobo.darkFloor, saturate: c.gobo.saturate,
    sharp: c.gobo.sharp, soft: c.gobo.soft, plate: c.gobo.plate, metresPerUnit: c.plane.metresPerUnit,
  };
}

/** The RULERS as the panel edits them (RULER.md): whether they print, and the law's numbers. On: the product's desk prints them (K1). */
export interface RulerTweaks {
  on: boolean; band: number; margin: number; tick: [number, number, number]; line: number; label: number; tickAlpha: number; frameAlpha: number;
  /** CSS px of pitch over which the fine ticks, and a level's labels, fade in (RULER.md §3 — the demo's four density numbers, K1). */
  ticksFrom: [number, number]; labelsFrom: [number, number];
  /** The labels' text: its size (CSS px — the glyph atlas's em, so a change re-renders the atlas), its inset from the outer line, its gap after the tick. */
  text: { size: number; top: number; gap: number };
  /** The most characters a label may have (a level whose labels would be wider carries none). */
  maxChars: number;
}
export function defaultRulerTweaks(): RulerTweaks {
  const r = DESK_GRID.mat.ruler;
  return {
    on: r.on, band: r.band, margin: r.margin, tick: [r.tick[0], r.tick[1], r.tick[2]], line: r.line, label: r.alpha.label, tickAlpha: r.alpha.tick, frameAlpha: r.alpha.frame,
    ticksFrom: [r.ticksFrom[0], r.ticksFrom[1]], labelsFrom: [r.labelsFrom[0], r.labelsFrom[1]], text: { ...r.text }, maxChars: r.maxChars,
  };
}
export const rulerConfigOf = (t: RulerTweaks): RulerConfig => ({
  ...DESK_GRID.mat.ruler, on: t.on, band: t.band, margin: t.margin, tick: [t.tick[0], t.tick[1], t.tick[2]], line: t.line,
  alpha: { frame: t.frameAlpha, tick: t.tickAlpha, label: t.label },
  ticksFrom: [t.ticksFrom[0], t.ticksFrom[1]], labelsFrom: [t.labelsFrom[0], t.labelsFrom[1]], text: { ...t.text }, maxChars: t.maxChars,
});
/** The mat's config with its rulers — the root's (a mini mat's inside never prints them). */
export const matConfigOf = (t: MatTweaks, ruler: RulerTweaks): MatConfig => ({
  line: { thin: t.thin, thick: t.thick, alphaThin: t.alphaThin, alphaThick: t.alphaThick },
  grain: t.grain, ground: t.ground, ink: t.ink,
  gobo: { opacity: t.opacity, blurTexels: t.blurTexels, shadeMix: t.shadeMix, darkFloor: t.darkFloor, saturate: t.saturate, sharp: t.sharp, soft: t.soft, plate: t.plate },
  plane: { ...DESK_GRID.mat.plane, metresPerUnit: t.metresPerUnit },
  ruler: rulerConfigOf(ruler),
});

/** The NIGHT (MAT.md): the Moon's colour temperature and illuminance, the sky's share, the rods' hue, the lit sage over the day's, the snow. */
export interface NightTweaks { kelvin: number; lux: number; fill: number; rodNm: number; rodPurity: number; litOverDay: number; snow: number }
export function defaultNightTweaks(): NightTweaks {
  return { kelvin: NIGHT.kelvin, lux: NIGHT.lux, fill: NIGHT.fill, rodNm: NIGHT.rodHue.nm, rodPurity: NIGHT.rodHue.purity, litOverDay: NIGHT.litOverDay, snow: NIGHT.snow };
}
/** The Moon from the panel's numbers over the panel's mat — theme.ts's `MAT_LIGHT.dark`, call for call. */
export const nightLightOf = (t: NightTweaks, ground: RGB): MatLight => nightLight({
  kelvin: t.kelvin, lux: t.lux, fill: t.fill, rodHue: { nm: t.rodNm, purity: t.rodPurity }, eigengrau: EIGENGRAU,
  litLuminance: t.litOverDay * dayLuminance(ground), snow: t.snow, surround: NIGHT.surround,
}, ground);

/** A theme constant's type as the panel edits it: its literal numbers widened, every level writable. */
export type Widen<T> = T extends number ? number : T extends boolean ? boolean : T extends string ? T : { -readonly [K in keyof T]: Widen<T[K]> };
/** The MINI MAT's law as the panel edits it (MINIMAT.md): a deep copy of the engine's, handed live through `handle.tuneLaw`. */
export type MiniMatTweaks = Widen<typeof MINIMAT>;
export const defaultMiniMatTweaks = (): MiniMatTweaks => structuredClone(MINIMAT) as MiniMatTweaks;

/** The flight's response and the zoom-through as core keeps them live (`NavTransitionSettings`, `ZoomThroughSettings`) — the desk's own on. */
export interface NavTweaks { responseMs: number; through: boolean; throughIn: number; throughOut: number; gate0: number; gate1: number }
export function defaultNavTweaks(): NavTweaks {
  const z = ZOOM_THROUGH_DEFAULTS;
  return { responseMs: NAV_TRANSITION_DEFAULTS.responseMs, through: true, throughIn: z.in, throughOut: z.out, gate0: z.gate[0], gate1: z.gate[1] };
}

/** The colour roles the panel exposes per theme (the theme's own fields). */
export type ColorRole = "canvasBg" | "select";
export const COLOR_ROLES: readonly ColorRole[] = ["canvasBg", "select"];
export type ColorOverrides = Record<ThemeName, Partial<Record<ColorRole, RGB>>>;

/**
 * Bumped when a saved snapshot's meaning changes; an old snapshot is dropped, not merged. 2 (K1): the rulers print by default — a
 * snapshot saved under 1 carries that version's default "off", so a browser that kept one would otherwise boot with them off.
 */
export const PARAMS_VERSION = 2;

export interface DeskParams {
  version: number;
  grid: { fadeIn: [number, number] };
  mat: MatTweaks;
  ruler: RulerTweaks;
  night: NightTweaks;
  colors: ColorOverrides;
  minimat: MiniMatTweaks;
  /** The objects' springs — THE object the layer's builder reads each frame (the panel mutates it in place). */
  motion: Mutable<ObjectSprings>;
  nav: NavTweaks;
  portal: { on: boolean };
}

export function defaultParams(): DeskParams {
  return {
    version: PARAMS_VERSION,
    grid: { fadeIn: [DESK_GRID.fadeIn[0], DESK_GRID.fadeIn[1]] },
    mat: defaultMatTweaks(),
    ruler: defaultRulerTweaks(),
    night: defaultNightTweaks(),
    colors: { dark: {}, light: {} },
    minimat: defaultMiniMatTweaks(),
    motion: { ...SPRINGS },
    nav: defaultNavTweaks(),
    portal: { on: true },
  };
}

/** The theme in force: the desk's own for `name`, the panel's colour overrides over it, and by night the panel's Moon over the panel's mat. */
export function themeWith(base: GroundTheme, p: DeskParams): GroundTheme {
  return { ...base, ...p.colors[base.name], ...(base.name === "dark" ? { matLight: nightLightOf(p.night, p.mat.ground) } : {}) };
}

/**
 * Deep-merge a saved snapshot onto `into` (fresh defaults, or the live params — which keeps every object the layer holds, the
 * springs above all): unknown keys are dropped, missing keys keep what `into` has, arrays only of equal length and numbers.
 */
export function restoreParams(saved: unknown, into: DeskParams = defaultParams()): DeskParams {
  if ((saved as { version?: unknown } | null)?.version !== PARAMS_VERSION) return into;
  const merge = (dst: Record<string, unknown>, src: unknown): void => {
    if (src === null || typeof src !== "object") return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!(k in dst)) continue;
      const d = dst[k];
      if (Array.isArray(d)) { if (Array.isArray(v) && v.length === d.length && v.every((x) => typeof x === "number")) dst[k] = [...v]; }
      else if (d !== null && typeof d === "object") merge(d as Record<string, unknown>, v);
      else if (typeof v === typeof d) dst[k] = v;
    }
  };
  merge(into as unknown as Record<string, unknown>, saved);
  // colour overrides are open sets, merged by role
  const src = saved as { colors?: Partial<Record<ThemeName, Record<string, unknown>>> } | null;
  for (const t of ["dark", "light"] as const) {
    for (const role of COLOR_ROLES) {
      const c = src?.colors?.[t]?.[role];
      if (Array.isArray(c) && c.length === 3 && c.every((x) => typeof x === "number")) into.colors[t][role] = [c[0], c[1], c[2]] as RGB;
    }
  }
  return into;
}

/** Everything back to the product, IN PLACE (the layer keeps the springs object): a fresh default merged over the live params. */
export function resetParams(p: DeskParams): DeskParams {
  const d = defaultParams();
  p.colors = { dark: {}, light: {} };
  return restoreParams(JSON.parse(JSON.stringify(d)), p);
}

export const snapshotParams = (p: DeskParams): string => JSON.stringify(p);
