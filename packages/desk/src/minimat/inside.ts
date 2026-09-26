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
//   insidePresent    the live inside's presentation at rest: its face, its mat
//                    whole, its objects at the gate's answer.
//   flightLights     the lamps a flight hands between the two desks.

import type { Box } from "../lattice/lod";
import type { GridConfig } from "../mat/grid";
import type { SlotLight } from "../mat/layout";
import { arrivalCamera, type CameraState, FIT, type FitBand, type Flight, flightOpacity, outgoingCamera, type PortalAffine, portalAffine, type Rect, type Viewport, visibleRect } from "../nav/flight";
import { boxOfPortal, clipOf, PORTAL_GATE, type PortalClip, portalPresence, type Presentation } from "../nav/portal";
import type { MiniMatInstance } from "./layout";
import { type Chip, DEFAULT_MINIMAT_LAW, FACE_RADIUS, faceLattice, faceOf, type MiniMatGeometry, type MiniMatLaw, numeralsOf } from "./minimat";

export interface InsideView {
  /** The embedding: inside → host (`host = o + inside · s`) — the flight's own. */
  readonly M: PortalAffine;
  /** The inside's arrival camera — what its lattice is DRESSED for (PORTAL.md §9). */
  readonly arrival: CameraState;
  /** The camera the inside renders under at the host's camera: the enter flight's c0 at the cut. */
  readonly cam: CameraState;
  /** The face on screen: the live inside's clip. */
  readonly clip: PortalClip;
  /** The gate's answer (0..1): the live inside's presence — 0 = the face is the far LOD alone. */
  readonly presence: number;
  /** The live inside's box on the attachment. */
  readonly box: Box;
}

/**
 * A mini mat's inside under the host camera `cam`: `content` the bounds of the inside (null = empty
 * — it arrives on its origin at zoom 1). The arrival and the embedding are the flight's own
 * (`arrivalCamera`, `portalAffine` on the same inputs), so a live inside rendered under `cam` IS the
 * flight's first frame. Null only for a face with no area.
 */
export function insideView(G: MiniMatGeometry, content: Rect | null, cam: CameraState, vp: Viewport, fit: FitBand = FIT, gate: readonly [number, number] = PORTAL_GATE): InsideView | null {
  return insideViewOfFace(faceOf(G), content, cam, vp, fit, gate);
}

/**
 * The same view from a FACE rect alone (D2b): what a kind's `face(geometry)` hands the builder, so
 * any container kind's inside is built by the one law — `faceClip` is `clipOf(faceOf(G), FACE_RADIUS, cam)`,
 * so the numbers are `insideView`'s to the bit.
 */
export function insideViewOfFace(K: Rect, content: Rect | null, cam: CameraState, vp: Viewport, fit: FitBand = FIT, gate: readonly [number, number] = PORTAL_GATE): InsideView | null {
  if (!(K.width > 0) || !(K.height > 0)) return null;
  const clip = clipOf(K, FACE_RADIUS, cam);
  const arrival = arrivalCamera(content, vp, fit);
  const M = portalAffine(visibleRect(arrival, vp.width, vp.height), K);
  return { M, arrival, cam: outgoingCamera(M, cam), clip, presence: portalPresence(clip, gate), box: boxOfPortal(clip, vp) };
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

/** The live inside's presentation at rest: through its face, its mat whole, its objects at the gate's answer (MINIMAT.md §5). */
export const insidePresent = (view: InsideView): Presentation => ({ opacity: 1, objects: view.presence, portal: view.clip });

/**
 * The presentations of a flight through a mini mat's face: `flightOpacity` as ever, and — on an
 * ENTER — the arriving desk's objects at the gate's answer for the face as it is this frame, so
 * a mini mat entered from its far LOD grows through the gate on the way in and its chips give way
 * to its objects as it does (the arriving desk's mat is whole from the cut: the same lattice as
 * the face's, by the same lamp). An exit keeps its objects whole and lands on whatever the face
 * shows at the landing (the old landing fade). A frozen flight is a dissolve.
 */
/** What the flight helpers read of a flight: its kind, its progress, whether it is frozen — the prototype's `Flight` or core's `NavTransition` alike. */
export type FlightState = Pick<Flight, "kind" | "p" | "frozen">;

export function flightPresent(f: FlightState, clip: PortalClip | undefined, gate: readonly [number, number] = PORTAL_GATE): { readonly incoming: Presentation; readonly outgoing: Presentation } {
  const op = flightOpacity(f.kind, f.p, f.frozen);
  if (f.frozen || !clip) return { incoming: { opacity: op.incoming }, outgoing: { opacity: op.outgoing } };
  if (f.kind === "enter") return { incoming: { opacity: op.incoming, objects: portalPresence(clip, gate), portal: clip }, outgoing: { opacity: op.outgoing } };
  return { incoming: { opacity: op.incoming }, outgoing: { opacity: op.outgoing, portal: clip } };
}

/**
 * When a flight hands the lamp over, as progress windows. ENTER hands it over once the departed
 * desk starts to go (flightOpacity: it holds to 0.3) — until then the frame IS the rest frame
 * under the departed camera; an EXIT hands it back in its first half — from then on the frame IS
 * the rest frame under the flying camera, the inside lit as a mini mat's inside is.
 */
export const HANDOVER = { enter: [0.3, 1], exit: [0, 0.5] } as const;
/** Smooth at both ends; exactly 0 before the window and 1 after it. */
const ease = (p: number, [a, b]: readonly [number, number]): number => { const x = (p - a) / (b - a); return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); };

/**
 * The LAMPS a flight hands between the two desks (MINIMAT.md §4). At rest a mini mat's inside is
 * lit by the desk the mini mat lies on; a desk the camera is on, by its own lamp. ENTER: the
 * arriving desk starts under the departed desk's lamp (`outCam` — at the cut, the portal's own
 * light, bit for bit) and ends under its own. EXIT: the departed desk starts under its own and
 * ends under the arriving desk's — the lamp its mini mat's inside is lit by at rest. A frozen
 * flight is two whole desks under their own lamps.
 */
export function flightLights(f: FlightState, cam: CameraState, outCam: CameraState): { readonly incoming?: SlotLight; readonly outgoing?: SlotLight } {
  if (f.frozen) return {};
  return f.kind === "enter" ? { incoming: { a: outCam, b: cam, t: ease(f.p, HANDOVER.enter) } } : { outgoing: { a: outCam, b: cam, t: ease(f.p, HANDOVER.exit) } };
}
