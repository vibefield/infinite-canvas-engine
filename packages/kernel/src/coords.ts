/**
 * THE coordinate seam (Law 13): every conversion between screen, world, and
 * island (widget-local GL) space lives here — including the ONE Y-flip.
 * v1 duplicated this math in three places; nothing outside this module may
 * re-derive it.
 *
 * Conventions:
 * - screen: CSS px, canvas-container-relative, Y-down. DPR never enters world
 *   math (it exists only in GL uniforms / FBO sizing — see zoom-bands).
 * - world:  world units, Y-down. `Camera.{x,y}` is the WORLD point at the
 *   viewport's top-left; `zoom` is screen px per world unit.
 * - island: widget-local GL space — CENTER origin, Y-UP, world-unit scale.
 *   (v1 VirtualWidget convention; the only Y-flip in the codebase.)
 */
import type { Rect, Vec2 } from "./shapes";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export function screenToWorld(screenX: number, screenY: number, camera: CameraState): Vec2 {
  return {
    x: screenX / camera.zoom + camera.x,
    y: screenY / camera.zoom + camera.y,
  };
}

export function worldToScreen(worldX: number, worldY: number, camera: CameraState): Vec2 {
  return {
    x: (worldX - camera.x) * camera.zoom,
    y: (worldY - camera.y) * camera.zoom,
  };
}

/**
 * Zoom about a fixed screen point (v1 `zoomAtPoint`): the world point under
 * `(screenX, screenY)` stays under it after the zoom change.
 * Returns the new camera (does not mutate). Clamping is the caller's policy.
 */
export function zoomAtPoint(
  camera: CameraState,
  screenX: number,
  screenY: number,
  newZoom: number,
): CameraState {
  const anchor = screenToWorld(screenX, screenY, camera);
  return {
    x: anchor.x - screenX / newZoom,
    y: anchor.y - screenY / newZoom,
    zoom: newZoom,
  };
}

/**
 * Camera → the ONE per-plane CSS transform (design-002 §5 `planeTransform`).
 * Children are laid out in WORLD units inside the plane (left/top = world x/y),
 * the plane carries `transform: translate(tx px, ty px) scale(scale)` with
 * `transform-origin: 0 0` — so a child at world point p lands at
 * `p·zoom + t = (p − camera)·zoom`, i.e. exactly `worldToScreen(p)`.
 */
export function planeCssTransform(camera: CameraState): { tx: number; ty: number; scale: number } {
  return {
    tx: -camera.x * camera.zoom,
    ty: -camera.y * camera.zoom,
    scale: camera.zoom,
  };
}

/** World → island (center-origin, Y-up). THE Y-flip, direction one. */
export function worldToIsland(worldX: number, worldY: number, widget: Rect): Vec2 {
  return {
    x: worldX - (widget.x + widget.width / 2),
    y: -(worldY - (widget.y + widget.height / 2)),
  };
}

/** Island → world. THE Y-flip, direction two. */
export function islandToWorld(islandX: number, islandY: number, widget: Rect): Vec2 {
  return {
    x: widget.x + widget.width / 2 + islandX,
    y: widget.y + widget.height / 2 - islandY,
  };
}
