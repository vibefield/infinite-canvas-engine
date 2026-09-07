// How a slot PRESENTS itself this frame: an opacity, and the rounded rects on
// screen it is visible through — the FACE it is seen through (its portal) and,
// for a nested slot, the faces of every slot above it (`within`, nearest
// first): the CHAIN. During a flight the arriving frame's ground is visible
// only through the container's face (enter), or the departing frame's only
// through the face it shrinks into (exit); a nested slot's inside is visible
// only where its face lies inside its parent's, and so on up; at rest the root
// presents everything. Every pass reads the chain by name (`portals`, `clips`)
// and multiplies its coverage by `portal_cover` (shaders/portal.wgsl); the
// ground also scissors the slot's draws to the chain's bounding box so nothing
// outside it is shaded.

import type { Box } from "../lattice/lod";
import { arrivalCamera, type CameraState, type FitBand, FIT, outgoingCamera, type PortalAffine, portalAffine, type Rect, type Viewport, visibleRect } from "./flight";

/** A rounded rect in screen CSS px: centre, half extents, corner radius. */
export interface PortalClip { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly r: number }

/**
 * The most faces a slot can be seen through, its own included — the length
 * of every uniform block's `portals`/`clips` arrays; portal.wgsl's
 * `PORTAL_CHAIN` is the same number (a mismatch fails to compile). Six holds
 * a host's depth belt of four plus the flight's face.
 */
export const PORTAL_CHAIN = 6;
/** The struct field type of a chain record (gpu/struct.ts). */
export const PORTAL_CHAIN_TYPE = `array<vec4f, ${PORTAL_CHAIN}>` as const;

export interface Presentation {
  /** Multiplies the slot's every alpha; 1 at rest. */
  readonly opacity: number;
  /** The face this slot is seen through; absent = visible everywhere (the root). */
  readonly portal?: PortalClip;
  /**
   * The faces the slot's PARENT is seen through, nearest first: a nested slot is
   * visible only inside all of them. The ground fills this in from the tree
   * (PORTAL.md §10); a host never needs to.
   */
  readonly within?: readonly PortalClip[];
}

/** The chain a presentation clips to: its own face first, then every face above it. Empty = everywhere. */
export function chainOf(p: Presentation | undefined): PortalClip[] {
  const out: PortalClip[] = [];
  if (p?.portal) out.push(p.portal);
  if (p?.within) out.push(...p.within);
  return out;
}

/** The `portals` and `clips` records every uniform block carries: the chain in order, a zero `clips[i].y` ending it. */
export function portalValues(p: Presentation | undefined): { portals: number[]; clips: number[] } {
  const portals = new Array<number>(4 * PORTAL_CHAIN).fill(0);
  const clips = new Array<number>(4 * PORTAL_CHAIN).fill(0);
  const chain = chainOf(p);
  if (chain.length > PORTAL_CHAIN) throw new Error(`nav/portal: a chain of ${chain.length} faces exceeds PORTAL_CHAIN ${PORTAL_CHAIN}`);
  chain.forEach((c, i) => { portals[4 * i] = c.cx; portals[4 * i + 1] = c.cy; portals[4 * i + 2] = c.hx; portals[4 * i + 3] = c.hy; clips[4 * i] = c.r; clips[4 * i + 1] = 1; });
  return { portals, clips };
}

/** A world rect (with a corner radius) as the portal it makes on screen under `cam`. */
export function clipOf(K: Rect, radius: number, cam: CameraState): PortalClip {
  const z = cam.zoom;
  return { cx: (K.x + K.width / 2 - cam.x) * z, cy: (K.y + K.height / 2 - cam.y) * z, hx: (K.width / 2) * z, hy: (K.height / 2) * z, r: radius * z };
}

/**
 * The slot's BOX for a portal (CSS px, inside the attachment; lod.ts `Box`):
 * the portal's bounding box plus a CSS px for the AA ramp. What a nested
 * slot instances, bakes and culls — its cost (PORTAL.md §2.3). The ground
 * intersects it with the parent's box (§10).
 */
