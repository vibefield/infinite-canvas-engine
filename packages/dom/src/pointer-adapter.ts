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
 */
import { NO_MODS, type InputEvent, type InputMods, type InputQueue } from "@ice/core";
import type { CanvasHost } from "./host";

/** DOM_DELTA_LINE → px (one wheel "line" ≈ 16px; matches typical browser mapping). */
const WHEEL_LINE_PX = 16;

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

export function attachPointerAdapter(host: CanvasHost, queue: InputQueue): () => void {
  const { container } = host;
  const view = container.ownerDocument.defaultView;

  let spaceHeld = false;
  // Pointers currently down — for the blur-cancel sweep (id → last sample).
  const live = new Map<string, { device: InputEvent["device"]; x: number; y: number }>();
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
    live.set(id, { device, x, y });
    if (typeof container.setPointerCapture === "function") {
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // capture is best-effort — a detached or unsupported target must not throw here.
      }
    }
    queue.enqueue({ kind: "down", pointerId: id, device, screenX: x, screenY: y, buttons: e.buttons, mods: pointerMods(e) });
  };

  const onPointerMove = (e: PointerEvent): void => {
    const id = pointerIdOf(e);
    const device = deviceOf(e);
    const { x, y } = relative(e.clientX, e.clientY);
    const seen = live.get(id);
    if (seen !== undefined) {
      seen.x = x;
      seen.y = y;
    }
    queue.enqueue({ kind: "move", pointerId: id, device, screenX: x, screenY: y, buttons: e.buttons, mods: pointerMods(e) });
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
      queue.enqueue({ kind, pointerId: id, device, screenX: x, screenY: y, buttons: e.buttons, mods: pointerMods(e) });
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

  const onBlur = (): void => {
    // The browser will not deliver pointerups once we lose focus — cancel every
    // still-down pointer so no gesture is stranded Active (design-003 §8).
    for (const [id, s] of live) {
      queue.enqueue({ kind: "cancel", pointerId: id, device: s.device, screenX: s.x, screenY: s.y, buttons: 0, mods: { ...NO_MODS, space: spaceHeld } });
    }
    live.clear();
    if (spaceHeld) {
      spaceHeld = false;
      lastMods = { ...lastMods, space: false };
    }
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
