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
 * - Camera policy (design-006, amending design-004 §7; James 2026-07-15):
 *   enter saves the live camera on the pushed entry (NavCamera) and ALWAYS
 *   lands on the DEFAULT framing — zoom-to-fit over the frame's content, else
 *   identity. The `ContainerCamera` rider is neither read nor written by the
 *   engine anymore (per-canvas view memory made re-entry unpredictable); the
 *   component stays in the catalog for userland. Exit restores the entry's
 *   NavCamera — "back where you came from" is the nav stack, not view memory.
 * - Transitions (design-006 T1): with a live Viewport and `transition` not
 *   "none", enter/exit CUT exactly as before and then FLY — the camera snaps
 *   to the continuity-solved start and `navFlight` springs it to the arrival
 *   (systems/nav-flight.ts). `exitTo(depth)` pops multi-level in ONE flight
 *   through the composed portals (rebuilt from CURRENT container rects — a
 *   collaborator may have moved a card). Headless (no Viewport) or opted-out
 *   calls snap, preserving the pre-T1 behavior exactly.
 */
import type { ChangeCollector, Entity, TickSystem, World } from "@vibecook/strata-ecs";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import type { CameraState, PortalAffine, SpatialIndex } from "@ice/kernel";
import {
  composeAffine,
  invertAffine,
  portalAffine,
  solveFlightStart,
  visibleRect,
} from "@ice/kernel";
import {
  Camera,
  ActiveTool,
  Container,
  Culled,
  NavCamera,
  NavDepth,
  NavFrame,
  NavTool,
  Position,
  Size,
  Viewport,
  Visible,
  Selected,
} from "../catalog";
import {
  NavTransition,
  abortNavFlight,
  publishNavCut,
  startNavFlight,
  type NavTransitionIdentity,
} from "../systems/nav-flight";
import { Active } from "../catalog/camera-derived";
import { PrefabId } from "../schema/prefab";
import { SpatialVersion, bumpVersion } from "../helpers/version-stamps";
import { SelectionVersion } from "../helpers/version-stamps";
import { writeRuntimeResource } from "../guards/resource-writer";
import { ChildOf } from "../catalog/scene";
import { WidgetEquipped } from "../widget/define-widget";
import { engineCatalogFor, widgetTypeFor } from "../canvas/engine-catalog";
import { resolveFrameView, resolvePortal } from "../canvas/frame-view";
import type {
  FrameSwitchRequest,
  PreparedFrameSwitch,
  PresentationReleaseReason,
} from "../canvas/presentation-transition";

const navEntryQ = defineQuery([NavDepth, NavCamera]);
const selectedQ = defineQuery([Selected]);
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
  return widgetTypeFor(world, id)?.capabilityTags.includes(Container) ?? false;
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

/** Per-op transition choice (design-006 §3.1); default is the portal zoom. */
export interface NavOpts {
  readonly transition?: "zoom" | "none";
}

