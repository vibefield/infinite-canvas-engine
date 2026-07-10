/**
 * L1 — spatial sync + targeting (design-003 §3; `react` phase).
 *
 * Two systems, run in this order:
 *
 * `spatialSync` maintains the kernel `SpatialIndex` over every Position+Size
 * entity (widgets AND HandleSpec chrome — both carry a world AABB). It is
 * anchored on the CanvasSurface query (exactly one entity, guaranteed by
 * install) so the body runs EVERY frame — it is the writer that bumps
 * `SpatialVersion`, and its own writes have no version stamp to gate on
 * (design-002 §4), so it must run eagerly and stays cheap via a private
 * last-known cache: an entity is re-`upsert`ed only when its AABB actually
 * changed, and a cache-sweep removes entries no longer matched (despawns, or a
 * lost Position/Size). Materialized ports are M8 — skipped.
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
import type { Entity, System, SystemCtx, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, Not } from "@vibecook/strata-ecs";
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
import { PointerVersion, SpatialVersion, bumpVersion, makeVersionGuard } from "../helpers/version-stamps";
import { distPointToBox, pickTopAt } from "../ops/point-pick";
import { POINTER_DEFAULTS } from "../settings/defaults";

const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

const canvasSurfaceQ = defineQuery([CanvasSurface]);
const posSizeQ = defineQuery([Position, Size]);
const pointerQ = defineQuery([Pointer, PointerScreen, PointerRadius, LocalPointer, Not(HandledByWidget)]);

export interface PickingSystems {
  spatialSync: System;
  picking: System;
  /** The shared spatial index — snap/drop/marquee consume the SAME instance. */
  index: SpatialIndex<Entity>;
}

export function createPickingSystems(
  world: World,
  index: SpatialIndex<Entity> = new SpatialIndex<Entity>(),
): PickingSystems {
  // Private last-known AABB cache — the compare-and-skip that keeps spatialSync
  // cheap while running every frame (it is the SpatialVersion writer).
  const cache = new Map<Entity, { x: number; y: number; w: number; h: number }>();

  const spatialSync = defineSystem(
    canvasSurfaceQ, // anchor: the CanvasSurface batch ⇒ the body runs every frame (despawn sweep is total)
    (b, _ctx) => {
      // A tag-only query has no required component, so strata invokes the body once per ARCHETYPE
      // (empty batches included). Do the (idempotent) work only for the batch holding the canvas
      // surface — exactly once per frame.
      if (b.count === 0) return;
      const seen = new Set<Entity>();
      let changed = false;
      world.query(posSizeQ).each((batch) => {
        const px = batch.col(Position).x;
        const py = batch.col(Position).y;
        const sw = batch.col(Size).w;
        const sh = batch.col(Size).h;
        for (const row of batch) {
          const e = batch.entity(row);
          seen.add(e);
          const x = px[row] as number;
          const y = py[row] as number;
          const w = sw[row] as number;
          const h = sh[row] as number;
          const prev = cache.get(e);
          if (prev === undefined || prev.x !== x || prev.y !== y || prev.w !== w || prev.h !== h) {
            index.upsert(e, { minX: x, minY: y, maxX: x + w, maxY: y + h });
            cache.set(e, { x, y, w, h });
            changed = true;
          }
        }
      });
      const gone: Entity[] = [];
      for (const e of cache.keys()) if (!seen.has(e)) gone.push(e);
      for (const e of gone) {
        index.remove(e);
        cache.delete(e);
        changed = true;
      }
      if (changed) bumpVersion(world, SpatialVersion);
    },
    {
      name: "spatialSync",
      // The inner world.query col() reads are charged to THIS system by access
      // enforcement — the anchor query carries no components, so the default
      // read set is empty and the columns must be declared explicitly.
      access: { read: [Position, Size] },
    },
  );

  /** THE narrow-phase, shared with the router's event-time pick (ops/point-pick). */
  const pickTop = (ctx: SystemCtx, wx: number, wy: number, rWorld: number): Entity | undefined =>
    pickTopAt(ctx, index, wx, wy, rWorld);

  const picking = defineSystem(
    pointerQ,
    (b, ctx) => {
      const cam = ctx.getResource(Camera);
      const zoom = cam?.zoom ?? 1;
      const canvas = ctx.firstOf(canvasSurfaceQ);
      const deadBandWorld = POINTER_DEFAULTS.hoverReleaseDeadBandPx / zoom;

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

  return { spatialSync, picking, index };
}
