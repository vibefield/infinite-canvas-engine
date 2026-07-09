/**
 * Spatial index backed by an R-tree (rbush) — ported from v1 (audited CLEAN-PORT).
 * World-space AABBs for culling, hit-testing, and snap-candidate gathering
 * (Law 15: the ONLY hit path). The id↔entry map gives O(log n) removal by
 * passing rbush the exact stored reference (v1 "Fix #8").
 *
 * `rbush` is the kernel's single, named dependency exception: a zero-dep pure
 * data structure (see .dependency-cruiser.cjs).
 */
import RBushImport from "rbush";
import type { AABB } from "./shapes";

// CJS/ESM interop — rbush exports differently depending on context (kept from v1).
type RBushModule = typeof RBushImport & { default?: typeof RBushImport };
const rbushModule = RBushImport as RBushModule;
const RBush = (
  typeof rbushModule.default === "function" ? rbushModule.default : RBushImport
) as typeof RBushImport;

export interface SpatialEntry<Id> extends AABB {
  id: Id;
}

export class SpatialIndex<Id> {
  private tree = new RBush<SpatialEntry<Id>>();
  private entries = new Map<Id, SpatialEntry<Id>>();

  upsert(id: Id, bounds: AABB): void {
    const existing = this.entries.get(id);
    if (existing) this.tree.remove(existing);
    const entry: SpatialEntry<Id> = { ...bounds, id };
    this.entries.set(id, entry);
    this.tree.insert(entry);
  }

  remove(id: Id): void {
    const existing = this.entries.get(id);
    if (existing) {
      this.tree.remove(existing);
      this.entries.delete(id);
    }
  }

  /** All entries intersecting the given AABB. */
  search(bounds: AABB): SpatialEntry<Id>[] {
    return this.tree.search(bounds);
  }

  /** Entries within `tolerance` of a point (z-priority is the caller's job). */
  searchPoint(x: number, y: number, tolerance = 0): SpatialEntry<Id>[] {
    return this.tree.search({
      minX: x - tolerance,
      minY: y - tolerance,
      maxX: x + tolerance,
      maxY: y + tolerance,
    });
  }

  clear(): void {
    this.tree.clear();
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
