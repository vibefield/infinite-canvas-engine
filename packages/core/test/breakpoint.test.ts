/**
 * breakpoint: `WidgetBreakpoint` from a widget's effective size (design-004 §8).
 * Asserts the 5 width tiers, ±10% boundary hysteresis (stable within a band), the
 * MeasuredSize-over-Size effective-size rule, and lazy add on WidgetEquipped only.
 *
 * 2026-07-15 gate: the system is Active-scoped (tiers drive RENDERED content;
 * non-active widgets are frozen-while-hidden) and runIf-gated on zoom change ∨
 * Size/MeasuredSize/Active churn — rig spawns stamp Active the way the real
 * pipeline's membership system does, and the gate suite below pins skips via
 * run/skip telemetry.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  abortNavFlight,
  Active,
  Camera,
  createBreakpointSystem,
  createEngine,
  type Entity,
  MeasuredSize,
  NavTransition,
  Size,
  WidgetBreakpoint,
  WidgetEquipped,
} from "../src";

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
  engine.addSystems("derive", createBreakpointSystem(world));
  engine.enableTelemetry();
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const spawn = (w: number, h = 100, opts: { active?: boolean } = {}) =>
    world.spawn({
      components: [[Size, { w, h }]],
      tags: opts.active === false ? [WidgetEquipped] : [WidgetEquipped, Active],
    });
  const tier = (e: Entity) => world.get(e, WidgetBreakpoint)?.tier;
  const ran = () => engine.lastFrame()?.systems.find((s) => s.system === "breakpoint")?.ran;
  return { world, engine, step, spawn, tier, ran };
}

describe("breakpoint tiers", () => {
  it("classifies effective width into 5 tiers", () => {
    const { step, spawn, tier } = rig();
    const micro = spawn(50);
    const compact = spawn(100);
    const normal = spawn(200);
    const expanded = spawn(400);
    const detailed = spawn(600);
    step();
    expect(tier(micro)).toBe("micro");
    expect(tier(compact)).toBe("compact");
    expect(tier(normal)).toBe("normal");
    expect(tier(expanded)).toBe("expanded");
    expect(tier(detailed)).toBe("detailed");
  });

  it("stores the effective size the tier was computed from", () => {
    const { world, step, spawn } = rig();
    const e = spawn(200, 140);
    step();
    expect(world.get(e, WidgetBreakpoint)).toEqual({ tier: "normal", w: 200, h: 140 });
  });

  it("holds the tier within ±10% and flips once the band is crossed", () => {
    const { world, step, spawn, tier } = rig();
    const e = spawn(100); // compact
    step();
    expect(tier(e)).toBe("compact");

    world.edit(e).set(Size, { w: 170, h: 100 }); // < 160·1.1 = 176 → still compact
    step();
    expect(tier(e)).toBe("compact");

    world.edit(e).set(Size, { w: 180, h: 100 }); // ≥ 176 → normal
    step();
    expect(tier(e)).toBe("normal");

    world.edit(e).set(Size, { w: 150, h: 100 }); // normal→compact needs < 160·0.9 = 144 → holds
    step();
    expect(tier(e)).toBe("normal");

    world.edit(e).set(Size, { w: 140, h: 100 }); // < 144 → compact
    step();
    expect(tier(e)).toBe("compact");
  });

  it("uses MeasuredSize over Size when auto-sized (>0)", () => {
    const { world, step, spawn, tier } = rig();
    const e = spawn(50); // Size width 50 → micro
    step();
    expect(tier(e)).toBe("micro");

    world.addComponent(e, MeasuredSize, { w: 300, h: 100 }); // effective 300 → normal
    step();
    expect(tier(e)).toBe("normal");
  });

  it("ignores entities without WidgetEquipped", () => {
    const { world, step } = rig();
    const bare = world.spawn({ components: [[Size, { w: 200, h: 100 }]] });
    step();
    expect(world.has(bare, WidgetBreakpoint)).toBe(false);
  });
});

describe("breakpoint gate (design-004 §8 × the 2026-07-15 runIf)", () => {
  it("zoom change re-tiers Active widgets; pan (zoom unchanged) SKIPS", () => {
    const { world, step, spawn, tier, ran } = rig();
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const e = spawn(200); // normal at zoom 1
    step();
    expect(tier(e)).toBe("normal");

    // Zoom out far: on-screen width 200·0.3 = 60 → micro.
    world.setResource(Camera, { x: 0, y: 0, zoom: 0.3, gesturing: false });
    step();
    expect(ran()).toBe(true);
    expect(tier(e)).toBe("micro");

    // Pan only: zoom unchanged → the system must not even run.
    world.setResource(Camera, { x: 500, y: 300, zoom: 0.3, gesturing: false });
    step();
    expect(ran()).toBe(false);
    expect(tier(e)).toBe("micro");
  });

  it("idle frames skip; Size churn re-tiers just fine through the journal", () => {
    const { world, step, spawn, tier, ran } = rig();
    const e = spawn(100); // compact
    step();
    expect(tier(e)).toBe("compact");
    step();
    step();
    expect(ran()).toBe(false); // settled: no churn, no zoom motion

    world.edit(e).set(Size, { w: 400, h: 100 });
    step();
    expect(ran()).toBe(true);
    expect(tier(e)).toBe("expanded");
  });

  it("non-Active widgets are frozen (no tier churn while hidden), re-tier on activation", () => {
    const { world, step, spawn, tier, ran } = rig();
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const shown = spawn(200);
    const hidden = spawn(200, 100, { active: false }); // closed-container content
    step();
    expect(tier(shown)).toBe("normal");
    expect(tier(hidden)).toBeUndefined(); // never rendered, never tiered

    // Zoom moves only the Active widget's tier; the hidden one stays frozen.
    world.setResource(Camera, { x: 0, y: 0, zoom: 0.3, gesturing: false });
    step();
    expect(tier(shown)).toBe("micro");
    expect(tier(hidden)).toBeUndefined();

    // Activation (nav enter analog) journals via the Active tag → tiers at
    // the CURRENT zoom in one tick.
    world.addTag(hidden, Active);
    step();
    expect(ran()).toBe(true);
    expect(tier(hidden)).toBe("micro");
  });

  it("a nav flight defers ZOOM retiers to flight end; journaled churn still tiers mid-flight", () => {
    // design-006 §8.2 (2026-07-16): the flight zoom sweeps every tier
    // threshold — retier-per-frame would swap widget content mid-flight.
    const { world, step, spawn, tier, ran } = rig();
    const e = spawn(200);
    step();
    expect(tier(e)).toBe("normal");
    step();
    step();
    expect(ran()).toBe(false); // settled

    world.setResource(NavTransition, {
      active: true, kind: "enter", p: 0, v: 0, frozen: false, epoch: 1, durMul: 1,
      documentEpoch: 0, fromFrame: 0 as Entity, toFrame: 0 as Entity,
      fromTypeId: "", toTypeId: "",
      c0x: 0, c0y: 0, c0z: 0.2, c1x: 0, c1y: 0, c1z: 0.3, as: 1, aox: 0, aoy: 0,
    });
    world.setResource(Camera, { x: 0, y: 0, zoom: 0.3, gesturing: false }); // mid-flight sweep
    step();
    expect(ran()).toBe(false); // zoom trigger suppressed
    expect(tier(e)).toBe("normal"); // frozen mid-flight

    // Fresh content mounting DURING the flight still gets its first tier
    // (the journal delta path is not suppressed).
    const fresh = spawn(600); // 600 × 0.3 = 180px → normal
    step();
    expect(ran()).toBe(true);
    expect(tier(fresh)).toBe("normal");
    expect(tier(e)).toBe("normal"); // the full walk did NOT run

    // Flight ends → the arrival-vs-pre-flight zoom compare fires ONE full retier.
    abortNavFlight(world);
    step();
    expect(ran()).toBe(true);
    expect(tier(e)).toBe("micro"); // 200 × 0.3 = 60px, retiered at rest
    step();
    expect(ran()).toBe(false); // and settles again
  });
});
