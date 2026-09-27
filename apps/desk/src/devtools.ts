// THE DEVTOOLS DOCK on `~` (⇧`, beside the dev panel's backtick — design-016 §4.5, K2): `@ice/devtools`' one draggable dock —
// strata's frame profiler, the desk's GPU (`gpu` slot) and strata's observer — mounted when the key is pressed and gone when it
// is pressed again. Dev tooling, OFF until pressed: opening it ARMS the layer's GPU profiler (the pass and submit instruments
// installed, every drawn frame's span, passes, draws, uploads read back) and closing it disarms it (the device's own methods
// back). Opening never wakes the desk (K-L5): at rest the slot says it waits for a frame. The strata tools arm the engine's
// telemetry (reactive stamping, +17–28 % on write-heavy paths — docs/api-reference.md), and that stays armed for the page.
//
// THE MIRROR: devtools cannot import desk, so its GPU slot reads `GpuPanelFrame` / `GpuPanelStats`, structural mirrors of
// desk's `GpuFrameReport` / `GpuProfileStats`. This module is where the two meet, and `_MirrorHolds` below makes `pnpm run ci`'s
// typecheck fail the day either side drifts.

import type { CanvasEngine } from "@ice/core";
import type { DeskLayerHandle, GpuFrameReport, GpuProfileStats } from "@ice/desk";
import { attachDevtools, type DevtoolsHandle, type GpuPanelFrame, type GpuPanelStats } from "@ice/devtools";

/** Compiles only while desk's report and stats are assignable to devtools' mirrors (K2). */
type Holds<T extends true> = T;
export type _MirrorHolds = Holds<[GpuFrameReport] extends [GpuPanelFrame] ? ([GpuProfileStats] extends [GpuPanelStats] ? true : false) : false>;

export interface ProfilerDock {
  /** Open the dock (arming the GPU profiler) or close it (disarming). */
  toggle(): void;
  isOpen(): boolean;
  close(): void;
}

/** The frames a capture asks for from the dock's button. */
const CAPTURE_FRAMES = 120;

export function createProfilerDock(engine: CanvasEngine, handle: DeskLayerHandle): ProfilerDock {
  let devtools: DevtoolsHandle | null = null;
  let release: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  const open = (): void => {
    const profiler = handle.profiler();
    if (profiler === undefined) return;   // no device yet
    devtools = attachDevtools(engine, {
      dock: { title: "ice devtools — the desk", corner: "tr", width: 440 },
      gpu: { capture: (n) => profiler.capture(n), captureFrames: CAPTURE_FRAMES },
    });
    release = profiler.arm();
    const d = devtools;
    unsubscribe = profiler.subscribe((r) => { if (r.kind === "frame") d.gpuFrame(r, profiler.stats()); });
  };
  const close = (): void => {
    unsubscribe?.();
    release?.();
    devtools?.detach();
    unsubscribe = null;
    release = null;
    devtools = null;
  };
  return {
    toggle: () => (devtools === null ? open() : close()),
    isOpen: () => devtools !== null,
    close,
  };
}
