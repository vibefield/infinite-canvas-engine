/**
 * Selection & presence (design-001 §5.6) + capability tags (design-001 §5.8).
 *
 * Selection is a runtime rider (`Selected`) — local truth, queried not stored,
 * restored on undo via history hooks. It is broadcast as an ephemeral presence
 * facet (`SelectionSummary` — a capped summary, not a key dump). Capability tags
 * are runtime, re-derived per peer from the prefab's interaction profile so pack
 * differences can never corrupt the document.
 *
 * Defaults policy (see catalog/index.ts): presence identity strings (name/color/
 * device) stay bare — they must be real; numeric summary/cursor fields carry zero
 * defaults, and `keys` an empty JSON list.
 */
import { enumOf, field } from "@vibecook/strata-ecs";
import { defineComponent, defineTag } from "../schema/meta";

/** Runtime selection rider on widgets. */
export const Selected = defineTag("Selected");

// --- capability tags (runtime, stamped from the prefab interaction profile) ---

export const Selectable = defineTag("Selectable");
export const Movable = defineTag("Movable");
export const Resizable = defineTag("Resizable");
export const SnapSource = defineTag("SnapSource");
export const SnapTarget = defineTag("SnapTarget");

// --- ephemeral presence-peer prefab facets (components + tags only — no relations/resources) ---

/** Peer display identity. */
export const PresenceInfo = defineComponent("PresenceInfo", { name: "string", color: "string" });

/** Peer cursor in world coords. */
export const PresenceCursor = defineComponent("PresenceCursor", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  device: enumOf(["mouse", "touch", "pen"]),
});

/**
 * Selection broadcast: count + combined bbox + a JSON key list capped at 32 (peers outline the
 * listed widgets; beyond the cap they render the bbox only). Facet semantics: present only while the
 * selection is non-empty.
 */
export const SelectionSummary = defineComponent("SelectionSummary", {
  count: field("u16", { default: 0 }),
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
  w: field("f32", { default: 0 }),
  h: field("f32", { default: 0 }),
  keys: field("string", { default: "[]" }),
});
