/**
 * The widget equip system (design-005 §2 "capability-tag stamping recipe",
 * design-001 reconciled catalog).
 *
 * Capability tags are RUNTIME state — a restored/remote document carries only
 * durable cells, so every projected widget entity gets its type's tags stamped
 * here, once (`WidgetEquipped` makes the query zero-match at steady state:
 * row-filtered, nothing runs, nothing stamps). Runs in `derive`; new
 * projections from this frame's sync() are visible by then.
 *
 * This generalizes the graybox demo's equipSceneBoxes into the engine.
 */
import { Not, defineQuery, defineSystem, type Component, type System } from "@vibecook/strata-ecs";
import type { AnyBehaviorDef } from "../behavior/types";
import { PrefabId } from "../schema/prefab";
import { WidgetEquipped, widgets } from "./define-widget";

/** Defaults ∪ the declared pre-attach data, serialized for the cell. */
function runtimeBehaviorCell(b: AnyBehaviorDef, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(b.defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = b.schema[k]?.kind === "json" ? JSON.stringify(v) : v;
  }
  return out;
}

const unequippedQ = defineQuery([PrefabId, Not(WidgetEquipped)]);

export function createWidgetEquipSystem(): System {
  return defineSystem(
    unequippedQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        const type = ctx.read(e, PrefabId).id;
        const widget = typeof type === "string" ? widgets.get(type) : undefined;
        // Non-widget prefabs still get the Equipped mark so this row never
        // re-scans; widgets get their capability tags.
        if (widget !== undefined) {
          for (const tag of widget.capabilityTags) ctx.addTag(e, tag);
          // RUNTIME pre-attached behaviors (design-009 §6) are riders, exactly
          // like capability tags: session-local, and needed on every peer's
          // projection — including one that received this widget over the wire
          // or restored it from a file, neither of which ran its spawn path.
          for (const entry of widget.behaviors) {
            if (entry.behavior.store !== "runtime") continue;
            ctx.addComponent(
              e,
              entry.behavior.component as Component<Record<string, unknown>>,
              runtimeBehaviorCell(entry.behavior, entry.data),
            );
          }
        }
        ctx.addTag(e, WidgetEquipped);
      }
    },
    { name: "widgetEquip" },
  );
}
