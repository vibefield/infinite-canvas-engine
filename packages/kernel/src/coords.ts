/**
 * THE coordinate seam (Law 13): every conversion between screen, world, and
 * island (widget-local GL) space lives here — including the ONE Y-flip.
 * v1 duplicated this math in three places; nothing outside this module may
 * re-derive it.
 *
 * Conventions:
 * - screen: CSS px, canvas-container-relative, Y-down. DPR never enters world
 *   math (it exists only in GL uniforms / FBO sizing — see zoom-bands). It is
 *   the container's LAYOUT space (petition I39): a CSS transform on it or an
 *   ancestor scales the box it is drawn in, never screen space — a client point
 *   comes in through `clientToScreen`, the container's size through `screenSizeOf`.
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

/** A node's RENDERED box, client px — `getBoundingClientRect()`'s: a CSS transform on it or an ancestor scales and moves it. */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A node's LAYOUT size, CSS px, by the DOM's own names (an element is one): what no transform changes — the box the canvas fills. */
export interface LaidOutBox {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/**
 * The container's SIZE in screen space (petition I39): its layout size, which no CSS transform changes — the canvas is sized by it and
 * every screen-space child is laid out in it. A node with no layout box to measure (0 × 0 — not rendered, or a DOM without layout)
 * answers its rendered box; untransformed, the two are one.
 */
export function screenSizeOf(rendered: ClientBox, layout: LaidOutBox): { readonly width: number; readonly height: number } {
  return layout.clientWidth > 0 || layout.clientHeight > 0
    ? { width: layout.clientWidth, height: layout.clientHeight }
    : { width: rendered.width, height: rendered.height };
}

/**
 * A CLIENT point (an event's `clientX`/`clientY`) in the container's SCREEN space (petition I39): its offset from the rendered box's
 * top-left, divided on each axis by the scale the box is drawn at (rendered over `screenSizeOf`) — under `transform: scale(s)` the
 * scaled box's far corner is the layout's far corner, so a press lands on what is drawn under it at any scale and translation (a
 * rotated box's bounding rect is not its box: not covered). Untransformed, the offset alone.
 */
export function clientToScreen(clientX: number, clientY: number, rendered: ClientBox, layout: LaidOutBox): Vec2 {
  const size = screenSizeOf(rendered, layout);
  return {
    x: (clientX - rendered.left) * (rendered.width > 0 ? size.width / rendered.width : 1),
    y: (clientY - rendered.top) * (rendered.height > 0 ? size.height / rendered.height : 1),
  };
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

// (`planeCssTransform` — the per-plane CSS transform of the retired DOM/GL planes — left at design-015 D7: the DOM
// lives in screen space, and no element carries a camera transform, §2.2.)
