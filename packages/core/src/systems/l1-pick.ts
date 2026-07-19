/**
 * L1 — spatial sync + targeting (design-003 §3; `react` phase).
 *
 * Two systems, run in this order:
 *
 * `spatialSync` maintains the kernel `SpatialIndex` over every Position+Size
 * entity (widgets AND HandleSpec chrome — both carry a world AABB). It is a
 * TICK system so the body runs every frame — it is the writer that bumps
 * `SpatialVersion` — but as of strata 0.7.0 (petition 7 LANDED) the body is
 * O(delta), not O(N): a `world.changes` collector journals exactly which
 * entities were touched (Position/Size writes, Active/WidgetEquipped flips,
 * spawns, destroys — same-frame, drained INSIDE the pipeline), and each is
 * re-checked against `isIndexable` → upsert or remove. The 2026-07-13 walk
 * machinery (last-known AABB cache, compare-and-skip, generation sweep) is
 * RETIRED — the collector knows; the system no longer has to discover.
 *
 * The FULL WALK survives as exactly what petition 7 said it should be:
 *  - the SEED (a collector only journals writes made after its creation);
 *  - the `reset` route (world.reset / replace import / nav `clearCaches`);
 *  - the `coarse` fallback (some declared-raw-write system touched
 *    Position/Size rows the journal cannot attribute — rescan, never miss).
 * Nav gating rides the walk QUERIES at archetype level: widgets match
 * `[Position, Size, WidgetEquipped, Active]`, chrome matches
 * `[Position, Size, Not(WidgetEquipped)]` — the union is exactly
 * `Position+Size ∧ (¬WidgetEquipped ∨ Active)`, and `isIndexable` is the
 * same predicate entity-wise for the delta path. Materialized ports are M8 —
 * skipped.
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
 * Pick priority is plane priority: HandleSpec chrome first, then widgets
 * topmost by sibling order (petition 8 — the shared SiblingOrderIndex feeds
 * pickTopAt, so pick can never diverge from paint), then the CanvasSurface
 * entity as the guaranteed fallback (design-001 §4). Relations are written
 * change-only (design-002 §4 hygiene). Wires/ports are M8 — skipped.
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
import { createSiblingOrderIndex } from "../ops/sibling-order";
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
  // The change journal (petition 7 / strata 0.7.0). Subscribing here is the
  // whole trick: Position/Size writes, Active/WidgetEquipped flips, spawns
  // and destroys journal the ENTITY at the write chokepoints — no walk needed
  // to discover them. `seeded` gates the initial full walk (pre-collector
  // entities) and is re-armed by nav `clearCaches` (design-004 §7).
  //
  // `coarse: false` is the engine's ATTESTATION (the strata option's exact
  // contract): every Position/Size writer here uses store-visible writes —
  // absolute writes via `ctx.*`/`world.edit`/doc projection are engine LAW.
  // Without it, the declared-`access.write` blanket from exact-path systems
  // (move/resize/snap declare for enforcement) would mark coarse every
  // gesture frame and force the full rescan collectors exist to retire.
  const collector = world.changes.collect({
    components: [Position, Size],
    tags: [Active, WidgetEquipped],
    coarse: false,
  });
  let seeded = false;
  // Entities THIS system put in the index. The index is SHARED and
  // multi-writer (ports + wires maintain their own entries) — rebuilds must
  // remove only our own stale entries, never `index.clear()`.
  let known = new Set<Entity>();

  /**
   * The delta path's entity-wise twin of the walk queries' union: upserts and
   * reports true when `e` belongs in the index, false (no write) otherwise.
   */
  const upsertIfIndexable = (e: Entity): boolean => {
    if (!world.isAlive(e)) return false;
    const p = world.get(e, Position);
    const s = world.get(e, Size);
    if (p === undefined || s === undefined) return false;
    if (world.hasTag(e, WidgetEquipped) && !world.hasTag(e, Active)) return false;
    index.upsert(e, { minX: p.x, minY: p.y, maxX: p.x + s.w, maxY: p.y + s.h });
    return true;
  };

  const spatialSync = defineTickSystem(
    (ctx) => {
      const delta = collector.drain();
      // Full-walk routes: seed, reset (world.reset / nav), coarse raw writes.
      if (!seeded || delta.reset || delta.coarse.length > 0) {
        seeded = true;
        const next = new Set<Entity>();
        const visit = (batch: Batch): void => {
          const px = batch.col(Position).x;
          const py = batch.col(Position).y;
          const sw = batch.col(Size).w;
          const sh = batch.col(Size).h;
          for (const row of batch) {
            const x = px[row] as number;
            const y = py[row] as number;
            const e = batch.entity(row);
            index.upsert(e, {
              minX: x,
              minY: y,
              maxX: x + (sw[row] as number),
              maxY: y + (sh[row] as number),
            });
            next.add(e);
          }
        };
        ctx.query(widgetAabbQ).each(visit);
        ctx.query(chromeAabbQ).each(visit);
        for (const e of known) {
          if (!next.has(e)) index.remove(e); // only OUR stale entries — never index.clear()
        }
        known = next;
        bumpVersion(world, SpatialVersion);
        return;
      }
      // Delta path — O(changed), ~0 on still frames.
      if (delta.changed.length === 0 && delta.removed.length === 0) return;
      for (const e of delta.removed) {
        if (known.delete(e)) index.remove(e); // destroyed — drop by our cached key
      }
      for (const e of delta.changed) {
        if (upsertIfIndexable(e)) {
          known.add(e);
        } else if (known.delete(e)) {
          index.remove(e);
        }
      }
      bumpVersion(world, SpatialVersion);
    },
    {
      name: "spatialSync",
      // The inner ctx.query col() reads are charged to THIS system by access
      // enforcement — a tick system has no query, so the default read set is
      // empty and the columns must be declared explicitly.
      access: { read: [Position, Size] },
    },
  );

  // The pull-based frame ordinal map (petition 8): pickTopAt's widget tier
  // takes the compareStackOrder max over it — the same map every renderer
  // sorts by. Stamp-checked per read; ~free while order is quiet.
  const order = createSiblingOrderIndex(world);

  /** THE narrow-phase, shared with the router's event-time pick (ops/point-pick).
   *  `wires` (M8) narrow-phases wire entries against their cached cubic; undefined
   *  before the wire slice installs ⇒ wire index entries are skipped by pickTopAt. */
  const pickTop = (ctx: SystemCtx, wx: number, wy: number, rWorld: number): Entity | undefined =>
    pickTopAt(ctx, index, wx, wy, rWorld, wires, order.ordinals());

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

  // clearCaches (nav seam, design-004 §7): re-arm the seed — the next tick
  // rebuilds the cleared index from the new Active set via the full walk.
  return {
    spatialSync,
    picking,
    index,
    clearCaches: () => {
      seeded = false;
    },
  };
}
