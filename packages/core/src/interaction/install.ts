/**
 * Interaction-stack installation (design-002 §2 phase layout × design-003).
 *
 * Composable: `installInteractionCore` wires the M4 spine (L0 ingest, L2
 * lifecycle + kinds + arbitration, ctl:claim, select/move behaviors, cleanup).
 * Later slices (picking, snap, drop, resize, marquee, camera) install through
 * their own module functions into the same phase groups — group order is the
 * only ordering contract between them; within-group order is the design-003 §5
 * in-phase order, so later installers pass explicit `before`-free appends in
 * the documented sequence.
 *
 * The canvas-surface anchor entity is guaranteed here (design-001 §4: picking
 * always resolves to SOMETHING; L0 ingest schedules on it).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { defineQuery } from "@vibecook/strata-ecs";
import { SpatialIndex } from "@ice/kernel";
import { CanvasSurface } from "../catalog";
import { createRecordingCommitSink, type CommitSink } from "../engine/commit-sink";
import type { Engine } from "../engine/engine";
import type { InputQueue } from "../input/queue";
import { createInputQueue } from "../input/queue";
import { createCameraSystems } from "../systems/camera-sim";
import { createCleanupSystems } from "../systems/cleanup";
import { createL0Systems } from "../systems/l0-input";
import { createNavFlight } from "../systems/nav-flight";
import { createPickingSystems } from "../systems/l1-pick";
import { createWireSync } from "../systems/l1-wires";
import { createArbitrationSystems } from "../systems/l2-arbitrate";
import { createL2Systems, type SpawnProfiles } from "../systems/l2-recognize";
import { createSelectMoveBehaviors } from "../systems/l3-behave";
import { createClaimSystems } from "../systems/l3-claim";
import { createConnectSystems, type WirePreviewBuffer } from "../systems/l3-connect";
import { createDropSystem, type DropPlacementPolicy } from "../systems/l3-drop";
import { createMarqueeBehavior, type MarqueeBuffer } from "../systems/l3-marquee";
import { createPortMaterialize } from "../systems/l3-ports";
import { createResizeBehavior } from "../systems/l3-resize";
import { createSnapSystem } from "../systems/l3-snap";
import { createSelectionChromeSystem } from "../systems/chrome";
import { createDrawBehavior } from "../systems/l3-draw";
import { createInsertGhostReap } from "../systems/insert-ghost";
import { createCursorSync } from "../systems/l4-cursor";

const canvasSurfaceQ = defineQuery([CanvasSurface]);

/** Ensure the guaranteed pick-fallback entity exists (idempotent; outside tick). */
export function ensureCanvasSurface(world: World): Entity {
  const existing = world.firstOf(canvasSurfaceQ);
  if (existing !== undefined) return existing;
  return world.spawn({ tags: [CanvasSurface] });
}

export interface InteractionCoreOpts {
  readonly queue?: InputQueue;
  readonly sink?: CommitSink;
  readonly profiles?: SpawnProfiles;
  /** Typed Canvas SDK placement truth; omission retains compatibility cells. */
  readonly placement?: DropPlacementPolicy;
}

export interface InteractionCore {
  readonly queue: InputQueue;
  readonly sink: CommitSink;
  readonly canvasSurface: Entity;
  /** Remove every installed system (HMR / doc switch). */
  uninstall(): void;
}

export function installInteractionCore(engine: Engine, opts: InteractionCoreOpts = {}): InteractionCore {
  const world = engine.world;
  const queue = opts.queue ?? createInputQueue();
  const sink = opts.sink ?? createRecordingCommitSink();
  const canvasSurface = ensureCanvasSurface(world);

  const l0 = createL0Systems(world, queue);
  const l2 = createL2Systems({ world, ...(opts.profiles ? { profiles: opts.profiles } : {}) });
  const arb = createArbitrationSystems(world);
  const claims = createClaimSystems(world);
  const behaviors = createSelectMoveBehaviors(world, sink);
  const cleanup = createCleanupSystems(world);

  const removers = [
    // input: lifecycle BEFORE ingest (value-based up+1 destroy; see l0-input.ts).
    engine.addSystems("input", l0.pointerLifecycle, l0.pointerIngest, l0.pointerWorldSync),
    engine.addSystems("ctl:spawn", l2.cancelSweep, l2.recognizerSpawn, l2.wheelSpawn, l2.recognizerIntegrity),
    // dependency LAST in ctl:recognize: its Pending resolutions flush at the
    // group boundary, so arbitration sees their Just* markers this frame.
    engine.addSystems(
      "ctl:recognize",
      l2.tapSystem,
      l2.longPressSystem,
      l2.dragSystem,
      l2.pinchSystem,
      l2.wheelSystem,
      l2.dependencySystem,
    ),
    engine.addSystems("ctl:arbitrate", arb.arbitration, arb.dragRoute),
    engine.addSystems("ctl:claim", claims.moveClaim, claims.resizeClaim),
    // design-003 §5 in-phase order: select → (snap) → move → (drop) → … later
    // installers splice their systems by installing in the documented sequence.
    engine.addSystems("ctl:behave", behaviors.selectBehavior, behaviors.moveBehavior),
    engine.addSystems("cleanup", cleanup.recognizerReap, cleanup.oneTickClear),
  ];

  return {
    queue,
    sink,
    canvasSurface,
    uninstall() {
      for (const remove of removers) remove();
    },
  };
}

