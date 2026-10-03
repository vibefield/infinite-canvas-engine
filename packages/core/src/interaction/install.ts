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
import { interactionDue, wakefulQueue } from "./wakes";
import { createCameraSystems } from "../systems/camera-sim";
import { createCleanupSystems } from "../systems/cleanup";
import { createL0Systems } from "../systems/l0-input";
import { createNavFlight } from "../systems/nav-flight";
import { createPickingSystems, type FramePickSlot, type PointPick } from "../systems/l1-pick";
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
import { createHeldInput, type HeldPoseSlot } from "../systems/held";
import { createPressWheel } from "../systems/press-wheel";
import { createTrayInput, createTrayLay, type TrayPoseSlot } from "../systems/tray";
import { ensureTray } from "../ops/tray";
import { createNavTap } from "../systems/nav-tap";
import { createZoomThrough } from "../systems/zoom-through";
import type { NavGeometrySlot } from "../nav/nav-geometry";

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
  /** Is this entity a container the engine may ENTER (the facade's catalog-backed test; design-015 §9's gesture and zoom-through)? Default: the `Container` tag. */
  readonly isContainer?: (entity: Entity) => boolean;
  /** Is this entity an object that OPENS (design-015 §8's double-tap; the facade's catalog-backed test — its type declares `openable`)? Default: nothing opens. */
  readonly isOpenable?: (entity: Entity) => boolean;
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
  // the adapters' one door wakes a sleeping loop (K7a, engine/frame-control.ts)
  const queue = wakefulQueue(opts.queue ?? createInputQueue(), () => engine.frame.wake("input"));
  const sink = opts.sink ?? createRecordingCommitSink();
  const canvasSurface = ensureCanvasSurface(world);

  const l0 = createL0Systems(world, queue);
  const l2 = createL2Systems({ world, ...(opts.profiles ? { profiles: opts.profiles } : {}) });
  const arb = createArbitrationSystems(world);
  const claims = createClaimSystems(world);
  const behaviors = createSelectMoveBehaviors(world, sink);
  const cleanup = createCleanupSystems(world);

  const removers = [
    // the stack's registered wake (K7a, interaction/wakes.ts): due every frame while its time-driven work is pending
    engine.frame.wakeWhen("interaction", interactionDue(world, queue)),
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
  /** The frame pick source's slot (design-014, B3b): the ground layer sets `current` at mount, clears it at dispose. */
  readonly framePick: FramePickSlot;
  /**
   * The exact pick OUT of the tick (petition I27; l1-pick `pickAt`): what a press at a SCREEN point (CSS px of the view) would touch
   * now — `picking`'s own `TouchesExact` body on the world as the last tick left it, through the frame source above; `undefined` over
   * the bare canvas and while the pegboard drawer is out. Read-only. The desk's `handle.pick` reaches it through its mount context.
   */
  pickAt(sx: number, sy: number): PointPick | undefined;
  /**
   * The nav geometry seam (design-015 §9; D2b) beside `framePick`: the renderer's word on a
   * container's DRAWN face, the inside's arrival and the exact cut camera — core's nav, the
   * zoom-through and the drop-into read it when set; the renderer sets it at mount, clears it at dispose.
   */
  readonly navGeometry: NavGeometrySlot;
  /**
   * The held pose seam (design-015 §8; D4b) beside the two above: the renderer's word on where the object in
   * hand is ON SCREEN this frame, through which every pointer is mapped while something is held; the renderer
   * sets it at mount, clears it at dispose.
   */
  readonly heldPose: HeldPoseSlot;
  /**
   * The tray pose seam (design-017 §4; K3) beside `heldPose`: the renderer's word on where the pegboard drawer is ON SCREEN this
   * frame (its rect mid-slide, its scroll range), which the tray's input hit-tests and clamps by; set at mount, cleared at dispose.
   */
  readonly trayPose: TrayPoseSlot;
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
  // the adapters' one door wakes a sleeping loop (K7a, engine/frame-control.ts)
  const queue = wakefulQueue(opts.queue ?? createInputQueue(), () => engine.frame.wake("input"));
  const sink = opts.sink ?? createRecordingCommitSink();
  const canvasSurface = ensureCanvasSurface(world);

  const l0 = createL0Systems(world, queue);
  // The shared index is built HERE so wireSync (its source) and picking (its
  // consumer of that source) can both bind it before either installs.
  const index = new SpatialIndex<Entity>();
  const { wireSync, wires } = createWireSync(world, index);
  // The frame pick source's slot (design-014, B3b): the ground layer fills it at mount.
  const framePick: FramePickSlot = { current: null };
  const pick = createPickingSystems(world, index, wires, framePick);
  // The nav geometry seam (design-015 §9; D2b): the renderer fills it at mount.
  const navGeometry: NavGeometrySlot = { current: null };
  const navOpts = { navGeometry, ...(opts.isContainer !== undefined ? { isContainer: opts.isContainer } : {}), ...(opts.isOpenable !== undefined ? { isOpenable: opts.isOpenable } : {}) };
  // The held pose seam (design-015 §8; D4b): the renderer fills it at mount; the held input maps every pointer through it.
  const heldPose: HeldPoseSlot = { current: null };
  // The tray pose seam (design-017 §4; K3): the renderer fills it at mount; the tray's input hit-tests through it. Its facts' entity, one per view.
  const trayPose: TrayPoseSlot = { current: null };
  ensureTray(world);
  const l2 = createL2Systems({ world, ...(opts.profiles ? { profiles: opts.profiles } : {}) });
  const arb = createArbitrationSystems(world);
  const claims = createClaimSystems(world);
  const behaviors = createSelectMoveBehaviors(world, sink, { navGeometry });
  const snap = createSnapSystem(world, index);
  const drop = createDropSystem(world, index, opts.placement, navGeometry);
  const resize = createResizeBehavior(world, sink);
  const marquee = createMarqueeBehavior(world, index);
  const connect = createConnectSystems(world, sink, index, wires);
  const ports = createPortMaterialize(world, index);
  const camera = createCameraSystems(world);
  const cursor = createCursorSync(world);
  const cleanup = createCleanupSystems(world);

  const removers = [
    // the stack's registered wake (K7a, interaction/wakes.ts): due every frame while its time-driven work is pending
    engine.frame.wakeWhen("interaction", interactionDue(world, queue)),
    engine.addSystems("input", l0.pointerLifecycle, l0.pointerIngest, l0.pointerWorldSync),
    // heldInput at the HEAD of react (design-015 §8, D4b): the ingest's one-tick tags (WentDown/WentUp) are flushed at the
    // phase boundary, so here it sees the press; its own `HandledByWidget`/`WheelHandled` flush before ctl — the recognizers
    // and both wheel consumers never see a pointer while an object is in hand. Picking still runs (the hover relations), harmless.
    // wireSync AFTER spatialSync (both SpatialVersion writers), BEFORE picking —
    // which now narrow-phases wire entries against wireSync's cached cubics.
    // pressWheel beside it (D3t-a): a press holding a `WheelTurns` widget takes its pointer's wheel from both wheel consumers too.
    // trayInput right after the hand's (design-017 §4, K3): the pegboard drawer's wheel, its board and its inert desk, in the same vocabulary
    engine.addSystems("react", createHeldInput(world, { pose: heldPose }), createTrayInput(world, { pose: trayPose }), createTrayLay(world, { pose: trayPose, placement: opts.placement }), createPressWheel(world), pick.spatialSync, wireSync, pick.picking),
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
      // design-015 §9 (D2b): the enter GESTURE after the select (the first tap selects, the
      // second asks to enter) and the zoom-through after the camera (it reads this frame's
      // wheel zoom). Both ask through `NavIntent`; the facade applies it after the tick.
      createNavTap(world, navOpts),
      createZoomThrough(world, navOpts),
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
    framePick,
    pickAt: (sx, sy) => pick.pickAt(sx, sy),
    navGeometry,
    heldPose,
    trayPose,
    clearCaches: () => pick.clearCaches(),
    readCursor: cursor.readCursor,
    uninstall() {
      for (const remove of removers) remove();
    },
  };
}
