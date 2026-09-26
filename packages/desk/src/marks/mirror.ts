// The marks' CPU MIRROR — pure (D4a): how far a screen point lies from a mark's ink, the distances
// shaders/marks/marks.wgsl shades, in CSS px (≤ 0 on the ink). The kinds keep a mirror of what they draw
// for picking (design-015 §4.5); the marks keep one so a witness can say exactly where the chrome may
// paint — the oracle's check holds everything outside that reach to the frame without marks, byte for byte.

import { sdRoundBox } from "../sdf";
import { MARK, type MarkRecord } from "./layout";

const segment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const h = l2 > 0 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / l2, 0), 1) : 0;
  return Math.hypot(px - ax - dx * h, py - ay - dy * h);
};

/** The point in a mark's own frame: about `c`, turned by −angle (marks.wgsl `marks_local`). */
const local = (m: MarkRecord, x: number, y: number): readonly [number, number] => {
  const c = Math.cos(m.centre[2]);
  const s = Math.sin(m.centre[2]);
  const dx = x - m.centre[0];
  const dy = y - m.centre[1];
  return [c * dx + s * dy, -s * dx + c * dy];
};

/** marks.wgsl `marks_brackets`: the distance to the four brackets of a rounded frame. */
export function bracketsDistance(qx: number, qy: number, X: number, Y: number, r: number, L: number): number {
  const ax = Math.abs(qx);
  const ay = Math.abs(qy);
  const top = Math.hypot(ax - Math.min(Math.max(ax, X - L), X - r), ay - Y);
  const side = Math.hypot(ax - X, ay - Math.min(Math.max(ay, Y - L), Y - r));
  let d = Math.min(top, side);
  const vx = ax - (X - r);
  const vy = ay - (Y - r);
  if (r > 0 && vx >= 0 && vy >= 0) d = Math.min(d, Math.abs(Math.hypot(vx, vy) - r));
  return d;
}

/**
 * The signed distance (CSS px) from a mark's ink at a screen point — a stroke's half-width taken off, a fill's edge, a
 * flare's radius; a glyph and a strip of tape by their turned boxes (the atlas's coverage and the torn outline lie inside).
 */
export function markDistance(m: MarkRecord, x: number, y: number): number {
  const kind = m.shape[0];
  const w = m.shape[2];
  if (kind === MARK.stroke || kind === MARK.fill || kind === MARK.brackets || kind === MARK.tape || kind === MARK.glyph) {
    const [qx, qy] = local(m, x, y);
    if (kind === MARK.glyph) return sdRoundBox(qx, qy, m.half[0] / 2 + m.aux[1], m.half[1] / 2 + m.aux[1], 0);
    if (kind === MARK.tape) return sdRoundBox(qx, qy, m.half[0], m.half[1], 0);
    const sd = sdRoundBox(qx, qy, m.half[0], m.half[1], m.centre[3]);
    if (kind === MARK.fill) return sd;
    if (kind === MARK.stroke) return Math.abs(sd) - w / 2;
    return bracketsDistance(qx, qy, m.half[0], m.half[1], m.centre[3], m.shape[3]) - w / 2;
  }
  if (kind === MARK.segment) return segment(x, y, m.centre[0], m.centre[1], m.half[0], m.half[1]) - w / 2;
  if (kind === MARK.bar) {
    const ax = m.centre[0];
    const ay = m.centre[1];
    const bx = m.half[0];
    const by = m.half[1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * m.aux[0];
    const ny = ((bx - ax) / len) * m.aux[0];
    return Math.min(segment(x, y, ax, ay, bx, by), segment(x, y, ax - nx, ay - ny, ax + nx, ay + ny), segment(x, y, bx - nx, by - ny, bx + nx, by + ny)) - w / 2;
  }
  if (kind === MARK.flare) return Math.hypot(x - m.centre[0], y - m.centre[1]) - m.centre[3];
  return Number.POSITIVE_INFINITY;
}