export interface InteractionStack extends InteractionCore {
  /** The one spatial index (picking/snap/drop/marquee/wires/ports share it). */
  readonly index: SpatialIndex<Entity>;
  /** Marquee preview render buffer (out-of-ECS by design — design-003 §5.7). */
  readonly marqueeBuffer: MarqueeBuffer;
  /** Connect preview render buffer (out-of-ECS — design-004 §6; M8). */
  readonly wirePreview: WirePreviewBuffer;
  /** Nav-op seam (design-004 §7): forget spatialSync's last-known AABBs. */
  clearCaches(): void;
  /** L4 cursor readout for the DOM cursor reflector. */
  readCursor(): string;
}

/**
 * The FULL M4 stack. Not a wrapper over `installInteractionCore`: within-group
 * order is registration order and design-003 §5's in-phase sequence
 * (select → snap → move → drop → resize → marquee → camera) interleaves spine
 * and non-spine systems, so the full installer registers everything itself in
 * the documented order. `installInteractionCore` remains the spine-only slice
 * (what the spine traces run against).
 */
export function installInteractionStack(engine: Engine, opts: InteractionCoreOpts = {}): InteractionStack {
  const world = engine.world;
  const queue = opts.queue ?? createInputQueue();
  const sink = opts.sink ?? createRecordingCommitSink();
  const canvasSurface = ensureCanvasSurface(world);

  const l0 = createL0Systems(world, queue);
  // The shared index is built HERE so wireSync (its source) and picking (its
  // consumer of that source) can both bind it before either installs.
  const index = new SpatialIndex<Entity>();
  const { wireSync, wires } = createWireSync(world, index);
  const pick = createPickingSystems(world, index, wires);
  const l2 = createL2Systems({ world, ...(opts.profiles ? { profiles: opts.profiles } : {}) });
  const arb = createArbitrationSystems(world);
  const claims = createClaimSystems(world);
  const behaviors = createSelectMoveBehaviors(world, sink);
  const snap = createSnapSystem(world, index);
  const drop = createDropSystem(world, index, opts.placement);
  const resize = createResizeBehavior(world, sink);
  const marquee = createMarqueeBehavior(world, index);
  const connect = createConnectSystems(world, sink, index, wires);
  const ports = createPortMaterialize(world, index);
  const camera = createCameraSystems(world);
  const cursor = createCursorSync(world);
  const cleanup = createCleanupSystems(world);

  const removers = [
    engine.addSystems("input", l0.pointerLifecycle, l0.pointerIngest, l0.pointerWorldSync),
    // wireSync AFTER spatialSync (both SpatialVersion writers), BEFORE picking —
    // which now narrow-phases wire entries against wireSync's cached cubics.
    engine.addSystems("react", pick.spatialSync, wireSync, pick.picking),
    engine.addSystems("ctl:spawn", l2.cancelSweep, l2.recognizerSpawn, l2.wheelSpawn, l2.recognizerIntegrity),
    engine.addSystems(
      "ctl:recognize",
      l2.tapSystem,
      l2.longPressSystem,
      l2.dragSystem,
      l2.pinchSystem,
      l2.wheelSystem,
      l2.dependencySystem,
    ),
    engine.addSystems("ctl:arbitrate", arb.arbitration, arb.dragRoute),
    engine.addSystems("ctl:claim", claims.moveClaim, claims.resizeClaim, connect.connectClaim),
    // design-003 §5 in-phase order (value writes are immediately visible; the
    // order IS the contract): select → snap → move → drop → resize → marquee →
    // connect → camera.
    engine.addSystems(
      "ctl:behave",
      behaviors.selectBehavior,
      snap,
      behaviors.moveBehavior,
      drop,
      resize,
      marquee,
      connect.connectBehavior,
      createDrawBehavior(world, sink),
      camera.cameraControl,
    ),
    // navFlight AFTER cameraControl's group (ctl:behave): a gesture going
    // Active stamps Camera.gesturing THIS frame, so the flight yields
    // same-frame (design-006 §4 "touch always wins").
    engine.addSystems("simulate", camera.cameraInertia, camera.tweenSystem, createNavFlight(world)),
    // derive order: portMaterialize BEFORE selectionChrome (both touch the index
    // in derive; ports must be indexed before chrome/next-frame picking read it),
    // selectionChrome BEFORE cursor (handles spawn at the derive flush so cursor
    // + next frame's spatialSync see them).
    engine.addSystems("derive", ports, createSelectionChromeSystem(world), cursor),
    // insertGhostReap AFTER recognizerReap: it reads terminal phase tags on
    // capturing recognizers pre-flush (deferred destroys land at the group
    // boundary), and its own despawns must not race the marker sweep.
    engine.addSystems("cleanup", cleanup.recognizerReap, cleanup.oneTickClear, createInsertGhostReap(world)),
  ];

  return {
    queue,
    sink,
    canvasSurface,
    index,
    marqueeBuffer: marquee.buffer,
    wirePreview: connect.previewBuffer,
    clearCaches: () => pick.clearCaches(),
    readCursor: cursor.readCursor,
    uninstall() {
      for (const remove of removers) remove();
    },
  };
}
