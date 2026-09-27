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
 *
 * THE LOOP OUTLIVES A THROWING STEP (2026-08-15, petition I14). Until this fix
 * the reschedule sat on the line AFTER `engine.step(now)`, so ONE throw from a
 * publish hook (which propagate loudly by design — engine.ts) escaped the rAF
 * callback, left `handle` un-renewed, and killed the canvas PERMANENTLY: with
 * `parked` still false, `wake` early-returns forever, so even freeze/thaw could
 * not restart it. Recovery needed a fresh `startRafLoop`. The next frame is now
 * scheduled in a `finally`, so a faulting frame is loud but survivable — the
 * throw still reaches the browser's error handler; only the death is gone.
 *
 * BEFORE EACH STEP (2026-09-27, ICE M21 K1): an optional `beforeStep` — where a host reads what the
 * platform changes without an event it can hear (the device's ratio: `createDeskHost`). It runs
 * only for a step that runs (never while parked), and inside the same `try`, so a throwing hook is
 * as survivable as a throwing step.
 *
 * THE SLEEP (2026-09-27, ICE M21 K7a — `@ice/core`'s frame-control.ts): with `sleep`, the loop asks
 * the frame gate after every step when the next one is due, and SLEEPS when it is not the next
 * frame — no rAF queued, and a timer only when a registered wake names a time (a flight, a caret's
 * blink, a layer let go). A wake (an input, a write from outside a step, a document's or a room's
 * arrival, a desk's flux) restarts it in the next frame; so does a freeze, whose settle walk needs
 * steps. A desk at rest then costs the main thread nothing at all (design-015 §11.4). Without
 * `sleep` the loop steps every frame, as it always did.
 */
import type { Engine } from "@ice/core";

export interface RafLoopOptions {
  /** Sleep when the engine is quiet (K7a): no frame scheduled until a wake or a registered time. Default false. */
  readonly sleep?: boolean;
}

export function startRafLoop(engine: Engine, beforeStep?: (now: number) => void, opts: RafLoopOptions = {}): () => void {
  const sleepy = opts.sleep === true;
  const frame = engine.frame;
  let handle = 0;
  let stopped = false;
  let parked = false;
  let asleep = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = (now: number): void => {
    if (stopped) return;
    if (!frame.claimStep()) {
      // Park: no step, and deliberately no reschedule. `wake` owns the restart.
      parked = true;
      handle = 0;
      return;
    }
    try {
      beforeStep?.(now);
      engine.step(now);
    } finally {
      // Re-checked AFTER the body: a `stop()` called from inside the step
      // (a publish hook, a reflector) must still win, or the loop would
      // resurrect itself past its own stopper.
      if (!stopped) schedule();
    }
  };

  /** After a step: the next frame, or sleep — until a wake, or the soonest registered time. */
  const schedule = (): void => {
    if (!sleepy) {
      handle = requestAnimationFrame(tick);
      return;
    }
    const t = performance.now();
    const due = frame.nextStep(t);
    if (due <= t) {
      handle = requestAnimationFrame(tick);
      return;
    }
    handle = 0;
    asleep = true;
    frame.sleeping(true);
    if (due !== Number.POSITIVE_INFINITY) timer = setTimeout(() => rise(true), Math.max(0, due - t));
  };

  /** Out of the sleep: the next frame steps (`timed`: for a registered time alone). */
  const rise = (timed: boolean): void => {
    if (stopped || !asleep) return;
    asleep = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    frame.sleeping(false, timed);
    handle = requestAnimationFrame(tick);
  };

  // (a freeze taken while the loop sleeps rises it through the world's doors — the freeze writes its `FrameMode` mirror — so its
  // settle walk has the steps it needs; the sleep test pins it)
  const wake = (): void => {
    if (stopped || !parked || frame.isFrozen()) return;
    parked = false;
    handle = requestAnimationFrame(tick);
  };
  const unsubscribe = frame.onChange(wake);
  const unsubscribeWake = sleepy ? frame.onWake(() => rise(false)) : undefined;

  handle = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    unsubscribe();
    unsubscribeWake?.();
    if (timer !== undefined) clearTimeout(timer);
    if (asleep) frame.sleeping(false);
    cancelAnimationFrame(handle);
  };
}
