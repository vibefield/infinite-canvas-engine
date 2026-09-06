/**
 * `installSurfaceInfra` — the surface infra system-set, as ONE registration
 * (design-013 §6, plan §2 A1a.8).
 *
 * The fix-wave class this closes is "copied wiring" (§7): the blank
 * `groundHost` came from a boot sequence an app was expected to reproduce, and
 * one that reproduced it incompletely rendered a plausible screen that was
 * quietly the wrong one. A profile therefore does not hand an app a list to
 * register — it IS the system-set it installs, and there is one call.
 *
 * ORDER INSIDE THE GROUP is registration order, and it is the design's:
 * Band before Demand (A2 appends Residency after both). The group itself is
 * `present:infra`, a real strata phase boundary AFTER `present`, so every kind
 * behaviour has already written its `SurfaceTarget` for this frame no matter
 * when its pack registered — the D1 reason, stated at `engine/pipeline.ts`.
 *
 * Takes the raw {@link Engine}, not the facade: `addSystems` and `world` are
 * what it needs, and both live there (`CanvasEngine.engine`). Returns ONE
 * remover that unregisters every system it added, so an unmounting host undoes
 * the whole set rather than remembering the parts.
 */
import type { Engine } from "../engine/engine";
import { createSurfaceBandSystem } from "../systems/surface-band";
import { createSurfaceDemandSystem } from "../systems/surface-demand";

/** Reserved for A2's residency options; empty in A1a so the seam exists from the start. */
export interface SurfaceInfraOpts {
  readonly reserved?: never;
}

export function installSurfaceInfra(engine: Engine, _opts?: SurfaceInfraOpts): () => void {
  const world = engine.world;
  return engine.addSystems(
    "present:infra",
    createSurfaceBandSystem(world),
    createSurfaceDemandSystem(world),
  );
}
