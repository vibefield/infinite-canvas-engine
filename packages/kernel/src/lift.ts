/**
 * The lift — ONE curve, ONE duration, for every surface (design-012 §2
 * consequence 2, §7 "dual lift implementations retire").
 *
 * Before the unified compositor there were two lifts running the same visual:
 * the DOM card's CSS transition and the GL island quad's engine-side ease. They
 * had to be kept in lockstep by hand, and design-004 §3 carries a standing
 * "animation lockstep" problem class because of it. Collapsing presentation to
 * one pass collapses them to one ease — but only if both halves read the curve
 * from the same place, which is what this file is.
 *
 * The numbers are not new. `cubic-bezier(0.2, 0.9, 0.3, 1.2)` is the DOM card
 * lift's spring — a slight overshoot past 1, then a quick settle — and 180 ms
 * is its duration; the r3f compositor pass has been running exactly these since
 * the stratified profile shipped. They move here so the composited profile
 * cannot drift from them by retyping them.
 *
 * The FADE is deliberately a different curve: CSS `ease`. An overshoot past 1
 * is meaningful for a scale (it reads as a spring) and meaningless for an
 * opacity, where it would clip at 1 and simply hold — a flat spot in the middle
 * of a fade.
 */
import { cubicBezierEase } from "./easing";

/** The lift's duration, matching the DOM transition. */
export const LIFT_DURATION_MS = 180;

/** The lift's spring: slight overshoot, quick settle. */
export const LIFT_EASE = cubicBezierEase(0.2, 0.9, 0.3, 1.2);

/** The fade's curve — CSS `ease`. Never the spring; see the header. */
export const FADE_EASE = cubicBezierEase(0.25, 0.1, 0.25, 1);

/**
 * Where an ease sits after `elapsedMs` of `durationMs`.
 *
 * A zero (or negative) duration snaps: a retarget with no time left is a set,
 * not a division by zero.
 */
export function easedValue(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number,
  ease: (t: number) => number,
): number {
  if (durationMs <= 0) return to;
  const t = elapsedMs / durationMs;
  if (t >= 1) return to;
  if (t <= 0) return from;
  return from + (to - from) * ease(t);
}
