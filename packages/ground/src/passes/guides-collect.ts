/**
 * Snap-guides collector — the pure ECS→triangles half of the guides pass
 * (v1 SnapGuideRenderer look, carried over from the 2D-canvas reflector it
 * replaces): full-viewport magenta alignment lines (`GuideLine.from == to` ⇒
 * full span — design-003 §6), bounded spans, and equal-spacing bars with 4px
 * end ticks. Screen-px output via the kernel `worldToScreen` seam. NO guide
 * count caps (the pool grows; so does the soup).
 */
import {
  DEFAULT_SNAP_GUIDES_CONFIG,
  GuideLine,
  SpacingBar,
  defineQuery,
  type SnapGuidesConfig,
  type World,
} from "@ice/core";
import { worldToScreen } from "@ice/kernel";
import type { GroundFrame } from "../pass";
import { SoupBuilder, type Rgba, type TriSoup } from "./soup-collect";

export const guideQ = defineQuery([GuideLine]);
export const barQ = defineQuery([SpacingBar]);

export function collectGuides(
  world: World,
  frame: GroundFrame,
  config: SnapGuidesConfig = DEFAULT_SNAP_GUIDES_CONFIG,
): TriSoup {
  const soup = new SoupBuilder();
  const cam = frame.camera;
  const lw = config.lineWidth;
  const guideColor: Rgba = [config.color[0], config.color[1], config.color[2], config.guideAlpha];
  const barColor: Rgba = [config.color[0], config.color[1], config.color[2], config.spacingAlpha];

  world.query(guideQ).each((b) => {
    for (const r of b) {
      const g = world.read(b.entity(r), GuideLine);
      const fullSpan = g.from === g.to;
      if (g.axis === "x") {
        const sx = worldToScreen(g.at, 0, cam).x;
        if (frame.width > 0 && (sx < -1 || sx > frame.width + 1)) continue;
        const y0 = fullSpan ? 0 : worldToScreen(0, g.from, cam).y;
        const y1 = fullSpan ? frame.height : worldToScreen(0, g.to, cam).y;
        soup.rect(sx - lw / 2, Math.min(y0, y1), lw, Math.abs(y1 - y0), guideColor);
      } else {
        const sy = worldToScreen(0, g.at, cam).y;
        if (frame.height > 0 && (sy < -1 || sy > frame.height + 1)) continue;
        const x0 = fullSpan ? 0 : worldToScreen(g.from, 0, cam).x;
        const x1 = fullSpan ? frame.width : worldToScreen(g.to, 0, cam).x;
        soup.rect(Math.min(x0, x1), sy - lw / 2, Math.abs(x1 - x0), lw, guideColor);
      }
    }
  });

  world.query(barQ).each((b) => {
    for (const r of b) {
      const s = world.read(b.entity(r), SpacingBar);
      const t = config.tickPx;
      if (s.axis === "x") {
        // Horizontal gap along x at world-y perp (kernel/v1 axis semantics).
        const a = worldToScreen(s.from, s.perp, cam);
        const bp = worldToScreen(s.to, s.perp, cam);
        if (frame.width > 0 && (Math.max(a.x, bp.x) < 0 || Math.min(a.x, bp.x) > frame.width)) continue;
        soup.rect(Math.min(a.x, bp.x), a.y - lw / 2, Math.abs(bp.x - a.x), lw, barColor);
        soup.rect(a.x - lw / 2, a.y - t, lw, t * 2, barColor);
        soup.rect(bp.x - lw / 2, bp.y - t, lw, t * 2, barColor);
      } else {
        const a = worldToScreen(s.perp, s.from, cam);
        const bp = worldToScreen(s.perp, s.to, cam);
        if (frame.height > 0 && (Math.max(a.y, bp.y) < 0 || Math.min(a.y, bp.y) > frame.height)) continue;
        soup.rect(a.x - lw / 2, Math.min(a.y, bp.y), lw, Math.abs(bp.y - a.y), barColor);
        soup.rect(a.x - t, a.y - lw / 2, t * 2, lw, barColor);
        soup.rect(bp.x - t, bp.y - lw / 2, t * 2, lw, barColor);
      }
    }
  });

  return soup.build();
}
