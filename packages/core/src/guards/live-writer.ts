/**
 * The per-cell gesture guard (design-001 §2 rule 4 + §3), as the engine's
 * live-write path. strata worlds can't intercept writes, so behaviors write
 * doc-SENSITIVE values through this facade:
 *
 *   a world value-write to a cell that exists in the doc for that entity is
 *   legal iff the entity is currently allowed to diverge — an Active
 *   recognizer Captures/Drags it, or it carries a live TransformTween
 *   (fly-back holds the claim; design-003 review M3).
 *
 * "Cell in doc" is approximated conservatively from public API: entity is
 * doc-bound (keyOf defined) AND the component is durable-eligible for its
 * prefab. Eligible-but-uncommitted optionals are guarded too (documented).
 * The divergence predicate is injected — M4 wires claims + tween; tests stub.
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import { prefabs, PrefabId } from "../schema/prefab";
import { devGuardsEnabled } from "./dev";

export interface LiveWriterOpts {
  /** `doc.keyOf` when a doc is attached; absent doc = nothing is doc-bound. */
  keyOf: (e: Entity) => unknown;
  /** May this entity's doc cells diverge right now? (claims ∪ tween) */
  mayDiverge: (e: Entity) => boolean;
  /**
   * Exact "is this cell in the doc?" (e.g. wired to `doc.getComponent`).
   * When absent, the guard falls back to the eligibility approximation —
   * stricter than design-001 §2 rule 4's letter: an eligible-but-uncommitted
   * optional is guarded too (fails safe; matrix finding #2).
   */
  cellInDoc?: (e: Entity, c: Component) => boolean;
}

export interface LiveWriter {
  set<S>(e: Entity, component: Component<S>, value: S): void;
}

export function createLiveWriter(world: World, opts: LiveWriterOpts): LiveWriter {
  return {
    set(e, component, value) {
      if (devGuardsEnabled() && opts.keyOf(e) !== undefined) {
        const prefabId = world.get(e, PrefabId)?.id;
        const prefab = typeof prefabId === "string" ? prefabs.get(prefabId) : undefined;
        const guardedCell = opts.cellInDoc
          ? opts.cellInDoc(e, component as Component)
          : (prefab?.eligible.has(component as Component) ?? false);
        if (guardedCell && !opts.mayDiverge(e)) {
          const name = String(prefabId);
          throw new Error(
            `ice: live write to a doc cell of "${name}" without a gesture claim — doc-sovereign values are written live only under an Active recognizer's Captures/Drags (or a TransformTween), then committed once at JustEnded (design-001 §3). Use a transaction for non-gesture edits.`,
          );
        }
      }
      world.edit(e).set(component, value);
    },
  };
}
