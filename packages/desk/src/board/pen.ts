// THE MARKER — pure (BOARD.md §5; D3t-a): the one pen of a board, in whatever pose it is in. Lying capped where a hand put
// it down; taken up into the hand as the board comes into it (it slides from where it lies to the pointer, rises in an arc,
// turns to a right hand's angle, its cap sliding back along the barrel to post on the end); in the hand at the pointer —
// hovering, its shadow stands off the nib; pressed, they meet; leaning with the hand's speed across its axis — and, put
// down, flying back to cap itself and lie down again. The eraser, when it is the tool in hand, rubs at the pointer while
// the marker lies down. The bench's `poseOf` and its springs (lab/board.ts), number for number, as FLUX: `stepPen` advances
// the springs toward what the hand is doing, `penPose` draws the pose they reach. At rest (every spring 0) the pose is
// `boardRest`'s — the capped marker where the oracle's still draws it — byte for byte.

import { spring, settled } from "../springs";
import type { RGB } from "../theme";
import { BOARD } from "../theme";
import type { BoardGeometry, WorldBox } from "./board";
import type { BoardEraser, BoardPen } from "./layout";
import { type TipName, TIPS } from "./stroke";

/** A right hand holds a marker with its barrel rising away to the upper right (lab/board.ts). */
export const HAND_ANGLE = Math.atan2(-0.8, 0.6);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * A board's pen as flux: `take` (0 lying … 1 in the hand), `shown` (present at the hand — over the melamine), `rub` (the eraser at
 * the hand), `press` (0 hovering … 1 on the board), each a spring with its velocity; `lean` (radians across the barrel) and the
 * hand's smoothed velocity (CSS px/s) it follows.
 */
export interface PenState {
  take: number; takeV: number;
  shown: number; shownV: number;
  rub: number; rubV: number;
  press: number; pressV: number;
  lean: number;
  vx: number; vy: number;
}
export const penAtRest = (): PenState => ({ take: 0, takeV: 0, shown: 0, shownV: 0, rub: 0, rubV: 0, press: 0, pressV: 0, lean: 0, vx: 0, vy: 0 });

/** What the hand is doing this frame, as the board's pen reads it. */
export interface PenInput {
  /** The pen is in hand: the board held and open (past 42 % of the pickup) — false on the desk and flying home. */
  readonly held: boolean;
  /** The eraser is the tool in hand (the marker lies down). */
  readonly erasing: boolean;
  /** The hand is over the melamine or laying a stroke: the pen (or the eraser) shows at it. */
  readonly over: boolean;
  /** A stroke is being laid: the nib meets the board. */
  readonly pressing: boolean;
}

/** The springs' numbers (lab/board.ts `step`): take 2.4 Hz critically damped, shown and rub 7 Hz, press 9 Hz ζ .85; the lean's decay and follow. */
export const PEN_SPRINGS = { take: [2.4, 1], shown: [7, 1], rub: [7, 1], press: [9, 0.85], leanDecay: 6, leanFollow: 12 } as const;

/**
 * Advance the pen's flux by `dt` seconds toward what the hand is doing (lab/board.ts `step`, the pen's rows); `snap` sits every
 * spring at its target (a still). Returns true while anything still moves.
 */
export function stepPen(s: PenState, input: PenInput, dt: number, snap = false): boolean {
  const S = PEN_SPRINGS;
  const takeT = input.held && !input.erasing ? 1 : 0;
  const hand = input.held && input.over;
  const shownT = hand && !input.erasing ? 1 : 0;
  const rubT = hand && input.erasing ? 1 : 0;
  const pressT = input.held && input.pressing ? 1 : 0;
  let live = false;
  const run = (x: number, v: number, t: number, [hz, damp]: readonly [number, number]): [number, number] => {
    if (snap || dt <= 0) return snap ? [t, 0] : [x, v];
    const [nx, nv] = spring(x, v, t, hz, damp, dt);
    if (settled(nx, nv, t)) return [t, 0];
    live = true;
    return [nx, nv];
  };
  [s.take, s.takeV] = run(s.take, s.takeV, takeT, S.take);
  [s.shown, s.shownV] = run(s.shown, s.shownV, shownT, S.shown);
  [s.rub, s.rubV] = run(s.rub, s.rubV, rubT, S.rub);
  [s.press, s.pressV] = run(s.press, s.pressV, pressT, S.press);
  // the lean: the hand's velocity across the marker's axis, damped as the hand slows (half as much while it only hovers)
  if (snap) { s.vx = 0; s.vy = 0; s.lean = 0; return false; }
  if (dt > 0) {
    s.vx *= Math.exp(-dt * S.leanDecay);
    s.vy *= Math.exp(-dt * S.leanDecay);
    const across = (-s.vx * 0.8 - s.vy * 0.6) / 1400;
    const lean = Math.max(-1, Math.min(1, across)) * BOARD.pen.lean * (input.pressing ? 1 : 0.5);
    s.lean += (lean - s.lean) * (1 - Math.exp(-dt * S.leanFollow));
    if (Math.abs(lean - s.lean) > 1e-4) live = true;
    else s.lean = lean;
  }
  return live;
}

