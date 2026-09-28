// How a slot PRESENTS itself this frame: an opacity, and the rounded rects on
// screen it is visible through — the FACE it is seen through (its portal: a
// mini mat's cutting area, MINIMAT.md §3) and, for a nested slot, the faces of
// every slot above it (`within`, nearest first): the CHAIN. During a flight the
// arriving desk's ground is visible only through the mini mat's face (enter),
// or the departing desk's only through the face it shrinks into (exit); a
// nested slot's inside is visible only where its face lies inside its parent's,
// and so on up; at rest the root presents everything. Every pass reads the chain by name (`portals`, `clips`)
// and multiplies its coverage by `portal_cover` (shaders/portal.wgsl); the
// ground also scissors the slot's draws to the chain's bounding box so nothing
// outside it is shaded.

import type { Box } from "../lattice/lod";
import { PORTAL } from "../theme";
import type { CameraState, Rect, Viewport } from "./flight";

/**
 * A rounded rect in screen CSS px: centre, half extents, corner radius — and a top FEATHER (design-018 §4): what the face shows
 * fades in over this many CSS px below its top edge, a smoothstep in every pass's `portal_cover` (absent or 0: a hard edge). The
 * pegboard tray's face carries one, so its specimens dissolve into the board at the drawer's top edge instead of being cut.
 */
export interface PortalClip { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly r: number; readonly feather?: number }

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
  /**
   * Multiplies its OBJECTS' alphas on top — not its mat (MINIMAT.md §5): a mini mat's live inside
   * comes in over the face's own drawing with its mat whole at once (the same lattice, lit by the
   * same lamp — nothing to see) and its objects fading in by the gate's answer, as the face's chips
   * fade out over them. Absent = 1.
   */
  readonly objects?: number;
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

/** The `portals` and `clips` records every uniform block carries: the chain in order, a zero `clips[i].y` ending it; `clips[i].z` the feather. */
export function portalValues(p: Presentation | undefined): { portals: number[]; clips: number[] } {
  const portals = new Array<number>(4 * PORTAL_CHAIN).fill(0);
  const clips = new Array<number>(4 * PORTAL_CHAIN).fill(0);
  const chain = chainOf(p);
  if (chain.length > PORTAL_CHAIN) throw new Error(`nav/portal: a chain of ${chain.length} faces exceeds PORTAL_CHAIN ${PORTAL_CHAIN}`);
  chain.forEach((c, i) => { portals[4 * i] = c.cx; portals[4 * i + 1] = c.cy; portals[4 * i + 2] = c.hx; portals[4 * i + 3] = c.hy; clips[4 * i] = c.r; clips[4 * i + 1] = 1; clips[4 * i + 2] = c.feather ?? 0; });
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

// ---------------------------------------------------------------- the live portal (PORTAL.md)

/**
 * The GATE (PORTAL.md §2.5, MINIMAT.md §5): a container's face shows its LIVE
 * inside only when its short side on screen is at least `lo` CSS px, fading in
 * fully by `hi` — the rung law applied to portals. Below it no slot exists and
 * the mini mat draws its face itself (its far LOD); zoomed out, a desk of mini
 * mats costs one instanced draw. The engine holds the numbers (theme.ts
 * `PORTAL.gate`); the mini mat, the one container, takes them by name.
 */
export const PORTAL_GATE: readonly [number, number] = PORTAL.gate;
/** The pool's cap: at most this many faces carry a slot per frame, largest first (PORTAL.md Q-f). */
export const PORTAL_CAP = 16;

const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(Math.max((x - a) / Math.max(b - a, 1e-3), 0), 1); return t * t * (3 - 2 * t); };
/** The slot's presence for a face on screen — its opacity; 0 = no slot. */
export const portalPresence = (c: PortalClip, gate: readonly [number, number] = PORTAL_GATE): number => smoothstep(gate[0], gate[1], 2 * Math.min(c.hx, c.hy));

// (`portalOf` — a container's live portal resolved under the gate, null below it — retired with the
// folder card, 2026-09-25: a mini mat's face needs its embedding at every size, for the far LOD as for
// the live inside, so the mini mat's `insideView` (minimat/inside.ts) resolves it always.)

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
