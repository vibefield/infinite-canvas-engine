/**
 * Selection-chrome collector — the pure ECS→quad half of the selection pass
 * (2026-07-16, James: per-widget SDF rings at P0). One expanded quad per
 * Selected widget around its TRUE rect (effective size: non-zero MeasuredSize
 * over Size, the wires readRect rule); the pass's fragment SDF turns the quad
 * into a thin rounded border just outside the rect.
 *
 * Geometry deliberately ignores the lift visual: a lifted card scales as pure
 * CSS (CardShell transform), the ECS rect never changes — so the ring stays on
 * the footprint the snap system aligns, and shows through the lifted card's
 * 75% fade as the "where it really is" cue.
 *
 * NOT rung: Selected entities without Position+Size (selected WIRES are the
 * wires pass's restyle, not a rect), and rects fully outside the viewport.
 */
import {
  DEFAULT_SELECTION_CHROME_CONFIG,
  MeasuredSize,
  Position,
  Selected,
  type SelectionChromeConfig,
  Size,
  defineQuery,
  type World,
} from "@ice/core";
import { worldToScreen } from "@ice/kernel";
import type { GroundFrame } from "../pass";

export const selectionQ = defineQuery([Selected, Position, Size]);
/** Auto-sized selected widgets: MeasuredSize value dirt re-rings them. */
export const selectionMeasuredQ = defineQuery([Selected, MeasuredSize]);

/** Non-indexed quad soup for the ring SDF: 6 verts/ring + per-vertex rect facts. */
export interface RingSoup {
  /** xyz, screen px (z = 0). */
  positions: Float32Array;
  /** Vertex offset from the rect center, screen px (the SDF sample coord). */
  local: Float32Array;
  /** Rect half-extent, screen px. */
  halfSize: Float32Array;
  /** Corner radius, screen px (zoom-scaled, clamped to the half-extent). */
  radius: Float32Array;
  vertexCount: number;
}

/** Unit-quad corner order (two tris), scaled per ring by its expanded extent. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
] as const;

export function collectSelection(
  world: World,
  frame: GroundFrame,
  config: SelectionChromeConfig = DEFAULT_SELECTION_CHROME_CONFIG,
): RingSoup {
  let count = 0;
  world.query(selectionQ).each((b) => {
    count += b.count;
  });
  const positions = new Float32Array(count * 6 * 3);
  const local = new Float32Array(count * 6 * 2);
  const halfSize = new Float32Array(count * 6 * 2);
  const radius = new Float32Array(count * 6);
  const cam = frame.camera;
  // Quad overhang past the rect: gap + stroke + a 1px AA skirt.
  const expand = config.pad + config.width + 1;
  let v = 0;
  world.query(selectionQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const p = world.read(e, Position);
      const measured = world.get(e, MeasuredSize);
      const s = measured !== undefined && measured.w > 0 ? measured : world.read(e, Size);
      const tl = worldToScreen(p.x, p.y, cam);
      const w = s.w * cam.zoom;
      const h = s.h * cam.zoom;
      if (
        frame.width > 0 &&
        (tl.x - expand > frame.width || tl.y - expand > frame.height || tl.x + w + expand < 0 || tl.y + h + expand < 0)
      ) {
        continue;
      }
      const hw = w / 2;
      const hh = h / 2;
      const cx = tl.x + hw;
      const cy = tl.y + hh;
      const rr = Math.min(config.radius * cam.zoom, hw, hh);
      const ex = hw + expand;
      const ey = hh + expand;
      for (const [ux, uy] of CORNERS) {
        const lx = ux * ex;
        const ly = uy * ey;
        positions[v * 3] = cx + lx;
        positions[v * 3 + 1] = cy + ly;
        positions[v * 3 + 2] = 0;
        local[v * 2] = lx;
        local[v * 2 + 1] = ly;
        halfSize[v * 2] = hw;
        halfSize[v * 2 + 1] = hh;
        radius[v] = rr;
        v++;
      }
    }
  });
  return {
    positions: positions.subarray(0, v * 3),
    local: local.subarray(0, v * 2),
    halfSize: halfSize.subarray(0, v * 2),
    radius: radius.subarray(0, v),
    vertexCount: v,
  };
}
