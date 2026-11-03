import { defineQuery, type Entity, type SystemCtx } from "@vibecook/strata-ecs";
import { screenToWorld } from "@ice/kernel";
import { Active, Camera, CanvasSurface, Culled, HandleSpec, Locked, Movable, Port, Position, Selected, SelectionMovable, Size } from "../catalog";
import type { Tool } from "../tools/define-tool";

const selectionQ = defineQuery([Selected, Position, Size]);

/**
 * Decide ONCE at pointer-down, never during hover or rendering. Empty space in
 * a multi-selection can carry the group; real objects, controls and handles
 * keep their pick priority. Shift on the canvas starts an additive marquee.
 */
export function selectionDragAt(ctx: SystemCtx, target: Entity | undefined, sx: number, sy: number, tool: Tool, shift: boolean): boolean {
  if (!tool.gates.movable || tool.route.widgetDrag !== "move") return false;
  const onCanvas = target === undefined || ctx.hasTag(target, CanvasSurface);
  if (onCanvas) {
    if (shift || tool.route.canvasDrag !== "marquee") return false;
  } else if (!ctx.hasTag(target, Selected) || ctx.has(target, HandleSpec) || ctx.has(target, Port) ||
    (!ctx.hasTag(target, Movable) && !ctx.hasTag(target, SelectionMovable))) return false;

  let count = 0;
  let movable = false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  ctx.query(selectionQ).each(b => {
    for (const r of b) {
      const e = b.entity(r);
      if (ctx.hasTag(e, Culled) && !ctx.hasTag(e, Active)) continue;
      const p = ctx.read(e, Position);
      const s = ctx.read(e, Size);
      count++;
      if (!ctx.hasTag(e, Locked) && (ctx.hasTag(e, Movable) || ctx.hasTag(e, SelectionMovable))) movable = true;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
    }
  });
  if (count < 2 || !movable) return false;
  if (!onCanvas) return true;
  const p = screenToWorld(sx, sy, ctx.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 });
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}
