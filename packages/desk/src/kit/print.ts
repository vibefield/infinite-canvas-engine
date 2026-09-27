// THE PRINT'S RASTER — a service a kind is lent (`PRINT_RASTER`, K8a — the desk calendar's DOM half lends it; moved here from calendar/printing.ts at K4a,
// design-016 §5, so the contract names no kind's folder): the host's hand face and its metrics, a version that turns
// over when a face lands, the type's widths, and a rectangle of a PRINT drawn into a tile. What a print is belongs to
// the kind that prints (the desk calendar's `SheetPrint`), so the service is generic over it — `P` is opaque here and
// the kind's own type in the kind; the host half that draws it (desk/host/print.ts) names the same `P`.

import { type ServiceKey, serviceKey } from "./services";
import type { HandMetrics } from "./text";

/** The hand's face as a print sets it: a family and a weight (the host loads it — desk/host/ink.ts `PEN_FACES`). */
export interface PrintFace {
  readonly family: string;
  readonly weight: number;
}

/** What a pass takes a tile as: the host's canvas (TILE_TEX², straight alpha) — a type only. */
export type TileSource = HTMLCanvasElement | OffscreenCanvas;

/**
 * THE PRINT'S RASTER (the host's seam, as `TextRaster` is the note's): the hand's face and its metrics (undefined while the
 * face loads — the print waits rather than set the hand in a stand-in face), a version that turns over when a face lands,
 * the type's widths, and a rectangle of a print drawn into a tile at `band` texels a unit.
 */
export interface PrintRaster<P = unknown> {
  hand(): { readonly face: PrintFace; readonly metrics: HandMetrics } | undefined;
  version(): number;
  measure(font: string, text: string): number;
  tile(print: P, x: number, y: number, w: number, h: number, band: number): TileSource;
  /** The same rectangle as RGBA bytes, TILE_TEX² × 4, row 0 at the top — a fixture's (a rig reads the live print through it). */
  bytes(print: P, x: number, y: number, w: number, h: number, band: number): Uint8Array<ArrayBuffer>;
}

/**
 * The print raster as a desk SERVICE (K8a, kit/services.ts): lent by the object whose DOM half makes it (the desk calendar's,
 * over the host's text raster) and `use`d by any kind that prints — `host.use?.(PRINT_RASTER)`.
 */
export const PRINT_RASTER: ServiceKey<PrintRaster> = serviceKey<PrintRaster>("print");
