/**
 * L1 — spatial sync + targeting (design-003 §3; `react` phase).
 *
 * Two systems, run in this order:
 *
 * `spatialSync` maintains the kernel `SpatialIndex` over every Position+Size
 * entity (widgets AND HandleSpec chrome — both carry a world AABB). It is a
 * TICK system (strata 0.5.0) so the body runs EVERY frame — it is the writer
 * that bumps
 * `SpatialVersion`, and its own writes have no version stamp to gate on
 * (design-002 §4), so it must run eagerly and stays cheap via a private
 * last-known cache: an entity is re-`upsert`ed only when its AABB actually
 * changed, and a cache-sweep removes entries no longer matched (despawns, or a
 * lost Position/Size). Materialized ports are M8 — skipped.
 *
 * Per-frame constant factors (2026-07-13 perf audit — this was the top
 * always-on system at 17µs/frame on an 18-widget board):
 *  - nav gating rides the QUERIES, not per-row `hasTag` calls: widgets match
 *    `[Position, Size, WidgetEquipped, Active]`, chrome matches
 *    `[Position, Size, Not(WidgetEquipped)]` — the union is exactly the old
 *    `!WidgetEquipped || Active` predicate, resolved at archetype level;
 *  - the sweep is a GENERATION stamp on cache entries (mutated in place),
 *    not a per-frame `seen` Set + `gone` array — zero steady-state
 *    allocations. The remaining idle cost is the O(N) compare walk; gating
 *    the WHOLE body needs a strata changed-since primitive (petition 7).
 *
 * `picking` runs the dual pick (design-003 §3), gated by a version guard over
 * `PointerVersion ∨ SpatialVersion`. `CameraVersion` does not exist — camera
 * motion alone does not re-pick, an accepted staleness (design-002 §2). Pointer
 * world position is derived from PointerScreen × Camera rather than the
 * PointerWorld cell: PointerWorld lags a frame on the pointer's spawn (the
 * pointerWorldSync writer cannot see a pointer spawned in the same input phase),
 * which would mis-capture on the down frame — screen×camera is exact here.
 *   - `Targets`      = radiused disc-vs-box pick with a screen-px release
 *                      dead-band (hover is forgiving; hold the current target
 *                      while the pointer stays within its expanded bounds).
 *   - `TouchesExact` = r=0 point pick (grab is precise; no dead-band).
 * Pick priority is plane priority: HandleSpec chrome first, then widgets by
 * StackZ descending, then the CanvasSurface entity as the guaranteed fallback
 * (design-001 §4). Relations are written change-only (design-002 §4 hygiene).
 * Wires/ports are M8 — skipped.
 */
import type { Batch, Entity, System, SystemCtx, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem, Not } from "@vibecook/strata-ecs";
import { SpatialIndex, screenToWorld, type CameraState } from "@ice/kernel";
import {
  Camera,
  CanvasSurface,
  HandledByWidget,
  LocalPointer,
  Pointer,
  PointerRadius,
  PointerScreen,
  Position,
  Size,
  Targets,
  TouchesExact,
} from "../catalog";
import { Active } from "../catalog/camera-derived";
import { WidgetEquipped } from "../widget/define-widget";
import { PointerVersion, SpatialVersion, bumpVersion, makeVersionGuard } from "../helpers/version-stamps";
import { distPointToBox, pickTopAt, type WirePickSource } from "../ops/point-pick";
import { PointerSettings } from "../catalog/settings-resources";
import { POINTER_DEFAULTS } from "../settings/defaults";

const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

const canvasSurfaceQ = defineQuery([CanvasSurface]);
// Nav gating at ARCHETYPE level (design-004 §7): the union of these two is
// exactly `Position+Size ∧ (¬WidgetEquipped ∨ Active)` — equipped widgets are
// hittable only while Active (in-frame); chrome/pre-equip entities always.
// Tags in the query beat per-row `hasTag` calls (2026-07-13 perf audit).
const widgetAabbQ = defineQuery([Position, Size, WidgetEquipped, Active]);
const chromeAabbQ = defineQuery([Position, Size, Not(WidgetEquipped)]);
const pointerQ = defineQuery([Pointer, PointerScreen, PointerRadius, LocalPointer, Not(HandledByWidget)]);

export interface PickingSystems {
  spatialSync: TickSystem;
  picking: System;
  /** The shared spatial index — snap/drop/marquee consume the SAME instance. */
  index: SpatialIndex<Entity>;
  /** Nav-op seam (design-004 §7): forget every last-known AABB so the next
   *  spatialSync pass repopulates the cleared index from the new Active set. */
  clearCaches(): void;
}

