/**
 * WidgetRoot — portals from ONE app root (design-004 §2).
 *
 * Portal-list membership (mount/unmount/evict) is owned HERE, by React,
 * subscribed to the engine's mount store via `useSyncExternalStore`; the
 * imperative dom-widgets reflector owns only the host DIVs. Eviction is
 * decided engine-side (LRU derive) and merely consumed. Each mounted entry
 * portals its widget type's component (from the defineWidget registry) into
 * the host's content element; hidden entries stay mounted (React state
 * preserved — cull ≠ unmount) inside a `WidgetHiddenContext` so their prop
 * subscriptions freeze (design-004 §2).
 *
 * A host div may not exist yet on the very first snapshot after mount (the
 * host reflector runs in the same post-notify pass, ordered by reflector
 * registration) — entries without a host render nothing this pass and pick
 * up on the next notification.
 */
import { PrefabId, widgets, type Entity, type World, type WidgetMountStore } from "@ice/core";
import { createElement, type ComponentType, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import { WidgetHiddenContext } from "./hooks";

export interface WidgetHosts {
  /** The dom-widgets reflector's lookup (content element per entity). */
  hostFor(entity: Entity): HTMLElement | undefined;
}

export interface WidgetRootProps {
  readonly world: World;
  readonly store: WidgetMountStore;
  readonly hosts: WidgetHosts;
}

export interface WidgetComponentProps {
  readonly entity: Entity;
  readonly world: World;
}

export function WidgetRoot({ world, store, hosts }: WidgetRootProps): ReactElement {
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const portals: ReactElement[] = [];
  for (const entry of entries) {
    if (!world.isAlive(entry.entity)) continue;
    const type = world.get(entry.entity, PrefabId)?.id;
    const widget = typeof type === "string" ? widgets.get(type) : undefined;
    if (widget === undefined || widget.surface !== "dom") continue;
    const target = hosts.hostFor(entry.entity);
    if (target === undefined) continue; // host lands next pass
    const View = widget.component as ComponentType<WidgetComponentProps>;
    if (View == null) continue;
    portals.push(
      createPortal(
        createElement(
          WidgetHiddenContext.Provider,
          { value: entry.hidden },
          createElement(View, { entity: entry.entity, world }),
        ),
        target,
        String(entry.entity),
      ),
    );
  }
  return createElement("div", { "data-ice-widget-root": "" }, portals);
}
