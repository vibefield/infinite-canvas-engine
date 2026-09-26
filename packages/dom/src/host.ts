/**
 * The canvas host (design-004 §1, host pipeline; SCREEN SPACE ONLY since design-015 D5b).
 *
 * The container is styled to be a stable, gesture-clean viewport: `relative` so
 * absolutely-positioned children (the desk's canvas, the one focused editor, the
 * remote-cursor plane, the app's screen-space chrome) anchor to it,
 * `overflow:hidden` to clip them, `touch-action:none` + `user-select:none` so
 * browser scroll/zoom and text selection never fight the interaction stack.
 *
 * THE CONTENT PLANE IS GONE (design-015 §2 law 2). Until D5b the host also made
 * one camera-transformed `<div>` — M3's "content plane", the P1 every DOM
 * widget mounted in, carrying the camera as ONE CSS transform written by the
 * plane-transform reflector (kernel `planeCssTransform`, gone since D7). No DOM element
 * carries a camera transform any more: everything under the camera is the
 * desk renderer's, and the DOM that remains is screen-space.
 */

export interface CanvasHost {
  /** The app-provided viewport element (styled, not created, by the host). */
  readonly container: HTMLElement;
  /** Clear the inline styles the host wrote. */
  dispose(): void;
}

/** The container styles the host owns unconditionally (cleared on dispose). */
const CONTAINER_STYLE: Readonly<Record<string, string>> = {
  overflow: "hidden",
  touchAction: "none",
  userSelect: "none",
};

export function createCanvasHost(container: HTMLElement): CanvasHost {
  // The children need the container to be a POSITIONED containing block — but
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

  return {
    container,
    dispose() {
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