export function createPickingSystems(
  world: World,
  index: SpatialIndex<Entity> = new SpatialIndex<Entity>(),
  wires?: WirePickSource,
): PickingSystems {
  // Private last-known AABB cache — the compare-and-skip that keeps spatialSync
  // cheap while running every frame (it is the SpatialVersion writer). Entries
  // carry a GENERATION stamp (mutated in place each visit) so membership sweep
  // needs no per-frame Set/array allocations.
  const cache = new Map<Entity, { x: number; y: number; w: number; h: number; gen: number }>();
  let gen = 0;

  const spatialSync = defineTickSystem(
    (ctx) => {
      gen += 1;
      let changed = false;
      const visit = (batch: Batch): void => {
        const px = batch.col(Position).x;
        const py = batch.col(Position).y;
        const sw = batch.col(Size).w;
        const sh = batch.col(Size).h;
        for (const row of batch) {
          const x = px[row] as number;
          const y = py[row] as number;
          const w = sw[row] as number;
          const h = sh[row] as number;
          const e = batch.entity(row);
          const prev = cache.get(e);
          if (prev === undefined) {
            index.upsert(e, { minX: x, minY: y, maxX: x + w, maxY: y + h });
            cache.set(e, { x, y, w, h, gen });
            changed = true;
            continue;
          }
          prev.gen = gen;
          if (prev.x !== x || prev.y !== y || prev.w !== w || prev.h !== h) {
            index.upsert(e, { minX: x, minY: y, maxX: x + w, maxY: y + h });
            prev.x = x;
            prev.y = y;
            prev.w = w;
            prev.h = h;
            changed = true;
          }
        }
      };
      ctx.query(widgetAabbQ).each(visit);
      ctx.query(chromeAabbQ).each(visit);
      // Sweep: anything not visited this generation left the indexable set
      // (despawn, lost Position/Size, or an equipped widget going inactive).
      for (const [e, rec] of cache) {
        if (rec.gen !== gen) {
          index.remove(e);
          cache.delete(e);
          changed = true;
        }
      }
      if (changed) bumpVersion(world, SpatialVersion);
    },
    {
      name: "spatialSync",
      // The inner ctx.query col() reads are charged to THIS system by access
      // enforcement — a tick system has no query, so the default read set is
      // empty and the columns must be declared explicitly.
      access: { read: [Position, Size] },
    },
  );

  /** THE narrow-phase, shared with the router's event-time pick (ops/point-pick).
   *  `wires` (M8) narrow-phases wire entries against their cached cubic; undefined
   *  before the wire slice installs ⇒ wire index entries are skipped by pickTopAt. */
  const pickTop = (ctx: SystemCtx, wx: number, wy: number, rWorld: number): Entity | undefined =>
    pickTopAt(ctx, index, wx, wy, rWorld, wires);

  const picking = defineSystem(
    pointerQ,
    (b, ctx) => {
      const cam = ctx.getResource(Camera);
      const zoom = cam?.zoom ?? 1;
      const canvas = ctx.firstOf(canvasSurfaceQ);
      const deadBandWorld =
        (ctx.getResource(PointerSettings) ?? POINTER_DEFAULTS).hoverReleaseDeadBandPx / zoom;

      for (const r of b) {
        const p = b.entity(r);
        const s = ctx.read(p, PointerScreen);
        const w = screenToWorld(s.x, s.y, cam ?? IDENTITY_CAM);
        const rWorld = (ctx.get(p, PointerRadius)?.r ?? 0) / zoom;

        // TouchesExact — precise point pick, no dead-band ("grab is precise").
        const exact = pickTop(ctx, w.x, w.y, 0) ?? canvas;
        if (exact !== undefined && ctx.getRelation(p, TouchesExact) !== exact) {
          ctx.setRelation(p, TouchesExact, exact);
        }

        // Targets — radiused pick with a dead-band hysteresis ("hover is forgiving").
        let target = pickTop(ctx, w.x, w.y, rWorld);
        const cur = ctx.getRelation(p, Targets);
        if (
          cur !== undefined &&
          cur !== canvas &&
          ctx.isAlive(cur) &&
          ctx.has(cur, Position) &&
          ctx.has(cur, Size)
        ) {
          const cp = ctx.read(cur, Position);
          const cs = ctx.read(cur, Size);
          const d = distPointToBox(w.x, w.y, cp.x, cp.y, cp.x + cs.w, cp.y + cs.h);
          if (d <= rWorld + deadBandWorld) target = cur; // hold current within its expanded bounds
        }
        const finalTarget = target ?? canvas;
        if (finalTarget !== undefined && ctx.getRelation(p, Targets) !== finalTarget) {
          ctx.setRelation(p, Targets, finalTarget);
        }
      }
    },
    { name: "picking", runIf: makeVersionGuard(world, [PointerVersion, SpatialVersion]) },
  );

  return { spatialSync, picking, index, clearCaches: () => cache.clear() };
}
