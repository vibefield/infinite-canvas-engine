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
 * world position is derived from PointerScreen × Camera rather than read from
 * the PointerWorld cell. The cell no longer lags on the pointer's spawn: ingest
 * spawns it at screen×camera, what the pointerWorldSync writer (which cannot see
 * a pointer spawned in the same input phase) writes from the next frame
 * (petition I45 — before, (0, 0) for that frame, which would have mis-captured
 * on the down frame). The pick keeps its own derivation: screen×camera, at the
 * camera it reads, is exact here whoever wrote the cell.
 *   - `Targets`      = radiused disc-vs-box pick with a screen-px release
 *                      dead-band (hover is forgiving; hold the current target
 *                      while the pointer stays within its expanded bounds).
 *   - `TouchesExact` = r=0 point pick (grab is precise; no dead-band).
 * Pick priority is plane priority: HandleSpec chrome first, then widgets
 * topmost by sibling order (petition 8 — the shared SiblingOrderIndex feeds
 * pickTopAt, so pick can never diverge from paint), then the CanvasSurface
 * entity as the guaranteed fallback (design-001 §4). Relations are written
 * change-only (design-002 §4 hygiene). Wires/ports are M8 — skipped.
 *
 * `pickAt` is the exact pick OUT of the tick (petition I27 — the desk's
 * `handle.pick`, a host's right-click): the `TouchesExact` body above run on
 * the world as the last tick left it, read-only — one body, so a host's pick
 * and a press can never disagree.
 */
import type { Batch, Entity, System, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineSystem, defineTickSystem, Not } from "@vibecook/strata-ecs";
import { SpatialIndex, screenToWorld, type CameraState } from "@ice/kernel";
import {
  Camera,
  CanvasSurface,
  HandledByWidget,
  LocalPointer,
  Pointer,
  PointerPart,
  PointerRadius,
  PointerScreen,
  Position,
  Size,
  Targets,
  TouchesExact,
  Tray,
} from "../catalog";
import { Active } from "../catalog/camera-derived";
import { WidgetEquipped } from "../widget/define-widget";
import { PointerVersion, SpatialVersion, bumpVersion, makeVersionGuard } from "../helpers/version-stamps";
import { distPointToBox, type PickReader, pickTopAt, type WirePickSource } from "../ops/point-pick";
import { compareStackOrder, createSiblingOrderIndex } from "../ops/sibling-order";
import { PointerSettings } from "../catalog/settings-resources";
import { POINTER_DEFAULTS } from "../settings/defaults";

const IDENTITY_CAM: CameraState = { x: 0, y: 0, zoom: 1 };

const canvasSurfaceQ = defineQuery([CanvasSurface]);
// The pegboard drawer's fact (design-017 §2): while it is out the desk is INERT to the pointer, and the pick reads that itself — see `picking`.
const trayQ = defineQuery([Tray]);
// Nav gating at ARCHETYPE level (design-004 §7): the union of these two is
// exactly `Position+Size ∧ (¬WidgetEquipped ∨ Active)` — equipped widgets are
// hittable only while Active (in-frame); chrome/pre-equip entities always.
// Tags in the query beat per-row `hasTag` calls (2026-07-13 perf audit).
const widgetAabbQ = defineQuery([Position, Size, WidgetEquipped, Active]);
const chromeAabbQ = defineQuery([Position, Size, Not(WidgetEquipped)]);
const pointerQ = defineQuery([Pointer, PointerScreen, PointerRadius, LocalPointer, Not(HandledByWidget)]);

/**
 * The FRAME pick source (design-014, B3b): the ground's answer to "what is
 * under this world point on card `e`" — `content`, `frame` (the chrome band
 * outside the content rect), `outside`, or a PART the registered card program
 * names (`close`, `lock` …) — or `undefined`: the source has NO GEOMETRY for the card
 * (the ground's pipelines are still compiling, the card has not been drawn yet, or
 * creation failed), and the box tier's answer stands. `undefined` is not `outside`: a
 * card the ground cannot see is still a card (B9 review blocker 1 — a source that
 * answered `outside` there made every card unclickable until the first build, and for
 * good when `Ground.create` rejected). `pad()` is how far the chrome reaches past the
 * content rect, world units: the spatial index holds content rects, so
 * `picking` widens its search by it and asks the source about candidates the
 * boxes missed. Set on the interaction stack by the ground layer at mount;
 * `null` = every hit is the box's (the stratified profile).
 */
export interface FramePickSource {
  pad(): number;
  hit(e: Entity, wx: number, wy: number): string | undefined;
  /**
   * The source's geometry is MOVING under a still pointer (a reveal growing a control, a lift): `picking` runs
   * every frame this answers true, so the part under a motionless pointer is the part that is there now. Absent
   * = never; the pointer and the spatial index are then the only wakes (B9 review).
   */
  live?(): boolean;
  /**
   * The widgets the source draws LIFTED this frame — above the frame's own order and away from their facts (design-015 §6's
   * print in a hand, flicked or gliding; D3t-a): the spatial index still holds their fact rects, so the frame tier asks
   * these FIRST, wherever they are drawn, and the topmost that answers is the hit — a press catches a gliding print where
   * it is, and its old rect no longer does (its geometry says `outside` there). Absent = none.
   */
  lifted?(): Iterable<Entity>;
}

/** The stack's slot for the frame pick source — a mutable box, so the ground can arrive after install. */
export interface FramePickSlot { current: FramePickSource | null }

/** What a press at a point would touch (`TouchesExact`): the entity, and the PART under it (`""` the thing itself — design-014). */
export interface PointPick {
  readonly entity: Entity;
  readonly part: string;
}

export interface PickingSystems {
  spatialSync: TickSystem;
  picking: System;
  /** The shared spatial index — snap/drop/marquee consume the SAME instance. */
  index: SpatialIndex<Entity>;
  /**
   * The exact pick OUT of the tick (petition I27): what a press at a SCREEN point (CSS px of the view) would touch now — the
   * `TouchesExact` body `picking` runs, on the world as the last tick left it and the camera as it stands; `undefined` over the bare
   * canvas, and everywhere while the pegboard drawer is out (the desk inert, design-017 §4). Read-only: no relation, no tag, no stamp.
   */
  pickAt(sx: number, sy: number): PointPick | undefined;
  /** Nav-op seam (design-004 §7): forget every last-known AABB so the next
   *  spatialSync pass repopulates the cleared index from the new Active set. */
  clearCaches(): void;
}

export function createPickingSystems(
  world: World,
  index: SpatialIndex<Entity> = new SpatialIndex<Entity>(),
  wires?: WirePickSource,
  frames: FramePickSlot = { current: null },
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
  const pickTop = (reader: PickReader, wx: number, wy: number, rWorld: number): Entity | undefined =>
    pickTopAt(reader, index, wx, wy, rWorld, wires, order.ordinals());
  /**
   * The frame tier (design-014, B3b): with a source registered, a widget hit by
   * its content box is asked what is under the point — a rounded corner's
   * void is `outside` and falls through; and when the boxes miss, the topmost
   * widget whose CHROME the source says is under the point (within `pad`) is
   * the hit. Returns the entity and the part (`""` for content and frame).
   */
  const pickFrame = (ctx: PickReader, wx: number, wy: number, rWorld: number, boxHit: Entity | undefined): { e: Entity | undefined; part: string } => {
    const src = frames.current;
    if (src === null) return { e: boxHit, part: "" };
    const isWidget = (e: Entity): boolean => ctx.hasTag(e, WidgetEquipped) && ctx.hasTag(e, Active);
    const partOf = (h: string): string => (h === "content" || h === "frame" || h === "outside" ? "" : h);
    // the LIFTED first (D3t-a): drawn above the frame's order, wherever their facts are — the topmost that answers wins
    const lifted = src.lifted?.();
    if (lifted !== undefined) {
      const ordinals = order.ordinals();
      let top: Entity | undefined;
      let topPart = "";
      for (const e of lifted) {
        if (!ctx.isAlive(e) || !isWidget(e)) continue;
        if (top !== undefined && compareStackOrder(ctx, ordinals, e, top) < 0) continue;
        const h = src.hit(e, wx, wy);
        if (h === undefined || h === "outside") continue;
        top = e;
        topPart = partOf(h);
      }
      if (top !== undefined) return { e: top, part: topPart };
    }
    if (boxHit !== undefined && isWidget(boxHit)) {
      const h = src.hit(boxHit, wx, wy);
      if (h === undefined) return { e: boxHit, part: "" }; // no geometry for it yet: the box tier stands
      if (h !== "outside") return { e: boxHit, part: partOf(h) };
    } else if (boxHit !== undefined) {
      return { e: boxHit, part: "" }; // chrome, a port, a wire: the box tier's answer stands
    }
    // the boxes missed (or the box hit was a corner's void): the chrome band of the topmost widget within reach
    const ordinals = order.ordinals();
    let best: Entity | undefined;
    let bestPart = "";
    for (const entry of index.searchPoint(wx, wy, rWorld + src.pad())) {
      const e = entry.id;
      if (!ctx.isAlive(e) || !isWidget(e) || e === boxHit) continue;
      if (best !== undefined && compareStackOrder(ctx, ordinals, e, best) < 0) continue;
      const h = src.hit(e, wx, wy);
      if (h === undefined || h === "outside") continue; // no geometry: no chrome band to reach
      best = e;
      bestPart = partOf(h);
    }
    return { e: best, part: bestPart };
  };
  /** The EXACT pick (`TouchesExact` and its part — "grab is precise"): the r = 0 point pick through the frame tier. */
  const pickExact = (reader: PickReader, wx: number, wy: number): { e: Entity | undefined; part: string } =>
    pickFrame(reader, wx, wy, 0, pickTop(reader, wx, wy, 0));

  const versions = makeVersionGuard(world, [PointerVersion, SpatialVersion]);
  // The drawer out = the desk inert to the pointer (design-017 §4). `trayInput` stamps every local pointer `HandledByWidget` for
  // that, but it runs in THIS phase and a tag is a structural write — it lands at the phase boundary, after this has picked — so
  // the query's `Not(HandledByWidget)` never sees it (the hand's stamp the same: "picking still runs", install.ts) and the
  // DOM-at-event-time halves (the editor's tap, the calendar's days) read a LIVE hit through the drawer (K9 law #1). So the pick
  // reads the fact itself: while `Tray.open`, every local pointer touches the bare canvas and names no part — what rose under
  // it settles, and nothing under the drawer can be lent, selected or written on. `trayWasOpen` runs it once on each flip of the
  // fact (a drawer opened by key, the pointer still: the hovered note must still let go; shut again: the hit must come back).
  const trayIsOpen = (): boolean => { const t = world.firstOf(trayQ); return t !== undefined && world.read(t, Tray).open; };
  let trayWasOpen = false;
  const picking = defineSystem(
    pointerQ,
    (b, ctx) => {
      const cam = ctx.getResource(Camera);
      const zoom = cam?.zoom ?? 1;
      const canvas = ctx.firstOf(canvasSurfaceQ);
      const deadBandWorld =
        (ctx.getResource(PointerSettings) ?? POINTER_DEFAULTS).hoverReleaseDeadBandPx / zoom;
      const inert = trayIsOpen();
      trayWasOpen = inert;

      for (const r of b) {
        const p = b.entity(r);
        if (inert) {
          // the desk under the drawer is bare to this pointer: the canvas surface is its exact hit and its target (as on the empty
          // desk), its part none — the same answers the pointer gets off every object, so every consumer reads "nothing here"
          if (canvas !== undefined) {
            if (ctx.getRelation(p, TouchesExact) !== canvas) ctx.setRelation(p, TouchesExact, canvas);
            if (ctx.getRelation(p, Targets) !== canvas) ctx.setRelation(p, Targets, canvas);
          }
          if (frames.current !== null) {
            const cur = ctx.get(p, PointerPart);
            if (cur === undefined) ctx.addComponent(p, PointerPart, { part: "" });
            else if (cur.part !== "") ctx.edit(p).set(PointerPart, { part: "" });
          }
          continue;
        }
        const s = ctx.read(p, PointerScreen);
        const w = screenToWorld(s.x, s.y, cam ?? IDENTITY_CAM);
        const rWorld = (ctx.get(p, PointerRadius)?.r ?? 0) / zoom;

        // TouchesExact — precise point pick, no dead-band ("grab is precise").
        const exactFrame = pickExact(ctx, w.x, w.y);
        const exact = exactFrame.e ?? canvas;
        if (exact !== undefined && ctx.getRelation(p, TouchesExact) !== exact) {
          ctx.setRelation(p, TouchesExact, exact);
        }
        // The part under the exact hit (design-014, B3b) — change-only, present only with a source.
        if (frames.current !== null) {
          const cur = ctx.get(p, PointerPart);
          if (cur === undefined) ctx.addComponent(p, PointerPart, { part: exactFrame.part });
          else if (cur.part !== exactFrame.part) ctx.edit(p).set(PointerPart, { part: exactFrame.part });
        }

        // Targets — radiused pick with a dead-band hysteresis ("hover is forgiving").
        let target = pickFrame(ctx, w.x, w.y, rWorld, pickTop(ctx, w.x, w.y, rWorld)).e;
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
    // `PointerPart` is this system's to write (change-only, through `edit().set` after the first `addComponent`): declared, or
    // strata's dev build throws on the first hover that crosses from content onto a control (B9 — found by the re-pick test).
    //
    // WHAT THAT DECLARATION COSTS A CONSUMER (Phase C review; no fix owed here).
    // A declared write is a COLUMN-WIDE stamp, taken whenever the system runs
    // rather than when a value changes — and `live()` runs this every frame a
    // spring is moving. A Tier-1 observer of `PointerPart` would therefore wake
    // on every one of those frames, for a hover that never moved. Nothing
    // inside ICE observes the column that way (the overlay collector and
    // `world.get` both PULL), so idle-zero holds here; a consumer that
    // subscribes Tier-1 to `PointerPart` is the one who pays, and wants a
    // `{ coarse: false }` collector instead — the same shape as the `Position`
    // finding against `cursorVisualPoles` (D-C4.9).
    { name: "picking", access: { write: [PointerPart] }, runIf: () => versions() || frames.current?.live?.() === true || trayIsOpen() !== trayWasOpen },
  );

  // clearCaches (nav seam, design-004 §7): re-arm the seed — the next tick
  // rebuilds the cleared index from the new Active set via the full walk.
  return {
    spatialSync,
    picking,
    index,
    pickAt(sx, sy) {
      // the drawer out: every press touches the bare canvas, as `picking` answers it
      if (trayIsOpen()) return undefined;
      const w = screenToWorld(sx, sy, world.getResource(Camera) ?? IDENTITY_CAM);
      const hit = pickExact(world, w.x, w.y);
      return hit.e === undefined ? undefined : { entity: hit.e, part: hit.part };
    },
    clearCaches: () => {
      seeded = false;
    },
  };
}
