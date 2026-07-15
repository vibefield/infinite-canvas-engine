/**
 * Nested canvas (design-004 §7 rev 2 — "the missing systems"; design-001
 * §5.7/§5.8 catalog).
 *
 * - `Active` = derived membership tag: a widget is Active iff the FIRST
 *   container ancestor on its `ChildOf` chain is the current nav frame
 *   (at root: no container ancestor at all). Children of a deeper container
 *   are that container's content — not Active until you enter it.
 * - `activeMembership` (derive tick, before cull): recomputes membership and
 *   flips Active/Visible/Culled CHANGE-ONLY, gated per design-004 §7
 *   (`runIf: nav-change ∨ ChildOf churn`) as a drain-and-early-return tick
 *   body — the spatialSync shape (petition 7 ChangeCollector; a `runIf`
 *   cannot drain, and this system declares no writes so an early-out
 *   blanket-stamps nothing). Idle frames cost one drain + one nav compare.
 *   Full resweeps run on seed / reset / coarse / NAV CHANGE / container
 *   despawn; everything else is delta-driven: a journaled entity whose
 *   membership INPUTS (ChildOf edge, Container-ness) are unchanged is
 *   skipped (drag frames journal Position every tick — O(1) each), a real
 *   reparent/container-flip reclassifies its re-anchored subtree.
 *   MEMBERSHIP-CHURN SIGNAL (why Position is the reparent proxy): relations
 *   are not collector-journalable (strata CollectOptions = components +
 *   tags), but coordinates are FRAME-LOCAL (design-001 §5.1) — a reparent
 *   that does not rewrite Position into the new frame's space is already a
 *   bug, and every real path co-writes: the doc sink commits reparent +
 *   Position in ONE tx (doc-commit-sink.ts), and undo/redo/remote imports
 *   project both rows of that tx. A bare runtime `world.setRelation(e,
 *   ChildOf, …)` with no Position write on a pre-existing entity is OUTSIDE
 *   the contract and goes stale until the next resweep.
 * - Nav stack = SESSION entities: `NavEntry` rows carry NavDepth + NavCamera
 *   (the camera to restore on exit) + NavFrame(entry→container). Root =
 *   empty stack. Current frame = deepest live entry's NavFrame target.
 * - `enterContainer`/`exitContainer` ops own the SPATIAL INDEX REBUILD:
 *   membership flips don't move Transforms, so the incremental spatialSync
 *   cache never fires on nav — the ops clear the index + caches and bump
 *   `SpatialVersion`; spatialSync repopulates from the new Active set on the
 *   next tick (its sweep-by-`seen` semantics make clear+repopulate exact).
 * - `navIntegrity` (react tick, before picking): if the current frame's
 *   container died (undo/remote — NavFrame edge auto-cleared), pop to the
 *   nearest LIVE ancestor entry (skipping dead ones) or root, restore that
 *   camera, rebuild. The recognizer-integrity pattern applied to nav.
 * - Camera memory: enter saves the live camera on the pushed entry
 *   (NavCamera) and applies the container's `ContainerCamera` rider (else
 *   zoom-to-fit over the frame's content, else identity); exit writes the
 *   rider back (per-user view memory; lost on undo-despawn — accepted) and
 *   restores the entry's NavCamera.
 */
import type { ChangeCollector, Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import type { SpatialIndex } from "@ice/kernel";
import {
  Camera,
  CameraLimits,
  Container,
  ContainerCamera,
  Culled,
  NavCamera,
  NavDepth,
  NavFrame,
  Position,
  Size,
  Viewport,
  Visible,
} from "../catalog";
import { Active } from "../catalog/camera-derived";
import { PrefabId } from "../schema/prefab";
import { SpatialVersion, bumpVersion } from "../helpers/version-stamps";
import { writeRuntimeResource } from "../guards/resource-writer";
import { ChildOf } from "../catalog/scene";
import { CAMERA_DEFAULTS } from "../settings/defaults";
import { WidgetEquipped, widgets } from "../widget/define-widget";

const navEntryQ = defineQuery([NavDepth, NavCamera]);
// Keyed on PrefabId (present AT SPAWN — same flush as equip's WidgetEquipped
// stamp), so Active lands the same tick projection does and the M6 mount
// timing is unchanged. Chrome/pointers lack PrefabId; wires lack Position.
const equippedQ = defineQuery([Position, Size, PrefabId]);

/** Deepest live nav entry, or undefined at root. */
export function currentNavEntry(world: World): Entity | undefined {
  let best: Entity | undefined;
  let bestDepth = -1;
  world.query(navEntryQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const d = world.read(e, NavDepth).d;
      if (d > bestDepth) {
        bestDepth = d;
        best = e;
      }
    }
  });
  return best;
}

