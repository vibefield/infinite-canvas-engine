/**
 * Engine-owned destroy cascade (design-001 §5.1, §5.3, design-003 §5).
 *
 * strata clears an entity's edges on `tx.destroy` but does NOT recurse, so the
 * engine walks containment itself: depth-first over `getReverse(e, ChildOf)`,
 * destroying descendants before their parent, then the root. Wires are reified
 * edge entities, so a wire whose `WireFrom`/`WireTo` endpoint dies is destroyed
 * with it (reverse-index lookup, same transaction).
 *
 * The walk reads runtime world state via `getReverse`; `tx.destroy` only RECORDS
 * (applied at seal / projection), so the reverse indices stay whole for the whole
 * walk. A `visited` set guards against cycles and double-destroying a wire that
 * touches two doomed endpoints.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import type { Mutator } from "@vibecook/strata-ecs/durable";
import { WireFrom, WireTo } from "../catalog/graph";
import { ChildOf } from "../catalog/scene";

/** Depth-first destroy `root` and its `ChildOf` subtree + any wires bound to a destroyed entity. */
export function cascadeDestroy(tx: Mutator, world: World, root: Entity): void {
  const visited = new Set<Entity>();

  const walk = (e: Entity): void => {
    if (visited.has(e)) return;
    visited.add(e);

    // Children before their parent.
    for (const child of world.getReverse(e, ChildOf)) walk(child);

    // Wires whose endpoint dies here die with it.
    for (const wire of world.getReverse(e, WireFrom)) walk(wire);
    for (const wire of world.getReverse(e, WireTo)) walk(wire);

    tx.destroy(e);
  };

  walk(root);
}
