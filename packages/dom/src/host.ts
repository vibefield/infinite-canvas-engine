/**
 * The DOM canvas host (design-004 §1, host pipeline — M3 slice).
 *
 * M3 stands up ONE content plane: an absolutely-positioned div whose single CSS
 * transform (written by the plane-transform reflector) applies the camera to
 * every world-positioned child at once (design-002 §5 `planeTransform`; kernel
 * `planeCssTransform`). The full six-plane model (background/content/overlay/
 * chrome/HUD/nav + the FBO compositor) arrives in M6 — this file is deliberately
 * the minimum that lets a reflector paint into a camera-transformed space.
 *
 * The container is styled to be a stable, gesture-clean viewport: `relative` so
 * the absolute plane anchors to it, `overflow:hidden` to clip the infinite
 * plane, `touch-action:none` + `user-select:none` so browser scroll/zoom and
 * text selection never fight the interaction stack.
 */

export interface CanvasHost {
  /** The app-provided viewport element (styled, not created, by the host). */
  readonly container: HTMLElement;
  /** The single camera-transformed plane; world-positioned children mount here. */
  readonly contentPlane: HTMLDivElement;
  /** Remove the plane and clear the inline styles the host wrote. */
  dispose(): void;
}

/** The container styles the host owns (cleared on dispose). */
const CONTAINER_STYLE: Readonly<Record<string, string>> = {
  position: "relative",
  overflow: "hidden",
  touchAction: "none",
  userSelect: "none",
};

/** The content-plane styles: origin-anchored, transform-ready (design-002 §5). */
const PLANE_STYLE: Readonly<Record<string, string>> = {
  position: "absolute",
  left: "0",
  top: "0",
  transformOrigin: "0 0",
  willChange: "transform",
};

export function createCanvasHost(container: HTMLElement): CanvasHost {
  Object.assign(container.style, CONTAINER_STYLE);

  const contentPlane = container.ownerDocument.createElement("div");
  Object.assign(contentPlane.style, PLANE_STYLE);
  container.appendChild(contentPlane);

  return {
    container,
    contentPlane,
    dispose() {
      contentPlane.remove();
      for (const prop of Object.keys(CONTAINER_STYLE)) {
        container.style.removeProperty(
          // camelCase → kebab-case for removeProperty (touchAction → touch-action).
          prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
        );
      }
    },
  };
}