/** The container the user is inside, or undefined at root. */
export function currentNavFrame(world: World): Entity | undefined {
  const entry = currentNavEntry(world);
  if (entry === undefined) return undefined;
  const frame = world.getRelation(entry, NavFrame);
  return frame !== undefined && world.isAlive(frame) ? frame : undefined;
}

/**
 * Container-ness for MEMBERSHIP decisions, with the equip-lag fallback: the
 * `Container` capability tag lands at the equip flush, ONE FRAME after a
 * widget projects — but membership classifies on the projection frame (the
 * M6 mount-timing invariant). Answering from the runtime tag alone during
 * that window mis-anchors fresh container CONTENT to the root for a frame;
 * cull then mass-Visible-tags it in the same flush membership corrects it
 * (change-only writes let the conflict through), and the zombies stay
 * mounted forever (measured: 6,440 phantom mounts on a 10k-board seed,
 * 2026-07-15). Pre-equip, the WIDGET REGISTRY answers from PrefabId.
 */
function isContainerForMembership(world: World, e: Entity): boolean {
  if (world.hasTag(e, Container)) return true;
  if (world.hasTag(e, WidgetEquipped)) return false; // equipped: the tag is truth
  const id = world.get(e, PrefabId)?.id;
  if (typeof id !== "string") return false;
  return widgets.get(id)?.capabilityTags.includes(Container) ?? false;
}

/** First container ancestor on the ChildOf chain (undefined = root-level). */
function firstContainerAncestor(world: World, e: Entity): Entity | undefined {
  let cur = world.getRelation(e, ChildOf);
  let hops = 0;
  while (cur !== undefined && hops < 64) {
    if (isContainerForMembership(world, cur)) return cur;
    cur = world.getRelation(cur, ChildOf);
    hops += 1;
  }
  return undefined;
}

export interface NestedCanvas {
  readonly activeMembership: TickSystem;
  readonly navIntegrity: TickSystem;
  enterContainer(container: Entity): void;
  exitContainer(): void;
  /** Depth of the nav stack (0 = root). */
  depth(): number;
}

export interface NestedCanvasOpts {
  /** THE spatial index (nav ops clear it; spatialSync repopulates). */
  readonly index: SpatialIndex<Entity>;
  /**
   * Clear spatialSync's private last-known cache alongside the index (the
   * install seam wires this; without it the compare-and-skip would believe
   * stale entries still exist).
   */
  readonly clearSpatialCaches: () => void;
}

/**
 * The membership stamper alone — installed by `installWidgetRuntime` (before
 * cull) so EVERY app partitions correctly, containers or not: a board with no
 * containers converges to all-Active on the first pass and never writes again.
 *
 * Gated per design-004 §7 (see the file header): the tick body drains a
 * petition-7 collector and early-returns on idle frames; membership work runs
 * only on nav change or membership-input churn. Baseline before this gate
 * (bench/membership-scale.test.ts, 2026-07-15): the full scan cost 19.0 ms
 * PER IDLE FRAME at 100k widgets nested 8 deep.
 */
