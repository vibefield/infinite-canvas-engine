/**
 * The zero-render→ECS-writes DEV assertion (M7 exit criterion; design-004 §3
 * fix #3). While a compositor frame pass runs — including island paints and
 * `useIslandFrame` callbacks — every world mutation throws with attribution.
 *
 * strata 0.4.0 (petition 4 LANDED): one persistent `world.devOnWrite`
 * registration + an armed flag. The hook is DEV-only, synchronous, and
 * PRE-MUTATION with throws propagating to the mutator's caller — so a throw
 * while armed is a clean veto whose stack names the offender. Fired from
 * strata's internal chokepoints, it covers every route the old own-property
 * mutator shadows could miss: bound/destructured method references, document
 * transactions, sync/attach drains, undo echoes, and any mutator added
 * upstream later. (Raw `batch.col()` column pokes remain the documented
 * carve-out — no chokepoint exists by design.)
 *
 * `enabled` is the app-side production gate the 0.4.0 notes ask for: in an
 * un-shimmed browser production bundle strata's own DEV flag can evaluate
 * true, so registration is gated HERE (default off; demos/traces opt in).
 */
import type { World } from "@ice/core";

export interface RenderWriteTrap {
  /** Arm the trap (begin twice without end is a bug — throws). */
  begin(): void;
  /** Disarm; always call in `finally`. */
  end(): void;
  /** Unregister the hook entirely (bridge teardown). */
  dispose(): void;
  readonly enabled: boolean;
}

export function createRenderWriteTrap(world: World, enabled: boolean): RenderWriteTrap {
  let armed = false;
  let unregister: (() => void) | null = null;

  if (enabled) {
    unregister = world.devOnWrite((kind) => {
      if (!armed) return;
      throw new Error(
        `ice: world mutation (${kind}) during the GL render pass — the render path never writes ECS (design-004 §3). Move the write to a system, an input fact, or an app op OUTSIDE useIslandFrame/render.`,
      );
    });
  }

  return {
    enabled,
    begin() {
      if (!enabled) return;
      if (armed) throw new Error("ice: render write trap begin() while already armed.");
      armed = true;
    },
    end() {
      armed = false;
    },
    dispose() {
      armed = false;
      unregister?.();
      unregister = null;
    },
  };
}
