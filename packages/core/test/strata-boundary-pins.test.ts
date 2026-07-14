/**
 * Strata behavior pins backing petition 7 (validated 2026-07-14). These pin
 * the boundary semantics the petition's design arguments depend on — if a
 * strata upgrade changes any of them, the petition (and the collector
 * migration plan) must be re-examined. Timing benches from the same spike
 * live in the petition's validation section, not in CI.
 */
import { describe, expect, it } from "vitest";
import { defineQuery, defineTickSystem } from "@vibecook/strata-ecs";
import { Position, Size, createCanvasEngine, createEngine, createWorld, defineWidget, spawnWidget, widgets } from "../src";

const posQ = defineQuery([Position]);

describe("reactiveOn arming (petition 7: stamps are opt-in, one-way)", () => {
  it("a bare world is unarmed; writes never arm; the first observe* arms; one-way", () => {
    const world = createWorld();
    expect(world.isReactiveEnabled).toBe(false);
    const e = world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    world.edit(e).set(Position, { x: 5, y: 5 });
    expect(world.isReactiveEnabled).toBe(false);
    const un = world.reactive.observeQuery(posQ, () => {}, { cols: [Position] });
    expect(world.isReactiveEnabled).toBe(true);
    un();
    expect(world.isReactiveEnabled).toBe(true);
  });
});

describe("observer boundary (petition 7: one boundary LATE for mid-frame consumers)", () => {
  it("a react-phase system does not see the observer flag for a same-frame input-phase write", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const e = world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });

    let observerFired = false;
    world.reactive.observeQuery(posQ, () => { observerFired = true; }, { cols: [Position] });

    let writeThisFrame = false;
    const writer = defineTickSystem(
      (ctx) => {
        if (writeThisFrame) ctx.edit(e).set(Position, { x: 99, y: 99 });
      },
      { name: "pinWriter", access: { write: [Position] } },
    );
    const flagLog: boolean[] = [];
    const reader = defineTickSystem(
      () => { flagLog.push(observerFired); },
      { name: "pinReader", access: { read: [] } },
    );
    engine.addSystems("input", writer);
    engine.addSystems("react", reader);

    engine.step(0);
    observerFired = false;
    flagLog.length = 0;

    writeThisFrame = true;
    engine.step(16); // frame F: input writes, react reads the flag
    writeThisFrame = false;
    engine.step(32); // frame F+1

    expect(flagLog[0]).toBe(false); // same frame: observer has NOT fired yet
    expect(flagLog[1]).toBe(true); // one boundary later it has
    expect(world.get(e, Position)?.x).toBe(99); // …while world state WAS visible in frame F
  });
});

describe("headless facade arming (petition 7 validation finding S5)", () => {
  it("a headless core facade does NOT arm reactivity — arming comes from the dom/react layers", () => {
    // This CORRECTED the petition's original "production always arms" claim:
    // browser apps arm at mount (the dom-widgets reflector registers observers
    // in its constructor, dom-widgets.ts), but a headless core (doc tooling,
    // migration runners) stays unarmed — added support for the collector's
    // SEPARATE gate. If this pin ever flips, re-examine the petition's cost
    // trade wording.
    const SPIKE =
      widgets.get("pin:card") ??
      defineWidget({
        type: "pin:card",
        surface: "dom",
        component: () => null,
        defaultSize: { w: 100, h: 100 },
      });
    const ce = createCanvasEngine();
    expect(ce.engine.world.isReactiveEnabled).toBe(false);
    ce.docs.create();
    spawnWidget(ce.docs.current()?.store as never, ce.engine.world, SPIKE.type, { x: 0, y: 0 });
    for (let i = 0; i < 5; i++) ce.engine.step(i * 16);
    expect(ce.engine.world.isReactiveEnabled).toBe(false);
    ce.dispose();
  });
});
