// (The kit's since K4a, design-016 §5 — moved from paper/raster.ts: a host service a kind `use`s — `TEXT_RASTER`, K8a.)
//
// The TEXT RASTER seam (design-015 §6.1; D2c) — what the paper kind calls to turn a hand's layout
// (text.ts, pure) into ink: the face's metrics for the layout, and the glyph boxes drawn as r8
// coverage for the ink pages. DOM-free as a contract: the browser's implementation is
// `desk/host/ink.ts` (Canvas2D on an OffscreenCanvas, the faces the app hands in — the prototype's
// lab/ink.ts); the Node oracle has none and keeps its COMMITTED raster (a still pinned on its note),
// so a desk without a text raster draws every sheet blank but the pinned ones, honestly.

import { type ServiceKey, serviceKey } from "./services";
import type { HandLayout, HandMetrics } from "./text";

/** r8 coverage rows, row 0 at the top — what the ink pages take (`PaperPass.write`). */
export interface InkBitmap {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly w: number;
  readonly h: number;
}

export interface TextRaster {
  /**
   * The face's metrics in em (advances and kerning measured at 100 px, the box from the font's own
   * ascent and descent) — `undefined` while the face loads: a sheet waits, blank, rather than write
   * in a stand-in hand and re-write itself a moment later.
   */
  metrics(face: string): HandMetrics | undefined;
  /** Bumped whenever a face lands: every layout keyed by it is laid again (the prototype's `fontVersion`). */
  version(): number;
  /**
   * Tell `fn` whenever `version` moves — a face landed between frames (K7a: the desk wakes for it; a loop at rest polls no
   * version). Returns an unsubscribe. Absent (a fake, a raster with fixed faces): the version never moves on its own.
   */
  onVersion?(fn: () => void): () => void;
  /**
   * Draw a layout's glyphs for a `box` (note units) at `band` texels per note unit: each glyph in its
   * own frame — turned, scaled, at its pressure — over a faint stroke `bleed` note units wide (the pen's
   * spread), the canvas's alpha read back as coverage.
   */
  raster(layout: HandLayout, face: string, box: { readonly w: number; readonly h: number }, band: number, bleed: number): InkBitmap;
}

/** The app's text raster as a desk SERVICE (K8a, kit/services.ts — `deskLayer({ text })` lends it): `host.use?.(TEXT_RASTER)`. */
export const TEXT_RASTER: ServiceKey<TextRaster> = serviceKey<TextRaster>("text");
