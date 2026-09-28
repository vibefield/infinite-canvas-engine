/**
 * L3 — drop candidate detection (design-003 §5 item 4; `ctl:behave`, ordered
 * AFTER moveBehavior so it tests POST-move bounds).
 *
 * For Active `RoutedMove` drags: spatial-query the dragged union bounds for
 * `Container` widgets (∉dragged), pick the topmost by sibling order (petition
 * 8 — compareStackOrder, the SAME comparator pick/paint use, so the drop
 * candidate can never diverge from what the user sees on top), and publish two
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
 *
 * THIRD SIGNAL (2026-09-06, design-013 §5 rev 6 / GLOW.md §3): `DragBounds` on
 * the recognizer — the same post-move union this system computes for its
 * spatial query, published instead of discarded. The overlap glow is cast light
 * from the lifted set's own SDF, so the compose reflector needs its rect; there
 * is no second computation and no new walk. Change-only over all four fields,
 * for the same reason the other two are: a value write stamps, and a still
 * frame must cost nothing.
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import type { SpatialIndex } from "@ice/kernel";
import {
  Accepts,
  Container,
  Drag,
  DragBounds,
  Drags,
  DropTarget,
  GestureActive,
  OverlapCandidate,
  OverlapRejected,
  Position,
  Provides,
  RoutedMove,
  Size,
  Solid,
  SweepsContained,
} from "../catalog";
import { Camera } from "../catalog/camera-derived";
import { widgetTypeFor } from "../canvas/engine-catalog";
import type { CanvasRect } from "../canvas/frame-view";
import { type NavGeometrySlot, resolveNavFace } from "../nav/nav-geometry";
import { compareStackOrder, createSiblingOrderIndex } from "../ops/sibling-order";
import { PrefabId } from "../schema/prefab";
import type { PortalAffine } from "@ice/kernel";

/** Is every one of these a GPU OBJECT (an `object` kind binding, design-015 §5.2)? The desk's drop rules apply to an all-object set. */
export function objectsOnly(world: World, entities: readonly Entity[]): boolean {
  if (entities.length === 0) return false;
  for (const e of entities) {
    if (!world.isAlive(e)) continue;
    const id = world.get(e, PrefabId)?.id;
    if (typeof id !== "string" || widgetTypeFor(world, id)?.object === undefined) return false;
  }
  return true;
}

/**
 * A container's FACE and its inside's embedding for a drop (design-015 §9): the renderer's word
 * through the nav geometry seam under the current camera (the face as drawn), else core's static
 * portal rect and default framing. `undefined` = the container has no face (no area).
 */
export function dropFaceOf(world: World, container: Entity, slot: NavGeometrySlot | undefined): { readonly face: CanvasRect; readonly affine: PortalAffine } | undefined {
  const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
  const f = resolveNavFace(world, container, { x: cam.x, y: cam.y, zoom: cam.zoom }, slot);
  return f === undefined ? undefined : { face: f.face, affine: f.affine };
}

