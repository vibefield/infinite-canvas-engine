/**
 * ONE LIFT (design-012 §7): the ease that replaces the CSS spring and the
 * engine-side island ease with a single per-quad fact.
 *
 * The curve itself is kernel's and already pinned there; what is graded here is
 * the behaviour a hand-maintained pair of implementations used to get wrong —
 * retargeting mid-flight, settling exactly, keeping the compositor awake for
 * its own duration, and scaling a card about its centre rather than its corner.
 */
import { ChromeSettings, Grab, NO_ENTITY, Opacity, Position, Size, createWorld } from "@ice/core";
import { LIFT_DURATION_MS } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { createLiftDriver } from "../src/compositor/lift";
import { createWorldQuadFacts } from "../src/compositor/quad-facts";

const GRAB = { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 };

function setup(options: { scale?: number; opacity?: number } = {}) {
  const world = createWorld();
  let clock = 0;
  const driver = createLiftDriver(world, {
    ...(options.scale !== undefined ? { scale: options.scale } : {}),
    ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
    now: () => clock,
  });
  const entity = world.spawn({
    components: [
      [Position, { x: 100, y: 200 }],
      [Size, { w: 200, h: 100 }],
    ],
  });
  return {
    world,
    driver,
    entity,
    tick(ms: number) {
      clock += ms;
      return driver.advance();
    },
    at: () => clock,
  };
}

describe("the lift ease", () => {
  it("is at rest until something is grabbed, and costs nothing", () => {
    const { driver, entity, tick } = setup({ scale: 1.05 });
    expect(tick(16)).toBe(false);
    expect(driver.factsFor(entity)).toEqual({ scale: 1, opacity: 1 });
    expect(driver.active()).toBe(0);
  });

  it("eases toward the lifted scale and reports itself animating", () => {
    const { world, driver, entity, tick } = setup({ scale: 1.05 });
    world.addComponent(entity, Grab, GRAB);
    tick(0);
    // Still animating, and NOT yet at the target — an ease that snapped would
    // pass a "did it lift" test while looking nothing like the DOM transition.
    expect(tick(LIFT_DURATION_MS / 2)).toBe(true);
    const mid = driver.factsFor(entity).scale;
    expect(mid).toBeGreaterThan(1);
    expect(mid).not.toBeCloseTo(1.05, 4);
  });

  it("settles EXACTLY on the target and then stops animating", () => {
    const { world, driver, entity, tick } = setup({ scale: 1.05 });
    world.addComponent(entity, Grab, GRAB);
    tick(0);
    tick(LIFT_DURATION_MS + 1);
    expect(driver.factsFor(entity).scale).toBe(1.05);
    // A settled lift must stop waking the compositor, or a picked-up card
    // composites forever at 120 Hz for no visible reason.
    expect(tick(16)).toBe(false);
  });

  it("returns home on release, and forgets the entity once it is back at rest", () => {
    const { world, driver, entity, tick } = setup({ scale: 1.05 });
    world.addComponent(entity, Grab, GRAB);
    tick(0);
    tick(LIFT_DURATION_MS + 1);
    world.removeComponent(entity, Grab);
    expect(tick(1)).toBe(true);
    tick(LIFT_DURATION_MS + 1);
    expect(driver.factsFor(entity).scale).toBe(1);
    tick(1);
    expect(driver.active()).toBe(0);
  });

  it("retargets from the DRAWN value, so an interrupted lift never jumps", () => {
    // Drop a card halfway up and grab it again immediately: the second lift
    // must start from where it visibly is. Retargeting from the original
    // `from` would snap it back down a frame before easing up again.
    const { world, driver, entity, tick } = setup({ scale: 1.5 });
    world.addComponent(entity, Grab, GRAB);
    tick(0);
    tick(LIFT_DURATION_MS / 2);
    const midway = driver.factsFor(entity).scale;
    expect(midway).toBeGreaterThan(1);

    world.removeComponent(entity, Grab);
    tick(0);
    // The very next sample must still be at the drawn value, not back at 1.
    expect(driver.factsFor(entity).scale).toBeCloseTo(midway, 5);
  });

  it("reads the lifted scale LIVE from ChromeSettings when none is given", () => {
    // The DOM card's own lift reads the same resource, and the settings panel
    // writes it at runtime — capturing it once would pin the first value seen.
    const world = createWorld();
    let clock = 0;
    const driver = createLiftDriver(world, { now: () => clock });
    const entity = world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    world.setResource(ChromeSettings, { liftScale: 1.25 });
    world.addComponent(entity, Grab, GRAB);
    driver.advance();
    clock += LIFT_DURATION_MS + 1;
    driver.advance();
    expect(driver.factsFor(entity).scale).toBe(1.25);
  });
});

describe("lift as a quad fact", () => {
  it("scales the card about its CENTRE, not its corner", () => {
    const { world, driver, entity, tick } = setup({ scale: 2 });
    const facts = createWorldQuadFacts(world, { lift: driver });
    expect(facts(entity)).toMatchObject({ x: 100, y: 200, w: 200, h: 100 });

    world.addComponent(entity, Grab, GRAB);
    tick(0);
    tick(LIFT_DURATION_MS + 1);
    // 200x100 doubled = 400x200, so the origin moves back by half the growth.
    // A corner-anchored scale would leave x,y at 100,200 and the card would
    // visibly slide down-right as it lifts.
    expect(facts(entity)).toMatchObject({ x: 100 - 100, y: 200 - 50, w: 400, h: 200 });
  });

  it("MULTIPLIES the entity's own opacity rather than replacing it", () => {
    const { world, driver, entity, tick } = setup({ scale: 1, opacity: 0.5 });
    world.addComponent(entity, Opacity, { a: 0.5 });
    const facts = createWorldQuadFacts(world, { lift: driver });
    world.addComponent(entity, Grab, GRAB);
    tick(0);
    tick(LIFT_DURATION_MS + 1);
    // A card the app faded to 0.5, lifted with a 0.5 fade, is 0.25 — not 0.5.
    expect(facts(entity)?.opacity).toBeCloseTo(0.25, 5);
  });

  it("leaves every quad untouched when no driver is wired", () => {
    const { world, entity } = setup();
    const facts = createWorldQuadFacts(world);
    expect(facts(entity)).toMatchObject({ x: 100, y: 200, w: 200, h: 100, opacity: 1 });
  });
});
