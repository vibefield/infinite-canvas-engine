/**
 * L3 — snap (design-003 §5 item 2, §6; `ctl:behave`, ordered BEFORE moveBehavior).
 *
 * For Active `RoutedMove` drags whose dragged set is a `SnapSource`: compute the
 * intended PRE-SNAP rect as `Grab.origin + Drag.total / zoomAtClaim`, unioned
 * over the dragged widgets — NEVER last-applied `Position` (one frame stale ⇒
 * guide-chasing oscillation, design-003 §5.2 red-team; `Grab` is readable here
 * thanks to the ctl:claim settle point, §4.5). Candidates come from the SHARED
 * spatial index (rect query = intended bounds expanded by threshold, filtered to
 * `SnapTarget ∧ ∉dragged`; Visible filtering waits for cull). Threshold is
 * `thresholdPx / zoomAtClaim` (screen-constant). The kernel `computeSnapGuides`
 * does the Figma math; we write `SnapState{dx,dy}` on the recognizer (moveBehavior
 * adds it to the absolute write). Guide CHROME entities (`GuideLine`) are deferred
 * to the chrome-reflector milestone — SnapState only here. SnapState clears to 0,0
 * when snap is off / no source / no candidate.
 */
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { type EntityBounds, type SpatialIndex, computeSnapGuides } from "@ice/kernel";
import {
  Captures,
  Drag,
  Drags,
  GestureActive,
  Grab,
  RoutedMove,
  SnapConfig,
  SnapSource,
  SnapState,
  SnapTarget,
} from "../catalog";
import { SNAP_DEFAULTS } from "../settings/defaults";

const snapDragQ = defineQuery([Drag, GestureActive, RoutedMove]);

export function createSnapSystem(world: World, index: SpatialIndex<Entity>): System {
  return defineSystem(
    snapDragQ,
    (b, ctx) => {
      const cfg = ctx.getResource(SnapConfig);
      const enabled = cfg?.enabled ?? SNAP_DEFAULTS.enabled;
      const thresholdPx = cfg?.thresholdPx ?? SNAP_DEFAULTS.thresholdPx;

      const setSnap = (rec: Entity, dx: number, dy: number): void => {
        const cur = ctx.get(rec, SnapState);
        if (cur === undefined || cur.dx !== dx || cur.dy !== dy) ctx.edit(rec).set(SnapState, { dx, dy });
      };

      for (const r of b) {
        const rec = b.entity(r);
        const dragged = ctx.getRelations(rec, Drags);
        const captured = ctx.getRelation(rec, Captures);
        const hasSource =
          (captured !== undefined && ctx.hasTag(captured, SnapSource)) ||
          dragged.some((w) => ctx.hasTag(w, SnapSource));
        if (!enabled || !hasSource) {
          setSnap(rec, 0, 0);
          continue;
        }

        // Intended union rect from Grab + total/zoom (never last-applied Position).
        const d = ctx.read(rec, Drag);
        const zoom = d.zoomAtClaim || 1;
        const draggedSet = new Set<Entity>(dragged);
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let any = false;
        for (const w of dragged) {
          if (!ctx.isAlive(w) || !ctx.has(w, Grab)) continue;
          const g = ctx.read(w, Grab);
          const x = g.x + d.totalX / zoom;
          const y = g.y + d.totalY / zoom;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + g.w);
          maxY = Math.max(maxY, y + g.h);
          any = true;
        }
        if (!any) {
          setSnap(rec, 0, 0);
          continue;
        }

        const threshold = thresholdPx / zoom;
        const intended: EntityBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

        // Candidates: index rect query (intended ∪ threshold), SnapTarget ∧ ∉dragged.
        const refs: EntityBounds[] = [];
        for (const entry of index.search({
          minX: minX - threshold,
          minY: minY - threshold,
          maxX: maxX + threshold,
          maxY: maxY + threshold,
        })) {
          const e = entry.id;
          if (draggedSet.has(e) || !ctx.isAlive(e) || !ctx.hasTag(e, SnapTarget)) continue;
          refs.push({
            x: entry.minX,
            y: entry.minY,
            width: entry.maxX - entry.minX,
            height: entry.maxY - entry.minY,
          });
        }
        if (refs.length === 0) {
          setSnap(rec, 0, 0);
          continue;
        }

        const res = computeSnapGuides(intended, refs, threshold);
        setSnap(rec, res.snapDx, res.snapDy);
      }
    },
    { name: "snapSystem", access: { write: [SnapState] } },
  );
}
