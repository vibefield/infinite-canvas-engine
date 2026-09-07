// A GRID PROGRAM — the pack seam for the field (design-014 §"the three seams").
//
// The engine owns the lattice, the LOD ladder, the field bake (the atlas that
// makes the ground react to card silhouettes) and one glyph, the DOT. A grid
// program is a glyph the app registers, of one of two kinds:
//
//   instanced  — a glyph drawn over the engine's lattice and bake, like the
//                dot: a WGSL entry for the three rungs (specialised by the
//                RUNG override) and one for the dense fine branch. The engine
//                compiles the pipelines on its own uniform block and atlas.
//                The needle is one (`packs/needle`).
//   surface    — a fullscreen program that reads no atlas and owns its pass:
//                its own uniforms, targets and assets, a `prepare` the field
//                calls in place of the bake, a `draw` it calls in place of the
//                glyphs. The cutting mat is one (`packs/mat`).
//
// A config a program needs beyond the field's (the mat's gobo, its plate,
// its wind) rides `FieldConfig.ext[glyph]`; per-frame clocks ride
// `FieldFrame.ext[glyph]`; colours and lights ride the theme's section for
// the program (`theme.packs[glyph]`).

import type { ShaderPart } from "../engine/shader";
import type { GroundTheme, ThemeName } from "../theme";
import type { FieldConfig, FieldFrame } from "./layout";

export interface InstancedGlyph {
  readonly kind: "instanced";
  readonly glyph: string;
  /** The rung entry (`@vertex vs` / `@fragment fs` over the field's `Uniforms` and `Card`, the atlas bound). */
  readonly entry: ShaderPart;
  /** The dense fine branch's fullscreen entry. */
  readonly fine: ShaderPart;
}

/** One SLOT of a surface program: its own uniforms, targets and bind groups; the pipelines and assets are the program's, shared by every slot. */
export interface SurfacePass {
  /** Upload the frame and record any auxiliary work (the mat's wind pass); returns whether that work ran — the churn instrument. */
  prepare(encoder: GPUCommandEncoder, frame: FieldFrame, cfg: FieldConfig, theme: GroundTheme): boolean;
  /** Record the surface into an open render pass — where the glyphs would go. */
  draw(pass: GPURenderPassEncoder): void;
  /** A second slot on the same pipelines and assets (a nav flight's departed frame, a live portal). */
  spawn(): SurfacePass;
  dispose(): void;
}

export interface SurfaceGlyph {
  readonly kind: "surface";
  readonly glyph: string;
  /** Compile the program's pipelines once; `modules` are the engine's shared parts (the portal chain). */
  create(device: GPUDevice, format: GPUTextureFormat, modules: readonly ShaderPart[]): Promise<SurfacePass>;
  /** The theme section this program reads, projected from a host's palette; absent = none. */
  theme?(palette: unknown, name: ThemeName): unknown;
}

export type GlyphProgram = InstancedGlyph | SurfaceGlyph;
