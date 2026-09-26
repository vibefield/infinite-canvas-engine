// THE HAND'S POSE (design-015 §8; D4b) — *Marks on the Mat* v2's Opening, desk.js `HOLD` · `heldTarget` ·
// `heldPose`, number for number, as pure math the builder, the pose seam, the oracle and the units all read.
//
// An object is picked up INTO THE HAND: no camera move. Its OPEN EXTENT (the kind's `open.extent`: a
// spread twice the case's width left of the spine, a board's face, a pad's month) comes to the middle of
// the view at its READING SIZE — one rule for every object: the extent fits the view with `margin` clear at
// the sides and top and the bar's `band` below, never past `max` — whatever the zoom you were at. Between
// the desk and the hand the pose is ONE curve: the position on the island ease, the size in LOG scale (the
// flight's zoom law: a book picked up from far out grows evenly), the tilt let go. The user's `zoom` (0.72 …
// 3, about the pointer) and `pan` ride on the reading pose. On a portrait phone a spread opens one page at a
// time (Q-p): the right page centred, the left waiting at the edge.
//
// THE POSE IS A CAMERA (the plan's D4b ruling): a flat kind is drawn by its own pass, at rest, under a
// camera that maps its extent to the held rect — `heldCamera` — no per-kind pose code. A kind with height
// (the notebook, `open.pose: "eye"`) keeps the desk's zoom under that camera and RISES toward the desk eye
// by `grow` instead: a point `z` up projects by H/(H − z), so z = H·(1 − 1/grow) reads at `grow` times its
// size (the page's engine plan: "posed under the desk eye, rising to H·(1 − 1/s)").

import { easeIsland } from "../marks/ease";
import type { ObjectRect } from "../kinds/world";
import type { CameraState } from "../nav/flight";

/** The hand's numbers (desk.js `HOLD`). Times in ms; `margin`/`top`/`band` CSS px; `blur` CSS px; `narrow` = a phone's width. */
export const HOLD = {
  inMs: 560, outMs: 440, closeLead: 0.14, openAt: 0.42,
  blur: 14, blurPhone: 10, dim: 0.08,
  margin: 56, marginPhone: 16, top: 56, topPhone: 60, band: 72,
  max: 3, zoomMin: 0.72, zoomMax: 3,
  narrow: 640,
  /** The reading light by night (Q-n): the held object keeps its day light, filtered. */
  light: { saturate: 0.62, brightness: 0.82 },
  /** The cover's spring in hand (desk.js `COVER`): a palm, not a desk. */
  cover: { hz: 1.4, zeta: 0.78 },
  /** The held bar's travel (M1 morph) and its return after the landing. */
  bar: { travelMs: 340, backMs: 200 },
} as const;

export interface HeldViewport { readonly width: number; readonly height: number }

/** The reading pose's target: where the open extent's centre goes on screen (CSS px), the scale there (CSS px per object unit), one page or the spread. */
export interface ReadingTarget {
  readonly cx: number;
  readonly cy: number;
  readonly s: number;
  readonly single: boolean;
}

/** A phone's width (desk.js `narrow`). */
export const isNarrow = (vp: HeldViewport): boolean => vp.width < HOLD.narrow;

/**
 * The reading size (desk.js `heldTarget`): the extent fits the view inside the margins and above the bar's band, never past 3×.
 * `spread`: the extent is a two-page spread that may open one page at a time — on a portrait phone (W < 0.85·H) it does when
 * one page reads at least 1.3× larger than the whole spread would; then the RIGHT page is centred (the extent's centre sits a
 * quarter of its width left of the middle).
 */
export function readingTarget(extent: ObjectRect, vp: HeldViewport, spread = false): ReadingTarget {
  const narrow = isNarrow(vp);
  const m = narrow ? HOLD.marginPhone : HOLD.margin;
  const top = narrow ? HOLD.topPhone : HOLD.top;
  const boxW = Math.max(40, vp.width - 2 * m);
  const boxH = Math.max(40, vp.height - top - HOLD.band);
  let s = Math.min(boxW / extent.w, boxH / extent.h, HOLD.max);
  let single = false;
  if (spread && narrow && vp.width < vp.height * 0.85) {
    const s1 = Math.min(boxW / (extent.w / 2), boxH / extent.h, HOLD.max);
    if (s1 > s * 1.3) { s = s1; single = true; }
  }
  return { cx: vp.width / 2 - (single ? (extent.w / 4) * s : 0), cy: top + boxH / 2, s, single };
}

/** Where the extent lies on screen at rest, under the desk's camera: its centre (CSS px), the scale (the zoom) and the object's turn. */
export interface HomePose { readonly cx: number; readonly cy: number; readonly s: number; readonly angle: number }

