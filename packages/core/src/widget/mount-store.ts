/**
 * Widget lifecycle: cull → keep-mounted LRU → the external mount store
 * (design-004 §2).
 *
 * - `cullSystem` (derive): viewport test over equipped widgets' EFFECTIVE size
 *   (MeasuredSize where present, else Size), overscan scaled by zoom; flips
 *   Visible/Culled CHANGE-ONLY. GATED (2026-07-15, the activeMembership
 *   playbook): a real `runIf` — camera/viewport window compare as the `extra`
 *   trigger (full pass; the window moved under everyone) ∨ a petition-7
 *   collector on Position/Size/MeasuredSize + Active flips (delta pass —
 *   drags/spawns/measures re-test only the journaled entities). Idle frames
 *   skip; camera frames stay O(active) by the widgetQ Active scope.
 * - `mountSystem` (derive, after cull): maintains the mount list — every
 *   Visible widget is mounted; Culled widgets stay mounted-but-hidden
 *   (`display:none` at the host; React state preserved) within a count LRU
 *   budget (default RUNTIME_BUDGETS.keepMountedWidgets); beyond it the
 *   least-recently-visible unmount for real. Decisions are ENGINE-side; the
 *   dom host reflector and the React portal hook both consume the snapshot.
 *   GATED the same way on Visible/Culled flips (+ destroys of tagged
 *   widgets); LRU recency is stamped at the flip (identical eviction order —
 *   "last tick seen visible" = the tick it stopped being visible).
 * - The store implements the `useSyncExternalStore` contract: `subscribe` /
 *   `getSnapshot` with snapshot identity changing IFF membership or a hidden
 *   flag changed. Listener notification is deferred to post-notify (the
 *   engine flush reflector) — never from inside the tick.
 */
import { Not, defineQuery, defineTickSystem, type Entity, type TickSystem, type World } from "@vibecook/strata-ecs";
import { screenToWorld } from "@ice/kernel";
import { Active, Camera, Culled, MeasuredSize, Position, Size, Viewport, Visible } from "../catalog";
import type { Engine } from "../engine/engine";
import { RUNTIME_BUDGETS } from "../settings/defaults";
import { WidgetEquipped } from "./define-widget";
import { createWidgetEquipSystem } from "./equip";
import { createBreakpointSystem } from "../systems/chrome";
import { createActiveMembership, currentNavFrame } from "../nav/nested-canvas";
import { createMeasureIngest } from "../systems/measure-ingest";
import type { MeasureQueue } from "../input/measure-queue";
import { makeChurnGuard } from "../helpers/churn-guard";

const widgetQ = defineQuery([Position, Size, WidgetEquipped, Active]);

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
  readonly cullSystem: TickSystem;
  readonly mountSystem: TickSystem;
  /** Post-notify listener flush — install registers it as a reflector. */
  flush(): void;
}

