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
import { defineComponent, defineRelation, defineTag } from "../schema/meta";

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

/** Button bitmask + the screen point where the current press began. */
export const PointerButtons = defineComponent("PointerButtons", {
  buttons: field("u8", { default: 0 }),
  downX: field("f32", { default: 0 }),
  downY: field("f32", { default: 0 }),
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

/** Marks the local device's pointer(s) (vs. presence projections). */
export const LocalPointer = defineTag("LocalPointer");

/** Derive-owned world position — screen × camera, recomputed every tick. */
export const PointerWorld = defineComponent("PointerWorld", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
});

/** pointer → hovered entity (radiused pick — "hover is forgiving"). */
export const Targets = defineRelation("Targets", { arity: "one" });

/** pointer → r=0 point-pick target ("grab is precise"). */
export const TouchesExact = defineRelation("TouchesExact", { arity: "one" });