export function createActiveMembership(world: World): TickSystem {
  // Created lazily on the FIRST run: both installWidgetRuntime and
  // createNestedCanvas construct an instance but rigs install only one — an
  // un-installed instance must never accumulate an undrained journal.
  let collector: ChangeCollector | undefined;
  let seeded = false;
  let lastFrame: Entity | undefined;
  let framePrimed = false;
  // Last-known membership INPUTS per equipped widget (the spatialSync `known`
  // pattern): ChildOf edge + Container-ness. A journaled entity whose inputs
  // are unchanged (Position-only churn — every drag frame) is skipped without
  // a chain walk. Rebuilt wholesale on every full resweep.
  let knownParent = new Map<Entity, Entity | undefined>();
  let knownContainer = new Set<Entity>();

  const isEquipped = (e: Entity): boolean =>
    world.has(e, PrefabId) && world.has(e, Position) && world.has(e, Size);

  return defineTickSystem(
    (ctx) => {
      if (collector === undefined) {
        // Position is the reparent proxy (frame-local co-write — file header);
        // PrefabId journals widget spawns/despawns; Container journals
        // container-ness flips (equip lands them one flush after spawn).
        // `coarse: false` is the same attestation spatialSync makes: every
        // writer of these components is store-visible (ctx/edit/projection).
        collector = world.changes.collect({
          components: [PrefabId, Position],
          tags: [Container],
          coarse: false,
        });
      }
      const delta = collector.drain();
      const frame = currentNavFrame(world);
      const navChanged = !framePrimed || frame !== lastFrame;
      framePrimed = true;
      lastFrame = frame;

      const classify = (e: Entity): void => {
        const member = firstContainerAncestor(world, e) === frame;
        if (member) {
          if (!ctx.hasTag(e, Active)) {
            ctx.addTag(e, Active); // cull re-classifies Visible next pass
            if (ctx.hasTag(e, Culled)) ctx.removeTag(e, Culled);
          }
        } else {
          // Canonical non-member state (never-was-active included): out of
          // Active, out of Visible, Culled — the mount store hides it and
          // the partition invariant (Visible ⊕ Culled over Active) holds.
          if (ctx.hasTag(e, Active)) ctx.removeTag(e, Active);
          if (ctx.hasTag(e, Visible)) ctx.removeTag(e, Visible);
          if (!ctx.hasTag(e, Culled)) ctx.addTag(e, Culled);
        }
      };

      // Container-despawn insurance: a dead container's ex-CHILDREN changed
      // first-ancestor without any journaled write of their own (a remote tx
      // can delete just the folder row; engine-local deletes cascade, so this
      // stays rare). Resweep rather than reconstruct the orphan set.
      let containerRemoved = false;
      for (const e of delta.removed) {
        if (knownContainer.delete(e)) containerRemoved = true;
        knownParent.delete(e);
      }

      // Structural resweeps rebuild the input caches; a NAV-ONLY resweep keeps
      // them — nav moves the frame, not the tree, and the cache rebuild is the
      // expensive half at scale (measured +80 ms on a 100k-entity enter).
      const structural = !seeded || delta.reset || delta.coarse.length > 0 || containerRemoved;
      if (structural || navChanged) {
        seeded = true;
        if (structural) {
          const nextParent = new Map<Entity, Entity | undefined>();
          const nextContainer = new Set<Entity>();
          ctx.query(equippedQ).each((b) => {
            for (const r of b) {
              const e = b.entity(r);
              classify(e);
              nextParent.set(e, world.getRelation(e, ChildOf));
              if (isContainerForMembership(world, e)) nextContainer.add(e);
            }
          });
          knownParent = nextParent;
          knownContainer = nextContainer;
        } else {
          ctx.query(equippedQ).each((b) => {
            for (const r of b) classify(b.entity(r));
          });
        }
        return;
      }

      if (delta.changed.length === 0) return; // the idle frame: one drain, one compare

      // Delta route: reclassify entities whose membership inputs changed plus
      // the subtree a reparent/container-flip re-anchors. The walk stops at
      // container CHILDREN (their content anchors to them — unaffected by a
      // move above), but the DFS ROOT recurses even when it is a container:
      // its container-ness may have just flipped, re-anchoring its children.
      const visited = new Set<Entity>();
      const reclassifySubtree = (root: Entity): void => {
        const stack: Entity[] = [root];
        while (stack.length > 0) {
          const e = stack.pop() as Entity;
          if (visited.has(e)) continue;
          visited.add(e);
          classify(e);
          if (e !== root && isContainerForMembership(world, e)) continue;
          for (const c of world.getReverse(e, ChildOf)) {
            if (isEquipped(c)) stack.push(c);
          }
        }
      };

      for (const e of delta.changed) {
        if (!world.isAlive(e) || !isEquipped(e)) continue;
        const parent = world.getRelation(e, ChildOf);
        const isCont = isContainerForMembership(world, e);
        if (knownParent.has(e) && knownParent.get(e) === parent && knownContainer.has(e) === isCont) {
          continue; // Position-only churn — membership inputs unchanged
        }
        knownParent.set(e, parent);
        if (isCont) knownContainer.add(e);
        else knownContainer.delete(e);
        reclassifySubtree(e);
      }
    },
    { name: "activeMembership" },
  );
}

