/**
 * The three standard surface behaviours' EXACT names — one frozen tuple, so
 * the door and the compiler cannot drift (design-013 §0, D6; A3b fix 4).
 *
 * Why a module of its own, with no imports at all: `compile.ts` needs these
 * names to decide the `orderIndependent` attestation, and `standard-behaviors.ts`
 * needs `defineBehavior` from `behavior/`. Putting the names in the behaviours
 * file would make `behavior/compile.ts → surface/standard-behaviors.ts →
 * behavior/define-behavior.ts` a cycle, which dependency-cruiser fails as an
 * error. A leaf module both may import is the acyclic answer.
 *
 * Why EXACT names and not the `ice:surface.` prefix they share: the attestation
 * says "these co-writers of `SurfaceTarget` are ours, they are row-disjoint by
 * law, and `defineWidget` attaches exactly one" — a promise ICE can make about
 * its own three and about nothing else. Keyed on the prefix, a pack that named
 * itself `ice:surface.kiosk` inherited the promise and silenced the very
 * advisory that would have told its author about a second writer. The prefix is
 * now RESERVED at `defineBehavior` (only `defineEngineBehavior` may use it), and
 * the attestation matches these strings and no others — belt and braces,
 * because the reservation is dev-guarded and the attestation is not.
 */
export const STANDARD_SURFACE_BEHAVIOR_NAMES = Object.freeze([
  "ice:surface.domAtRest",
  "ice:surface.alwaysGpu",
  "ice:surface.alwaysDom",
] as const);

export type StandardSurfaceBehaviorName = (typeof STANDARD_SURFACE_BEHAVIOR_NAMES)[number];
