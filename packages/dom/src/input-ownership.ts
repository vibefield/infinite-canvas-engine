/**
 * Input-ownership predicates (design-007 §4 — one predicate FAMILY, not one
 * predicate; petitions I1/I4). "Does the widget own input here" is answered
 * per-surface at the right scope, sharing the DOM-walk mechanics:
 *
 *  - `isEditableTarget` — the 4-class editable gate (keymap default + the
 *    adapter's Space-types fix). Kept narrow so UNDECLARED widgets behave
 *    exactly as before (design-007 F5).
 *  - `keyboardClaimOf` — the `data-canvas-keyboard` claim marker written by the
 *    dom-widgets reflector for `interaction.keyboard: "exclusive"` widgets.
 *    Read UNBOUNDED (page-global) on purpose: `document.activeElement` is one
 *    per page, so engine B's keymap must stand down while you type into engine
 *    A's claiming widget (design-007 F2 — only the DOM is page-global).
 *  - `wheelCede` — the NARROW, DYNAMIC scroll opt-out (design-007 §3.4/§4):
 *    plain wheel cedes to native scroll only when a scroller WITH ROOM in the
 *    wheel's dominant axis sits inside a claim-marked / `data-canvas-
 *    interactive` / editable subtree. At the scroll bounds the predicate turns
 *    false and the wheel falls through to canvas pan/zoom — the familiar
 *    nested-scroll feel — which also keeps scroll-chaining from ever reaching
 *    the page. Deliberately NOT the full `crossesInteractive` set: hovering a
 *    bare `<button>` must not kill canvas zoom (design-007 F4).
 *
 * The keymap (`@ice/react`) imports these — the two historically disagreeing
 * guards now share one implementation (the I1 unification).
 */

/** The claim marker the dom-widgets reflector writes on an exclusive widget's host. */
export const KEYBOARD_CLAIM_ATTR = "data-canvas-keyboard";

/** Marker value for `keyboardEscape: "widget"` (the widget receives even Escape). */
export const CLAIM_OWNS_ESCAPE = "escape";

export interface KeyboardClaim {
  /** The event-target chain crosses a claim marker (⇒ engine keyboard stands down). */
  readonly claimed: boolean;
  /** The claiming widget owns Escape too (`keyboardEscape: "widget"`). */
  readonly ownsEscape: boolean;
}

const NO_CLAIM: KeyboardClaim = { claimed: false, ownsEscape: false };

/** The keymap's editable gate — exactly INPUT/TEXTAREA/SELECT/contentEditable. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Resolve the keyboard claim for an event target (keydown targets ARE
 * `document.activeElement`, so this reads browser focus — the single source of
 * truth, design-007 §2.1). Unbounded `closest` by design (see header).
 */
export function keyboardClaimOf(target: EventTarget | null): KeyboardClaim {
  if (!(target instanceof Element)) return NO_CLAIM;
  const marked = target.closest(`[${KEYBOARD_CLAIM_ATTR}]`);
  if (marked === null) return NO_CLAIM;
  return { claimed: true, ownsEscape: marked.getAttribute(KEYBOARD_CLAIM_ATTR) === CLAIM_OWNS_ESCAPE };
}

/**
 * The scroll-opt-out subtree roots (design-007 §4 `crossesScrollable` — the
 * narrow set): the claim marker, the explicit interactive opt-in, and real
 * editable scrollers. NOT bare button/a/media.
 */
const SCROLL_OPT_OUT_SELECTOR =
  `[${KEYBOARD_CLAIM_ATTR}], [data-canvas-interactive], input, textarea, select, [contenteditable=""], [contenteditable="true"]`;

/** Sub-pixel tolerance for fractional scroll positions. */
const SCROLL_EPS = 1;

/** The element can consume this wheel's dominant-axis delta RIGHT NOW (overflow + room). */
function hasScrollRoom(el: HTMLElement, dx: number, dy: number): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style === undefined || style === null) return false;
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy === 0) return false;
    const oy = style.overflowY;
    if (oy !== "auto" && oy !== "scroll") return false;
    if (el.scrollHeight <= el.clientHeight + SCROLL_EPS) return false;
    return dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - SCROLL_EPS : el.scrollTop > SCROLL_EPS;
  }
  if (dx === 0) return false;
  const ox = style.overflowX;
  if (ox !== "auto" && ox !== "scroll") return false;
  if (el.scrollWidth <= el.clientWidth + SCROLL_EPS) return false;
  return dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - SCROLL_EPS : el.scrollLeft > SCROLL_EPS;
}

/**
 * Should this plain (non-pinch) wheel be ceded to native widget scroll?
 * Walks target → container: remembers any scroller-with-room, cedes on the
 * first opt-out root at or above it. Walking up meets scrollers BEFORE their
 * widget's marker (the marker sits on the host), so "a scroller inside an
 * opt-out subtree" is exactly "saw a scroller by the time the marker matches".
 * ctrl/pinch wheels never reach this — they are ALWAYS the canvas's zoom.
 */
export function wheelCede(
  target: EventTarget | null,
  container: HTMLElement,
  dx: number,
  dy: number,
): boolean {
  if (!(target instanceof Element)) return false;
  if (dx === 0 && dy === 0) return false;
  let sawScrollableRoom = false;
  for (let el: Element | null = target; el !== null && el !== container; el = el.parentElement) {
    if (el instanceof HTMLElement && hasScrollRoom(el, dx, dy)) sawScrollableRoom = true;
    if (sawScrollableRoom && el.matches(SCROLL_OPT_OUT_SELECTOR)) return true;
  }
  return false;
}
