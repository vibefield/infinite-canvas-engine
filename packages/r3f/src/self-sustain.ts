/**
 * Self-sustain scheduling for the demand loop (design-004 §3 animation-rate
 * amendment, 2026-07-14).
 *
 * When the ONLY reason to run another frame is ambient animation (Hot islands
 * or a stagger backlog), the loop no longer re-invalidates at native refresh:
 * on a 120 Hz panel that was 5 always-Hot islands × 120 paints/sec ≈ 96 % GPU
 * duty at idle — the fan. Instead the next pass is scheduled `1000/maxFps` ms
 * after the last pass STARTED, so ambient animation runs at ~`maxFps` and the
 * GPU idles between frames.
 *
 * What stays at native refresh:
 *  - lift eases (`liftAnimating`) — 180 ms of interaction feedback;
 *  - every EXTERNALLY invalidated frame (camera, drag, props dirt): the
 *    bridge's `requestFrame` path is untouched, so interaction still runs at
 *    display rate and Hot islands ride along uncapped while it lasts.
 *
 * The cap is approximate: the wake-up is a timeout and the actual frame lands
 * on the next vsync after it. {@link RATE_CAP_SLACK_MS} pulls the timeout half
 * a 120 Hz vsync early so the following vsync is the intended one, not one
 * past it (naive `interval` scheduling on a 120 Hz grid yields 40 fps, not 60).
 */

/** Timeout lead so the post-timeout vsync lands on the target boundary. */
export const RATE_CAP_SLACK_MS = 4;

export interface SelfSustainStats {
  readonly anyHot: boolean;
  readonly pendingPaints: number;
  readonly liftAnimating: boolean;
}

/**
 * Decide how the demand loop continues after a pass.
 *
 * @param stats        The pass's self-sustain signals.
 * @param elapsedMs    ms since the pass started (schedule anchor).
 * @param maxFps       Animation rate cap; `Infinity` restores uncapped.
 * @returns `"none"` (park), `"now"` (invalidate immediately), or the timeout
 *          delay in ms before invalidating.
 */
export function selfSustainPlan(
  stats: SelfSustainStats,
  elapsedMs: number,
  maxFps: number,
): "none" | "now" | number {
  if (stats.liftAnimating) return "now";
  if (!stats.anyHot && stats.pendingPaints <= 0) return "none";
  const interval = 1000 / Math.max(1, maxFps);
  const delay = interval - elapsedMs - RATE_CAP_SLACK_MS;
  return delay <= 0 ? "now" : delay;
}
