// @vitest-environment node
// `Engine.afterStep` (design-015 §9, D2b): a hook that runs once every `step` is over — after the
// reflectors, outside the tick — in registration order, removable; where the facade applies the nav
// op a system asked for inside the tick (`NavIntent`), whichever `step` a host loop drives (the dom
// loop drives the raw engine, not the facade's passthrough).
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { Camera, createEngine } from "../src";

describe("Engine.afterStep (D2b)", () => {
  it("runs after each step, after the reflectors, in registration order; a removed hook runs no more", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const log: string[] = [];
    engine.registerReflector({ name: "witness", observe: { resources: [Camera] }, flush: () => { log.push("reflect"); } });
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const removeA = engine.afterStep(() => log.push("a"));
    engine.afterStep(() => log.push("b"));
    engine.step(16);
    expect(log.slice(-2)).toEqual(["a", "b"]);
    expect(log.indexOf("reflect")).toBeLessThan(log.indexOf("a"));
    removeA();
    log.length = 0;
    engine.step(32);
    expect(log.filter((l) => l === "a")).toHaveLength(0);
    expect(log.filter((l) => l === "b")).toHaveLength(1);
  });
});
