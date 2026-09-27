// A mini mat's INSIDE as a host sees it (MINIMAT.md §3–§5) — pure: no GPU. The
// lab and the Node oracle both build their frames through these, so the two
// hosts agree on every number a still is made of.
//
//   insideView       the embedding (the flight's own: the inside's arrival fitted
//                    to the face — `portalAffine`), the camera the inside renders
//                    under at the host's camera (`outgoingCamera`), its face on
//                    screen, and the gate's answer — ALWAYS, past the gate or not:
//                    the far LOD draws the face on the same embedding.
//   miniMatInstance  what the mini mat pass takes: the geometry, the vinyl, the
//                    embedding with the lattice the live inside would draw, the chips.
//
// The view through ANY container's face — `insideViewOfFace` — the live inside's presentation, a flight's presentations and
// the lamps it hands between the two desks are the kit's since K4b (kit/inside.ts): the builder nests every container by them.

import { type GridConfig, type CameraState, FIT, type FitBand, PORTAL_GATE, type Rect, type Viewport, type InsideView, insideViewOfFace } from "@ice/desk/kit";
import type { MiniMatInstance } from "./layout";
import { type Chip, DEFAULT_MINIMAT_LAW, faceLattice, faceOf, type MiniMatGeometry, type MiniMatLaw, numeralsOf } from "./minimat";
import { MINIMAT } from "./theme";


/**
 * A mini mat's inside under the host camera `cam`: `content` the bounds of the inside (null = empty
 * — it arrives on its origin at zoom 1). The arrival and the embedding are the flight's own
 * (`arrivalCamera`, `portalAffine` on the same inputs), so a live inside rendered under `cam` IS the
 * flight's first frame. Null only for a face with no area.
 */
export function insideView(G: MiniMatGeometry, content: Rect | null, cam: CameraState, vp: Viewport, fit: FitBand = FIT, gate: readonly [number, number] = PORTAL_GATE): InsideView | null {
  return insideViewOfFace(faceOf(G), MINIMAT.faceRadius, content, cam, vp, fit, gate);
}

/**
 * What the pass takes for one mini mat: `grid` is the INSIDE's (its fade-in and its line law — the
 * face's far-LOD lattice is the live inside's, dressed for its arrival when `dress`; its vinyl — the
 * inside's mat is the same vinyl, `grid.mat.ground`), `name` what its foot prints; the ruler numbers
 * the rung the law says at the inside's zoom.
 */
export function miniMatInstance(G: MiniMatGeometry, view: InsideView, grid: GridConfig, chips: readonly Chip[], name?: string, dress = true, law: MiniMatLaw = DEFAULT_MINIMAT_LAW): MiniMatInstance {
  const lattice = faceLattice(view.cam.zoom, grid.fadeIn, grid.mat.line, dress ? view.arrival.zoom : undefined);
  return { geometry: G, ground: grid.mat.ground, grain: grid.mat.grain, inside: { M: view.M, lattice }, chips, numerals: numeralsOf(lattice, view.cam.zoom, law.print.labelsFrom), ...(name ? { name } : {}) };
}
