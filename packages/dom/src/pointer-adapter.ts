/**
 * The real L0 pointer adapter (design-003 §2–§3; replaces the M3 demo-input scaffold).
 *
 * Translates DOM pointer / wheel / keyboard events into normalized `InputEvent`s
 * and ONLY enqueues them (Law 2: adapters enqueue, they never touch the world —
 * this file imports no ECS state and writes nothing). `pointerIngest` drains the
 * queue once per tick and turns the facts into world state.
 *
 * Details that matter:
 *  - stable pointer ids: `"mouse"` for the one mouse, `"touch:<pointerId>"` per
 *    contact, `"pen"` — ingest keys pointer entities off these (design-003 §2);
 *  - container-relative CSS px (the kernel screen space) via getBoundingClientRect;
 *  - `setPointerCapture` on down so a drag keeps delivering outside the element;
 *  - Space is the pan modifier (design-003 §4.4): tracked here and threaded onto
 *    every event's `mods.space`; keydown/keyup emit a `key` fact only when the
 *    modifier tuple actually changes, and Space `preventDefault`s to stop page scroll;
 *  - wheel `preventDefault`s: a ctrl-wheel / trackpad pinch becomes `wheel.pinch`
 *    (the zoom signal), a plain wheel becomes dx/dy (deltaMode lines → px ×16);
 *  - window blur enqueues a synthetic `cancel` for every pointer still down
 *    (design-003 §8) — the browser will not send the pointerups.
 *
 * Widget opt-out (the pinned widget-event contract, design-002 §8 / design-004 §4):
 * on `pointerdown` ONLY, if the event's target chain (up to the container) crosses
 * a native interactive (input/textarea/select/button/a[href]/contenteditable/
 * media[controls]) or an explicit `[data-canvas-interactive]`, the down fact is
 * flagged `surfaceHandled: true` — the fact still lands (the one input path is
 * absolute), but recognizer-spawn/arbitration skip it (`HandledByWidget` flows
 * through L0). `stopPropagation()` inside widget content is the OTHER boundary:
 * a stopped event never reaches the container listener, so it never becomes a
 * canvas fact at all — that is the design, not a gap.
 *
 * Hover-time amendment (design-002 §8, 2026-07-18): down/move facts ALSO carry
 * `overInteractive` — the same `crossesInteractive` check, run at hover time,
 * OR'd with the GL router's hover verdict — so the world can telegraph the
 * opt-out BEFORE a down (cursor affordances). It never gates gestures:
 * `surfaceHandled` stays down-only and keeps its exact meaning. During a
 * container-captured drag every event retargets to the container, so
 * `overInteractive` reads false mid-gesture — correct: the gesture owns the
 * pointer, not the widget under it.
 */
import { NO_MODS, type InputEvent, type InputMods, type InputQueue } from "@ice/core";
import type { CanvasHost } from "./host";

/**
 * The router GL path's adapter seam (design-004 §4). The GL plane is
 * `pointer-events: none` — its events land HERE, and the injected router
 * (built by @ice/r3f; the adapter stays ECS-free) performs the synchronous
 * point-pick + island raycast + synthetic dispatch at event time. Returning
 * `true` means island content claimed the event (stopPropagation'd or held
 * under island capture): the fact still lands — flagged `surfaceHandled`, so
 * recognizers skip it via `HandledByWidget` — the same contract as the
 * native-interactive opt-out.
 */
export type GLRoute = (
  kind: "down" | "move" | "up" | "cancel",
  screenX: number,
  screenY: number,
  native: PointerEvent,
) => boolean | GLRouteVerdict;

/**
 * The richer GL verdict (hover-time amendment, 2026-07-18): `handled` keeps the
 * boolean's exact meaning (island content claimed the event); `overInteractive`
 * adds the hover fact — the pick chain holds claim-capable content (a mesh with
 * a down/click handler), so a down HERE would be the island's. Plain `boolean`
 * returns stay legal (≡ `{ handled }`), so existing routes never break.
 */
