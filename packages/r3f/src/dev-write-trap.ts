/**
 * The zero-render→ECS-writes DEV assertion (M7 exit criterion; design-004 §3
 * fix #3). While a compositor frame pass runs — including island paints and
 * `useIslandFrame` callbacks — every world MUTATOR throws with attribution.
 *
 * Mechanism: own-property shadows over the world instance's mutating methods
 * for the duration of the pass, removed in `end()` (the prototype methods
 * return untouched). This traps OUR strata instance's public surface, not
 * R3F internals (probing those is banned). strata 0.3.0 exposes no write
 * hook or public write-version counter — petition candidate recorded in
 * docs/strata-petitions.md; when one ships this becomes observation-only.
 *
 * DEV-only by construction: create it with `enabled: false` (the default in
 * production) and both methods are no-ops.
 */
import type { World } from "@ice/core";

/** Every public mutator on the strata World surface (0.3.0, API-verified). */
const MUTATORS = [
  "spawn",
  "destroy",
  "addComponent",
  "removeComponent",
  "addTag",
  "removeTag",
  "setRelation",
  "addRelation",
  "removeRelation",
  "setResource",
  "updateResource",
  "edit",
  "import",
  "reset",
] as const;

export interface RenderWriteTrap {
  /** Arm the trap (idempotent within a pass is a bug — begin twice throws). */
  begin(): void;
  /** Disarm; always call in `finally`. */
  end(): void;
  readonly enabled: boolean;
}

export function createRenderWriteTrap(world: World, enabled: boolean): RenderWriteTrap {
  let armed = false;

  const throwFor = (name: string) => () => {
    throw new Error(
      `ice: world.${name}() called during the GL render pass — the render path never writes ECS (design-004 §3). Move the write to a system, an input fact, or an app op OUTSIDE useIslandFrame/render.`,
    );
  };

  return {
    enabled,
    begin() {
      if (!enabled) return;
      if (armed) throw new Error("ice: render write trap begin() while already armed.");
      armed = true;
      const w = world as unknown as Record<string, unknown>;
      for (const name of MUTATORS) {
        if (typeof w[name] === "function") {
          Object.defineProperty(w, name, {
            value: throwFor(name),
            configurable: true,
            writable: true,
          });
        }
      }
    },
    end() {
      if (!enabled || !armed) return;
      armed = false;
      const w = world as unknown as Record<string, unknown>;
      for (const name of MUTATORS) {
        // Remove the own-property shadow; the prototype method resurfaces.
        if (Object.hasOwn(w, name)) delete w[name];
      }
    },
  };
}
