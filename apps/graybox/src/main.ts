/**
 * Gray-box demo entry: the M3 stack wired end-to-end.
 *
 *   createWorld → createEngine → createCanvasHost(#app)
 *   → register plane-transform + gray-box + HUD reflectors
 *   → spawn 10k-box scene → attach demo pan/zoom → enable telemetry → rAF loop
 *
 * Pan with a pointer drag, zoom with the wheel; press `p`/`d` to run the scripted
 * pan / drag measurement harnesses (numbers land in the console + the HUD).
 */
import { Camera, createEngine, createWorld } from "@ice/core";
import {
  attachDemoPanZoom,
  createCanvasHost,
  createGrayboxReflector,
  createPlaneTransformReflector,
  startRafLoop,
} from "@ice/dom";
import { createHudReflector } from "./hud";
import { installHarnessHotkeys } from "./harness";
import { spawnScene } from "./scene";

function boot(): void {
  const appEl = document.getElementById("app");
  if (appEl === null) throw new Error("graybox demo: #app element not found");

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(appEl);

  // Frame the seeded scene (centered on the world origin) into the viewport.
  const zoom = 0.12;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  world.setResource(Camera, { x: -vw / 2 / zoom, y: -vh / 2 / zoom, zoom, gesturing: false });

  const plane = createPlaneTransformReflector(host);
  const graybox = createGrayboxReflector(host);
  engine.registerReflector(plane);
  engine.registerReflector(graybox);
  engine.registerReflector(createHudReflector({ engine, host, plane, graybox }));

  spawnScene(world, { count: 10_000 });
  attachDemoPanZoom(host, world);
  installHarnessHotkeys(engine, { plane, graybox });

  engine.enableTelemetry();
  startRafLoop(engine);
}

boot();
