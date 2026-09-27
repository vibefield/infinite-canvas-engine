// A SLOT'S VIEW, as a kind reads it (design-016 §5, K-L3): the mat a kind's pass is made on and spawned onto, and the
// words the contract's `SlotContext` is written in — the camera and box (`View`), the lattice's LOD and line law, the
// grid's fade-in window and dressing, the mat's config and clocks, the glyph atlas, the lamp the slot is lit by. The
// ground owns the slot and fills it; a kind reads it. (The definitions stay in the engine's modules — mat/, lattice/ —
// and this is the one door a kind names them through; the portal chain and the flight are kit/nav.ts.)

import type { GlyphAtlasMeta } from "../mat/layout";

export { type Box, type FadeIn, type Lod, lod, type View } from "../lattice/lod";
export { type LineLaw, type LineWeight, lineWeight } from "../lattice/line";
export type { RulerLaw } from "../lattice/ruler";
export { DEFAULT_GRID, dressScale, type GridConfig } from "../mat/grid";
export { type GlyphAtlasMeta, GLYPHS, litByOwn, type MatConfig, type MatFrame, MatUniforms, type PlateName, type RulerConfig, type SlotLight } from "../mat/layout";
export type { Mat4 } from "../mat/projector";
/** The silhouette a kind's marks go around (`ObjectKind.frame`) — the marks' own type (marks/layout.ts). */
export type { MarkFrame } from "../marks/layout";

/**
 * A SLOT'S MAT as a kind's pass reads it: what the slot lends every kind drawn in it — the mat's animated silhouette (the
 * lamp's gobo through the wind, this slot's own), the blue noise, the rulers' glyph atlas and its metrics, and the version
 * of those assets (a pass rebinds when it turns over). `KindProgram.create` makes a kind's root pass on the root's; every
 * other slot's pass is `spawn`ed onto that slot's. The ground's `CuttingMat` is the one there is; a kind never makes one.
 */
export interface MatPass {
  /**
   * The slot's ONE VIEW BLOCK (design-016 K-L3): a `MatUniforms` buffer the slot writes once a frame — the camera and box, the
   * clocks, the lamp's gobo, the night, the portal chain, the objects' presence (`view.w`; the mat's own is `presence.x`) — which every kind pass binds at
   * `@group(0) @binding(0)` as `u` (`kitWgsl`'s `view` piece). A kind never writes it and never keeps a copy.
   */
  readonly view: GPUBuffer;
  /** The slot's animated gobo silhouette (r8, PLATE_SIZE²) — what an object's shadow and dapple sample. */
  readonly silhouette: GPUTextureView;
  /** The blue-noise tile (NOISE_SIZE², shared by every slot). */
  readonly noiseTexture: GPUTexture;
  /** The rulers' glyph atlas (a 1×1 empty cell until a host uploads one) and its metrics. */
  readonly glyphTexture: GPUTexture;
  readonly glyphs: GlyphAtlasMeta;
  /** Turns over whenever a plate, the noise or the glyphs land: a pass holding a bind group over them rebinds. */
  readonly assetVersion: number;
}
