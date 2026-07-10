/**
 * Widget lifecycle: cull → keep-mounted LRU → the external mount store
 * (design-004 §2).
 *
 * - `cullSystem` (derive): viewport test over equipped widgets' EFFECTIVE size
 *   (MeasuredSize where present, else Size), overscan scaled by zoom; flips
 *   Visible/Culled CHANGE-ONLY.
 * - `mountSystem` (derive, after cull): maintains the mount list — every
 *   Visible widget is mounted; Culled widgets stay mounted-but-hidden
 *   (`display:none` at the host; React state preserved) within a count LRU
 *   budget (default RUNTIME_BUDGETS.keepMountedWidgets); beyond it the
 *   least-recently-visible unmount for real. Decisions are ENGINE-side; the
 *   dom host reflector and the React portal hook both consume the snapshot.
 * - The store implements the `useSyncExternalStore` contract: `subscribe` /
 *   `getSnapshot` with snapshot identity changing IFF membership or a hidden
 *   flag changed. Listener notification is deferred to post-notify (the
 *   engine flush reflector) — never from inside the tick.
 */
import { Not, defineQuery, defineSystem, type Entity, type System, type World } from "@vibecook/strata-ecs";
import { screenToWorld } from "@ice/kernel";
import { Camera, Culled, MeasuredSize, Position, Size, Viewport, Visible } from "../catalog";
import type { Engine } from "../engine/engine";
import { RUNTIME_BUDGETS } from "../settings/defaults";
import { WidgetEquipped } from "./define-widget";
import { createWidgetEquipSystem } from "./equip";
import { createBreakpointSystem } from "../systems/chrome";
import { createMeasureIngest } from "../systems/measure-ingest";
import type { MeasureQueue } from "../input/measure-queue";

const widgetQ = defineQuery([Position, Size, WidgetEquipped]);

export interface MountEntry {
  readonly entity: Entity;
  /** Culled-but-kept-mounted: host hides, React state survives. */
  readonly hidden: boolean;
}

export interface WidgetMountStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly MountEntry[];
}

export interface WidgetRuntime {
  readonly store: WidgetMountStore;
  readonly cullSystem: System;
  readonly mountSystem: System;
  /** Post-notify listener flush — install registers it as a reflector. */
  flush(): void;
}

