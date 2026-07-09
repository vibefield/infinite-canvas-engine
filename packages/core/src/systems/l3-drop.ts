/**
 * L3 — drop candidate detection (design-003 §5 item 4; `ctl:behave`, ordered
 * AFTER moveBehavior so it tests POST-move bounds).
 *
 * For Active `RoutedMove` drags: spatial-query the dragged union bounds for
 * `Container` widgets (∉dragged), pick the topmost by StackZ, and publish two
 * signals the move-outcome tree consumes (l3-behave §5.5):
 *   - `DropTarget(recognizer → container)` — set for the container under the
 *     bounds REGARDLESS of an accepts-match (so the outcome tree can distinguish
 *     a rejected drop from a plain move).
 *   - `OverlapCandidate` on the container — ONLY when the container's `Accepts`
 *     intersects the dragged set's `Provides` (a widget with no `Provides` never
 *     matches; RFC-004 contracts).
 * BOTH are strictly change-only: `setRelation`/`addTag` bump the GLOBAL tag/
 * relation version, and any churn wakes every row-filtered observer world-wide
 * (design-002 §4). Both clear when no container is under the bounds; the move
 * behavior clears them on every terminal path.
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import type { SpatialIndex } from "@ice/kernel";
import {
  Accepts,
  Container,
  Drag,
  Drags,
  DropTarget,
  GestureActive,
  OverlapCandidate,
  Position,
  Provides,
  RoutedMove,
  Size,
  StackZ,
} from "../catalog";

const dropDragQ = defineQuery([Drag, GestureActive, RoutedMove]);

/** Parse a JSON string-array field; malformed ⇒ empty (never throw inside the tick). */
function parseList(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function createDropSystem(world: World, index: SpatialIndex<Entity>): System {
  return defineSystem(
    dropDragQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        const dragged = ctx.getRelations(rec, Drags);
        const draggedSet = new Set<Entity>(dragged);

        // Post-move union bounds from the dragged widgets' CURRENT transform.
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let any = false;
        for (const w of dragged) {
          if (!ctx.isAlive(w) || !ctx.has(w, Position) || !ctx.has(w, Size)) continue;
          const p = ctx.read(w, Position);
          const s = ctx.read(w, Size);
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x + s.w);
          maxY = Math.max(maxY, p.y + s.h);
          any = true;
        }

        const prev = ctx.getRelation(rec, DropTarget);

        // Topmost Container under the union bounds (∉dragged).
        let container: Entity | undefined;
        let bestZ = Number.NEGATIVE_INFINITY;
        if (any) {
          for (const entry of index.search({ minX, minY, maxX, maxY })) {
            const e = entry.id;
            if (draggedSet.has(e) || !ctx.isAlive(e) || !ctx.hasTag(e, Container)) continue;
            const z = ctx.get(e, StackZ)?.z ?? 0;
            if (z > bestZ) {
              bestZ = z;
              container = e;
            }
          }
        }

        if (container === undefined) {
          if (prev !== undefined) {
            if (ctx.isAlive(prev) && ctx.hasTag(prev, OverlapCandidate)) ctx.removeTag(prev, OverlapCandidate);
            ctx.removeRelation(rec, DropTarget);
          }
          continue;
        }

        // A moved-off previous container loses its candidate tag.
        if (prev !== undefined && prev !== container && ctx.isAlive(prev) && ctx.hasTag(prev, OverlapCandidate)) {
          ctx.removeTag(prev, OverlapCandidate);
        }
        if (prev !== container) ctx.setRelation(rec, DropTarget, container);

        // accepts ∩ (union of dragged provides) — a widget with no Provides never matches.
        const provided = new Set<string>();
        for (const w of dragged) {
          if (!ctx.isAlive(w)) continue;
          for (const k of parseList(ctx.get(w, Provides)?.list)) provided.add(k);
        }
        const accepts = parseList(ctx.get(container, Accepts)?.list);
        const matches = accepts.some((k) => provided.has(k));

        if (matches) {
          if (!ctx.hasTag(container, OverlapCandidate)) ctx.addTag(container, OverlapCandidate);
        } else if (ctx.hasTag(container, OverlapCandidate)) {
          ctx.removeTag(container, OverlapCandidate);
        }
      }
    },
    { name: "dropSystem" },
  );
}
