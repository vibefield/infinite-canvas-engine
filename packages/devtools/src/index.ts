/**
 * @ice/devtools — strata's observer panel + FPS profiler, engine-flavored
 * (describe/durable/ephemeral/reflect-lane glue). Reads the world outside the
 * tick; never a reflector, never writes ECS. Nobody imports us
 * (depcruise-enforced leaf).
 */
export const DEVTOOLS_VERSION = "0.1.0";

export {
  attachDevtools,
  engineDescribe,
  type DevtoolsEngine,
  type DevtoolsHandle,
  type DevtoolsOpts,
} from "./attach";