export function boxOfPortal(c: PortalClip, attach: { readonly width: number; readonly height: number }): Box {
  const x0 = Math.max(0, c.cx - c.hx - 1);
  const y0 = Math.max(0, c.cy - c.hy - 1);
  const x1 = Math.min(attach.width, c.cx + c.hx + 1);
  const y1 = Math.min(attach.height, c.cy + c.hy + 1);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** The intersection of two boxes; empty (zero size) when they miss. */
export function intersectBox(a: Box, b: Box): Box {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

// ---------------------------------------------------------------- the face (PORTAL.md §2.1, §10)

/** A face's insets from a card's content rect (card units) and the face's own corner radius. */
export interface FaceInsets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number; readonly radius: number }
/**
 * The product folder's face: its manifest `portal` insets (plugins/field-tools
 * — a 10 px pad, the 36 px bar below) and its portal's corner radius
 * (folder.css). The band between the face and the card's interior stays the
 * plate; the hole is cut to the face (card/content.ts `PortalFace`).
 */
export const FOLDER_FACE: FaceInsets = { top: 10, right: 10, bottom: 36, left: 10, radius: 7 };
/**
 * The face a card shows its inside through: its content rect `K` inset — or,
 * as ICE's `resolvePortal` rules, `K` ITSELF (the very object) when the insets
 * leave no area: a card too small for its face shows its inside through the
 * whole body, at the card's own radius (`faceRadius`).
 */
export function faceRect(K: Rect, f: FaceInsets): Rect {
  const width = K.width - f.left - f.right;
  const height = K.height - f.top - f.bottom;
  return width > 0 && height > 0 ? { x: K.x + f.left, y: K.y + f.top, width, height } : K;
}
/** The face's corner radius: the insets' own, or the card's when the face fell back to the whole body. */
export const faceRadius = (K: Rect, f: FaceInsets, cardRadius: number): number => (faceRect(K, f) === K ? cardRadius : f.radius);

// ---------------------------------------------------------------- the live portal (PORTAL.md)

/**
 * The GATE (PORTAL.md §2.5): a container's face shows its inside only when its
 * short side on screen is at least `lo` CSS px, fading in fully by `hi` — the
 * rung law applied to portals. Below it the container is a plate and no slot
 * exists; zoomed out, a board of folders costs nothing.
 */
export const PORTAL_GATE: readonly [number, number] = [80, 120];
/** The pool's cap: at most this many faces carry a slot per frame, largest first (PORTAL.md Q-f). */
export const PORTAL_CAP = 16;

const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(Math.max((x - a) / Math.max(b - a, 1e-3), 0), 1); return t * t * (3 - 2 * t); };
/** The slot's presence for a face on screen — its opacity; 0 = no slot. */
export const portalPresence = (c: PortalClip, gate: readonly [number, number] = PORTAL_GATE): number => smoothstep(gate[0], gate[1], 2 * Math.min(c.hx, c.hy));

/** A live portal's geometry, as `portalOf` resolves it for one frame. */
export interface LivePortal {
  /** The inside's arrival camera (`arrivalCamera` of its content) — what the slot's grid is DRESSED for (PORTAL.md §9). */
  readonly arrival: CameraState;
  /** The embedding: the inside's coords → the parent's (`kernel` `portalAffine`; the flight's own). */
  readonly M: PortalAffine;
  /** The camera the inside renders under — the departed-slot ride `outgoingCamera(M, cam)`: the enter flight's c0 at the cut (PORTAL.md §2). */
  readonly cam: CameraState;
  /** The face on screen: the slot's clip. */
  readonly clip: PortalClip;
  /** The gate's answer, 0..1 — the slot's opacity. */
  readonly presence: number;
  /** The slot's box on the attachment. */
  readonly box: Box;
}

/**
 * Resolve a container's live portal under the parent's camera: `K` its face
 * (in the parent's frame), `content` the bounds of its inside (null = empty;
 * a thunk is asked only past the gate, so a host can make an inside on first
 * sight), `cam` the parent's camera. The inside's arrival camera and the
 * affine are the flight's own (`arrivalCamera`, `portalAffine` on the same
 * inputs), so what this renders IS the flight's first frame. `null` when the
 * face is under the gate or has no area.
 */