export interface GLRouteVerdict {
  readonly handled: boolean;
  readonly overInteractive?: boolean;
}

const asVerdict = (v: boolean | GLRouteVerdict | undefined): GLRouteVerdict =>
  typeof v === "object" ? v : { handled: v === true };

export interface PointerAdapterOpts {
  readonly glRoute?: GLRoute;
}

/** DOM_DELTA_LINE → px (one wheel "line" ≈ 16px; matches typical browser mapping). */
const WHEEL_LINE_PX = 16;

/**
 * Elements whose `pointerdown` is the widget's, not the canvas's (design-002 §8).
 * `contenteditable=""` (bare attribute) and `="true"` are editable; `="false"` is
 * not. Media only opts out WITH visible controls.
 */
const INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], audio[controls], video[controls], [data-canvas-interactive]';

/** True if `target`'s ancestor chain, up to but excluding `container`, holds an interactive surface. */
function crossesInteractive(target: EventTarget | null, container: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const match = target.closest(INTERACTIVE_SELECTOR);
  // `closest` walks to the document root; bound it to inside the canvas so an
  // interactive ANCESTOR of the container (unusual, but legal) does not count.
  return match !== null && container.contains(match);
}

function pointerIdOf(e: PointerEvent): string {
  if (e.pointerType === "touch") return `touch:${e.pointerId}`;
  if (e.pointerType === "pen") return "pen";
  return "mouse";
}

function deviceOf(e: PointerEvent): InputEvent["device"] {
  if (e.pointerType === "touch") return "touch";
  if (e.pointerType === "pen") return "pen";
  return "mouse";
}

