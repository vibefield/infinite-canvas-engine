/**
 * The input queue — the ONE input path's front door (Law 2, design-003 §2).
 *
 * Adapters (DOM pointer/wheel/keyboard, R3F router verdicts, test drivers) ONLY
 * enqueue normalized {@link InputEvent}s; `pointerIngest` drains the queue once
 * per tick and turns events into world facts. Handlers run mid-frame at
 * arbitrary times — the queue is what keeps every world write inside the frame
 * contract (design-002 §3). It is pre-ingest TRANSPORT, not world state: no
 * system reads it, nothing observes it, it holds nothing across a drain.
 *
 * Pointer identity: `pointerId` is the adapter's stable string for a device
 * pointer — `"mouse"` for the one mouse, `"touch:<n>"` per touch contact,
 * `"pen"` for a stylus. Ingest keys pointer entities off it (`Pointer.id`).
 */

export type InputEventKind = "down" | "move" | "up" | "cancel" | "wheel" | "key";

export interface InputMods {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  /** Space-held (pan gesture modifier, design-003 §4.4) — not a PointerMods field. */
  readonly space: boolean;
}

export interface InputEvent {
  readonly kind: InputEventKind;
  /** Stable adapter pointer id ("mouse" | "touch:<n>" | "pen"). Empty for kind:"key". */
  readonly pointerId: string;
  readonly device: "mouse" | "touch" | "pen";
  /** Canvas-container-relative CSS px (the kernel screen space). */
  readonly screenX: number;
  readonly screenY: number;
  /** Button bitmask as of this event (PointerEvent.buttons semantics). */
  readonly buttons: number;
  readonly mods: InputMods;
  /** Wheel deltas for kind:"wheel" (`pinch` = ctrl-wheel / trackpad zoom signal). */
  readonly wheel?: { readonly dx: number; readonly dy: number; readonly pinch: number };
  /** GL-island opt-out (pinned widget-event contract, design-002 §8): fact still lands, recognizers skip. */
  readonly surfaceHandled?: boolean;
}

export const NO_MODS: InputMods = { shift: false, ctrl: false, alt: false, meta: false, space: false };

export interface InputQueue {
  enqueue(event: InputEvent): void;
  /** Drain in arrival order. Called ONLY by `pointerIngest`, once per tick. */
  drain(): readonly InputEvent[];
  /** Events waiting (telemetry/tests). */
  size(): number;
}

export function createInputQueue(): InputQueue {
  let buffer: InputEvent[] = [];
  return {
    enqueue(event) {
      buffer.push(event);
    },
    drain() {
      const drained = buffer;
      buffer = [];
      return drained;
    },
    size() {
      return buffer.length;
    },
  };
}
