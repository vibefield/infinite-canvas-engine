/**
 * The rAF frame loop (design-002 §1: core is scheduler-free — the DOM package
 * owns the loop; core never touches the platform).
 *
 * Drives `engine.step(now)` once per animation frame, threading the rAF
 * timestamp straight into the frame clock (so FrameInfo.dt is real wall time,
 * clamped in core). The returned stop fn cancels the pending frame AND latches
 * so a frame already in flight cannot re-schedule — calling it is idempotent.
 *
 * THE FREEZE GATE (2026-08-04). Before each frame the loop claims a step from
 * `engine.frame`. While a freeze is held the gate walks its settle and then
 * refuses, at which point the loop PARKS: it stops scheduling rAF at all
 * rather than spinning a callback that does nothing — "the engine is stopped"
 * should mean the browser has no work queued for it either. Thaw arrives
 * through the gate's change subscription, which schedules the next frame.
 *
 * The dt clamp is what makes resume safe: a freeze that lasted an hour hands
 * `step` an enormous `now`, and core clamps the delta (frame-info.ts), so
 * tweens advance by one ordinary frame instead of teleporting to their end.
 */
import type { Engine } from "@ice/core";

export function startRafLoop(engine: Engine): () => void {
  let handle = 0;
  let stopped = false;
  let parked = false;

  const tick = (now: number): void => {
    if (stopped) return;
    if (!engine.frame.claimStep()) {
      // Park: no step, and deliberately no reschedule. `wake` owns the restart.
      parked = true;
      handle = 0;
      return;
    }
    engine.step(now);
    handle = requestAnimationFrame(tick);
  };

  const wake = (): void => {
    if (stopped || !parked || engine.frame.isFrozen()) return;
    parked = false;
    handle = requestAnimationFrame(tick);
  };
  const unsubscribe = engine.frame.onChange(wake);

  handle = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    unsubscribe();
    cancelAnimationFrame(handle);
  };
}
