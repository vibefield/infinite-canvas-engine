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
 * The DEFAULT framing camera (2026-07-18, James: "do zoom to fit, but with a
 * upper and bottom cap … should feel natural"): zoom-to-fit `content` (a
 * world-space bbox) with `pad` px of breathing room on every side, zoom
 * clamped into [minZoom, maxZoom] — the natural band: never so far in that
 * one small card fills the screen, never so far out that the board turns
 * into an ant farm. The content CENTER stays centered whether or not a cap
 * engages. Callers own the band policy (engine default: FIT_DEFAULTS ∩ the
 * session's hard CameraLimits) and must pass a real viewport.
 */
export function fitCamera(
  content: Rect,
  vpW: number,
  vpH: number,
  opts: { pad: number; minZoom: number; maxZoom: number },
): CameraState {
  const fit = Math.min(vpW / (content.width + opts.pad * 2), vpH / (content.height + opts.pad * 2));
  const zoom = Math.min(opts.maxZoom, Math.max(opts.minZoom, fit));
  return {
    x: content.x + content.width / 2 - vpW / (2 * zoom),
    y: content.y + content.height / 2 - vpH / (2 * zoom),
    zoom,
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
