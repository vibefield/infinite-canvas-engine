// The types of frame.mjs, for its TypeScript host — apps/desk's parity page (design-015 D1b).
// The oracle is plain JS by convention (it runs through tsx beside Dawn); this declares only
// the surface a host touches, self-contained: `skipLibCheck` would quietly turn a broken import
// in a declaration file into `any`, so there are none.

/** A shader-file map (`MAT_SHADER_FILES`, …) → its text: `shaderText` from `@ice/desk/shaders` in a browser. */
export type ShaderText = <T extends Record<string, string>>(files: T) => { readonly [K in keyof T]: string };

/** The fixtures' bytes: the engine's blue noise and the host's plates, glyph atlas and committed ink raster (`null` = absent). */
export interface OracleAssets {
  readonly noise: Uint8Array<ArrayBuffer>;
  readonly goboC: Uint8Array<ArrayBuffer>;
  readonly goboB: Uint8Array<ArrayBuffer>;
  /** glyphs-mono-2x.json — the atlas's metadata (`count` ≥ 12 or the rulers print no labels). */
  readonly glyphMeta: { readonly count: number } | null;
  readonly glyphs: Uint8Array<ArrayBuffer> | null;
  /** ink-note-1.json — the committed raster's metadata (`w` × `h` r8). */
  readonly inkMeta: { readonly w: number; readonly h: number } | null;
  readonly ink: Uint8Array<ArrayBuffer> | null;
}

export interface OracleDesk {
  /**
   * Encode one scene (scenes.mjs's `scene`) into `encoder`, drawn into `target` (`size` in device px) through the
   * ground's `prepareFrame` + `drawFrame`. The host submits. `prepared.portals` = the live insides drawn.
   */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    size: { readonly w: number; readonly h: number },
    scene: unknown,
    opts?: Readonly<Record<string, unknown>>,
  ): { readonly prepared: { readonly portals: number } };
}

/** The desk both hosts draw: the root's passes on `device` in `format`, the fixtures on them, the scene builder. */
export function createOracleDesk(opts: {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly text: ShaderText;
  readonly assets: OracleAssets;
  readonly log?: (message: string) => void;
}): Promise<OracleDesk>;
