/**
 * Sibling order — THE per-frame stacking source (petition 8; design-004 §1
 * amendment). Within a frame, paint/pick/drop order IS the frame parent's
 * ordered `ChildOf` sibling sequence: index 0 paints first (bottom), the tail
 * paints last (top). The frame parent is `currentNavFrame(world) ?? BoardRoot`
 * — every renderer/pick consumer shares this module so the orders can never
 * diverge (the point-pick lesson, extended to the comparator).
 *
 * LEGACY FALLBACK (must keep working): when the `BoardRoot` resource is absent
 * (a pre-schema-2 doc opened read-only, or a doc-less runtime world) OR an
 * entity carries no `ChildOf` edge (bare runtime spawns), stacking falls back
 * to the legacy `(StackZ.z asc, entity asc)` comparator. This module is the
 * ONLY sanctioned StackZ reader outside the schema migration.
 *
 * Mixed frames — some entities ordinal-mapped, some fallback — are nominally
 * impossible (the 1→2 migration hangs an edge on every durable widget, and a
 * pre-schema-2 read-only doc has no BoardRoot at all, so it is all-fallback).
 * The comparator still totals them: ordinal-mapped entities sort BELOW the
 * fallback set (ordinals first in paint order), each group internally ordered
 * by its own rule — documented so a stray bare spawn lands somewhere stable
 * rather than somewhere random.
 *
 * Invalidation is PULL-ONLY, the strata 0.8.0 contract: `world.orderStamp
 * (parent, ChildOf)` is a monotonic per-parent version consumers poll after a
 * reactive wake; the wake itself is an `observeQuery` whose grammar names the
 * relation (`Related(ChildOf)` — pure reorders turn it over).
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import { Related, defineQuery } from "@vibecook/strata-ecs";
import { BoardRoot, ChildOf, Position, StackZ } from "../catalog/scene";
import { currentNavFrame } from "../nav/nested-canvas";

/** Structural read both `World` and `SystemCtx` provide — all the comparator needs. */
export interface StackOrderReader {
  get<S>(e: Entity, c: Component<S>): S | undefined;
}

/**
 * The frame parent — the entity whose `ChildOf` sibling sequence is the
 * current frame's stacking order: the nav frame when inside a container, else
 * the document's board root. `undefined` = a legacy world (pre-schema-2
 * read-only doc / doc-less runtime) — everything is fallback-ordered.
 */
export function frameParent(world: World): Entity | undefined {
  const frame = currentNavFrame(world);
  if (frame !== undefined) return frame;
  const root = world.getResource(BoardRoot)?.root;
  return root !== undefined && world.isAlive(root) ? root : undefined;
}

/** `parent`'s sibling sequence as entity → position (the renderers' sort key). */
export function buildOrdinals(world: World, parent: Entity): Map<Entity, number> {
  const seq = world.getReverse(parent, ChildOf);
  const map = new Map<Entity, number>();
  for (let i = 0; i < seq.length; i++) map.set(seq[i] as Entity, i);
  return map;
}

/**
 * THE stacking comparator (ascending = paint order; the pick tier takes the
 * max). Ordinal-mapped entities order by sibling position; entities missing
 * from the map use the legacy `(StackZ asc, entity asc)` fallback among
 * themselves and sort ABOVE the ordinal-mapped set (see the header note on
 * nominally-impossible mixed frames).
 */
export function compareStackOrder(
  reader: StackOrderReader,
  ordinals: ReadonlyMap<Entity, number>,
  a: Entity,
  b: Entity,
): number {
  const oa = ordinals.get(a);
  const ob = ordinals.get(b);
  if (oa !== undefined && ob !== undefined) return oa - ob;
  if (oa !== undefined) return -1;
  if (ob !== undefined) return 1;
  const za = reader.get(a, StackZ)?.z ?? 0;
  const zb = reader.get(b, StackZ)?.z ?? 0;
  return za !== zb ? za - zb : Number(a) - Number(b);
}

export interface SiblingOrderIndex {
  /** The frame parent backing the current ordinal map (undefined = legacy world). */
  parent(): Entity | undefined;
  /** The stamp-checked ordinal map — rebuilt only when the frame parent or its `orderStamp` moved. */
  ordinals(): ReadonlyMap<Entity, number>;
  /** True when the next `ordinals()` would rebuild (cheap pull; no rebuild). */
  stale(): boolean;
  /**
   * Arm the reorder wake: an `observeQuery` naming `ChildOf` (`Related`
   * grammar — pure reorders and edge turnover both fire it). Callers pair it
   * with `stale()`/`ordinals()` so other-frame churn stays a no-op.
   */
  observe(cb: () => void): () => void;
}

// Widgets all carry Position; naming ChildOf makes reorders (not just edge
// membership) turn the watch over — the ordered-relations wake contract.
const orderWakeQ = defineQuery([Position, Related(ChildOf)]);

/**
 * A pull-based ordinal cache over the CURRENT frame parent's sibling sequence.
 * Consumers each hold their own instance (the cache is a cheap `getReverse`
 * walk); correctness is shared through {@link compareStackOrder} and the
 * stamp, never through instance identity.
 */
export function createSiblingOrderIndex(world: World): SiblingOrderIndex {
  const empty: ReadonlyMap<Entity, number> = new Map();
  let built: ReadonlyMap<Entity, number> = empty;
  let builtParent: Entity | undefined;
  let builtStamp = 0;
  let hasBuilt = false;

  const stale = (): boolean => {
    const parent = frameParent(world);
    if (!hasBuilt || parent !== builtParent) return true;
    return parent !== undefined && world.orderStamp(parent, ChildOf) !== builtStamp;
  };

  return {
    parent: () => frameParent(world),
    ordinals() {
      if (!stale()) return built;
      const parent = frameParent(world);
      builtParent = parent;
      builtStamp = parent === undefined ? 0 : world.orderStamp(parent, ChildOf);
      built = parent === undefined ? empty : buildOrdinals(world, parent);
      hasBuilt = true;
      return built;
    },
    stale,
    observe: (cb) => world.reactive.observeQuery(orderWakeQ, cb),
  };
}
