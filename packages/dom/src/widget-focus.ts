/**
 * The focus driver — acquisition + programmatic focus for keyboard-claiming
 * widgets (design-007 §2.3–§2.5, petition I1).
 *
 * The single source of truth is BROWSER focus: `document.activeElement` inside
 * a `data-canvas-keyboard` subtree is what makes every engine keyboard surface
 * stand down (input-ownership.ts). This driver's whole job is to make that
 * state reachable — it drives `.focus()`, it never mirrors focus into the
 * world (there is no Focus resource; design-007 §2.2 demoted it, and despawn
 * integrity is free: removing the node resets `activeElement`).
 *
 * Acquisition is DOM-at-event-time, not a world system: for DOM widgets the
 * browser's own event targeting IS the pick (the down target sits inside the
 * claiming host), and for GL widgets the claim lives on the DOM-chrome host
 * under the pointer (the GL plane is `pointer-events:none`, so the down lands
 * on the chrome — design-007 §2.5's proxy path). A capture-phase listener
 * keeps ordering deterministic across browsers (Safari's click-focus quirks):
 *
 *  - down on a natively-focusable node inside the claim (textarea, canvas
 *    with tabindex, the declared proxy itself) → the browser's own mousedown
 *    focus is correct; the driver does nothing.
 *  - down anywhere else inside the claim → the driver focuses the widget's
 *    declared `[data-canvas-focus]` proxy when one exists, else the host
 *    (the reflector gave it `tabindex="-1"`), with `preventScroll` — and
 *    `preventDefault()`s the pointerdown so the native focus fixup cannot
 *    fight the choice. Canceling a pointerdown suppresses only the compat
 *    mouse events (focus fixup + text selection — the container is already
 *    `user-select:none`); `click` still derives and the adapter's container
 *    listener has already enqueued the down fact (one input path intact).
 *  - down outside any claim → untouched; the browser blurs to body/other
 *    content on its own (click-away release, design-007 §2.4).
 *
 * Release stays where the design put it: Escape in the keymap (blur), lifecycle
 * via node removal, window blur deliberately does NOT force-blur (the browser
 * restores focus on refocus — adapter's cancelAllInput keeps its hands off).
 */
import type { Entity } from "@ice/core";
import type { CanvasHost } from "./host";
import { KEYBOARD_CLAIM_ATTR } from "./input-ownership";

/** The widget-declared focus target (a proxy descendant): `<div data-canvas-focus tabIndex={-1}>`. */
export const FOCUS_PROXY_ATTR = "data-canvas-focus";

/**
 * Natively click-focusable content — where the browser's own mousedown focus
 * already lands inside the widget (the driver must not override it).
 */
const FOCUSABLE_SELECTOR =
  'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [tabindex], audio[controls], video[controls], iframe';

/** Resolves an entity to its host's content element (the dom-widgets reflector's `hostFor`). */
export interface FocusHostLookup {
  hostFor(entity: Entity): HTMLElement | undefined;
}

export interface WidgetFocusHandle {
  /**
   * Programmatically focus a claiming widget (its proxy, else its host).
   * Returns false when the entity has no mounted host or no keyboard claim —
   * only `keyboard: "exclusive"` widgets are focusable (declaration drives
   * focusability; design-007 §3.1).
   */
  focusWidget(entity: Entity): boolean;
  /** Blur whatever claim currently holds focus. False when none does. */
  blurFocus(): boolean;
  /** Remove the acquisition listener. */
  detach(): void;
}

/** The claiming host's focus node: the declared proxy, else the (tabindexed) host. */
function focusNodeOf(claimHost: HTMLElement): HTMLElement {
  const proxy = claimHost.querySelector<HTMLElement>(`[${FOCUS_PROXY_ATTR}]`);
  return proxy ?? claimHost;
}

export function attachWidgetFocus(host: CanvasHost, lookup: FocusHostLookup): WidgetFocusHandle {
  const { container } = host;
  const doc = container.ownerDocument;

  const onPointerDown = (e: PointerEvent): void => {
    if (!(e.target instanceof Element)) return;
    const marked = e.target.closest(`[${KEYBOARD_CLAIM_ATTR}]`);
    if (!(marked instanceof HTMLElement) || !container.contains(marked)) return;
    // A natively-focusable node under the pointer (deeper than the host)
    // takes browser focus on its own — the common editable/terminal case.
    const focusable = e.target.closest(FOCUSABLE_SELECTOR);
    if (focusable !== null && focusable !== marked && marked.contains(focusable)) return;
    const node = focusNodeOf(marked);
    if (doc.activeElement === node) return; // already held — never disturb mid-gesture
    e.preventDefault(); // suppress the native focus fixup; the driver owns the choice
    node.focus({ preventScroll: true });
  };

  // Capture phase: runs before widget content's own handlers and before the
  // adapter's bubble listener — deterministic acquisition, no races.
  container.addEventListener("pointerdown", onPointerDown, true);

  return {
    focusWidget(entity) {
      const content = lookup.hostFor(entity);
      const hostEl = content?.parentElement;
      if (!(hostEl instanceof HTMLElement) || !hostEl.hasAttribute(KEYBOARD_CLAIM_ATTR)) return false;
      const node = focusNodeOf(hostEl);
      node.focus({ preventScroll: true });
      return doc.activeElement === node;
    },
    blurFocus() {
      const active = doc.activeElement;
      // SVG focus targets included — same rule as the keymap's Escape release.
      if (!(active instanceof HTMLElement || active instanceof SVGElement)) return false;
      if (active.closest(`[${KEYBOARD_CLAIM_ATTR}]`) === null) return false;
      active.blur();
      return true;
    },
    detach() {
      container.removeEventListener("pointerdown", onPointerDown, true);
    },
  };
}