/** The hand moved: its velocity, CSS px/s, folded into the pen's (the bench's per-event smoothing, a frame at a time). */
export function followHand(s: PenState, dx: number, dy: number, dt: number): void {
  if (dt <= 0) return;
  const d = Math.min(0.1, Math.max(0.004, dt));
  s.vx += (dx / d - s.vx) * 0.35;
  s.vy += (dy / d - s.vy) * 0.35;
}

/** Where the marker lies on a board of `w × h`: its centre from the board's (× the hold's scale) and its angle — BOARD.md §5's rest. */
export const penRest = (w: number, h: number): { readonly x: number; readonly y: number; readonly angle: number } => ({ x: w * 0.16, y: h * 0.5 - BOARD.spec.frame - BOARD.pen.radius - 13, angle: -0.07 });

/** The hand's world point kept on the melamine (lab/board.ts `handOf`); none seen: the board's centre. */
export function handOnMelamine(G: BoardGeometry, at: readonly [number, number] | null): readonly [number, number] {
  if (at === null) return [G.centre[0], G.centre[1]];
  return [Math.min(Math.max(at[0], G.centre[0] - G.inner[0]), G.centre[0] + G.inner[0]), Math.min(Math.max(at[1], G.centre[1] - G.inner[1]), G.centre[1] + G.inner[1])];
}

/**
 * THE marker's pose this frame between where it lies and the hand (lab/board.ts `poseOf`, number for number): the nib slides from
 * its resting place to the hand and turns to the hand's angle (plus the lean); it rises in an arc, its barrel tilting up from the
 * nib as a held pen does; its cap slides back along the barrel and posts on the end; present in the hand only where the hand is
 * over the board. The eraser at the hand while it rubs. And the world box both may paint, shadows and all.
 */
export function penPose(G: BoardGeometry, w: number, h: number, tip: TipName, ink: RGB, s: PenState, at: readonly [number, number] | null): { readonly pen: BoardPen; readonly eraser: BoardEraser | undefined; readonly box: WorldBox } {
  const P = BOARD.pen;
  const R = P.radius;
  const L = P.length;
  const e = clamp01(s.take);
  const r0 = penRest(w, h);
  const ar = r0.angle;
  const mid = [G.centre[0] + r0.x * G.scale, G.centre[1] + r0.y * G.scale] as const;
  const rest = [mid[0] - Math.cos(ar) * L * 0.5, mid[1] - Math.sin(ar) * L * 0.5] as const;
  const hand = e > 0 ? handOnMelamine(G, at) : rest;
  let da = HAND_ANGLE + s.lean - ar;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const gap = (1 - clamp01(s.press)) * P.hover;
  const pen: BoardPen = {
    x: rest[0] + (hand[0] - rest[0]) * e, y: rest[1] + (hand[1] - rest[1]) * e, angle: ar + da * e,
    height: R + (gap - R) * e + 34 * Math.sin(Math.PI * e), rise: P.rise * e,
    cap: smooth(0.3, 0.85, e), nib: TIPS[tip].half[1],
    presence: 1 + (clamp01(s.shown) - 1) * smooth(0.85, 1, e),
    ink,
  };
  const slope = Math.hypot(G.slope[0], G.slope[1]);
  const r = L * 1.3 + 60 + slope * (pen.height + L * pen.rise + 12);
  let box: WorldBox = { x0: pen.x - r, y0: pen.y - r, x1: pen.x + r, y1: pen.y + r };
  let eraser: BoardEraser | undefined;
  if (s.rub > 0.001) {
    const [x, y] = handOnMelamine(G, at);
    eraser = { x, y, height: gap, presence: clamp01(s.rub) };
    const re = 60 + slope * (gap + BOARD.block.felt + BOARD.block.wood + 8);
    box = { x0: Math.min(box.x0, x - re), y0: Math.min(box.y0, y - re), x1: Math.max(box.x1, x + re), y1: Math.max(box.y1, y + re) };
  }
  return { pen, eraser, box };
}
