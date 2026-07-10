/**
 * chrome reflector (P4, screen-space): draws pooled SelectionBox + HandleSpec
 * entities and the out-of-ECS marquee buffer into the overlay plane
 * (design-004 §5). Asserts draw geometry (world→screen), change-only style
 * writes, camera-driven redraw, marquee show/hide, and the idle early-out.
 */
import {
  Camera,
  createEngine,
  createWorld,
  HandleSpec,
  type MarqueeBuffer,
  Position,
  SelectionBox,
  Size,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCanvasHost } from "../src/host";
import { createChromeReflector } from "../src/reflectors/chrome";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  const engine = createEngine(world);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const marquee: MarqueeBuffer = { rect: null, hits: [] };
  const reflector = createChromeReflector(host, world, marquee);
  engine.registerReflector(reflector);
  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  const nodes = (kind: string) => container.querySelectorAll(`[data-chrome="${kind}"]`);
  return { world, engine, host, container, reflector, marquee, step, nodes };
}

describe("chrome reflector", () => {
  it("does nothing while there is nothing to draw (idle early-out)", () => {
    const { step, reflector, nodes } = setup();
    step();
    step();
    expect(reflector.writes()).toBe(0);
    expect(nodes("box")).toHaveLength(0);
    expect(nodes("handle")).toHaveLength(0);
  });

  it("draws a selection box + handle in screen space", () => {
    const { world, step, nodes } = setup();
    world.spawn({ components: [[SelectionBox, { x: 100, y: 100, w: 80, h: 60 }]] });
    world.spawn({
      components: [
        [Position, { x: 175, y: 155 }],
        [Size, { w: 10, h: 10 }],
        [HandleSpec, { anchor: "se" }],
      ],
    });
    step();

    const box = nodes("box")[0] as HTMLElement;
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("100px");
    expect(box.style.width).toBe("80px");
    expect(box.style.height).toBe("60px");

    // Handle centered on its world AABB center (180,160) → 8px square around it.
    const handle = nodes("handle")[0] as HTMLElement;
    expect(handle.style.left).toBe("176px");
    expect(handle.style.top).toBe("156px");
  });

  it("writes change-only across static frames and redraws on camera change", () => {
    const { world, step, reflector, nodes } = setup();
    world.spawn({ components: [[SelectionBox, { x: 0, y: 0, w: 100, h: 100 }]] });
    step();
    const first = reflector.writes();
    expect(first).toBeGreaterThan(0);

    step();
    step();
    expect(reflector.writes()).toBe(first); // static scene: flush runs (always), writes nothing

    world.setResource(Camera, { x: 50, y: 0, zoom: 1, gesturing: false }); // pan → screen pos changes
    step();
    expect(reflector.writes()).toBe(first + 1);
    const box = nodes("box")[0] as HTMLElement;
    expect(box.style.left).toBe("-50px"); // (0 - 50) * zoom 1
  });

  it("shows the marquee while the buffer has a rect and removes it when cleared", () => {
    const { step, marquee, nodes } = setup();
    marquee.rect = { x: 10, y: 20, w: 40, h: 30 };
    step();
    const m = nodes("marquee")[0] as HTMLElement;
    expect(m).toBeDefined();
    expect(m.style.left).toBe("10px");
    expect(m.style.width).toBe("40px");

    marquee.rect = null;
    step();
    expect(nodes("marquee")).toHaveLength(0);
  });

  it("removes chrome nodes when the entities disappear (one clearing flush)", () => {
    const { world, step, nodes } = setup();
    const e = world.spawn({ components: [[SelectionBox, { x: 0, y: 0, w: 10, h: 10 }]] });
    step();
    expect(nodes("box")).toHaveLength(1);

    world.destroy(e);
    step();
    expect(nodes("box")).toHaveLength(0);
  });
});
