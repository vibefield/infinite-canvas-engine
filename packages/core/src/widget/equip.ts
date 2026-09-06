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
 * PRESENTATION FACTS ride the same path (2026-09-06, design-013 §5 / D2 / D4).
 * The six surface components are runtime riders exactly like capability tags
 * and pre-attached runtime behaviours: session-local, derivable from the widget
 * TYPE, and needed on every peer's projection — including one that received the
 * widget over the wire or restored it from a file, neither of which ran a spawn
 * path. Putting the kind in the durable prefab instead would sync a fact every
 * peer can compute from `PrefabId` (D4).
 *
 * They are added ONCE, here, and value-written thereafter. design-001 §7 bans
 * interaction-rate component add/remove, and a promote/demote per drag would
 * move the card's archetype twice per gesture; stamping the safe default at
 * equip is the `SnapState` discipline instead — essential at spawn, zeroed, so
 * the one writer named in §5 never races an attach. Structural `ctx.addComponent`
 * lands at the derive flush like the tags, so `present:infra` sees them in the
 * SAME frame. Non-widget prefabs (ports, ghosts, chrome) get none of the six.
 */
import { Not, defineQuery, defineSystem, type Component, type System, type World } from "@vibecook/strata-ecs";
import type { AnyBehaviorDef } from "../behavior/types";
import {
  RequestedDemand,
  SurfaceBand,
  SurfaceDemand,
  SurfaceKind,
  SurfaceTarget,
  TextureRef,
} from "../catalog/surface";
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
          // The presentation facts, at their safe defaults (design-013 D2).
          // Only the two the TYPE decides carry real values: the kind, and the
          // target that kind can actually present on. Everything else starts
          // claiming nothing — demand paused/0 so the clamp owes no uploads
          // before cull has spoken, band 0 ("never banded"), texture 0 (= no
          // destination, the NO_ENTITY precedent).
          ctx.addComponent(e, SurfaceKind, { kind: widget.surface });
          ctx.addComponent(e, SurfaceTarget, { target: widget.surface === "dom" ? "dom" : "gpu" });
          ctx.addComponent(e, RequestedDemand, { mode: "live", fpsBucket: 60, interactive: false });
          ctx.addComponent(e, SurfaceDemand, { mode: "paused", fpsBucket: 0, interactive: false });
          ctx.addComponent(e, SurfaceBand, { band: 0 });
          ctx.addComponent(e, TextureRef, { texture: 0, layer: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
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
