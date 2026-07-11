/**
 * Assembles the pointerlab world — v2 world.ts's role, but the pipeline is the
 * v3 ENGINE's: createEngine + installInteractionStack bring L0–L4 (ingest,
 * picking, recognizers incl. the restored Pending machinery, arbitration,
 * select/move/resize/marquee behaviors, camera control + inertia, chrome,
 * cleanup). The app adds only its presentation systems (cursors, fake remotes)
 * and its scene.
 *
 * Settings parity with the v2 prototype: 45px pick disc on every device (the
 * ring IS the pick reach), 4px release dead-band (engine default = v2's), zoom
 * clamp [0.2, 5], snapping OFF (v2 had none).
 */
import {
  ActiveTool,
  Camera,
  CameraLimits,
  PointerSettings,
  SnapConfig,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  installInteractionStack,
  type Engine,
  type InteractionStack,
  type World,
} from "@ice/core";
import { RING_RADIUS_PX } from "./components";
import { ZOOM_MAX, ZOOM_MIN } from "./camera";
import { createCursorSystems } from "./cursor";
import { createRemoteSystems, spawnRemotePointers } from "./remote";
import { spawnTargets } from "./target";

export interface PointerWorld {
  world: World;
  engine: Engine;
  stack: InteractionStack;
}

export function createPointerWorld(): PointerWorld {
  const world = createWorld();
  const engine = createEngine(world);
  const stack = installInteractionStack(engine, { sink: createRecordingCommitSink() });

  world.setResource(ActiveTool, { id: "select" });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(CameraLimits, { minZoom: ZOOM_MIN, maxZoom: ZOOM_MAX });
  world.setResource(PointerSettings, {
    radiusMousePx: RING_RADIUS_PX,
    radiusTouchPx: RING_RADIUS_PX,
    radiusPenPx: RING_RADIUS_PX,
    hoverReleaseDeadBandPx: 4,
  });
  world.setResource(SnapConfig, { enabled: false, thresholdPx: 5 });

  spawnTargets(world);
  spawnRemotePointers(world, 4);

  const cursor = createCursorSystems();
  const remote = createRemoteSystems(world);
  engine.addSystems("input", remote.remotePresence, remote.fakeRemoteDriver);
  engine.addSystems("react", cursor.cursorSpawn);
  engine.addSystems("simulate", cursor.follower, cursor.localVisual, cursor.remoteVisual);
  engine.addSystems("cleanup", cursor.cursorReap);

  return { world, engine, stack };
}