export function attachPointerAdapter(
  host: CanvasHost,
  queue: InputQueue,
  opts: PointerAdapterOpts = {},
): () => void {
  const { container } = host;
  const view = container.ownerDocument.defaultView;
  const { glRoute } = opts;

  let spaceHeld = false;
  // Pointers currently down — blur-cancel sweep + DEFERRED-CAPTURE state.
  // Capture timing (field report 2026-07-12, v1's click-vs-drag discrimination):
  // capturing on DOWN retargets the derived `click`/`dblclick` to the container,
  // killing every widget-body handler (todo rows, folder double-click). So:
  //   - GL-claimed downs capture IMMEDIATELY (the router synthesizes its own
  //     clicks; island drags must keep delivering outside the element);
  //   - native-interactive downs NEVER capture (the engine ignores them);
  //   - everything else captures on the FIRST held-button move past a 4px slop
  //     — below every recognizer dead zone, so a drag is always captured
  //     before it can activate, while a clean tap never captures at all.
  const live = new Map<
    string,
    {
      device: InputEvent["device"];
      x: number;
      y: number;
      downX: number;
      downY: number;
      native: boolean;
      captured: boolean;
    }
  >();
  const CAPTURE_SLOP_PX = 4;

  const capture = (pointerId: number): void => {
    if (typeof container.setPointerCapture !== "function") return;
    try {
      container.setPointerCapture(pointerId);
    } catch {
      // capture is best-effort — a detached or unsupported target must not throw here.
    }
  };
  // Last emitted keyboard tuple — emit a `key` fact only when it actually changes.
  let lastMods = { shift: false, ctrl: false, alt: false, meta: false, space: false };

  const relative = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = container.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const pointerMods = (e: PointerEvent | WheelEvent): InputMods => ({
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    meta: e.metaKey,
    space: spaceHeld,
  });

  const onPointerDown = (e: PointerEvent): void => {
    const id = pointerIdOf(e);
    const device = deviceOf(e);
    const { x, y } = relative(e.clientX, e.clientY);
    // Widget opt-out: down on a native interactive / [data-canvas-interactive]
    // flags the fact so recognizers skip it (design-002 §8). The GL router is
    // the same boundary for island content — its synchronous pick + synthetic
    // dispatch happens HERE, at event time (design-004 §4).
    const native = crossesInteractive(e.target, container);
    const gl = asVerdict(glRoute?.("down", x, y, e));
    const glClaimed = gl.handled;
    live.set(id, { device, x, y, downX: x, downY: y, native, captured: glClaimed });
    if (glClaimed) capture(e.pointerId); // island capture semantics need it NOW
    const surfaceHandled = native || glClaimed;
    queue.enqueue({
      kind: "down",
      pointerId: id,
      device,
      screenX: x,
      screenY: y,
      buttons: e.buttons,
      mods: pointerMods(e),
      tMs: e.timeStamp,
      ...(surfaceHandled ? { surfaceHandled: true } : {}),
      // The down IS a hover-bearing fact: a touch's first event must seed the
      // pointer's OverInteractive truth (no prior moves exist to).
      overInteractive: surfaceHandled || gl.overInteractive === true,
    });
  };

  const onPointerMove = (e: PointerEvent): void => {
    const id = pointerIdOf(e);
    const device = deviceOf(e);
    const { x, y } = relative(e.clientX, e.clientY);
    let seen = live.get(id);
    // ADOPTED-gesture hardening (ops.insertByDrag, 2026-07-19): a held-button
    // move for a pointer whose down we never saw means widget content started
    // the gesture and handed it to the engine (the tray tile stopPropagation'd
    // its down — the sanctioned boundary). Track it from HERE so the deferred
    // capture below still takes the pointer before it can leave the window
    // mid-drag, and the blur sweep knows to cancel it. Gated off interactive
    // targets: a move over opted-out content (text selection in a widget's
    // input, the tray panel itself) must never trigger a container capture.
    if (seen === undefined && e.buttons !== 0 && !crossesInteractive(e.target, container)) {
      seen = { device, x, y, downX: x, downY: y, native: false, captured: false };
      live.set(id, seen);
    }
    if (seen !== undefined) {
      seen.x = x;
      seen.y = y;
      // Deferred capture: a real drag is forming — take it before any
      // recognizer dead zone (>=8px) can activate.
      if (
        !seen.captured &&
        !seen.native &&
        e.buttons !== 0 &&
        Math.hypot(x - seen.downX, y - seen.downY) > CAPTURE_SLOP_PX
      ) {
        capture(e.pointerId);
        seen.captured = true;
      }
    }
    const gl = asVerdict(glRoute?.("move", x, y, e)); // island capture / hover synth
    queue.enqueue({
      kind: "move",
      pointerId: id,
      device,
      screenX: x,
      screenY: y,
      buttons: e.buttons,
      mods: pointerMods(e),
      tMs: e.timeStamp,
      ...(gl.handled ? { surfaceHandled: true } : {}),
      // Hover fact, every move: DOM chain check ∪ GL verdict. A gl-captured
      // move (island drag) counts — the widget owns the pointer right now.
      overInteractive:
        crossesInteractive(e.target, container) || gl.handled || gl.overInteractive === true,
    });
  };

  const endPointer =
    (kind: "up" | "cancel") =>
    (e: PointerEvent): void => {
      const id = pointerIdOf(e);
      const device = deviceOf(e);
      const { x, y } = relative(e.clientX, e.clientY);
      live.delete(id);
      if (typeof container.releasePointerCapture === "function") {
        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          // release is best-effort (capture may already be gone).
        }
      }
      const gl = asVerdict(glRoute?.(kind, x, y, e)); // releases island capture
      queue.enqueue({
        kind,
        pointerId: id,
        device,
        screenX: x,
        screenY: y,
        buttons: e.buttons,
        mods: pointerMods(e),
        ...(gl.handled ? { surfaceHandled: true } : {}),
        // No overInteractive stamp: a capture-retargeted up reads the container,
        // not the content under the pointer — the next real move re-truths it.
      });
    };
  const onPointerUp = endPointer("up");
  const onPointerCancel = endPointer("cancel");

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // own zoom/pan — never let the page scroll
    const { x, y } = relative(e.clientX, e.clientY);
    const scale = e.deltaMode === 1 ? WHEEL_LINE_PX : 1; // DOM_DELTA_LINE → px
    const wheel = e.ctrlKey
      ? { dx: 0, dy: 0, pinch: e.deltaY } // ctrl-wheel / trackpad pinch = zoom signal
      : { dx: e.deltaX * scale, dy: e.deltaY * scale, pinch: 0 };
    queue.enqueue({ kind: "wheel", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: e.buttons, mods: pointerMods(e), wheel });
  };

  /** Emit a `key` fact iff the modifier tuple changed (design-003 §2 minimal keyboard). */
  const emitKeyIfChanged = (e: KeyboardEvent): void => {
    const mods: InputMods = { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, space: spaceHeld };
    if (
      mods.shift === lastMods.shift &&
      mods.ctrl === lastMods.ctrl &&
      mods.alt === lastMods.alt &&
      mods.meta === lastMods.meta &&
      mods.space === lastMods.space
    ) {
      return;
    }
    lastMods = { ...mods };
    queue.enqueue({ kind: "key", pointerId: "", device: "mouse", screenX: 0, screenY: 0, buttons: 0, mods });
  };

  const isSpace = (e: KeyboardEvent): boolean => e.key === " " || e.code === "Space";

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isSpace(e)) {
      e.preventDefault(); // Space would otherwise page-scroll
      spaceHeld = true;
    }
    emitKeyIfChanged(e);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (isSpace(e)) {
      e.preventDefault();
      spaceHeld = false;
    }
    emitKeyIfChanged(e);
  };

  /**
   * Drain every latched input to a clean slate (Law 2: enqueue only). Called on
   * window blur AND on detach: the browser delivers no more pointerups/keyups
   * once we blur, and detaching mid-gesture (unmounting the canvas while the
   * engine outlives it) must not strand an Active drag / held buttons / latched
   * modifiers in the world for a remount of the same engine to resurrect. Also
   * clears the deferred-capture `live` map so no per-pointer tracking survives.
   */
  const cancelAllInput = (): void => {
    // The browser will not deliver pointerups once we lose focus — cancel every
    // still-down pointer so no gesture is stranded Active (design-003 §8).
    for (const [id, s] of live) {
      queue.enqueue({ kind: "cancel", pointerId: id, device: s.device, screenX: s.x, screenY: s.y, buttons: 0, mods: { ...NO_MODS, space: spaceHeld } });
    }
    live.clear();
    // Modifier keyups are also lost on blur — ENQUEUE the clearing fact, or
    // the world's Keyboard resource stays latched (space-stuck: every canvas
    // drag pans forever). Clearing only local state was the bug: lastMods
    // already saying "space up" suppressed the next emitKeyIfChanged too.
    spaceHeld = false;
    if (lastMods.space || lastMods.shift || lastMods.ctrl || lastMods.alt || lastMods.meta) {
      lastMods = { ...NO_MODS };
      queue.enqueue({
        kind: "key",
        pointerId: "",
        device: "mouse",
        screenX: 0,
        screenY: 0,
        buttons: 0,
        mods: { ...NO_MODS },
      });
    }
  };

  const onBlur = (): void => {
    cancelAllInput();
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("wheel", onWheel, { passive: false });
  view?.addEventListener("keydown", onKeyDown);
  view?.addEventListener("keyup", onKeyUp);
  view?.addEventListener("blur", onBlur);

  return () => {
    // Sweep first (a detach can land mid-gesture) — same clean-slate cancel as
    // blur; facts drain on the engine's next step. Then unwire the listeners.
    cancelAllInput();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerCancel);
    container.removeEventListener("wheel", onWheel);
    view?.removeEventListener("keydown", onKeyDown);
    view?.removeEventListener("keyup", onKeyUp);
    view?.removeEventListener("blur", onBlur);
  };
}