export interface NestedCanvas {
  readonly activeMembership: TickSystem;
  readonly navIntegrity: TickSystem;
  enterContainer(container: Entity, opts?: NavOpts): void;
  exitContainer(opts?: NavOpts): void;
  /** Pop to `targetDepth` in ONE transition (breadcrumb jumps; design-006 §5). */
  exitTo(targetDepth: number, opts?: NavOpts): void;
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
  /** EngineCatalog-backed container validity; legacy rigs may omit it. */
  readonly isContainer?: (entity: Entity) => boolean;
  /** Runs synchronously before an explicit enter/exit visibility cut. */
  readonly beforeSwitch?: () => void;
  /** Presentation gate: false forces an atomic cut (for example, cross-ground before T2). */
  readonly transitionAllowed?: (
    fromFrame: Entity | undefined,
    toFrame: Entity | undefined,
  ) => boolean;
  /** Trusted synchronous pre-cut presentation capture. It cannot veto the cut. */
  readonly prepareTransition?: (request: FrameSwitchRequest) => PreparedFrameSwitch;
  /** Integrity/doc recovery releases any adapter holds without animation. */
  readonly abortTransition?: (reason: PresentationReleaseReason) => void;
  /** Capture stable frame/type/document identity before the authority cut. */
  readonly transitionIdentity?: (
    fromFrame: Entity | undefined,
    toFrame: Entity | undefined,
  ) => NavTransitionIdentity;
  /** One publication per completed switch or integrity pop. */
  readonly onSwitch?: (
    frame: Entity | undefined,
    depth: number,
    restoreTool: string | undefined,
  ) => void;
  readonly maxDepth?: number;
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

export function createNestedCanvas(world: World, config: NestedCanvasOpts): NestedCanvas {
  const maxDepth = config.maxDepth ?? 64;
  const validContainer = (entity: Entity): boolean =>
    config.isContainer?.(entity) ?? world.hasTag(entity, Container);
  const rebuildIndex = (): void => {
    config.index.clear();
    config.clearSpatialCaches();
    bumpVersion(world, SpatialVersion);
  };

  /**
   * THE VISIBILITY CUT (field glitch 2026-07-17): the op snaps the camera to
   * the flight start SYNCHRONOUSLY, but membership → cull → mount hide the
   * departed frame's content one to two ticks later — a few frames of the old
   * scene squeezed under the new camera at the portal. Nav member sets are
   * DISJOINT across a cut, so the op stamps the canonical non-member state
   * (¬Active ∧ ¬Visible ∧ Culled) on EVERY equipped widget right now (ops run
   * outside the tick — the index-rebuild legality); the next tick's membership
   * resweep re-derives the new frame's members, and every renderer (DOM
   * mounts, GL island phases, ground wires, selection chrome) reads the same
   * canonical signal, so the old frame vanishes on the same reflect pass that
   * first applies the new camera.
   */
  const cutVisibility = (): void => {
    // Two-phase: world.* tag writes are IMMEDIATE (archetype moves) and
    // illegal mid-iteration — collect, then mutate.
    const all: Entity[] = [];
    world.query(equippedQ).each((b) => {
      for (const r of b) all.push(b.entity(r));
    });
    for (const e of all) {
      if (world.hasTag(e, Active)) world.removeTag(e, Active);
      if (world.hasTag(e, Visible)) world.removeTag(e, Visible);
      if (!world.hasTag(e, Culled)) world.addTag(e, Culled);
    }
  };

  /**
   * The DEFAULT framing for a frame: kernel `fitCamera` over its direct
   * content — zoom-to-fit (FIT_DEFAULTS.pad) capped into the NATURAL band
   * (FIT_DEFAULTS ∩ the session's CameraLimits: never past 100%, never
   * below 50% — 2026-07-18, James: "should feel natural"); identity when
   * empty/headless. Sizes are measured-when-real (the folder minis' rule —
   * arrival and portal preview must agree). The flight PATH may transit
   * outside the band; only the arrival honors it. No `ContainerCamera`
   * rider (design-006).
   */
  const resolveArrivalCamera = (frame: Entity): CameraState => {
    const frameTypeId = world.get(frame, PrefabId)?.id;
    const canvas =
      typeof frameTypeId === "string"
        ? engineCatalogFor(world)?.canvasForContainer(frameTypeId)
        : undefined;
    return resolveFrameView(world, frame, canvas, { isContainer: validContainer }).camera;
  };

  const snapCamera = (c: CameraState): void => {
    writeRuntimeResource(world, Camera, { x: c.x, y: c.y, zoom: c.zoom, gesturing: false });
  };

  /** Flights need a real viewport and no opt-out; headless snaps (pre-T1 behavior). */
  const flightable = (
    opts: NavOpts | undefined,
    fromFrame: Entity | undefined,
    toFrame: Entity | undefined,
  ): boolean => {
    const vp = world.getResource(Viewport);
    return (
      opts?.transition !== "none" &&
      (config.transitionAllowed?.(fromFrame, toFrame) ?? true) &&
      vp !== undefined &&
      vp.w > 0 &&
      vp.h > 0
    );
  };

  /** Container body rect in its parent frame's coords — the portal (§8.5: full body for now). */
  const containerRect = (c: Entity): { x: number; y: number; width: number; height: number } | undefined => {
    const typeId = world.get(c, PrefabId)?.id;
    const binding = typeof typeId === "string" ? widgetTypeFor(world, typeId)?.container : undefined;
    return resolvePortal(world, c, binding)?.parent;
  };

  const prepareSwitch = (
    kind: "enter" | "exit",
    fromCamera: CameraState,
    toCamera: CameraState,
    A: PortalAffine | undefined,
    identity: NavTransitionIdentity | undefined,
    requestedMotion: boolean,
  ): PreparedFrameSwitch | undefined =>
    config.prepareTransition?.(
      Object.freeze({
        kind,
        documentEpoch: identity?.documentEpoch ?? 0,
        fromFrame: identity?.fromFrame ?? (0 as Entity),
        toFrame: identity?.toFrame ?? (0 as Entity),
        fromTypeId: identity?.fromTypeId ?? "",
        toTypeId: identity?.toTypeId ?? "",
        fromCamera,
        toCamera,
        affine: A ?? { s: 1, ox: 0, oy: 0 },
        requestedMotion,
      }),
    );

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
          if (frame === undefined || !world.isAlive(frame) || !validContainer(frame)) {
            deadAt = Math.min(deadAt, world.read(e, NavDepth).d);
          }
        }
      });
      if (!Number.isFinite(deadAt)) return;
      const fromFrame = currentNavFrame(world);
      const fromCamera = world.getResource(Camera) ?? {
        x: 0,
        y: 0,
        zoom: 1,
        gesturing: false,
      };
      abortNavFlight(world); // integrity is never blocked on animation (design-006 §4)
      config.abortTransition?.("interrupted");
      let restore: { x: number; y: number; zoom: number } | undefined;
      let restoreTool: string | undefined;
      let targetFrame: Entity | undefined;
      let targetDepth = 0;
      ctx.query(navEntryQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const d = world.read(e, NavDepth).d;
          if (d >= deadAt) {
            if (d === deadAt) {
              const cam = world.read(e, NavCamera);
              restore = { x: cam.x, y: cam.y, zoom: cam.zoom };
              restoreTool = world.get(e, NavTool)?.id ?? undefined;
            }
            ctx.destroy(e);
          } else if (d > targetDepth) {
            const frame = world.getRelation(e, NavFrame);
            if (frame !== undefined && world.isAlive(frame) && validContainer(frame)) {
              targetDepth = d;
              targetFrame = frame;
            }
          }
        }
      });
      const arrival = restore ?? fromCamera;
      if (restore !== undefined) writeRuntimeResource(world, Camera, { ...restore, gesturing: false });
      // The same visibility cut the ops make (via ctx — this is a system):
      // an integrity pop swaps frames too, and stale content under the
      // restored camera is the same glitch.
      ctx.query(equippedQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (ctx.hasTag(e, Active)) ctx.removeTag(e, Active);
          if (ctx.hasTag(e, Visible)) ctx.removeTag(e, Visible);
          if (!ctx.hasTag(e, Culled)) ctx.addTag(e, Culled);
        }
      });
      let clearedSelection = false;
      ctx.query(selectedQ).each((b) => {
        for (const r of b) {
          ctx.removeTag(b.entity(r), Selected);
          clearedSelection = true;
        }
      });
      if (clearedSelection) bumpVersion(world, SelectionVersion);
      rebuildIndex();
      publishNavCut(
        world,
        "exit",
        fromCamera,
        arrival,
        config.transitionIdentity?.(fromFrame, targetFrame),
      );
      config.onSwitch?.(targetFrame, targetDepth, restoreTool);
    },
    {
      name: "navIntegrity",
      runIf: () => {
        // Cheap guard: any nav entry at all? (root sessions skip entirely)
        return world.firstOf(navEntryQ) !== undefined;
      },
    },
  );

  const exitTo = (targetDepth: number, opts?: NavOpts): void => {
    // Live entries, depth ascending; the deepest is the current frame.
    const entries: { e: Entity; d: number }[] = [];
    world.query(navEntryQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        entries.push({ e, d: world.read(e, NavDepth).d });
      }
    });
    entries.sort((a, b) => a.d - b.d);
    const deepest = entries[entries.length - 1];
    if (deepest === undefined || targetDepth < 0 || targetDepth >= deepest.d) return;
    const doomed = entries.filter((x) => x.d > targetDepth);
    const shallowest = doomed[0] as { e: Entity; d: number }; // non-empty by the guard
    // The shallowest doomed entry's saved camera is the restore point (the
    // camera as it was the moment that level was entered).
    const restore = world.read(shallowest.e, NavCamera);
    const restoreTool = world.get(shallowest.e, NavTool)?.id ?? undefined;
    const c1: CameraState = { x: restore.x, y: restore.y, zoom: restore.zoom };
    const camPre = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
    const fromFrame = currentNavFrame(world);
    const targetEntry = entries.find((entry) => entry.d === targetDepth);
    const targetFrame =
      targetEntry === undefined ? undefined : world.getRelation(targetEntry.e, NavFrame);

    // Compose the portal chain from CURRENT rects (containers move), outermost
    // first: A maps the departed frame's coords into the TARGET frame's. Any
    // dead/rect-less link degrades the whole jump to a snap — never half-fly.
    let A: PortalAffine | undefined;
    const vp = world.getResource(Viewport);
    if (vp !== undefined && vp.w > 0 && vp.h > 0) {
      for (const { e } of doomed) {
        const frame = world.getRelation(e, NavFrame);
        const K = frame !== undefined && world.isAlive(frame) ? containerRect(frame) : undefined;
        if (frame === undefined || K === undefined) {
          A = undefined;
          break;
        }
        const M = portalAffine(visibleRect(resolveArrivalCamera(frame), vp.w, vp.h), K);
        A = A === undefined ? M : composeAffine(A, M);
      }
    }
    const identity = config.transitionIdentity?.(fromFrame, targetFrame);
    const requestedMotion = A !== undefined && flightable(opts, fromFrame, targetFrame);

    config.beforeSwitch?.();
    const prepared = prepareSwitch("exit", camPre, c1, A, identity, requestedMotion);
    let authorityMutated = false;
    try {
      for (const { e } of doomed) {
        // ops run OUTSIDE the tick — structural world.* is legal here. Once
        // one entry is gone this attempt cannot be treated as a pre-cut
        // presentation rollback, even if a later operation faults.
        world.destroy(e);
        authorityMutated = true;
      }
      cutVisibility(); // BEFORE the camera write (see enterContainer)
      authorityMutated = true;
      if (A !== undefined && requestedMotion && (prepared?.allowFlight ?? true)) {
        startNavFlight(world, "exit", A, solveFlightStart(A, camPre), c1, identity);
      } else {
        snapCamera(c1);
        publishNavCut(world, "exit", camPre, c1, identity, A);
      }
      rebuildIndex();
      config.onSwitch?.(targetFrame, targetDepth, restoreTool);
      prepared?.commit();
    } catch (error) {
      prepared?.cancel(authorityMutated ? "fault" : "cancelled");
      throw error;
    }
  };

  return {
    activeMembership,
    navIntegrity,
    enterContainer(container, opts) {
      if (!world.isAlive(container) || !validContainer(container)) {
        throw new Error("ice: enterContainer target is not a live container.");
      }
      const fromFrame = currentNavFrame(world);
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      // §6.2 rev 2: the saved return pose is SETTLED — a driving flight saves its
      // arrival camera, never the mid-flight pose; an aborted flight's resting
      // pose is user truth and saves as-is.
      const flight = world.getResource(NavTransition);
      const returnCam =
        flight !== undefined && flight.active
          ? { x: flight.c1x, y: flight.c1y, zoom: flight.c1z }
          : cam;
      const depth = (currentNavEntry(world) !== undefined ? world.read(currentNavEntry(world) as Entity, NavDepth).d : 0) + 1;
      if (depth > maxDepth) {
        throw new Error(`ice: enterContainer would exceed the maximum CanvasFrame depth ${maxDepth}.`);
      }
      const c1 = resolveArrivalCamera(container);
      const K = containerRect(container);
      const vp = world.getResource(Viewport);
      const A =
        K !== undefined && vp !== undefined && vp.w > 0 && vp.h > 0
          ? invertAffine(portalAffine(visibleRect(c1, vp.w, vp.h), K))
          : undefined;
      const identity = config.transitionIdentity?.(fromFrame, container);
      const requestedMotion = A !== undefined && flightable(opts, fromFrame, container);
      config.beforeSwitch?.();
      const prepared = prepareSwitch("enter", cam, c1, A, identity, requestedMotion);
      let authorityMutated = false;
      try {
        const entry = world.spawn({
          components: [
            [NavDepth, { d: depth }],
            [NavCamera, { x: returnCam.x, y: returnCam.y, zoom: returnCam.zoom }],
            [NavTool, { id: world.getResource(ActiveTool)?.id ?? "select" }],
          ],
        });
        authorityMutated = true;
        world.setRelation(entry, NavFrame, container);
        cutVisibility(); // BEFORE the camera write — no frame may render old content under the new camera
        if (A !== undefined && requestedMotion && (prepared?.allowFlight ?? true)) {
          // A = M⁻¹: parent (departed) coords → child (destination) coords.
          startNavFlight(world, "enter", A, solveFlightStart(A, cam), c1, identity);
        } else {
          snapCamera(c1);
          publishNavCut(world, "enter", cam, c1, identity, A);
        }
        rebuildIndex();
        config.onSwitch?.(container, depth, undefined);
        prepared?.commit();
      } catch (error) {
        prepared?.cancel(authorityMutated ? "fault" : "cancelled");
        throw error;
      }
    },
    exitContainer(opts) {
      const entry = currentNavEntry(world);
      if (entry === undefined) return; // already at root
      exitTo(world.read(entry, NavDepth).d - 1, opts);
    },
    exitTo,
    depth() {
      const entry = currentNavEntry(world);
      return entry === undefined ? 0 : world.read(entry, NavDepth).d;
    },
  };
}
