/**
 * breakpoint: `WidgetBreakpoint` from a widget's effective size (design-004 §8).
 * Asserts the 5 width tiers, ±10% boundary hysteresis (stable within a band), the
 * MeasuredSize-over-Size effective-size rule, and lazy add on WidgetEquipped only.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  createBreakpointSystem,
  createEngine,
  type Entity,
  MeasuredSize,
  Size,
  WidgetBreakpoint,
  WidgetEquipped,
} from "../src";

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", always: false, flush: () => {} });
  engine.addSystems("derive", createBreakpointSystem(world));
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const spawn = (w: number, h = 100) =>
    world.spawn({ components: [[Size, { w, h }]], tags: [WidgetEquipped] });
  const tier = (e: Entity) => world.get(e, WidgetBreakpoint)?.tier;
  return { world, step, spawn, tier };
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