export function createWidgetRuntime(
  world: World,
  opts: { keepMounted?: number } = {},
): WidgetRuntime {
  const budget = opts.keepMounted ?? RUNTIME_BUDGETS.keepMountedWidgets;

  // Camera/viewport window compare — the cull gate's `extra` trigger. Kept
  // outside the guard so the closure caches the last-seen window verbatim
  // (undefined-ness included: the headless posture compares equal and never
  // fires; the first real camera write fires a full pass).
  let lastWin: { x: number; y: number; zoom: number; w: number; h: number } | undefined | null = null;
  // NAV DEFERRAL (field bug 2026-07-17, the folder-zombie): on the tick a nav
  // op lands, activeMembership strips Active from the departing frame's
  // widgets IN THE SAME TICK cull's full pass runs — and tag flips flush at
  // the group boundary, so cull classifies against STALE Active tags and the
  // FLIGHT-START window (which can span the old frame's coords). A widget
  // culled at root then re-tags Visible while ¬Active is a ZOMBIE: rendered,
  // unpickable, repaired by nobody (membership sees no input churn; cull only
  // touches Active). So: the nav tick SKIPS classification entirely and the
  // NEXT tick runs a forced full pass against the flushed membership.
  let lastNavFrame: Entity | undefined;
  let navPrimed = false;
  let navSkipTick = false;
  let navHoldFull = false;
  const cullGuard = makeChurnGuard(
    world,
    { components: [Position, Size, MeasuredSize], tags: [Active], coarse: false },
    () => {
      const frame = currentNavFrame(world);
      if (!navPrimed || frame !== lastNavFrame) {
        navPrimed = true;
        lastNavFrame = frame;
        navSkipTick = true;
        navHoldFull = true;
      }
      const cam = world.getResource(Camera);
      const vp = world.getResource(Viewport);
      const win =
        cam === undefined || vp === undefined
          ? undefined
          : { x: cam.x, y: cam.y, zoom: cam.zoom, w: vp.w, h: vp.h };
      const changed =
        lastWin === null ||
        (win === undefined) !== (lastWin === undefined) ||
        (win !== undefined &&
          lastWin !== undefined &&
          lastWin !== null &&
          (win.x !== lastWin.x || win.y !== lastWin.y || win.zoom !== lastWin.zoom || win.w !== lastWin.w || win.h !== lastWin.h));
      lastWin = win;
      // Nav ticks fire the gate regardless: the skip tick must consume the
      // guard (dropping its delta is safe — the held full pass covers it) and
      // the following tick must run even if camera/journal are quiet.
      if (navSkipTick || navHoldFull) return true;
      return changed;
    },
  );

  const cullSystem = defineTickSystem(
    (ctx) => {
      const work = cullGuard.take();
      if (work === undefined) return;
      if (navSkipTick) {
        // The nav tick: membership's Active flips flush at this group's
        // boundary — classify next tick (navHoldFull), never against stale tags.
        navSkipTick = false;
        return;
      }
      const forcedFull = navHoldFull;
      navHoldFull = false;
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
      const classify = (e: Entity): void => {
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
      };
      if (work.full || forcedFull) {
        ctx.query(widgetQ).each((b) => {
          for (const r of b) classify(b.entity(r));
        });
        return;
      }
      for (const e of work.changed) {
        // The delta twin of widgetQ: equipped ∧ Active (membership already
        // parks non-Active in the canonical Culled state — never touch them).
        if (!ctx.isAlive(e) || !ctx.hasTag(e, Active)) continue;
        if (!world.hasTag(e, WidgetEquipped) || !ctx.has(e, Position) || !ctx.has(e, Size)) continue;
        classify(e);
      }
    },
    { name: "cull", access: { read: [Position, Size, MeasuredSize] }, runIf: cullGuard.runIf },
  );

  // --- mount bookkeeping (engine-side LRU; closure state is derived cache) ---
  const mounted = new Map<Entity, { hidden: boolean }>();
  const lastVisibleTick = new Map<Entity, number>();
  let tickCounter = 0;
  let snapshot: readonly MountEntry[] = [];
  let dirty = false;
  const listeners = new Set<() => void>();

  const visibleWidgetsQ = defineQuery([Position, Size, WidgetEquipped, Active, Visible]);
  const culledWidgetsQ = defineQuery([Position, Size, WidgetEquipped, Not(Visible)]);

  // GATED tick system (2026-07-15): Visible/Culled flips journal the entity;
  // destroys of tagged widgets land in `removed` (every mounted widget carries
  // one of the two tags). Idle frames skip. LRU recency stamps at the flip —
  // "last tick seen visible" = the tick it stopped being visible, so the
  // eviction order matches the old refresh-every-frame bookkeeping.
  const mountGuard = makeChurnGuard(world, { tags: [Visible, Culled], coarse: false });

  const mountSystem = defineTickSystem(
    (ctx) => {
      const work = mountGuard.take();
      if (work === undefined) return;
      tickCounter += 1;
      let changed = false;

      const markVisible = (e: Entity): void => {
        lastVisibleTick.set(e, tickCounter);
        const entry = mounted.get(e);
        if (entry === undefined) {
          mounted.set(e, { hidden: false });
          changed = true;
        } else if (entry.hidden) {
          entry.hidden = false;
          changed = true;
        }
      };
      const markHidden = (e: Entity): void => {
        const entry = mounted.get(e);
        if (entry !== undefined && !entry.hidden) {
          entry.hidden = true;
          lastVisibleTick.set(e, tickCounter); // visible until THIS tick
          changed = true;
        }
      };

      if (work.full) {
        // Full reconcile: first run, reset (doc switch — every handle dead),
        // coarse. Queries + the isAlive sweep rebuild the map from scratch.
        ctx.query(visibleWidgetsQ).each((vb) => {
          for (const r of vb) markVisible(vb.entity(r));
        });
        ctx.query(culledWidgetsQ).each((cb) => {
          for (const r of cb) markHidden(cb.entity(r));
        });
        for (const e of [...mounted.keys()]) {
          if (!world.isAlive(e)) {
            mounted.delete(e);
            lastVisibleTick.delete(e);
            changed = true;
          }
        }
      } else {
        for (const e of work.removed) {
          if (mounted.delete(e)) changed = true;
          lastVisibleTick.delete(e);
        }
        for (const e of work.changed) {
          if (!world.isAlive(e)) continue; // removed handles it
          // Active required, matching visibleWidgetsQ (defense in depth vs the
          // nav-tick zombie: a stray Visible on a non-member must never mount).
          if (ctx.hasTag(e, Visible) && ctx.hasTag(e, Active)) markVisible(e);
          else markHidden(e);
        }
      }

      // Keep-mounted LRU budget (only reachable when something flipped).
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
    { name: "widgetMount", runIf: mountGuard.runIf },
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
    createActiveMembership(engine.world), // membership BEFORE cull (design-004 §7)
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
