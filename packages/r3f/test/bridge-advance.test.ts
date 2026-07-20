/**
 * Reflect-phase advance traces (design-004 §3 amendment, 2026-07-20 — the
 * pan-lag fix). The contract under test: the composite render fires INSIDE
 * `engine.step` (same flush as the DOM reflectors — same presented frame as
 * the camera write that caused it), exactly once per step, latched while
 * GLViews is unmounted, rate-capped for ambient animation via the injected
 * clock, and never recursive when pass code re-latches mid-render.
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "@vibecook/strata-ecs";
import { Camera, Viewport, createEngine } from "@ice/core";
import { createGLBridge } from "../src/bridge";

function createRig(clock: { t: number }) {
  const world = createWorld();
  const engine = createEngine(world);
  const bridge = createGLBridge(engine, { now: () => clock.t });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
  let now = 0;
  const step = (): void => {
    now += 16;
    engine.step(now);
  };
  return { world, engine, bridge, step };
}

describe("reflect-phase advance", () => {
  it("renders synchronously inside the step that wrote the camera, seeing the fresh value", () => {
    const clock = { t: 1000 };
    const { world, bridge, step } = createRig(clock);
    const seen: number[] = [];
    let inStep = false;
    bridge.setRenderNow(() => {
      expect(inStep).toBe(true); // the render is part of the flush, not a later task
      seen.push(world.getResource(Camera)?.x ?? Number.NaN);
    });

    inStep = true;
    step(); // registration dirt → first paint
    inStep = false;
    expect(seen).toEqual([0]);

    world.setResource(Camera, { x: 42, y: 0, zoom: 1, gesturing: false });
    inStep = true;
    step();
    inStep = false;
    // ONE render for the step, and it saw the camera the DOM reflectors saw.
    expect(seen).toEqual([0, 42]);
  });

  it("parks with no dirt — an idle step renders nothing", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    bridge.setRenderNow(() => {
      calls += 1;
    });
    step(); // first paint
    step();
    step();
    expect(calls).toBe(1);
  });

  it("requestFrame latches exactly one render on the next step", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    bridge.setRenderNow(() => {
      calls += 1;
    });
    step(); // drain first paint
    bridge.requestFrame();
    bridge.requestFrame(); // coalesces
    step();
    expect(calls).toBe(2);
    step();
    expect(calls).toBe(2);
  });

  it("dirt latched while unmounted survives and renders after setRenderNow rewires", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    bridge.requestFrame();
    step(); // no renderer wired — latch must survive
    expect(calls).toBe(0);
    bridge.setRenderNow(() => {
      calls += 1;
    });
    step();
    expect(calls).toBe(1);
  });

  it("schedulePass(ms) arms the ambient due-time on the injected clock; 'none' clears it", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    bridge.setRenderNow(() => {
      calls += 1;
    });
    step(); // first paint
    bridge.schedulePass(10);
    step(); // t=1000 < 1010 — not due
    expect(calls).toBe(1);
    clock.t = 1009;
    step();
    expect(calls).toBe(1);
    clock.t = 1011;
    step();
    expect(calls).toBe(2); // due fired — the rate cap's cadence

    bridge.schedulePass(10);
    bridge.schedulePass("none"); // e.g. the last Hot island went cold
    clock.t = 2000;
    step();
    expect(calls).toBe(2);
  });

  it("schedulePass('now') latches the immediate next frame (lift-ease cadence)", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    bridge.setRenderNow(() => {
      calls += 1;
    });
    step(); // first paint
    bridge.schedulePass("now");
    step();
    expect(calls).toBe(2);
    step();
    expect(calls).toBe(2); // consumed — no free-running loop
  });

  it("requestFrame from inside the render re-latches for the NEXT step — no recursion", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    let rearm = false;
    bridge.setRenderNow(() => {
      calls += 1;
      expect(calls).toBeLessThan(10); // recursion guard: bounded
      if (rearm) {
        rearm = false;
        bridge.requestFrame(); // a frame callback retargeting a lift, say
      }
    });
    step(); // first paint
    rearm = true;
    bridge.requestFrame();
    step(); // renders once; the mid-render requestFrame re-latches
    expect(calls).toBe(2);
    step(); // the re-latch drains as ONE more render
    expect(calls).toBe(3);
    step();
    expect(calls).toBe(3);
  });

  it("uninstall drops the latch and the reflectors — later steps render nothing", () => {
    const clock = { t: 1000 };
    const { bridge, step } = createRig(clock);
    let calls = 0;
    bridge.setRenderNow(() => {
      calls += 1;
    });
    bridge.requestFrame();
    bridge.uninstall();
    step();
    step();
    expect(calls).toBe(0);
  });
});
