/**
 * The ECS Observer — strata-ecs's FIRST-PARTY tools panel (James's rule: base
 * on strata's tools, never invent a parallel one). `attachObserver` brings the
 * whole thing: entities tab (virtualized live list + component/tag/relation
 * detail), systems tab (per-system µs + run/skip idle%, fed by the core's
 * WorldObserver telemetry — armed only while attached), timeline tab (canvas
 * waterfall of every entity's birth→death via strata's lifecycle hooks, so
 * even one-tick entities appear), draggable/resizable/collapsible window with
 * persisted layout. The app supplies ONLY the identity-off-composition
 * `describe` fn (./describe — v2's labels + colors on the v3 vocabulary).
 */
import type { World } from "@ice/core";
import { attachObserver } from "@vibecook/strata-ecs/tools";
import { useEffect } from "react";
import { describeEntity } from "./describe";

export function ObserverPanel({ world }: { world: World }) {
  useEffect(() => {
    const obs = attachObserver(world, { describe: describeEntity, defaultTab: "entities" });
    return () => obs.dispose();
  }, [world]);
  return null;
}