export function portalOf(K: Rect, radius: number, content: Rect | null | (() => Rect | null), cam: CameraState, vp: Viewport, fit: FitBand = FIT, gate: readonly [number, number] = PORTAL_GATE): LivePortal | null {
  if (!(K.width > 0) || !(K.height > 0)) return null;
  const clip = clipOf(K, radius, cam);
  const presence = portalPresence(clip, gate);
  if (presence <= 0) return null;
  const arrival = arrivalCamera(typeof content === "function" ? content() : content, vp, fit);
  return portalFrom(K, arrival, cam, vp, clip, presence);
}

/**
 * The same portal from an ARRIVAL already solved — ICE's preview store hands a
 * container's `resolvedView` (its own fit, its own limits), so the ground never
 * re-derives what the flight will land on. Everything after the gate is
 * `portalOf`'s own arithmetic (`portalFrom`): the two agree bit for bit on
 * the same arrival.
 */
export function portalAt(K: Rect, radius: number, arrival: CameraState, cam: CameraState, vp: Viewport, gate: readonly [number, number] = PORTAL_GATE): LivePortal | null {
  if (!(K.width > 0) || !(K.height > 0)) return null;
  const clip = clipOf(K, radius, cam);
  const presence = portalPresence(clip, gate);
  if (presence <= 0) return null;
  return portalFrom(K, arrival, cam, vp, clip, presence);
}

/** The record past the gate: the embedding, the inside's camera, the box — one place, so `portalOf` and `portalAt` cannot drift. */
function portalFrom(K: Rect, arrival: CameraState, cam: CameraState, vp: Viewport, clip: PortalClip, presence: number): LivePortal {
  const M = portalAffine(visibleRect(arrival, vp.width, vp.height), K);
  return { arrival, M, cam: outgoingCamera(M, cam), clip, presence, box: boxOfPortal(clip, vp) };
}

/**
 * ZOOM-THROUGH (PORTAL.md §8, §9): does a face COVER the viewport — every corner of the
 * viewport inside the face's rounded rect by at least `margin` CSS px (negative = may
 * poke out by that much)? Entering when it does is a cut nobody can see: the whole view
 * is already the inside; leaving when it no longer does shows the parent only where the
 * face has left the view. The two margins make the dead band.
 */
export function faceCovers(c: PortalClip, vp: Viewport, margin: number): boolean {
  const rr = Math.min(c.r, c.hx, c.hy);
  const sd = (x: number, y: number): number => {
    const qx = Math.abs(x - c.cx) - c.hx + rr;
    const qy = Math.abs(y - c.cy) - c.hy + rr;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  };
  return sd(0, 0) <= -margin && sd(vp.width, 0) <= -margin && sd(0, vp.height) <= -margin && sd(vp.width, vp.height) <= -margin;
}
/** The dead band: enter once the face covers the view by this much … */
export const THROUGH_IN = 2;
/** … leave once it fails to cover by this much. */
export const THROUGH_OUT = 6;

/** The scissor a presentation draws inside (device px): the chain's bounding boxes intersected, a device px of slack for the AA ramp; the attachment when there is no chain. */
export function scissorOf(p: Presentation | undefined, dpr: number, size: { readonly w: number; readonly h: number }): readonly [number, number, number, number] {
  let x0 = 0;
  let y0 = 0;
  let x1 = size.w;
  let y1 = size.h;
  for (const c of chainOf(p)) {
    x0 = Math.max(x0, Math.floor((c.cx - c.hx) * dpr) - 1); y0 = Math.max(y0, Math.floor((c.cy - c.hy) * dpr) - 1);
    x1 = Math.min(x1, Math.ceil((c.cx + c.hx) * dpr) + 1); y1 = Math.min(y1, Math.ceil((c.cy + c.hy) * dpr) + 1);
  }
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}
