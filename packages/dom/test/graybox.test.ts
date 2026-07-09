/**
 * Gray-box reflector (M3 exit gate, design-002 §5): enter/update/exit
 * reconciliation with world-unit geometry, change-only style writes, and a 10k
 * single-flush mount.
 */
import { createEngine, createWorld, Position, Size } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createGrayboxReflector } from "../src/reflectors/graybox";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  const reflector = createGrayboxReflector(host);
  engine.registerReflector(reflector);
  return { world, engine, host, reflector };
}

describe("graybox reflector", () => {
  it("mounts one div per entity in world-unit geometry on enter", () => {
    const { world, engine, host, reflector } = setup();
    world.spawn({ components: [[Position, { x: 10, y: 20 }], [Size, { w: 30, h: 40 }]] });
    engine.step(0);

    expect(reflector.nodeCount()).toBe(1);
    expect(host.contentPlane.childElementCount).toBe(1);
    const div = host.contentPlane.firstElementChild as HTMLElement;
    expect(div.style.position).toBe("absolute");
    expect(div.style.left).toBe("10px");
    expect(div.style.top).toBe("20px");
    expect(div.style.width).toBe("30px");
    expect(div.style.height).toBe("40px");
    expect(div.style.background).not.toBe(""); // deterministic fill applied
  });

  it("rewrites exactly the changed entity's styles on a value change", () => {
    const { world, engine, reflector } = setup();
    const a = world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    world.spawn({ components: [[Position, { x: 5, y: 5 }], [Size, { w: 10, h: 10 }]] });
    engine.step(0);
    expect(reflector.styleWrites()).toBe(2); // both entered

    world.edit(a).set(Position, { x: 100, y: 100 });
    engine.step(1);
    expect(reflector.styleWrites()).toBe(3); // only `a` differed → +1

    engine.step(2); // nothing changed → reflector stays quiet (dirty-driven, no flush)
    expect(reflector.styleWrites()).toBe(3);
  });

  it("removes the div when an entity despawns", () => {
    const { world, engine, host, reflector } = setup();
    const a = world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 10, h: 10 }]] });
    world.spawn({ components: [[Position, { x: 5, y: 5 }], [Size, { w: 10, h: 10 }]] });
    engine.step(0);
    expect(reflector.nodeCount()).toBe(2);

    world.destroy(a);
    engine.step(1);
    expect(reflector.nodeCount()).toBe(1);
    expect(host.contentPlane.childElementCount).toBe(1);
  });

  it("mounts 10k entities in a single flush without quadratic style churn", () => {
    const { world, engine, host, reflector } = setup();
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      world.spawn({ components: [[Position, { x: i, y: i }], [Size, { w: 10, h: 10 }]] });
    }
    engine.step(0);
    expect(reflector.nodeCount()).toBe(count);
    expect(host.contentPlane.childElementCount).toBe(count);
    expect(reflector.styleWrites()).toBe(count); // one geometry write each — no re-writes
  });
});
