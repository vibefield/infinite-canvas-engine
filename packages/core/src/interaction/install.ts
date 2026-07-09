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
import { CanvasSurface } from "../catalog";
import { createRecordingCommitSink, type CommitSink } from "../engine/commit-sink";
import type { Engine } from "../engine/engine";
import type { InputQueue } from "../input/queue";
import { createInputQueue } from "../input/queue";
import { createCleanupSystems } from "../systems/cleanup";
import { createL0Systems } from "../systems/l0-input";
import { createArbitrationSystems } from "../systems/l2-arbitrate";
import { createL2Systems, type SpawnProfiles } from "../systems/l2-recognize";
import { createClaimSystems } from "../systems/l3-claim";
import { createSelectMoveBehaviors } from "../systems/l3-behave";

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
  const arb = createArbitrationSystems();
  const claims = createClaimSystems(world);
  const behaviors = createSelectMoveBehaviors(world, sink);
  const cleanup = createCleanupSystems(world);

  const removers = [
    // input: lifecycle BEFORE ingest (value-based up+1 destroy; see l0-input.ts).
    engine.addSystems("input", l0.pointerLifecycle, l0.pointerIngest, l0.pointerWorldSync),
    engine.addSystems("ctl:spawn", l2.cancelSweep, l2.recognizerSpawn, l2.wheelSpawn, l2.recognizerIntegrity),
    engine.addSystems(
      "ctl:recognize",
      l2.tapSystem,
      l2.longPressSystem,
      l2.dragSystem,
      l2.pinchSystem,
      l2.wheelSystem,
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
