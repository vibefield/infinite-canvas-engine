/** Explicitly imported content-reactive magnet-grid GroundProgram. */
import type { GridConfig, GridMagnetConfig } from "@ice/core";
import { worldToScreen } from "@ice/kernel";
import { createMagnetGrid, type MagnetGridRenderer } from "../passes/grid-magnet";
import {
  MAGNET_SOURCE_FLOATS,
  MAX_MAGNET_SOURCES,
  collectMagnetLevels,
  magnetFieldScale,
  resolveMagnet,
} from "../passes/magnet-collect";
import { mergeGridConfig, resolveInitialGridConfig } from "../passes/grid-contract";
import type { GroundFrame } from "../pass";
import type { Pole, PoleSource } from "../poles";
import type { GroundProgramDefinition, GroundProgramInput } from "../program";

export interface MagnetGridGroundProgramOptions {
  readonly id: string;
  readonly grid?: Partial<GridConfig>;
  readonly poles?: PoleSource | readonly PoleSource[];
}

type Candidate = {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  radius: number;
  area: number;
  distance: number;
};

function packSources(
  input: GroundProgramInput,
  frame: GroundFrame,
  magnet: GridMagnetConfig,
  fieldScale: number,
  poleSources: readonly PoleSource[],
  out: Float32Array,
): number {
  if (fieldScale <= 0) return 0;
  const cap = Math.min(
    magnet.maxSources,
    MAX_MAGNET_SOURCES,
    Math.floor(out.length / MAGNET_SOURCE_FLOATS),
  );
  let count = 0;
  const poles: Pole[] = [];
  for (const source of poleSources) poles.push(...input.poles(source));
  for (const pole of poles) {
    if (count >= cap) break;
    if (!(pole.strength > 0)) continue;
    const point =
      pole.space === "screen"
        ? pole
        : worldToScreen(pole.x, pole.y, frame.camera);
    const offset = count * MAGNET_SOURCE_FLOATS;
    out[offset] = point.x;
    out[offset + 1] = point.y;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    out[offset + 4] = 0;
    out[offset + 5] = pole.strength * fieldScale;
    out[offset + 6] = 0;
    out[offset + 7] = 0;
    count += 1;
  }
  if (!magnet.widgets || magnet.widgetStrength <= 0 || count >= cap) return count;

  const haloCss =
    5 *
    magnet.reach *
    Math.sqrt(Math.max(magnet.widgetStrength * fieldScale, 0.0001));
  const pad = haloCss / frame.camera.zoom;
  const hits = input.spatial({
    minX: frame.camera.x - pad,
    minY: frame.camera.y - pad,
    maxX: frame.camera.x + frame.width / frame.camera.zoom + pad,
    maxY: frame.camera.y + frame.height / frame.camera.zoom + pad,
  });
  const viewX = frame.width / 2;
  const viewY = frame.height / 2;
  const candidates: Candidate[] = [];
  for (const hit of hits) {
    const width = hit.maxX - hit.minX;
    const height = hit.maxY - hit.minY;
    if (!(width > 0 && height > 0)) continue;
    const hx = (width / 2) * frame.camera.zoom;
    const hy = (height / 2) * frame.camera.zoom;
    const center = worldToScreen(
      hit.minX + width / 2,
      hit.minY + height / 2,
      frame.camera,
    );
    candidates.push({
      cx: center.x,
      cy: center.y,
      hx,
      hy,
      radius: Math.min(magnet.widgetRadius * frame.camera.zoom, hx, hy),
      area: hx * hy,
      distance: (center.x - viewX) ** 2 + (center.y - viewY) ** 2,
    });
  }
  const remaining = cap - count;
  if (candidates.length > remaining) {
    candidates.sort((a, b) => b.area - a.area || a.distance - b.distance);
    candidates.length = remaining;
  }
  const strength = magnet.widgetStrength * fieldScale;
  for (const candidate of candidates) {
    const offset = count * MAGNET_SOURCE_FLOATS;
    out[offset] = candidate.cx;
    out[offset + 1] = candidate.cy;
    out[offset + 2] = candidate.hx;
    out[offset + 3] = candidate.hy;
    out[offset + 4] = candidate.radius;
    out[offset + 5] = strength;
    out[offset + 6] = 0;
    out[offset + 7] = 0;
    count += 1;
  }
  return count;
}

export function magnetGridGroundProgram(
  opts: MagnetGridGroundProgramOptions,
): GroundProgramDefinition {
  let config = resolveInitialGridConfig(opts.grid ?? {});
  const poles =
    opts.poles === undefined ? [] : Array.isArray(opts.poles) ? opts.poles : [opts.poles];
  const live = new Set<MagnetGridRenderer>();
  return {
    id: opts.id,
    // It reads active-frame content, so it cannot remain live after the cut.
    transition: "snapshot",
    sources: [
      { kind: "active-spatial" },
      ...poles.map((source) => ({ kind: "poles" as const, source })),
    ],
    configureGrid(next) {
      config = mergeGridConfig(config, next);
    },
    create() {
      const renderer = createMagnetGrid();
      const scratch = new Float32Array(MAX_MAGNET_SOURCES * MAGNET_SOURCE_FLOATS);
      live.add(renderer);
      let disposed = false;
      return {
        object: renderer.group,
        activate: () => [],
        collect(input, frame, presentation) {
          const magnet = resolveMagnet(config);
          const fieldScale = magnetFieldScale(frame.camera.zoom, magnet.fadeZoom);
          const sourceCount = packSources(input, frame, magnet, fieldScale, poles, scratch);
          const levels = collectMagnetLevels(frame, config).map((level) => ({
            ...level,
            alpha: level.alpha * presentation.opacity,
          }));
          renderer.update(
            frame,
            config,
            magnet,
            levels,
            scratch,
            sourceCount,
          );
        },
        deactivate: () => {},
        estimateBytes: () => scratch.byteLength + 64 * 1024,
        dispose() {
          if (disposed) return;
          disposed = true;
          live.delete(renderer);
          renderer.dispose();
        },
      };
    },
  };
}