export function homePose(extent: ObjectRect, angle: number, cam: CameraState): HomePose {
  return { cx: (extent.cx - cam.x) * cam.zoom, cy: (extent.cy - cam.y) * cam.zoom, s: cam.zoom, angle };
}

/** The user's facts on the held object (core's `HeldView`). */
export interface HeldUser { readonly zoom: number; readonly panX: number; readonly panY: number }
export const HELD_USER_REST: HeldUser = { zoom: 1, panX: 0, panY: 0 };

/** The pose between the desk and the hand: the extent's centre on screen, CSS px per unit, the turn, the carry amount. */
export interface HeldPose { readonly cx: number; readonly cy: number; readonly s: number; readonly angle: number; readonly e: number }

/** desk.js `heldPose`: position on the island curve (the caller eases `e`), size in log scale, the tilt let go. */
export function heldPose(home: HomePose, target: ReadingTarget, user: HeldUser, e: number): HeldPose {
  const s1 = target.s * user.zoom;
  const s = Math.exp(Math.log(Math.max(home.s, 1e-9)) + (Math.log(Math.max(s1, 1e-9)) - Math.log(Math.max(home.s, 1e-9))) * e);
  return { cx: home.cx + (target.cx + user.panX - home.cx) * e, cy: home.cy + (target.cy + user.panY - home.cy) * e, s, angle: home.angle * (1 - e), e };
}

/** The carry amount for the pickup's progress `p` (0 … 1) — the island ease; the put-down runs it backwards from where it was. */
export const carryOf = (p: number): number => easeIsland(Math.min(Math.max(p, 0), 1));

/**
 * The held slot's CAMERA (the pose IS a camera) and the factor a kind with height must reach by rising. The object's rect centre
 * lies `offset` (its own units, unturned) from its extent's centre; the pose turns that offset by its angle and puts the extent's
 * centre at (pose.cx, pose.cy), so the rect's centre lands at P − R(angle)·offset·s. A flat kind's camera zooms to `pose.s` and
 * grows nothing; an `eye` kind keeps the desk's zoom when the pose is larger (grow = pose.s / zoom ≥ 1, the rise does the rest)
 * and zooms out with the camera when the pose is smaller (a book picked up from very close: grow 1).
 */
export function heldCamera(pose: HeldPose, rect: ObjectRect, extent: ObjectRect, deskZoom: number, eye: boolean, vp: HeldViewport): { readonly cam: CameraState; readonly grow: number } {
  const zoom = eye ? Math.min(deskZoom, pose.s) : pose.s;
  const grow = pose.s / zoom;
  const ox = rect.cx - extent.cx;
  const oy = rect.cy - extent.cy;
  const c = Math.cos(pose.angle);
  const sn = Math.sin(pose.angle);
  // the rect's centre on screen
  const sx = pose.cx + (c * ox - sn * oy) * pose.s;
  const sy = pose.cy + (sn * ox + c * oy) * pose.s;
  if (!eye || grow <= 1 + 1e-9) return { cam: { x: rect.cx - sx / zoom, y: rect.cy - sy / zoom, zoom }, grow: 1 };
  // the eye stands over the VIEW's centre: a point at the rising height lands at E + (p − E)·grow on the desk plane, so the eye's foot
  // must be E = c − (S − vw/2)/(grow·zoom), and the camera's corner is E − vw/(2·zoom)
  const ex = rect.cx - (sx - vp.width / 2) / (grow * zoom);
  const ey = rect.cy - (sy - vp.height / 2) / (grow * zoom);
  return { cam: { x: ex - vp.width / (2 * zoom), y: ey - vp.height / (2 * zoom), zoom }, grow };
}

/** The held object's frame ON SCREEN (what the pose seam publishes, core's `HeldScreenFrame`): the shown extent's centre and half extents, CSS px, its scale. `single`: the right page alone. */
export function heldFrame(pose: HeldPose, extent: ObjectRect, single: boolean): { readonly cx: number; readonly cy: number; readonly hx: number; readonly hy: number; readonly s: number } {
  if (!single) return { cx: pose.cx, cy: pose.cy, hx: (extent.w / 2) * pose.s, hy: (extent.h / 2) * pose.s, s: pose.s };
  // one page: the right half of the spread, centred a quarter-width right of the extent's centre (turned with the pose)
  const q = (extent.w / 4) * pose.s;
  return { cx: pose.cx + q * Math.cos(pose.angle), cy: pose.cy + q * Math.sin(pose.angle), hx: q, hy: (extent.h / 2) * pose.s, s: pose.s };
}

/** The focus behind the hand: the blur radius (CSS px) and the dim at a carry amount. */
export const focusOf = (e: number, vp: HeldViewport): { readonly blur: number; readonly dim: number } => ({ blur: (isNarrow(vp) ? HOLD.blurPhone : HOLD.blur) * e, dim: HOLD.dim * e });
