/**
 * The rAF frame loop (design-002 §1: core is scheduler-free — the DOM package
 * owns the loop; core never touches the platform).
 *
 * Drives `engine.step(now)` once per animation frame, threading the rAF
 * timestamp straight into the frame clock (so FrameInfo.dt is real wall time,
 * clamped in core). The returned stop fn cancels the pending frame AND latches
 * so a frame already in flight cannot re-schedule — calling it is idempotent.
 */
import type { Engine } from "@ice/core";

export function startRafLoop(engine: Engine): () => void {
  let handle = 0;
  let stopped = false;

  const tick = (now: number): void => {
    if (stopped) return;
    engine.step(now);
    handle = requestAnimationFrame(tick);
  };

  handle = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}
