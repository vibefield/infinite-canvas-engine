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
 * Band, then Demand, then Residency — each reads what the one before it wrote
 * (§6 steps 2–4). The group itself is
 * `present:infra`, a real strata phase boundary AFTER `present`, so every kind
 * behaviour has already written its `SurfaceTarget` for this frame no matter
 * when its pack registered — the D1 reason, stated at `engine/pipeline.ts`.
 *
 * Takes the raw {@link Engine}, not the facade: `addSystems` and `world` are
 * what it needs, and both live there (`CanvasEngine.engine`). Returns ONE
 * remover that unregisters every system it added, so an unmounting host undoes
 * the whole set rather than remembering the parts.
 */
import type { RasterStrategy } from "@ice/kernel";
import type { Engine } from "../engine/engine";
import type { LayerAllocator } from "../residency/layer-allocator";
import {
  createResidencyStore,
  createResidencySystem,
  DEFAULT_RESIDENCY_BUDGET_BYTES,
} from "../residency/residency-system";
import type { TextureTable } from "../residency/texture-table";
import { createSurfaceBandSystem } from "../systems/surface-band";
import { createSurfaceDemandSystem } from "../systems/surface-demand";

/**
 * What Residency needs, all of it optional (A2).
 *
 * A profile that will REALISE these destinations — B's render reflectors, which
 * need the table to turn a handle into a `GPUTexture` — passes its own `table`
 * and `allocator` and keeps the references. A profile that only wants the facts
 * in the world passes neither and gets a pair built here.
 */
export interface ResidencyOptions {
  readonly table?: TextureTable;
  readonly allocator?: LayerAllocator;
  /**
   * Default {@link DEFAULT_RESIDENCY_BUDGET_BYTES} (256 MB). A PLACEHOLDER — the
   * number is to be replaced by a MEASURED one at B3, where pixels are the
   * witness; nothing has yet been weighed against it.
   */
  readonly budgetBytes?: number;
  readonly bytesPerPixel?: number;
  readonly layerSize?: number;
  readonly now?: () => number;
  /** Per-kind raster strategy. Default `band` (§9 Q1); B gives it a `defineWidget` field. */
  readonly raster?: (kind: "dom" | "gl" | "video") => RasterStrategy;
}

export interface SurfaceInfraOpts {
  /** Omit it and no Residency system is installed — Band and Demand alone. */
  readonly residency?: ResidencyOptions;
}

export function installSurfaceInfra(engine: Engine, opts?: SurfaceInfraOpts): () => void {
  const world = engine.world;
  const systems = [createSurfaceBandSystem(world), createSurfaceDemandSystem(world)];

  const residency = opts?.residency;
  if (residency !== undefined) {
    const store = createResidencyStore({
      ...(residency.layerSize === undefined ? {} : { layerSize: residency.layerSize }),
      ...(residency.budgetBytes === undefined ? {} : { budgetBytes: residency.budgetBytes }),
      ...(residency.bytesPerPixel === undefined ? {} : { bytesPerPixel: residency.bytesPerPixel }),
    });
    systems.push(
      createResidencySystem(world, {
        table: residency.table ?? store.table,
        allocator: residency.allocator ?? store.allocator,
        ...(residency.budgetBytes === undefined ? {} : { budgetBytes: residency.budgetBytes }),
        ...(residency.bytesPerPixel === undefined ? {} : { bytesPerPixel: residency.bytesPerPixel }),
        ...(residency.now === undefined ? {} : { now: residency.now }),
        ...(residency.raster === undefined ? {} : { raster: residency.raster }),
      }),
    );
  }

  return engine.addSystems("present:infra", ...systems);
}
