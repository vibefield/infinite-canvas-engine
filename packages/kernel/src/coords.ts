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

/** Screen px a host's own chrome covers on each side of the viewport; an absent side covers none. */
export interface ScreenInset {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

/** A zoom band, [minZoom, maxZoom]. */
export interface ZoomBand {
  readonly minZoom: number;
  readonly maxZoom: number;
}

/** What the look camera frames by (`lookCamera`). */
export interface LookCameraOpts {
  /** The zoom policy: `"comfort"`, `"fit"`, `"keep"` or a zoom (see `lookCamera`). */
  readonly zoom: "comfort" | "fit" | "keep" | number;
  /** Screen px of room on every side of the target when it must fit (at most a quarter of the room on an axis). */
  readonly pad: number;
  /** The natural band the fit lands in and the comfort zooms in to (engine default: FIT_DEFAULTS). */
  readonly band: ZoomBand;
  /** The hard clamp every result honours (the session's CameraLimits). */
  readonly limits: ZoomBand;
  /** The viewport's edges the host's chrome covers: the target is centred in what is left. */
  readonly inset?: ScreenInset;
}

/**
 * The LOOK camera (petition I58, `ops.lookAt`): the camera that CENTRES `target` (a world rect) in what
 * the person can see — the viewport less `opts.inset` — at the zoom `opts.zoom` gives, from `from`, the
 * zoom the camera is at:
 *  - `"comfort"`: `from` when the target can be read there (`from` ≥ the band's floor) and fits (with
 *    `pad` round it); below the floor it zooms in to the floor — never past the band's ceiling — or only
 *    as far as the target still fits; too big at `from`, it zooms out until the target fits;
 *  - `"fit"`: the target fitted with `pad` round it, clamped into the band (`fitCamera`'s band rule);
 *  - `"keep"`: `from`;
 *  - a number: that zoom.
 * The pad is SCREEN px at every zoom (`fitCamera` adds its pad to the content in world units, so its
 * margin is px only at 100%), cut to a quarter of the room on an axis where it would leave less than
 * half of it. The band is first intersected with `limits` (on no overlap the limit wins: `frameContent`'s
 * rule), and every result is clamped by `limits`. Insets that leave no room on an axis are ignored: the
 * target is centred in the whole viewport. Pure math; callers pass a real viewport and finite numbers.
 */
export function lookCamera(target: Rect, from: number, vpW: number, vpH: number, opts: LookCameraOpts): CameraState {
  const inset = opts.inset ?? {};
  const left = inset.left ?? 0;
  const top = inset.top ?? 0;
  const roomW = vpW - left - (inset.right ?? 0);
  const roomH = vpH - top - (inset.bottom ?? 0);
  const roomy = roomW > 0 && roomH > 0;
  const x0 = roomy ? left : 0;
  const y0 = roomy ? top : 0;
  const w = roomy ? roomW : vpW;
  const h = roomy ? roomH : vpH;
  const { limits, band } = opts;
  const floor = Math.min(Math.max(band.minZoom, limits.minZoom), limits.maxZoom);
  const ceiling = Math.max(Math.min(band.maxZoom, limits.maxZoom), limits.minZoom);
  /** The zoom at which the target, `pad` screen px round it, just fits what is left of the view. */
  const fits = Math.min(
    (w - 2 * Math.min(opts.pad, w / 4)) / target.width,
    (h - 2 * Math.min(opts.pad, h / 4)) / target.height,
  );
  const policy = opts.zoom;
  let zoom: number;
  if (typeof policy === "number") zoom = policy;
  else if (policy === "keep") zoom = from;
  else if (policy === "fit") zoom = Math.min(ceiling, Math.max(floor, fits));
  else if (from >= floor && from <= fits) zoom = from;
  // in to the floor (≤ the ceiling, by the intersection above) — or less, where the target would not fit there
  else if (from < floor) zoom = Math.min(floor, fits);
  else zoom = fits;
  zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, zoom));
  return {
    x: target.x + target.width / 2 - (x0 + w / 2) / zoom,
    y: target.y + target.height / 2 - (y0 + h / 2) / zoom,
    zoom,
  };
}

// (`planeCssTransform` — the per-plane CSS transform of the retired DOM/GL planes — left at design-015 D7: the DOM
// lives in screen space, and no element carries a camera transform, §2.2.)
