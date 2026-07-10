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
import { Not, defineQuery, defineSystem, type System } from "@vibecook/strata-ecs";
import { PrefabId } from "../schema/prefab";
import { WidgetEquipped, widgets } from "./define-widget";

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
        }
        ctx.addTag(e, WidgetEquipped);
      }
    },
    { name: "widgetEquip" },
  );
}
