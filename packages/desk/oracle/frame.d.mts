// The types of frame.mjs, for its TypeScript host — apps/desk's parity page (design-015 D1b).
// The oracle is plain JS by convention (it runs through tsx beside Dawn); this declares only
// the surface a host touches, self-contained: `skipLibCheck` would quietly turn a broken import
// in a declaration file into `any`, so there are none.

/** A shader-file map (`MAT_SHADER_FILES`, …) → its text: `shaderText` from `@ice/desk/shaders` in a browser. */
export type ShaderText = <T extends Record<string, string>>(files: T) => { readonly [K in keyof T]: string };

/** The fixtures' bytes: the engine's blue noise and the host's plates, glyph atlas, committed ink raster and the prints' picture (`null` = absent). */
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
  /** photo-1.json — the prints' picture's metadata (`w` × `h` rgba8, sRGB, straight alpha; tools/make-photo-fixture.mjs). */
  readonly photoMeta: { readonly w: number; readonly h: number } | null;
  readonly photo: Uint8Array<ArrayBuffer> | null;
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

/**
 * A notebook as the prototype's lab hands it to the pass (design-015 D3r-b: lab/notebook.ts `makeBook` → `resolveBooks` →
 * `drawBooks`), from a scene's book spec — a `NotebookDraw` (src/notebook/pass.ts), untyped here. A fresh id every call.
 */
export function notebookDraw(spec: { readonly x: number; readonly y: number } & Readonly<Record<string, unknown>>): unknown;
/** The `index`-th desk calendar as the lab's `renderLayer` hands it to the pass, from a scene's pad spec — a `CalendarDraw`, untyped here. */
export function calendarDraw(spec: { readonly x: number; readonly y: number } & Readonly<Record<string, unknown>>, index: number): unknown;
/** Where a note stuck to `day` (YYYY-MM-DD) on a pad lies: its day's slot, world units (the lab's `slotOf`). */
export function pinnedAt(pad: { readonly x: number; readonly y: number; readonly weekStart?: 0 | 1 }, day: string): { readonly x: number; readonly y: number };
