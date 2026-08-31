/** Shared portal geometry and frame-arrival view resolution. */
import type { Entity, World } from "@vibecook/strata-ecs";
import { fitCamera, type CameraState } from "@ice/kernel";
import {
  CameraLimits,
  MeasuredSize,
  Position,
  Size,
  Viewport,
} from "../catalog";
import { ChildOf } from "../catalog/scene";
import { CAMERA_DEFAULTS, FIT_DEFAULTS } from "../settings/defaults";
import type { CanvasType } from "./define-canvas-type";
import type { WidgetContainerEntry } from "../widget/define-widget";

export interface CanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ResolvedPortal {
  readonly local: CanvasRect;
  readonly parent: CanvasRect;
  /** False means authored insets were invalid at the effective instance size. */
  readonly authored: boolean;
}

export interface ResolvedFrameView {
  readonly bounds: CanvasRect;
  readonly camera: CameraState;
  readonly totalChildren: number;
}

export interface FrameChildrenOpts {
  /** When supplied, malformed descendants inherit the nearest container frame. */
  readonly isContainer?: (entity: Entity) => boolean;
}

function effectiveSize(world: World, entity: Entity): { w: number; h: number } | undefined {
  const measured = world.get(entity, MeasuredSize);
  if (measured !== undefined && measured.w > 0 && measured.h > 0) return measured;
  return world.get(entity, Size);
}

/**
 * Converged effective frame order. Without a container predicate this is the
 * ordinary direct sequence. Compatibility callers supply the engine-scoped
 * predicate to include malformed descendants and stop at nested frames.
 */
export function resolveFrameChildren(
  world: World,
  frame: Entity,
  opts: FrameChildrenOpts = {},
): readonly Entity[] {
  if (!world.isAlive(frame)) return Object.freeze([]);
  const direct = world.getReverse(frame, ChildOf).filter((entity) => world.isAlive(entity));
  if (opts.isContainer === undefined) return Object.freeze(direct);
  const result: Entity[] = [];
  const seen = new Set<Entity>([frame]);
  const pending = [...direct].reverse();
  while (pending.length > 0) {
    const child = pending.pop() as Entity;
    if (seen.has(child)) continue;
    seen.add(child);
    result.push(child);
    if (opts.isContainer(child)) continue;
    const descendants = world
      .getReverse(child, ChildOf)
      .filter((entity) => world.isAlive(entity));
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      pending.push(descendants[index] as Entity);
    }
  }
  return Object.freeze(result);
}

/** One source for preview clipping and navigation/transition portal math. */
export function resolvePortal(
  world: World,
  container: Entity,
  binding: WidgetContainerEntry | undefined,
): ResolvedPortal | undefined {
  const position = world.get(container, Position);
  const size = effectiveSize(world, container);
  if (position === undefined || size === undefined || size.w <= 0 || size.h <= 0) return undefined;
  const portal = binding?.portal ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const width = size.w - portal.left - portal.right;
  const height = size.h - portal.top - portal.bottom;
  const authored =
    [portal.top, portal.right, portal.bottom, portal.left].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) &&
    width > 0 &&
    height > 0;
  const local: CanvasRect = authored
    ? { x: portal.left, y: portal.top, width, height }
    : { x: 0, y: 0, width: size.w, height: size.h };
  return {
    local,
    parent: {
      x: position.x + local.x,
      y: position.y + local.y,
      width: local.width,
      height: local.height,
    },
    authored,
  };
}

/** One source for arrival camera and semantic preview projection. */
export function resolveFrameView(
  world: World,
  frame: Entity,
  canvas: CanvasType | undefined,
  opts: FrameChildrenOpts = {},
): ResolvedFrameView {
  const limits = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
  const cameraPolicy = canvas?.presentation?.camera;
  const requestedMin = cameraPolicy?.minZoom ?? FIT_DEFAULTS.minZoom;
  const requestedMax = cameraPolicy?.maxZoom ?? FIT_DEFAULTS.maxZoom;
  const minZoom = Math.min(Math.max(requestedMin, limits.minZoom), limits.maxZoom);
  const maxZoom = Math.max(Math.min(requestedMax, limits.maxZoom), limits.minZoom);
  const identity: CameraState = {
    x: 0,
    y: 0,
    zoom: Math.min(maxZoom, Math.max(minZoom, 1)),
  };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let totalChildren = 0;
  for (const child of resolveFrameChildren(world, frame, opts)) {
    totalChildren += 1;
    const position = world.get(child, Position);
    const size = effectiveSize(world, child);
    if (position === undefined || size === undefined) continue;
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + size.w);
    maxY = Math.max(maxY, position.y + size.h);
  }
  const hasBounds = Number.isFinite(minX);
  const bounds: CanvasRect = hasBounds
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 };
  const viewport = world.getResource(Viewport);
  if (
    cameraPolicy?.arrival === "identity" ||
    !hasBounds ||
    viewport === undefined ||
    viewport.w <= 0 ||
    viewport.h <= 0
  ) {
    return { bounds, camera: identity, totalChildren };
  }
  return {
    bounds,
    camera: fitCamera(bounds, viewport.w, viewport.h, {
      pad: cameraPolicy?.padding ?? FIT_DEFAULTS.pad,
      minZoom,
      maxZoom,
    }),
    totalChildren,
  };
}
