/**
 * L3 — draw behavior (design-005 §3 `draw(widgetType)` tool; `ctl:behave`,
 * after connect, before camera — design-003 §5 order).
 *
 * A `RoutedDraw` drag creates ONE widget from the release rect: at
 * `JustEnded`, screen start+total → world rect (Camera at release), floored
 * at the widget's `minSize`; a sub-slop release (a click) places the
 * widget's DEFAULT size centered on the point. Commit is one `create`
 * intent through the sink — the doc sink spawns via the same override
 * builder as `ops.spawnWidget`, so the two paths can never diverge.
 * Cancel/fail commit nothing. The widget type comes from the ACTIVE tool's
 * `draw` config (latched per drag at claim would be stricter; tools switch
 * via `ops.setTool` which cancels active gestures first, so the active
 * tool is stable for a live drag by construction).
 *
 * Mid-drag rect preview is recorded polish (design-001 §3's full
 * draft→promote protocol is the vNext shape); v1 draws nothing until release.
 */
import type { System, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem } from "@vibecook/strata-ecs";
import { screenToWorld, type CameraState } from "@ice/kernel";
import { Camera, Drag, GesturePhases, RoutedDraw } from "../catalog";
import { ActiveTool } from "../catalog/camera-derived";
import type { CommitSink } from "../engine/commit-sink";
import { tools } from "../tools/define-tool";
import { widgets } from "../widget/define-widget";

const P = GesturePhases;
const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

/** Below this screen travel a draw release is a CLICK (default-size place). */
const DRAW_CLICK_SLOP_PX = 4;

export function createDrawBehavior(world: World, sink: CommitSink): System {
  const drawDragQ = defineQuery([Drag, RoutedDraw]);

  return defineSystem(
    drawDragQ,
    (b, ctx) => {
      for (const r of b) {
        const rec = b.entity(r);
        if (!ctx.hasTag(rec, P.justTags.Ended)) continue;

        const tool = tools.resolve(ctx.getResource(ActiveTool)?.id ?? "select");
        const type = tool.draw?.widgetType;
        const widget = type !== undefined ? widgets.get(type) : undefined;
        if (type === undefined || widget === undefined) continue; // route without a draw tool: no-op

        const d = ctx.read(rec, Drag);
        const cam = ctx.getResource(Camera) ?? IDENTITY_CAM;
        const w0 = screenToWorld(d.startX, d.startY, cam);
        const w1 = screenToWorld(d.startX + d.totalX, d.startY + d.totalY, cam);

        let x: number;
        let y: number;
        let w: number;
        let h: number;
        if (Math.hypot(d.totalX, d.totalY) < DRAW_CLICK_SLOP_PX) {
          // Click: default size centered on the point.
          w = widget.defaultSize.w;
          h = widget.defaultSize.h;
          x = w0.x - w / 2;
          y = w0.y - h / 2;
        } else {
          x = Math.min(w0.x, w1.x);
          y = Math.min(w0.y, w1.y);
          w = Math.max(widget.minSize.w, Math.abs(w1.x - w0.x));
          h = Math.max(widget.minSize.h, Math.abs(w1.y - w0.y));
        }

        sink.commit({
          kind: "create",
          gesture: rec,
          writes: [],
          creates: [{ type, x, y, w, h }],
        });
      }
    },
    { name: "drawBehavior" },
  );
}
