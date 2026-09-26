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
 *
 * RIDERS take the same path — session-local facts derivable from the widget
 * TYPE and needed on every peer's projection, including one that received the
 * widget over the wire or restored it from a file, neither of which ran a spawn
 * path (design-013 D4: never sync what every peer can compute from `PrefabId`):
 * the desk `Stratum` (design-015 §4.2, D2a-core) and the type's runtime
 * pre-attached behaviours (design-009 §6). Structural `ctx.addComponent` lands
 * at the derive flush like the tags. Until design-015 D5b the six presentation
 * facts (`SurfaceKind` … `TextureRef`, design-013 §5) rode here too; they left
 * with the DOM/GPU presentation choice — an object presents on the desk and
 * nowhere else, so there is no kind to name, no target to choose and no texture
 * to reserve.
 */
import { Not, defineQuery, defineSystem, type Component, type System, type World } from "@vibecook/strata-ecs";
import type { AnyBehaviorDef } from "../behavior/types";
import { STRATUM_BANDS, Stratum } from "../catalog/desk";
import { widgetTypeFor } from "../canvas/engine-catalog";
import { PrefabId } from "../schema/prefab";
import { WidgetEquipped } from "./define-widget";

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

export function createWidgetEquipSystem(world: World): System {
  return defineSystem(
    unequippedQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        const type = ctx.read(e, PrefabId).id;
        const widget = typeof type === "string" ? widgetTypeFor(world, type) : undefined;
        // Non-widget prefabs still get the Equipped mark so this row never
        // re-scans; widgets get their capability tags.
        if (widget !== undefined) {
          for (const tag of widget.capabilityTags) ctx.addTag(e, tag);
          // The desk stratum (design-015 §4.2): every object (a `things` unless
          // it declared otherwise) and any other widget that declared one. A
          // rider like the tags — derivable from the type, stamped on every
          // peer's projection, never synced.
          if (widget.stratum !== undefined) {
            ctx.addComponent(e, Stratum, { band: STRATUM_BANDS[widget.stratum] });
          }
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
