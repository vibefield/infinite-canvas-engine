/**
 * Headless M3 exit-number harness (design-002 §5 O(1) pan; design-001 §7 churn
 * budget). Runs BOTH scripted harnesses under happy-dom with no rAF — engine.step
 * is driven in a loop — and asserts the write-counter budgets EXACTLY.
 *
 * NOTE: happy-dom frame times understate real-browser DOM cost (its layout/paint
 * is a stub), so the frame-µs block below is the ECS-side tick time only and is
 * logged, not asserted. The meaningful, browser-independent measurements are the
 * write COUNTERS — those are asserted to the exact budget.
 */
import { Camera, createEngine, createWorld, type Engine } from "@ice/core";
import { createCanvasHost, createGrayboxReflector, createPlaneTransformReflector } from "@ice/dom";
import { describe, expect, it } from "vitest";
import { scriptedDrag, scriptedPan } from "../src/harness";
import { spawnScene } from "../src/scene";

const NODES = 10_000;
const FRAMES = 150;

function makeStack(): {
  engine: Engine;
  reflectors: { plane: ReturnType<typeof createPlaneTransformReflector>; graybox: ReturnType<typeof createGrayboxReflector> };
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const engine = createEngine(world);
  const plane = createPlaneTransformReflector(host);
  const graybox = createGrayboxReflector(host);
  engine.registerReflector(plane);
  engine.registerReflector(graybox);
  spawnScene(world, { count: NODES });
  engine.enableTelemetry();
  return { engine, reflectors: { plane, graybox } };
}

describe("scripted harness — M3 exit numbers", () => {
  it("O(1) pan: exactly one transform write per frame, zero gray-box style writes", () => {
    const { engine, reflectors } = makeStack();
    const r = scriptedPan(engine, reflectors, FRAMES);

    console.log("[graybox] scriptedPan frame µs:", r.frameMicros);
    expect(r.transformWrites).toBe(FRAMES);
    expect(r.styleWrites).toBe(0);
    expect(reflectors.graybox.nodeCount()).toBe(NODES);
  });

  it("churn budget: one gray-box style write per dragged frame, zero transform writes, zero migrations", () => {
    const { engine, reflectors } = makeStack();
    const r = scriptedDrag(engine, reflectors, FRAMES);

    console.log("[graybox] scriptedDrag frame µs:", r.frameMicros);
    expect(r.styleWrites).toBe(FRAMES); // exactly the one dragged entity, once per frame
    expect(r.transformWrites).toBe(0); // camera static
    expect(r.nodeDelta).toBe(0); // no enter/exit ⇒ no migrations/tag flips
  });
});
