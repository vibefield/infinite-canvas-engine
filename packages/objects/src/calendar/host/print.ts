// The calendar's PRINT RASTER in the browser (CALENDAR.md §6; D3t-c) — the host half of calendar/printing.ts's seam: the
// prototype's `tileCanvas` and `measureCtx` (lab/calendar.ts). One OffscreenCanvas the size of a tile (TILE_TEX², the gutter
// in) is reused for every tile the driver draws; the print's type is measured on a context of its own; the HAND is the
// note's — its face and its metrics come from the desk's text raster (desk/host/ink.ts, the faces the app hands in), so the
// calendar writes in the very Caveat a note does and waits, blank, while it loads.

import { type HandMetrics, type TextRaster, type PrintFace, type PrintRaster, PEN_FACES } from "@ice/desk/kit";
import { drawRegion, type SheetPrint } from "../print";
import { TILE_TEX } from "../tiles";

export interface PrintRasterOptions {
  /** The desk's text raster: the hand's face and its metrics (the note's). */
  readonly text: TextRaster;
  /** The hand's face by name (`PEN_FACES` — the note's Caveat unless a host says). */
  readonly face?: string;
}

export function printRaster(opts: PrintRasterOptions): PrintRaster<SheetPrint> {
  const faceName = opts.face ?? "caveat";
  const spec = PEN_FACES[faceName] ?? { family: "Caveat", weight: 500 };
  const face: PrintFace = { family: spec.family, weight: spec.weight };
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let measurer: OffscreenCanvasRenderingContext2D | null = null;
  const context = (): OffscreenCanvasRenderingContext2D => {
    if (ctx === null) {
      canvas = new OffscreenCanvas(TILE_TEX, TILE_TEX);
      // the CPU raster (as the note's ink): a GPU-backed 2D canvas rasterised the same tile differently run to run (seen by the
      // print check — 6 tiles of a sheet a few bytes apart), so the committed print could not be held to the live one
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx === null) throw new Error("desk/print: no 2d context on an OffscreenCanvas");
    }
    return ctx;
  };
  const widths = new Map<string, number>();
  return {
    hand() {
      const metrics: HandMetrics | undefined = opts.text.metrics(faceName);
      return metrics === undefined ? undefined : { face, metrics };
    },
    version: () => opts.text.version(),
    measure(font, s) {
      const key = `${font}\u0000${s}`;
      let w = widths.get(key);
      if (w === undefined) {
        measurer ??= new OffscreenCanvas(8, 8).getContext("2d");
        if (measurer === null) throw new Error("desk/print: no 2d context to measure with");
        measurer.font = font;
        w = measurer.measureText(s).width;
        widths.set(key, w);
      }
      return w;
    },
    tile(print: SheetPrint, x, y, w, h, band) {
      const g = context();
      drawRegion(g, print, x, y, w, h, band);
      return g.canvas;
    },
    bytes(print: SheetPrint, x, y, w, h, band) {
      const g = context();
      drawRegion(g, print, x, y, w, h, band);
      const img = g.getImageData(0, 0, TILE_TEX, TILE_TEX);
      return new Uint8Array(img.data.buffer.slice(0));
    },
  };
}
