// The cutting mat's GPU records, declared once. `MatUniforms` is what both mat
// entries read — the wind pass (plate → animated silhouette) and the fullscreen
// mat pass. `matUniformValues()` fills it by name from the frame, the config
// and the theme's numbers; nothing is hand-indexed.

import { defineStruct } from "../engine/struct";
import { boxValues, type FadeIn, lod, type View } from "../lattice/lod";
import type { LineLaw } from "../lattice/line";
import { MAT_COLORS, MAT_GRID, type RGB } from "../theme";
import { PORTAL_CHAIN_TYPE, portalValues, type Presentation } from "../nav/portal";
import { HERO_PROJECTOR, type Mat4, projectorMatrix } from "./projector";
import { DAY_LIGHT, lightValues, type MatLight } from "./night";

export const MatUniforms = defineStruct("MatUniforms", [
  ["cam", "vec4f"],         // camX, camY (world, UNwrapped — the projector is fixed in world), zoom, dpr
  ["view", "vec4f"],        // cssW, cssH, grain time (s), presentation opacity
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
  ["box", "vec4f"],         // the slot's box on the attachment: x, y, w, h (CSS px) — stats only; the mat is fullscreen under the scissor
] as const);

export type PlateName = "c" | "b";

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
}

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
};

export const HERO_MATRIX: Mat4 = projectorMatrix(HERO_PROJECTOR);
export const STILL_MAT_FRAME: MatFrame = { time: 0, goboTime: 0, goboMatrix: HERO_MATRIX, noise: [0, 0] };

export const NOISE_SIZE = 128;
export const PLATE_SIZE = 512;

export function matUniformValues(view: View & { readonly dpr: number }, fadeIn: FadeIn, cfg: MatConfig, f: MatFrame, plateStrength: number, present?: Presentation, light: MatLight = DAY_LIGHT) {
  const l = lod(view);
  return {
    cam: [view.camX, view.camY, view.zoom, view.dpr],
    view: [view.width, view.height, f.time, present?.opacity ?? 1],
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
    box: boxValues(view),
  };
}
