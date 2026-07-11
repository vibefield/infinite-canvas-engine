/**
 * @ice/devtools — the engine devtools panel (design-005 §4): pointers/recognizers,
 * planes, sovereignty badges, loop telemetry. A standalone DOM panel that reads
 * the world outside the tick — it is NOT a reflector and writes no ECS.
 * Import wall: @ice/core (+kernel) only; nobody imports us (depcruise-enforced).
 */
export const DEVTOOLS_VERSION = "0.0.0";

export { attachDevtools, type DevtoolsHandle, type DevtoolsOpts } from "./panel";
