/**
 * @ice/devtools — strata's observer panel + FPS profiler, engine-flavored
 * (describe/durable/ephemeral/reflect-lane glue), and the GPU panel the WebGPU
 * desk's profiler feeds (design-016 K2). Reads the world outside the tick;
 * never a reflector, never writes ECS. Nobody imports us (depcruise-enforced
 * leaf).
 */
export const DEVTOOLS_VERSION = "0.1.0";

export {
  attachDevtools,
  engineDescribe,
  type DevtoolsEngine,
  type DevtoolsHandle,
  type DevtoolsOpts,
} from "./attach";
export { createDock, type Dock, type DockCorner, type DockOptions, type DockSlotId } from "./dock";
// `createGlPanel` (the r3f stats mirror) left at design-015 D5b with the GL islands it read; the GPU panel (design-016 K2)
// is the WebGPU desk's, fed through its structural mirrors.
export {
  createGpuPanel,
  fmtBytes,
  fmtMs,
  type GpuPanel,
  type GpuPanelFrame,
  type GpuPanelOptions,
  type GpuPanelPass,
  type GpuPanelRolling,
  type GpuPanelStats,
} from "./gpu-panel";
