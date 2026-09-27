// The WHITEBOARD's law — pure: no GPU (BOARD.md). A board on the desk is an axis-aligned
// slab: a melamine surface recessed in an aluminium frame, `thick` world units off the mat.
// `resolveBoard` turns it and its motion (held · selected · fading) into the GEOMETRY the
// pass draws and the hit-test reads, in plain numbers, and the functions beside it are the
// CPU mirror of board.wgsl — the footprint, the frame, the melamine — so what is clicked is
// what is drawn. The lamp is the desk's one light (paper.ts `lampOf`): its ground slope casts
// the slab's shadow and its direction shades the frame's roll, as for the note and the
// notebook. `framing` is the camera an OPEN board is seen under: the board above the marker
// tray, the one number the focus glide (book/focus.ts) flies to.

import { sdRoundBox } from "../sdf";
import type { CameraState, Viewport } from "../nav/flight";
import type { Lamp } from "../paper/paper";
import { BOARD } from "./theme";

/** The board's numbers (theme.ts `BOARD`) — the engine's unless a host tweaks them. */
export interface BoardLaw {
  readonly spec: { readonly width: number; readonly height: number; readonly frame: number; readonly radius: number; readonly thick: number; readonly recess: number };
  readonly lift: { readonly height: number; readonly scale: number };
  readonly shadow: {
    readonly penumbra: { readonly sigma0: number; readonly sigmaPerHeight: number; readonly alpha: number };
    readonly contact: { readonly sigma: number; readonly alpha: number; readonly reach: number };
    readonly slopeMax: number;
  };
  readonly focus: { readonly pad: number; readonly tray: number; readonly minZoom: number; readonly maxZoom: number; readonly close: number };
}
export const DEFAULT_BOARD_LAW: BoardLaw = BOARD;

/** Where a board lies: its world centre and its outer size (world units). Boards stay square to the desk — an open one is drawn on under a camera that never turns. */
export interface BoardRect { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }

/** What moves: the hold's lift (0..1), the selection ring's presence (0..1), the presence itself (1 … 0 gone). */
export interface BoardMotion { readonly held: number; readonly ring: number; readonly fade: number }
export const BOARD_REST: BoardMotion = { held: 0, ring: 0, fade: 1 };

export interface BoardGeometry {
  readonly centre: readonly [number, number];
  /** The outer half extents as drawn (the hold's scale applied). */
  readonly half: readonly [number, number];
  /** The melamine's half extents and corner radius (inside the frame). */
  readonly inner: readonly [number, number];
  readonly innerR: number;
  readonly frame: number;
  readonly radius: number;
  /** The slab: its height, the melamine's recess below the frame's top, how far its underside floats (the hold's rise). */
  readonly thick: number;
  readonly recess: number;
  readonly lift: number;
  readonly scale: number;
  /** The shadow's ground offset per unit of height, world axes — away from the lamp, capped. */
  readonly slope: readonly [number, number];
  /** The unit direction TO the lamp, world axes (x right, y down the screen, z off the desk). */
  readonly lamp: readonly [number, number, number];
  readonly ring: number;
  readonly alpha: number;
}

/** The melamine's corner: the frame's outer radius less its width, never sharper than this. */
export const INNER_RADIUS_MIN = 1.5;

export function resolveBoard(b: BoardRect, m: BoardMotion, lamp: Lamp, law: BoardLaw = DEFAULT_BOARD_LAW): BoardGeometry {
  const s = law.spec;
  const scale = 1 + (law.lift.scale - 1) * m.held;
  const hx = (b.w / 2) * scale;
  const hy = (b.h / 2) * scale;
  const frame = s.frame * scale;
  const radius = s.radius * scale;
  const dx = lamp.x - b.cx;
  const dy = lamp.y - b.cy;
  const h = Math.max(lamp.h, 1e-6);
  const len = Math.hypot(dx, dy, h);
  let sx = -dx / h;
  let sy = -dy / h;
  const sl = Math.hypot(sx, sy);
  if (sl > law.shadow.slopeMax) { sx *= law.shadow.slopeMax / sl; sy *= law.shadow.slopeMax / sl; }
  return {
    centre: [b.cx, b.cy], half: [hx, hy],
    inner: [Math.max(hx - frame, 1e-3), Math.max(hy - frame, 1e-3)], innerR: Math.max(radius - frame, INNER_RADIUS_MIN * scale),
    frame, radius, thick: s.thick, recess: s.recess, lift: law.lift.height * m.held, scale,
    slope: [sx, sy], lamp: [dx / len, dy / len, h / len],
    ring: m.ring, alpha: m.fade,
  };
}

