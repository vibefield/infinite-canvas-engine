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

/** The container styles the host owns unconditionally (cleared on dispose). */
const CONTAINER_STYLE: Readonly<Record<string, string>> = {
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
  // The plane needs the container to be a POSITIONED containing block — but
  // `absolute`/`fixed` already qualify, so only promote a `static` container
  // to `relative`. Stomping an app's `position: absolute` with inline
  // `relative` collapses the common `#app { position: absolute; inset: 0 }`
  // sizing pattern to zero height (inset offsets a relative box, it does not
  // size it), and the host's own overflow:hidden then clips everything.
  // Inline style first (authoritative and environment-independent), computed
  // second (catches stylesheet rules like `#app { position: absolute }`).
  const view = container.ownerDocument.defaultView;
  const position =
    container.style.position !== ""
      ? container.style.position
      : (view?.getComputedStyle(container).position ?? "");
  const promoteToRelative = position === "" || position === "static";
  if (promoteToRelative) container.style.position = "relative";
  // Record each host-owned property's prior inline value BEFORE overwriting it,
  // so dispose restores what the caller set (e.g. an inline overflow:auto) rather
  // than blanket-clearing it. Empty string = the caller had no inline value here.
  const priorContainerStyle = Object.keys(CONTAINER_STYLE).map((prop) => {
    // camelCase → kebab-case for the CSSOM property API (touchAction → touch-action).
    const cssName = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    return [cssName, container.style.getPropertyValue(cssName)] as const;
  });
  Object.assign(container.style, CONTAINER_STYLE);

  const contentPlane = container.ownerDocument.createElement("div");
  Object.assign(contentPlane.style, PLANE_STYLE);
  container.appendChild(contentPlane);

  return {
    container,
    contentPlane,
    dispose() {
      contentPlane.remove();
      if (promoteToRelative) container.style.removeProperty("position");
      for (const [cssName, prior] of priorContainerStyle) {
        // Restore the caller's prior inline value, or clear the host's if the
        // caller had none.
        if (prior !== "") container.style.setProperty(cssName, prior);
        else container.style.removeProperty(cssName);
      }
    },
  };
}
