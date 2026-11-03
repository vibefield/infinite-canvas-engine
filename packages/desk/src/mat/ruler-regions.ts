// Partition the mat into its surface and foreground rulers. Every pixel belongs
// to exactly one region: no extra mat shading, and no double alpha during fades.
import type { View } from "../lattice/lod";
import type { RulerConfig } from "./layout";

export type MatRegion = readonly [number, number, number, number];
export interface RulerRegions {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly margin: number;
  readonly band: number;
  readonly line: number;
  readonly surface: readonly MatRegion[];
  readonly edges: readonly MatRegion[];
}

/** Geometry changes only on resize, DPR or ruler styling; camera motion reuses it. */
export function rulerRegions(view: View & { readonly dpr: number }, ruler: RulerConfig, previous: RulerRegions | null): RulerRegions {
  const { width, height, dpr } = view;
  const { margin, band, line } = ruler;
  if (previous && previous.width === width && previous.height === height && previous.dpr === dpr && previous.margin === margin && previous.band === band && previous.line === line) return previous;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  // ruler_line has a one-device-pixel AA ramp. Include it on both sides of each
  // boundary, then snap once so adjacent draws neither overlap nor leave gaps.
  const pad = line * dpr / 2 + 0.5;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const left = clamp(Math.floor(margin * dpr - pad), 0, w);
  const top = clamp(Math.floor(margin * dpr - pad), 0, h);
  const right = clamp(Math.ceil((width - margin) * dpr + pad), left, w);
  const bottom = clamp(Math.ceil((height - margin) * dpr + pad), top, h);
  const innerLeft = clamp(Math.ceil((margin + band) * dpr + pad), left, right);
  const innerTop = clamp(Math.ceil((margin + band) * dpr + pad), top, bottom);
  const innerRight = clamp(Math.floor((width - margin) * dpr - pad), innerLeft, right);
  const innerBottom = clamp(Math.floor((height - margin) * dpr - pad), innerTop, bottom);
  const surface: MatRegion[] = [
    [0, 0, w, top], [0, bottom, w, h - bottom],
    [0, top, left, bottom - top], [right, top, w - right, bottom - top],
    [innerLeft, innerTop, innerRight - innerLeft, innerBottom - innerTop],
  ];
  const edges: MatRegion[] = [
    [left, top, right - left, innerTop - top],
    [left, innerTop, innerLeft - left, innerBottom - innerTop],
    [innerRight, innerTop, right - innerRight, innerBottom - innerTop],
    [left, innerBottom, right - left, bottom - innerBottom],
  ];
  const nonempty = (r: MatRegion) => r[2] > 0 && r[3] > 0;
  return { width, height, dpr, margin, band, line, surface: surface.filter(nonempty), edges: edges.filter(nonempty) };
}