export function createNestedCanvas(world: World, opts: NestedCanvasOpts): NestedCanvas {
  const rebuildIndex = (): void => {
    opts.index.clear();
    opts.clearSpatialCaches();
    bumpVersion(world, SpatialVersion);
  };

  const applyCameraForFrame = (frame: Entity | undefined): void => {
    if (frame === undefined) return;
    // Every zoom written here must honor the configured band (facade settings.zoom),
    // or enterContainer breaks the app's own invariant the moment it lands.
    const lim = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
    const clampZoom = (z: number): number => Math.min(lim.maxZoom, Math.max(lim.minZoom, z));
    const rider = world.get(frame, ContainerCamera);
    if (rider !== undefined && rider.zoom > 0) {
      writeRuntimeResource(world, Camera, { x: rider.x, y: rider.y, zoom: clampZoom(rider.zoom), gesturing: false });
      return;
    }
    // Zoom-to-fit over the frame's direct content (fallback; identity if empty).
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let any = false;
    for (const child of world.getReverse(frame, ChildOf)) {
      const p = world.get(child, Position);
      const s = world.get(child, Size);
      if (p === undefined || s === undefined) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w);
      maxY = Math.max(maxY, p.y + s.h);
      any = true;
    }
    const vp = world.getResource(Viewport);
    if (!any || vp === undefined || vp.w === 0) {
      writeRuntimeResource(world, Camera, { x: 0, y: 0, zoom: clampZoom(1), gesturing: false });
      return;
    }
    const pad = 80;
    const zoom = clampZoom(Math.min(vp.w / (maxX - minX + pad * 2), vp.h / (maxY - minY + pad * 2)));
    writeRuntimeResource(world, Camera, {
      x: minX - (vp.w / zoom - (maxX - minX)) / 2,
      y: minY - (vp.h / zoom - (maxY - minY)) / 2,
      zoom,
      gesturing: false,
    });
  };

  const popTo = (targetDepth: number): void => {
    // Destroy entries deeper than targetDepth; restore the camera of the
    // shallowest destroyed entry (the camera as it was before entering it).
    const doomed: Entity[] = [];
    world.query(navEntryQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        const d = world.read(e, NavDepth).d;
        if (d > targetDepth) doomed.push(e);
      }
    });
    // Shallowest doomed entry's saved camera is the correct restore point.
    let shallowest: Entity | undefined;
    let shallowestD = Number.POSITIVE_INFINITY;
    for (const e of doomed) {
      const d = world.read(e, NavDepth).d;
      if (d < shallowestD) {
        shallowestD = d;
        shallowest = e;
      }
    }
    if (shallowest !== undefined) {
      const cam = world.read(shallowest, NavCamera);
      writeRuntimeResource(world, Camera, { x: cam.x, y: cam.y, zoom: cam.zoom, gesturing: false });
    }
    for (const e of doomed) world.destroy(e); // ops run OUTSIDE the tick — structural world.* is legal here
    rebuildIndex();
  };

  const activeMembership = createActiveMembership(world);

  const navIntegrity = defineTickSystem(
    (ctx) => {
      // Pop past every entry whose frame died (undo/remote): destroy the dead
      // entry AND everything deeper (their return path is gone), restore the
      // shallowest doomed entry's saved camera, rebuild. Structural ops go
      // through ctx (law: systems never call structural world.*).
      let deadAt = Number.POSITIVE_INFINITY;
      ctx.query(navEntryQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const frame = world.getRelation(e, NavFrame);
          if (frame === undefined || !world.isAlive(frame)) {
            deadAt = Math.min(deadAt, world.read(e, NavDepth).d);
          }
        }
      });
      if (!Number.isFinite(deadAt)) return;
      let restore: { x: number; y: number; zoom: number } | undefined;
      ctx.query(navEntryQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const d = world.read(e, NavDepth).d;
          if (d < deadAt) continue;
          if (d === deadAt) {
            const cam = world.read(e, NavCamera);
            restore = { x: cam.x, y: cam.y, zoom: cam.zoom };
          }
          ctx.destroy(e);
        }
      });
      if (restore !== undefined) writeRuntimeResource(world, Camera, { ...restore, gesturing: false });
      rebuildIndex();
    },
    {
      name: "navIntegrity",
      runIf: () => {
        // Cheap guard: any nav entry at all? (root sessions skip entirely)
        return world.firstOf(navEntryQ) !== undefined;
      },
    },
  );

  return {
    activeMembership,
    navIntegrity,
    enterContainer(container) {
      if (!world.isAlive(container) || !world.hasTag(container, Container)) {
        throw new Error("ice: enterContainer target is not a live container.");
      }
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      const depth = (currentNavEntry(world) !== undefined ? world.read(currentNavEntry(world) as Entity, NavDepth).d : 0) + 1;
      const entry = world.spawn({
        components: [
          [NavDepth, { d: depth }],
          [NavCamera, { x: cam.x, y: cam.y, zoom: cam.zoom }],
        ],
      });
      world.setRelation(entry, NavFrame, container);
      applyCameraForFrame(container);
      rebuildIndex();
    },
    exitContainer() {
      const entry = currentNavEntry(world);
      if (entry === undefined) return; // already at root
      // Persist per-user view memory on the frame we're leaving.
      const frame = world.getRelation(entry, NavFrame);
      const cam = world.getResource(Camera);
      if (frame !== undefined && world.isAlive(frame) && cam !== undefined) {
        const rider = { x: cam.x, y: cam.y, zoom: cam.zoom };
        if (world.has(frame, ContainerCamera)) world.edit(frame).set(ContainerCamera, rider);
        else world.addComponent(frame, ContainerCamera, rider);
      }
      popTo(world.read(entry, NavDepth).d - 1);
    },
    depth() {
      const entry = currentNavEntry(world);
      return entry === undefined ? 0 : world.read(entry, NavDepth).d;
    },
  };
}
