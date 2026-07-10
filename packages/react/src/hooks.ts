/**
 * React hooks over the engine's Tier-3 reactivity (design-005 §2 hooks;
 * design-004 §2 frozen-hidden rule).
 *
 * Implemented directly on `world.reactive.observeValue` + `useSyncExternalStore`
 * rather than strata's own react module: core is react-free by law, so
 * strata/react cannot be re-exported through it — and the adapter is ~20
 * lines. Value semantics are strata Tier-3: equality-suppressed, fired at
 * notify(), never during the tick.
 *
 * FROZEN-HIDDEN: a widget inside a hidden (culled-but-kept-mounted) host must
 * not re-render on doc edits — `useWidgetProps` reads {@link WidgetHiddenContext}
 * (provided per-portal by WidgetRoot) and suspends its subscription while
 * hidden, serving the last snapshot; on show it resubscribes and refreshes.
 */
import {
  Selected,
  WidgetBreakpoint,
  defineQuery,
  widgets,
  type Component,
  type Entity,
  type World,
} from "@ice/core";
import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from "react";

/** Per-portal hidden flag (WidgetRoot provides it; defaults to live). */
export const WidgetHiddenContext = createContext(false);

const selectedQ = defineQuery([Selected]);

/** Shallow field equality — strata cells are flat field records. */
function shallowEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Tier-3 component value subscription (equality-suppressed). Snapshot
 * STABILITY is load-bearing: strata's `get()` materializes a fresh object per
 * read (SoA columns), and `useSyncExternalStore` treats a new reference as a
 * new snapshot — so reads go through a shallow-equality cache and only a real
 * field change yields a new reference.
 */
export function useWorldComponent<S>(world: World, entity: Entity, component: Component<S>): S | undefined {
  const hidden = useContext(WidgetHiddenContext);
  const last = useRef<S | undefined>(undefined);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (hidden) return () => {}; // frozen while hidden — no wakeups, no renders
      return world.reactive.observeValue(entity, component, onChange);
    },
    [world, entity, component, hidden],
  );
  const getSnapshot = useCallback(() => {
    if (hidden) return last.current; // stable snapshot while frozen
    const v = world.isAlive(entity) ? world.get(entity, component) : undefined;
    if (!shallowEq(v, last.current)) last.current = v;
    return last.current;
  }, [world, entity, component, hidden]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Typed props for one conflict group of a widget (design-005 §2). Group
 * component values come back whole; `p.json` fields are parsed. Identity is
 * stable per underlying group value (memo on the raw reference).
 */
export function useWidgetProps<T extends Record<string, unknown>>(
  world: World,
  entity: Entity,
  type: string,
  group = "props",
): T | undefined {
  const widget = widgets.get(type);
  const g = widget?.groups.find((x) => x.name === group);
  if (widget === undefined || g === undefined) {
    throw new Error(`ice: useWidgetProps — unknown widget type/group "${type}"/"${group}".`);
  }
  const raw = useWorldComponent(world, entity, g.component) as Record<string, unknown> | undefined;
  return useMemo(() => {
    if (raw === undefined) return undefined;
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(g.fields)) {
      const v = raw[name];
      out[name] = spec.kind === "json" && typeof v === "string" ? JSON.parse(v) : v;
    }
    return out as T;
  }, [raw, g]);
}

/** Selection membership (Tier-1 wake on Selected churn; O(1) snapshot). */
export function useSelected(world: World, entity: Entity): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => world.reactive.observeQuery(selectedQ, onChange),
    [world],
  );
  const getSnapshot = useCallback(
    () => world.isAlive(entity) && world.hasTag(entity, Selected),
    [world, entity],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** LOD tier (design-004 §8); "normal" until the breakpoint system stamps one. */
export function useBreakpoint(world: World, entity: Entity): string {
  const bp = useWorldComponent(world, entity, WidgetBreakpoint);
  return (bp as { tier?: string } | undefined)?.tier ?? "normal";
}
