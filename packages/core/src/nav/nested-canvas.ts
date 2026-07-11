/**
 * Nested canvas (design-004 §7 rev 2 — "the missing systems"; design-001
 * §5.7/§5.8 catalog).
 *
 * - `Active` = derived membership tag: a widget is Active iff the FIRST
 *   container ancestor on its `ChildOf` chain is the current nav frame
 *   (at root: no container ancestor at all). Children of a deeper container
 *   are that container's content — not Active until you enter it.
 * - `activeMembership` (derive tick, before cull): recomputes membership and
 *   flips Active/Visible/Culled CHANGE-ONLY. A nav switch is O(frame
 *   content) tag flips — bounded, rare, migration-free. Boards without
 *   containers converge to "everything Active" on the first pass and never
 *   write again (M3–M7 demos unaffected).
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
import type { Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import type { SpatialIndex } from "@ice/kernel";
import {
  Camera,
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

/** First container ancestor on the ChildOf chain (undefined = root-level). */
function firstContainerAncestor(world: World, e: Entity): Entity | undefined {
  let cur = world.getRelation(e, ChildOf);
  let hops = 0;
  while (cur !== undefined && hops < 64) {
    if (world.hasTag(cur, Container)) return cur;
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
 */
export function createActiveMembership(world: World): TickSystem {
  return defineTickSystem(
    (ctx) => {
      const frame = currentNavFrame(world);
      ctx.query(equippedQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
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
        }
      });
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
    const rider = world.get(frame, ContainerCamera);
    if (rider !== undefined && rider.zoom > 0) {
      writeRuntimeResource(world, Camera, { x: rider.x, y: rider.y, zoom: rider.zoom, gesturing: false });
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
      writeRuntimeResource(world, Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
      return;
    }
    const pad = 80;
    const zoom = Math.min(2, Math.max(0.1, Math.min(vp.w / (maxX - minX + pad * 2), vp.h / (maxY - minY + pad * 2))));
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