/** Is the world point inside the rect (edges included)? */
export const insideRect = (r: CanvasRect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

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

export interface DropPlacementPolicy {
  canIngress(widgetTypeId: string, targetContainer: Entity): boolean;
  /** K9: may an object of this type be made in this frame at all — the root's CanvasType placement (inside a container, `canIngress`). */
  canPlace?(widgetTypeId: string, targetFrame: Entity): boolean;
}

export function createDropSystem(
  world: World,
  index: SpatialIndex<Entity>,
  placement?: DropPlacementPolicy,
  navGeometry?: NavGeometrySlot,
): System {
  // Frame ordinal map for the topmost-container compare (petition 8) — the
  // same pull-based source the pick systems read; candidates are same-frame
  // by construction (the spatial index is Active-gated).
  const order = createSiblingOrderIndex(world);
  return defineSystem(
    dropDragQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        const dragged = ctx.getRelations(rec, Drags);

        // A comment-box group (any dragged SweepsContained widget) is
        // LANDSCAPE, not cargo — with ONE exception (2026-07-18, James: "i
        // do want that"): it CAN file into an ACCEPTING container. So for
        // sweeper sets, Solid widgets never reject (the group's union bounds
        // overlap half the board by construction — that's what a comment is
        // FOR), and a NON-matching container is scenery (plain move), never
        // a fly-back: DropTarget only lands together with OverlapCandidate.
        const sweeper = dragged.some((w) => ctx.isAlive(w) && ctx.hasTag(w, SweepsContained));
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

        // Publish the union (design-013 §5). Only when the walk found a live
        // dragged widget: with `any` false the four accumulators are still
        // ±Infinity, and writing those would put a number in the world that no
        // reader could tell from a real rect. A resize drag never populates
        // `Drags`, so its recognizer keeps the spawn zeros — which is the
        // honest answer, since there is no lifted set to cast light.
        if (any) {
          const cur = ctx.get(rec, DragBounds);
          if (
            cur === undefined ||
            cur.minX !== minX ||
            cur.minY !== minY ||
            cur.maxX !== maxX ||
            cur.maxY !== maxY
          ) {
            ctx.edit(rec).set(DragBounds, { minX, minY, maxX, maxY });
          }
        }

        const prev = ctx.getRelation(rec, DropTarget);

        // Topmost drop-evaluating widget under the union bounds (∉dragged):
        // a Container (accept/reject by contracts) OR a Solid widget (always
        // rejects — v1's iOS-card overlap contract, 2026-07-12 field report).
        // An all-OBJECT set (design-015 §9, D2b) follows the desk's rule instead: the
        // container whose FACE — the portal rect as drawn (the nav geometry seam) — holds
        // the set's CENTRE, topmost first; a face the centre is not over is scenery.
        const objects = any && objectsOnly(world, dragged);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        let container: Entity | undefined;
        if (any) {
          const ordinals = order.ordinals();
          for (const entry of index.search({ minX, minY, maxX, maxY })) {
            const e = entry.id;
            if (draggedSet.has(e) || !ctx.isAlive(e)) continue;
            if (!ctx.hasTag(e, Container) && !(!sweeper && ctx.hasTag(e, Solid))) continue;
            if (objects && ctx.hasTag(e, Container)) {
              const drop = dropFaceOf(world, e, navGeometry);
              if (drop === undefined || !insideRect(drop.face, cx, cy)) continue;
            }
            if (container === undefined || compareStackOrder(ctx, ordinals, e, container) > 0) {
              container = e;
            }
          }
        }

        const clearSignals = (e: Entity): void => {
          if (!ctx.isAlive(e)) return;
          if (ctx.hasTag(e, OverlapCandidate)) ctx.removeTag(e, OverlapCandidate);
          if (ctx.hasTag(e, OverlapRejected)) ctx.removeTag(e, OverlapRejected);
        };

        if (container === undefined) {
          if (prev !== undefined) {
            clearSignals(prev);
            ctx.removeRelation(rec, DropTarget);
          }
          continue;
        }

        // accepts ∩ (union of dragged provides) — a widget with no Provides never
        // matches; a Solid non-container has no Accepts and always rejects. A type
        // that declares `interaction.drop: "never"` (design-015 D-D18) matches nothing,
        // whichever path decides — the typed placement authority or the cells.
        let matches: boolean;
        const neverDrops = dragged.some((w) => {
          if (!ctx.isAlive(w)) return false;
          const typeId = ctx.get(w, PrefabId)?.id;
          return typeof typeId === "string" && widgetTypeFor(world, typeId)?.drop === "never";
        });
        if (neverDrops) {
          matches = false;
        } else if (placement !== undefined && ctx.hasTag(container, Container)) {
          matches = dragged.every((w) => {
            if (!ctx.isAlive(w)) return false;
            const typeId = ctx.get(w, PrefabId)?.id;
            return typeof typeId === "string" && placement.canIngress(typeId, container as Entity);
          });
        } else {
          const provided = new Set<string>();
          for (const w of dragged) {
            if (!ctx.isAlive(w)) continue;
            for (const k of parseList(ctx.get(w, Provides)?.list)) provided.add(k);
          }
          const accepts = parseList(ctx.get(container, Accepts)?.list);
          matches = accepts.some((k) => provided.has(k));
        }

        // Sweeper sets never fly back: a non-matching container is treated
        // like no container at all (release = plain move).
        // Sweeper sets never fly back: a non-matching container is treated
        // like no container at all (release = plain move). An OBJECT set is the same
        // (design-015 §9, D-D18): a whiteboard let go over a mini mat lies on it as a
        // root object — the desk has no fly-back.
        if ((sweeper || objects) && !matches) {
          if (prev !== undefined) {
            clearSignals(prev);
            ctx.removeRelation(rec, DropTarget);
          }
          continue;
        }

        // A moved-off previous target loses its signal tags.
        if (prev !== undefined && prev !== container) clearSignals(prev);
        if (prev !== container) ctx.setRelation(rec, DropTarget, container);

        if (matches) {
          if (!ctx.hasTag(container, OverlapCandidate)) ctx.addTag(container, OverlapCandidate);
          if (ctx.hasTag(container, OverlapRejected)) ctx.removeTag(container, OverlapRejected);
        } else {
          if (ctx.hasTag(container, OverlapCandidate)) ctx.removeTag(container, OverlapCandidate);
          if (!ctx.hasTag(container, OverlapRejected)) ctx.addTag(container, OverlapRejected);
        }
      }
    },
    { name: "dropSystem", access: { write: [DragBounds] } },
  );
}