/** The outer silhouette's signed distance at a world point. */
export const sdBoard = (G: BoardGeometry, wx: number, wy: number): number => sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.half[0], G.half[1], G.radius);
/** The melamine's signed distance at a world point. */
export const sdSurface = (G: BoardGeometry, wx: number, wy: number): number => sdRoundBox(wx - G.centre[0], wy - G.centre[1], G.inner[0], G.inner[1], G.innerR);

export type BoardHit = "surface" | "frame" | "outside";
/** What is under a world point: the melamine (drawn on when open), the frame, or nothing. */
export function pickBoard(G: BoardGeometry, wx: number, wy: number): BoardHit {
  if (sdBoard(G, wx, wy) >= 0) return "outside";
  return sdSurface(G, wx, wy) < 0 ? "surface" : "frame";
}

/** A world point in the melamine's own units: world units from its top-left (what a stamp carries). */
export function toSurface(G: BoardGeometry, wx: number, wy: number): readonly [number, number] {
  return [wx - (G.centre[0] - G.inner[0]), wy - (G.centre[1] - G.inner[1])];
}
/** The melamine's size in world units at scale 1 — what its raster covers, whatever the hold's scale. */
export const surfaceSize = (G: BoardGeometry): readonly [number, number] => [(2 * G.inner[0]) / G.scale, (2 * G.inner[1]) / G.scale];

/** The raster a melamine of this size takes at `density` texels per world unit (BOARD.ink.density). */
export function rasterSize(surface: readonly [number, number], density: number): readonly [number, number] {
  return [Math.max(1, Math.ceil(surface[0] * density)), Math.max(1, Math.ceil(surface[1] * density))];
}

/** How far the slab's shadow can reach past the board, world units: the top's offset along the slope, and 2.5 σ of its penumbra. */
export function shadowReach(G: BoardGeometry, law: BoardLaw = DEFAULT_BOARD_LAW): number {
  const top = G.lift + G.thick;
  return Math.hypot(G.slope[0], G.slope[1]) * top + 2.5 * (law.shadow.penumbra.sigma0 + law.shadow.penumbra.sigmaPerHeight * top);
}

export interface WorldBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** The world rect the fragment may paint: the board and its shadow's reach, grown to take in `extra` (the pen in the hand, when it is shown). */
export function quadOf(G: BoardGeometry, extra?: WorldBox, law: BoardLaw = DEFAULT_BOARD_LAW): WorldBox {
  const r = shadowReach(G, law);
  let x0 = G.centre[0] - G.half[0] - r;
  let y0 = G.centre[1] - G.half[1] - r;
  let x1 = G.centre[0] + G.half[0] + r;
  let y1 = G.centre[1] + G.half[1] + r;
  if (extra) { x0 = Math.min(x0, extra.x0); y0 = Math.min(y0, extra.y0); x1 = Math.max(x1, extra.x1); y1 = Math.max(y1, extra.y1); }
  return { x0, y0, x1, y1 };
}

/**
 * The camera an OPEN board is seen under: the whole board, `pad` CSS px clear on every side, in
 * the view above the marker tray's `tray` px band — its zoom in the band, its centre at the
 * centre of what the tray leaves. The focus glide (book/focus.ts `glideTo`) flies here.
 */
export function framing(b: BoardRect, vp: Viewport, law: BoardLaw = DEFAULT_BOARD_LAW): CameraState {
  const f = law.focus;
  const availW = Math.max(vp.width - 2 * f.pad, 1);
  const availH = Math.max(vp.height - 2 * f.pad - f.tray, 1);
  const zoom = Math.min(f.maxZoom, Math.max(f.minZoom, Math.min(availW / b.w, availH / b.h)));
  return { x: b.cx - vp.width / (2 * zoom), y: b.cy - (vp.height - f.tray) / (2 * zoom), zoom };
}
