// The LASER from the snap's facts (design-015 §7, *Marks on the Mat* Q-c; D4a) — pure. The snap law is
// the kernel's (`computeSnapGuides`, run by core's snap system, which writes each guide as a `GuideLine
// { axis, at }` and each equal gap as a `SpacingBar { axis, from, to, perp, gap }`, world units); what the
// laser DRAWS is desk.js `setGuides`, number for number: a guide is bright over the objects that align on
// it — every rect whose edge or centre lies on its line, and the dragged set — 14 px past them, with a
// flare at each aligned corner (a centre's flare at the middle of each object); a centre guide is dotted.
// Whether a guide is a centre is read off the dragged set (the kernel's `center` pair is the one that
// aligns the dragged set's CENTRE; every other pair aligns an edge of it), so a GuideLine needs no type.

import type { MarkBar, MarkGuide } from "./layout";

/** A world rect, top-left to bottom-right. */
export interface WorldBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/** A guide as the world states it: a line along `axis` at world `at` (kernel `SnapGuide.position`); its type when the caller knows it. */
export interface WorldGuide { readonly axis: "x" | "y"; readonly at: number; readonly type?: "edge" | "center" }
/** An equal gap as the world states it (core `SpacingBar`): world units. */
export interface WorldBar { readonly axis: "x" | "y"; readonly from: number; readonly to: number; readonly perp: number; readonly gap: number }
export interface LaserCamera { readonly x: number; readonly y: number; readonly zoom: number }

/** desk.js `setGuides`: the span a guide is bright over reaches this far (CSS px) past the objects it aligns. */
export const LASER_PAST = 14;

/**
 * The laser on screen: each guide's line, type, bright span and flares; each gap's bar. `others` are the rects the
 * snap aligned against (the objects not dragged), `dragged` the dragged set's union (null: none — a guide with nothing
 * dragged is still drawn, over what lies on it). An object lies on a line when its edge or centre is within half a
 * screen px of it (desk.js's 0.05 world units at zoom 1 — relative here, so it holds at every zoom).
 */
export function laserOf(guides: readonly WorldGuide[], bars: readonly WorldBar[], others: readonly WorldBox[], dragged: WorldBox | null, cam: LaserCamera, past = LASER_PAST): { readonly guides: MarkGuide[]; readonly bars: MarkBar[] } {
  const z = cam.zoom;
  const eps = 0.5 / z;
  const sx = (x: number): number => (x - cam.x) * z;
  const sy = (y: number): number => (y - cam.y) * z;
  const out: MarkGuide[] = [];
  for (const g of guides) {
    const isX = g.axis === "x";
    const lo = (b: WorldBox): number => (isX ? b.x0 : b.y0);
    const hi = (b: WorldBox): number => (isX ? b.x1 : b.y1);
    const near = (v: number): boolean => Math.abs(v - g.at) < eps;
    const on = (b: WorldBox): boolean => near(lo(b)) || near(hi(b)) || near((lo(b) + hi(b)) / 2);
    const type = g.type ?? (dragged !== null && near((lo(dragged) + hi(dragged)) / 2) ? "center" : "edge");
    const boxes = others.filter(on);
    if (dragged !== null) boxes.push(dragged);
    let s0 = Number.POSITIVE_INFINITY;
    let s1 = Number.NEGATIVE_INFINITY;
    const points: [number, number][] = [];
    for (const b of boxes) {
      const a0 = isX ? b.y0 : b.x0;
      const a1 = isX ? b.y1 : b.x1;
      s0 = Math.min(s0, a0);
      s1 = Math.max(s1, a1);
      if (type === "center") points.push(isX ? [g.at, (a0 + a1) / 2] : [(a0 + a1) / 2, g.at]);
      else points.push(isX ? [g.at, a0] : [a0, g.at], isX ? [g.at, a1] : [a1, g.at]);
    }
    if (boxes.length === 0) { s0 = 0; s1 = 0; }
    const toScreen = (p: readonly [number, number]): readonly [number, number] => [sx(p[0]), sy(p[1])];
    const span: readonly [number, number] = isX ? [sy(s0) - past, sy(s1) + past] : [sx(s0) - past, sx(s1) + past];
    out.push({ axis: g.axis, at: isX ? sx(g.at) : sy(g.at), type, span: boxes.length === 0 ? [0, 0] : span, points: points.map(toScreen) });
  }
  const outBars: MarkBar[] = bars.map((b) => (b.axis === "x"
    ? { axis: "x", from: sx(b.from), to: sx(b.to), perp: sy(b.perp), gap: b.gap }
    : { axis: "y", from: sy(b.from), to: sy(b.to), perp: sx(b.perp), gap: b.gap }));
  return { guides: out, bars: outBars };
}

/** The key a guide set strikes on (desk.js: a NEW alignment flashes) — the axes and positions, then the gaps, at 0.1 (desk.js ran the two lists together; a `#` keeps them apart). */
export function laserKey(guides: readonly WorldGuide[], bars: readonly WorldBar[]): string {
  return `${guides.map((g) => `${g.axis}${g.at.toFixed(1)}`).join("|")}#${bars.map((b) => b.gap.toFixed(1)).join("|")}`;
}
