// An object's DATA children read from the world (design-015 §5.1; D3w) — the host's half of the
// kinds' `DataChildren` seam (kinds/world.ts): a kind never reads the world, the desk layer hands its
// `local()` this. The stamp is strata's order stamp of the object's `ChildOf` sequence — it turns over
// when a child is added, removed or moved (a stroke laid, undone, redone, a remote peer's) — and the
// rows are the children's values of one component in sibling order (D3t-c: with their entities, and a child's one edge — a
// pin's note). A dead object has neither.

import { ChildOf, type Component, type Entity, type Relation, type World } from "@ice/core";
import type { DataChildren } from "../kinds/world";

export function worldChildren(world: World): DataChildren {
  return {
    stamp: (e) => (world.isAlive(e) ? world.orderStamp(e, ChildOf) : 0),
    rows<T>(e: Entity, c: Component<T>): readonly T[] {
      if (!world.isAlive(e)) return [];
      const out: T[] = [];
      for (const k of world.getReverse(e, ChildOf)) { const v = world.get(k, c); if (v !== undefined) out.push(v); }
      return out;
    },
    entries<T>(e: Entity, c: Component<T>): readonly { readonly entity: Entity; readonly value: T }[] {
      if (!world.isAlive(e)) return [];
      const out: { entity: Entity; value: T }[] = [];
      for (const k of world.getReverse(e, ChildOf)) { const v = world.get(k, c); if (v !== undefined) out.push({ entity: k, value: v }); }
      return out;
    },
    target: (k: Entity, r: Relation) => (world.isAlive(k) ? world.getRelation(k, r) : undefined),
  };
}
