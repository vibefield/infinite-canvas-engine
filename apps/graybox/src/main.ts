/**
 * Gray-box demo entry — the FULL M4 interaction stack wired end-to-end.
 *
 *   createWorld → createEngine → createCanvasHost(#app)
 *   → installInteractionStack (L0 ingest, L1 REAL picking + spatial index,
 *     L2 recognizers/arbitration/claims, select/snap/move/drop/resize/marquee
 *     behaviors, camera control + inertia + fly-back, L4 cursor)
 *   → plane-transform + gray-box + cursor + HUD reflectors
 *   → spawn the scene → attach the real pointer adapter → telemetry → rAF loop
 *
 * Interaction (select tool): tap a box to select (shift toggles), drag a box to
 * move it (select-on-grab, snap when near neighbors), drag empty canvas to
 * MARQUEE-select; space-drag / middle-drag pan; wheel + trackpad pinch zoom
 * about the cursor; touch: one-finger canvas drag pans, two free fingers pinch.
 * `p` / `d` run the scripted pan / drag measurement harnesses.
 */
import {
  ActiveTool,
  Camera,
  Viewport,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  installInteractionStack,
} from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createCursorReflector,
  createGrayboxReflector,
  createPlaneTransformReflector,
  startRafLoop,
} from "@ice/dom";
import { installHarnessHotkeys } from "./harness";
import { createHudReflector } from "./hud";
import { spawnScene } from "./scene";

function boot(): void {
  const appEl = document.getElementById("app");
  if (appEl === null) throw new Error("graybox demo: #app element not found");

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(appEl);

  // Frame the seeded scene (centered on the origin) into the viewport.
  const zoom = 0.12;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  world.setResource(Camera, { x: -vw / 2 / zoom, y: -vh / 2 / zoom, zoom, gesturing: false });

  // Viewport is an app-handler resource write (design-002 §3) — measured now and
  // on resize. The pointer adapter never touches the world (Law 2).
  const measure = (): void => {
    const rect = appEl.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    world.setResource(Viewport, { w: rect.width, h: rect.height, dpr });
  };
  measure();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(appEl);

  // The full stack, select tool: canvas drag marquees; space/middle/touch pan.
  const sink = createRecordingCommitSink(); // HUD reads the intent tally
  const stack = installInteractionStack(engine, { sink });
  world.setResource(ActiveTool, { id: "select" });

  const plane = createPlaneTransformReflector(host);
  const graybox = createGrayboxReflector(host);
  engine.registerReflector(plane);
  engine.registerReflector(graybox);
  engine.registerReflector(createCursorReflector(host, stack.readCursor));
  engine.registerReflector(createHudReflector({ engine, host, plane, graybox, sink }));

  spawnScene(world, { count: 10_000 });
  attachPointerAdapter(host, stack.queue);
  installHarnessHotkeys(engine, { plane, graybox }, stack.queue);

  engine.enableTelemetry();
  startRafLoop(engine);
}

boot();
