// A CONTAINER's inside, as the contract names it (design-015 §5.2 `chip` · `InsideContext`; moved here from minimat/ at
// K4a, design-016 §5): the view a host has of the desk a container holds — its embedding, the camera it renders under,
// its face on screen, the gate's answer — and a child as that face's far LOD draws it (a CHIP). The mini mat is the
// container that makes them (minimat/inside.ts, `chipOf`); the builder hands them to a kind's `record` and `chip`. Pure
// types: the contract (kinds/world.ts) names them, so they live where no kind folder is imported to reach them.
//
// And the ONE LAW every container's inside is built by (moved here from minimat/inside.ts at K4b, design-016 §5 — the builder
// nests every container by it, so it cannot be the mini mat's alone): the view through a face (`insideViewOfFace`), the live
// inside's presentation at rest, a flight's presentations and the lamps it hands between the two desks, the face's clip radius
// and its chip cap.

import type { Box } from "../lattice/lod";
import type { SlotLight } from "../mat/layout";
import { arrivalCamera, type CameraState, FIT, type FitBand, type Flight, flightOpacity, outgoingCamera, type PortalAffine, portalAffine, type Rect, type Viewport, visibleRect } from "../nav/flight";
import { boxOfPortal, clipOf, PORTAL_GATE, type PortalClip, portalPresence, type Presentation } from "../nav/portal";
import type { RGB } from "../theme";

/** A container's inside under the host camera (MINIMAT.md §3–§5): what `insideView` answers — ALWAYS, past the gate or not. */
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
 * The FINISH a container's face draws a child's chip in (K8a — open: until K8a a chip was a `ChipKind`, `"paper" | "mat"`, the two
 * built-ins' own names, so no plugin kind could have one): a name among the container's `FaceLaw.finishes` — the mini mat draws
 * `"paper"` (a sheet in the chip's colour, its writing greeked) and `"vinyl"` (grained, its frame line at `margin`) — and a plugin
 * container draws its own. A chip names one, or several in preference order; the first the container draws wins, and a chip the
 * container draws none of is not drawn (the builder counts it: `BuildWork.unchipped`) — never a finish it did not ask for.
 */
export type ChipFinish = string;
/** The two finishes the kit names — a chip's shared vocabulary (a note's `paper`, a mini mat's `vinyl`); a container may draw more. */
export const PAPER_FINISH: ChipFinish = "paper";
export const VINYL_FINISH: ChipFinish = "vinyl";

/** One child as the face's far LOD draws it, in the CHILD's frame (the inside's world). */
export interface ChildShape {
  /** Its finish (`ChipFinish`) — or finishes, in preference order; the builder hands the container the one it draws. */
  readonly finish: ChipFinish | readonly ChipFinish[];
  readonly cx: number; readonly cy: number;
  /** Half extents, the tilt (radians), the corner radius — the child's own. */
  readonly hx: number; readonly hy: number;
  readonly angle: number;
  readonly radius: number;
  /** Its colour: the paper's, or the vinyl's. */
  readonly colour: RGB;
  /** How far it stands off the face, child units — what its contact shadow is cast from. */
  readonly height: number;
  /** A note's writing, GREEKED: the pen's colour, the text's left edge and em (note units from the sheet's top-left), and each line's baseline and width. */
  readonly writing?: { readonly ink: RGB; readonly x0: number; readonly em: number; readonly lines: readonly { readonly y: number; readonly width: number }[] } | undefined;
  /** A mini mat's printed border, child units. */
  readonly margin?: number | undefined;
}

/**
 * A CONTAINER kind's FACE LAW (K8a — the container's own, declared on its kind as `ObjectKind.faceLaw`): the chip finishes its face
 * draws. Absent on a kind with a `face`: its face draws no chips.
 */
export interface FaceLaw {
  readonly finishes: readonly ChipFinish[];
}

/** The finish a container draws a chip in: the chip's first that the container draws, or undefined — none (the chip is not drawn). */
export function finishOf(finish: ChipFinish | readonly ChipFinish[], drawn: readonly ChipFinish[]): ChipFinish | undefined {
  if (typeof finish === "string") return drawn.includes(finish) ? finish : undefined;
  return (finish as readonly ChipFinish[]).find((f) => drawn.includes(f));
}

/**
 * The face's corner radius a container's inside is clipped by (MINIMAT.md §5; D2b): square — `clipOf(face, FACE_RADIUS, cam)` for
 * every container, and core's nav geometry agrees (nav-geometry.ts). The kit's since K4b: the builder cuts every container's
 * inside with it, so it cannot be one kind's.
 */
export const FACE_RADIUS = 0;

/** At most this many chips a container's face draws (MINIMAT.md §3, the far LOD's cap): the builder's cut, and the mini mat's law's default. */
export const FACE_CHIPS_MAX = 64;

/**
 * The same view from a FACE rect alone (D2b): what a kind's `face(geometry)` hands the builder, so
 * any container kind's inside is built by the one law — `faceClip` is `clipOf(faceOf(G), FACE_RADIUS, cam)`,
 * so the numbers are the mini mat's `insideView`'s to the bit.
 */
export function insideViewOfFace(K: Rect, content: Rect | null, cam: CameraState, vp: Viewport, fit: FitBand = FIT, gate: readonly [number, number] = PORTAL_GATE): InsideView | null {
  if (!(K.width > 0) || !(K.height > 0)) return null;
  const clip = clipOf(K, FACE_RADIUS, cam);
  const arrival = arrivalCamera(content, vp, fit);
  const M = portalAffine(visibleRect(arrival, vp.width, vp.height), K);
  return { M, arrival, cam: outgoingCamera(M, cam), clip, presence: portalPresence(clip, gate), box: boxOfPortal(clip, vp) };
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
