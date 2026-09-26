/**
 * The widget runtime: the CULL (design-004 §2, what survives of it at design-015 D5b).
 *
 * - `cullSystem` (derive): viewport test over equipped widgets' `Size`, overscan
 *   scaled by zoom; flips Visible/Culled CHANGE-ONLY. GATED (2026-07-15, the
 *   activeMembership playbook): a real `runIf` — camera/viewport window compare
 *   as the `extra` trigger (full pass; the window moved under everyone) ∨ a
 *   petition-7 collector on Position/Size + Active flips (delta pass —
 *   drags/spawns re-test only the journaled entities). Idle frames skip; camera
 *   frames stay O(active) by the widgetQ Active scope. `Visible`/`Culled` is the
 *   desk renderer's WORKING SET: the builder walks the visible objects and the
 *   pick source answers for them.
 *
 * GONE at design-015 D5b: the mount system, its keep-mounted LRU, the
 * `useSyncExternalStore` snapshot, `retainForTransition` and the post-notify
 * listener flush — every one of them existed so a DOM host or a GL island could
 * stay mounted-but-hidden and be held across a nav crossfade. An object has no
 * view to mount; the desk draws it from the world (design-015 §1). The
 * facade's `runtime.store` went with them.
 */
import { defineQuery, defineTickSystem, type Entity, type TickSystem, type World } from "@vibecook/strata-ecs";
import { screenToWorld } from "@ice/kernel";
import { Active, Camera, Culled, Position, Size, Viewport, Visible } from "../catalog";
import type { Engine } from "../engine/engine";
import { RUNTIME_BUDGETS } from "../settings/defaults";
import { WidgetEquipped } from "./define-widget";
import { createWidgetEquipSystem } from "./equip";
import { createBreakpointSystem } from "../systems/chrome";
import { createActiveMembership, currentNavFrame } from "../nav/nested-canvas";
import { makeChurnGuard } from "../helpers/churn-guard";

const widgetQ = defineQuery([Position, Size, WidgetEquipped, Active]);

export interface WidgetRuntime {
  readonly cullSystem: TickSystem;
}

export function createWidgetRuntime(world: World): WidgetRuntime {
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
    { components: [Position, Size], tags: [Active], coarse: false },
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
        const s = ctx.read(e, Size);
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
    { name: "cull", access: { read: [Position, Size] }, runIf: cullGuard.runIf },
  );

  return { cullSystem };
}

/** Install membership → equip → cull → breakpoint on an engine. */
export function installWidgetRuntime(engine: Engine): WidgetRuntime & { uninstall(): void } {
  const runtime = createWidgetRuntime(engine.world);
  // equip → cull → breakpoint (equip's deferred tags land at the derive flush,
  // so a brand-new widget is classified one frame after projection — accepted
  // lag). Breakpoints ship installed (review: built but orphaned).
  const removeSystems = engine.addSystems(
    "derive",
    createActiveMembership(engine.world), // membership BEFORE cull (design-004 §7)
    createWidgetEquipSystem(engine.world),
    runtime.cullSystem,
    createBreakpointSystem(engine.world),
  );
  return {
    ...runtime,
    uninstall() {
      removeSystems();
    },
  };
}
