/**
 * Headless M4 exit-number harness (design-002 §5 O(1) pan; design-001 §7 churn
 * budget). Both scripted harnesses run under happy-dom with no rAF — engine.step
 * is driven in a loop — through the REAL interaction stack, and the write-counter
 * budgets are asserted EXACTLY. The pan is now produced by synthetic pointer
 * events on the queue (L0 → cameraControl), not a direct Camera poke, so the
 * O(1) property is proven end-to-end.
 *
 * NOTE: happy-dom frame times understate real-browser DOM cost (its layout/paint
 * is a stub), so the frame-µs block is the ECS-side tick time only and is logged,
 * not asserted. The meaningful, browser-independent measurements are the write
 * COUNTERS — those are asserted to the exact budget.
 */
import {
  ActiveTool,
  Camera,
  createCameraSystems,
  createEngine,
  createWorld,
  installInteractionCore,
  type Engine,
  type InputQueue,
} from "@ice/core";
import { createCanvasHost, createGrayboxReflector, createPlaneTransformReflector } from "@ice/dom";
import { describe, expect, it } from "vitest";
import { scriptedDrag, scriptedPan } from "../src/harness";
import { spawnScene } from "../src/scene";

const NODES = 10_000;
const FRAMES = 150;

/**
 * The pan run needs the real interaction stack (L0 → cameraControl); the drag run
 * measures raw `simulate` churn and installs only its own one-entity mover, so it
 * stays stack-free (two Position writers in one phase is a legitimate advisory).
 */
function makeStack(withInteraction: boolean): {
  engine: Engine;
  queue: InputQueue | undefined;
  reflectors: { plane: ReturnType<typeof createPlaneTransformReflector>; graybox: ReturnType<typeof createGrayboxReflector> };
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const engine = createEngine(world);

  let queue: InputQueue | undefined;
  if (withInteraction) {
    // No picking is installed, so a synthetic canvas drag captures the canvas and
    // (under the pan tool) routes to pan — never a widget move.
    const core = installInteractionCore(engine);
    world.setResource(ActiveTool, { id: "pan" });
    const cam = createCameraSystems(world);
    engine.addSystems("ctl:behave", cam.cameraControl);
    engine.addSystems("simulate", cam.cameraInertia, cam.tweenSystem);
    queue = core.queue;
  }

  const plane = createPlaneTransformReflector(host);
  const graybox = createGrayboxReflector(host);
  engine.registerReflector(plane);
  engine.registerReflector(graybox);
  spawnScene(world, { count: NODES });
  engine.enableTelemetry();
  return { engine, queue, reflectors: { plane, graybox } };
}

describe("scripted harness — M4 exit numbers (queue-driven)", () => {
  it("O(1) pan: exactly one transform write per frame, zero gray-box style writes", () => {
    const { engine, queue, reflectors } = makeStack(true);
    if (queue === undefined) throw new Error("pan stack must expose the input queue");
    const r = scriptedPan(engine, reflectors, queue, FRAMES);

    console.log("[graybox] scriptedPan frame µs:", r.frameMicros);
    expect(r.transformWrites).toBe(FRAMES);
    expect(r.styleWrites).toBe(0);
    expect(reflectors.graybox.nodeCount()).toBe(NODES);
  });

  it("churn budget: one gray-box style write per dragged frame, zero transform writes, zero migrations", () => {
    const { engine, reflectors } = makeStack(false);
    const r = scriptedDrag(engine, reflectors, FRAMES);

    console.log("[graybox] scriptedDrag frame µs:", r.frameMicros);
    expect(r.styleWrites).toBe(FRAMES); // exactly the one dragged entity, once per frame
    expect(r.transformWrites).toBe(0); // camera static
    expect(r.nodeDelta).toBe(0); // no enter/exit ⇒ no migrations/tag flips
  });
});
