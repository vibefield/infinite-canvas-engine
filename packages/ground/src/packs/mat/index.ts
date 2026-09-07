// `mat` — the cutting mat as a SURFACE grid program pack (design-014): lines on
// the engine's lattice by one law, the gobo projected onto the desk, the tilt,
// the Sun by day and the Moon by night. Registered by an app
// (`groundCompose({ grids: [cuttingMat] })`, `Ground.create({ grids })`); the
// engine's own glyph is the dot. Its config rides `FieldConfig.ext.mat`
// (`MatConfig`), its clocks `FieldFrame.ext.mat` (`MatFrame`), its light the
// theme's `mat` section.

import type { FieldConfig, FieldFrame } from "../../field/layout";
import type { SurfaceGlyph, SurfacePass } from "../../field/program";
import type { GroundTheme, ThemeName } from "../../theme";
import { DEFAULT_MAT_CONFIG, type MatConfig, type MatFrame, STILL_MAT_FRAME } from "./layout";
import { MatPass } from "./mat-pass";
import { DAY_LIGHT, type MatLight } from "./night";
import { matShadersFromGen } from "./shaders";
import { MAT_LIGHT } from "./theme";

export * from "./layout";
export * from "./mat-pass";
export * from "./night";
export * from "./projector";
export * from "./shaders";
export * from "./theme";
export * from "./tilt";

/** The glyph name and the theme section's key. */
export const MAT_GLYPH = "mat";

export interface MatThemeSection { readonly light: MatLight }

export const matConfigOf = (cfg: FieldConfig): MatConfig => (cfg.ext?.[MAT_GLYPH] as MatConfig | undefined) ?? DEFAULT_MAT_CONFIG;
export const matFrameOf = (frame: FieldFrame): MatFrame => (frame.ext?.[MAT_GLYPH] as MatFrame | undefined) ?? STILL_MAT_FRAME;
export const matLightOf = (theme: GroundTheme): MatLight => (theme.packs[MAT_GLYPH] as MatThemeSection | undefined)?.light ?? DAY_LIGHT;

/** A field config with the mat's own, in its slot. */
export const withMat = (cfg: FieldConfig, mat: MatConfig): FieldConfig => ({ ...cfg, ext: { ...(cfg.ext ?? {}), [MAT_GLYPH]: mat } });
/** A field frame with the mat's clocks, in their slot. */
export const withMatFrame = <F extends FieldFrame>(frame: F, mat: MatFrame): F => ({ ...frame, ext: { ...(frame.ext ?? {}), [MAT_GLYPH]: mat } });

class MatSurface implements SurfacePass {
  readonly pass: MatPass;
  constructor(pass: MatPass) { this.pass = pass; }
  prepare(encoder: GPUCommandEncoder, frame: FieldFrame, cfg: FieldConfig, theme: GroundTheme): boolean {
    return this.pass.prepare(encoder, frame.view, cfg.fadeIn, matConfigOf(cfg), matFrameOf(frame), frame.present, matLightOf(theme));
  }
  draw(pass: GPURenderPassEncoder): void { this.pass.draw(pass); }
  spawn(): SurfacePass { return new MatSurface(this.pass.spawn()); }
  dispose(): void { this.pass.dispose(); }
}

/** The mat's pass behind a field's surface slot — the host uploads its plates and blue noise through it. `null` when the mat is not registered. */
export function matPassOf(field: { readonly surfaces: ReadonlyMap<string, SurfacePass> }): MatPass | null {
  const s = field.surfaces.get(MAT_GLYPH);
  return s instanceof MatSurface ? s.pass : null;
}

/** The theme section: the Sun by day, the Moon by night. */
export const MAT_THEME_SOURCE = { glyph: MAT_GLYPH, theme: (_palette: unknown, name: ThemeName): MatThemeSection => ({ light: MAT_LIGHT[name] }) } as const;

export const cuttingMat: SurfaceGlyph = {
  kind: "surface",
  glyph: MAT_GLYPH,
  create: async (device, format) => new MatSurface(await MatPass.create(device, format, matShadersFromGen())),
  theme: MAT_THEME_SOURCE.theme,
};