export function createWidgetRuntime(
  world: World,
  opts: { keepMounted?: number } = {},
): WidgetRuntime {
  const budget = opts.keepMounted ?? RUNTIME_BUDGETS.keepMountedWidgets;

  const cullSystem = defineSystem(
    widgetQ,
    (b, ctx) => {
      const cam = ctx.getResource(Camera);
      const vp = ctx.getResource(Viewport);
      if (cam === undefined || vp === undefined || vp.w === 0) return; // headless: everything stays unculled
      const over = RUNTIME_BUDGETS.cullOverscanWorldPerZoom / cam.zoom;
      const tl = screenToWorld(0, 0, cam);
      const br = screenToWorld(vp.w, vp.h, cam);
      const minX = tl.x - over;
      const minY = tl.y - over;
      const maxX = br.x + over;
      const maxY = br.y + over;
      for (const r of b) {
        const e = b.entity(r);
        const p = ctx.read(e, Position);
        const m = ctx.get(e, MeasuredSize);
        const s = m !== undefined && m.w > 0 ? m : ctx.read(e, Size); // effective size
        const inView = p.x + s.w >= minX && p.x <= maxX && p.y + s.h >= minY && p.y <= maxY;
        // Change-only flips (hygiene, design-002 §4).
        if (inView) {
          if (!ctx.hasTag(e, Visible)) {
            ctx.addTag(e, Visible);
            if (ctx.hasTag(e, Culled)) ctx.removeTag(e, Culled);
          }
        } else if (!ctx.hasTag(e, Culled)) {
          ctx.addTag(e, Culled);
          if (ctx.hasTag(e, Visible)) ctx.removeTag(e, Visible);
        }
      }
    },
    { name: "cull" },
  );

  // --- mount bookkeeping (engine-side LRU; closure state is derived cache) ---
  let reconciledThisTick = false;
  const mounted = new Map<Entity, { hidden: boolean }>();
  const lastVisibleTick = new Map<Entity, number>();
  let tickCounter = 0;
  let snapshot: readonly MountEntry[] = [];
  let dirty = false;
  const listeners = new Set<() => void>();

  const visibleWidgetsQ = defineQuery([Position, Size, WidgetEquipped, Visible]);
  const culledWidgetsQ = defineQuery([Position, Size, WidgetEquipped, Not(Visible)]);

  const mountSystem = defineSystem(
    widgetQ,
    (b) => {
      if (b.count === 0) return;
      // Anchor-style single pass per frame: the first non-empty chunk drives a
      // full reconcile via world queries (widgetQ can span archetypes; per-chunk
      // incremental bookkeeping would double-run — one total pass is simpler
      // and O(widgets)).
      if (reconciledThisTick) return;
      reconciledThisTick = true;
      tickCounter += 1;
      let changed = false;

      world.query(visibleWidgetsQ).each((vb) => {
        for (const r of vb) {
          const e = vb.entity(r);
          lastVisibleTick.set(e, tickCounter);
          const entry = mounted.get(e);
          if (entry === undefined) {
            mounted.set(e, { hidden: false });
            changed = true;
          } else if (entry.hidden) {
            entry.hidden = false;
            changed = true;
          }
        }
      });
      world.query(culledWidgetsQ).each((cb) => {
        for (const r of cb) {
          const e = cb.entity(r);
          const entry = mounted.get(e);
          if (entry !== undefined && !entry.hidden) {
            entry.hidden = true;
            changed = true;
          }
        }
      });
      // Sweep dead entities + enforce the keep-mounted LRU budget.
      for (const e of [...mounted.keys()]) {
        if (!world.isAlive(e)) {
          mounted.delete(e);
          lastVisibleTick.delete(e);
          changed = true;
        }
      }
      const hiddenEntries = [...mounted.entries()].filter(([, v]) => v.hidden);
      const visibleCount = mounted.size - hiddenEntries.length;
      const hiddenBudget = Math.max(0, budget - visibleCount);
      if (hiddenEntries.length > hiddenBudget) {
        hiddenEntries.sort((a, b2) => (lastVisibleTick.get(a[0]) ?? 0) - (lastVisibleTick.get(b2[0]) ?? 0));
        for (const [e] of hiddenEntries.slice(0, hiddenEntries.length - hiddenBudget)) {
          mounted.delete(e); // true unmount — session UI state is best-effort
          lastVisibleTick.delete(e);
          changed = true;
        }
      }

      if (changed) {
        snapshot = [...mounted.entries()].map(([entity, v]) => ({ entity, hidden: v.hidden }));
        dirty = true;
      }
    },
    { name: "widgetMount" },
  );

  return {
    store: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
    },
    cullSystem,
    mountSystem,
    flush() {
      reconciledThisTick = false; // re-arm for the next frame
      if (!dirty) return;
      dirty = false;
      for (const l of listeners) l();
    },
  };
}

/** Install cull + mount + the post-notify listener flush on an engine. */
export function installWidgetRuntime(
  engine: Engine,
  opts: { keepMounted?: number; measureQueue?: MeasureQueue } = {},
): WidgetRuntime & { uninstall(): void } {
  const runtime = createWidgetRuntime(engine.world, opts);
  // equip → cull → mount → breakpoint (equip's deferred tags land at the
  // derive flush, so a brand-new widget mounts one frame after projection —
  // accepted lag). Breakpoints ship installed (review: built but orphaned).
  const removeSystems = engine.addSystems(
    "derive",
    createWidgetEquipSystem(),
    runtime.cullSystem,
    runtime.mountSystem,
    createBreakpointSystem(engine.world),
  );
  // Measurement ingest (input phase) when the app wires a measure queue
  // (the dom measure adapter feeds it; design-004 §2).
  const removeMeasure =
    opts.measureQueue !== undefined
      ? engine.addSystems("input", createMeasureIngest(engine.world, opts.measureQueue))
      : undefined;
  const removeReflector = engine.registerReflector({
    name: "widgetMountFlush",
    always: true, // cheap: a dirty-flag check; listener fan-out only on change
    flush: () => runtime.flush(),
  });
  return {
    ...runtime,
    uninstall() {
      removeSystems();
      removeMeasure?.();
      removeReflector();
    },
  };
}
