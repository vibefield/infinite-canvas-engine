/**
 * Pointers — the L0 runtime pointer prefab (design-001 §5.4, design-003 §2).
 *
 * Pointers are dumb: recognizers own the FSM. Hover is the pointer's outgoing
 * `Targets` edge (no widget-side Hovered tag — one fact, one owner). Transition
 * detection uses one-tick tags (`WentDown`/`WentUp`/`WentCancelled`) written by
 * ingest and cleared in the cleanup phase.
 *
 * Defaults policy (see catalog/index.ts): identity fields ingest always supplies
 * stay bare (Pointer.id/device); per-frame value writes and the remote-owner id
 * carry ergonomic zero/empty defaults.
 */
import { enumOf, field } from "@vibecook/strata-ecs";
import { defineComponent, defineRelation, defineResource, defineTag } from "../schema/meta";

/** Pointer identity. `owner` is the peer/user id ("" for the local device). */
export const Pointer = defineComponent("Pointer", {
  id: "string",
  device: enumOf(["mouse", "touch", "pen"]),
  owner: field("string", { default: "" }),
});

/** Screen-space position, CSS px. */
export const PointerScreen = defineComponent("PointerScreen", {
  x: field("f32", { default: 0 }),
  y: field("f32", { default: 0 }),
});

/** Button bitmask + the screen point/time where the current press began. */
export const PointerButtons = defineComponent("PointerButtons", {
  buttons: field("u8", { default: 0 }),
  downX: field("f32", { default: 0 }),
  downY: field("f32", { default: 0 }),
  /** The down EVENT's timestamp (0 = unknown ⇒ consumers fall back to frame now). */
  downMs: field("f64", { default: 0 }),
});

/** Keyboard modifiers latched with the pointer sample. */
export const PointerMods = defineComponent("PointerMods", {
  shift: field("bool", { default: false }),
  ctrl: field("bool", { default: false }),
  alt: field("bool", { default: false }),
  meta: field("bool", { default: false }),
});

/** Wheel deltas — accumulate within a tick, zeroed in cleanup. `pinch` is the ctrl-wheel zoom signal. */
export const PointerWheel = defineComponent("PointerWheel", {
  dx: field("f32", { default: 0 }),
  dy: field("f32", { default: 0 }),
  pinch: field("f32", { default: 0 }),
});

/** Touch-forgiveness radius, screen px (0 = exact, for mouse/pen). */
export const PointerRadius = defineComponent("PointerRadius", { r: field("f32", { default: 0 }) });

/** One-tick: pointer went down this tick (cleared in cleanup). */
export const WentDown = defineTag("WentDown");

/** One-tick: pointer went up this tick. */
export const WentUp = defineTag("WentUp");

/** One-tick: pointer was cancelled this tick (pointercancel / touch lost / blur). */
export const WentCancelled = defineTag("WentCancelled");

/** The down was consumed by a widget's own DOM handler — recognizers skip it. */
export const HandledByWidget = defineTag("HandledByWidget");

/**
 * PERSISTENT (not one-tick): the pointer is hovering content that would opt a
 * down out — a native interactive / `[data-canvas-interactive]` (DOM) or
 * claim-capable island content (GL). Written change-only by ingest from the
 * adapters' hover-time `overInteractive` fact (design-002 §8 amendment,
 * 2026-07-18) and held across ticks with no fresh hover information (wheel,
 * blur). Presentation-grade truth — cursor affordances telegraph "the widget
 * owns your input here" BEFORE the down; recognizers never read it (the
 * gesture gate stays `HandledByWidget`).
 */
export const OverInteractive = defineTag("OverInteractive");

/** Marks the local device's pointer(s) (vs. presence projections). */
export const LocalPointer = defineTag("LocalPointer");

/** Derive-owned world position — screen × camera, recomputed every tick. */
export const PointerWorld = defineComponent("PointerWorld", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
});

/**
 * Keyboard modifier state (design-003 §2 — minimal keyboard). Written by ingest
 * from adapter key events. `space` is the pan gesture modifier (design-003 §4.4);
 * shortcuts are app handlers between frames, never a tick system.
 */
export const Keyboard = defineResource("Keyboard", {
  shift: field("bool", { default: false }),
  ctrl: field("bool", { default: false }),
  alt: field("bool", { default: false }),
  meta: field("bool", { default: false }),
  space: field("bool", { default: false }),
});

/**
 * ONE-TICK cancel request (design-003 §4.1/§8): escape / tool switch / doc
 * detach all converge here via `cancelActiveGestures()`. The ctl:spawn sweep
 * consumes it; cleanup clears it — a latched cancel would kill every future
 * gesture forever.
 */
export const CancelRequest = defineResource("CancelRequest", {
  active: field("bool", { default: false }),
});

/** pointer → hovered entity (radiused pick — "hover is forgiving"). */
export const Targets = defineRelation("Targets", { arity: "one" });

/** pointer → r=0 point-pick target ("grab is precise"). */
export const TouchesExact = defineRelation("TouchesExact", { arity: "one" });
