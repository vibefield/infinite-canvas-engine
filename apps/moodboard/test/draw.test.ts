/**
 * The draw tool end-to-end through the facade: select `draw:sticky`, synthesize a
 * canvas drag on the interaction stack's input queue, and one new sticky is
 * created from the drag rect (one undoable transaction). Mirrors the core facade
 * draw trace, driven entirely through the published `CanvasEngine` surface
 * (`engine.stack.queue`, `engine.ops`, `engine.world`).
 */
import { NO_MODS, Position, PrefabId, Size, Viewport, defineQuery, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createMoodboardEngine, DRAW_STICKY } from "../src/engine";

const widgetQ = defineQuery([Position, Size, PrefabId]);

function stickies(engine: { world: import("@ice/core").World }): Entity[] {
  const out: Entity[] = [];
  engine.world.query(widgetQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      if (engine.world.get(e, PrefabId)?.id === "sticky") out.push(e);
    }
  });
  return out;
}

describe("moodboard draw tool", () => {
  it("a canvas drag with draw:sticky active creates one sticky", () => {
    const { engine } = createMoodboardEngine();
    engine.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });

    let now = 1000;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    };
    const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
      engine.stack.queue.enqueue({
        kind,
        pointerId: "mouse",
        device: "mouse",
        screenX: x,
        screenY: y,
        buttons,
        mods: NO_MODS,
      });
    };

    step(2); // settle the seed projection
    const before = new Set(stickies(engine).map((e) => e as number));

    expect(DRAW_STICKY.id).toBe("draw:sticky");
    engine.ops.setTool(DRAW_STICKY.id);
    step();

    // Dead-zone exit rebases the drag start (M4-pinned): activation at (200,161),
    // release at (320,251) — the rect the sticky is drawn from.
    mouse("down", 200, 150, 1);
    step();
    mouse("move", 200, 161, 1); // 11px > slop: activation
    step();
    mouse("move", 320, 251, 1);
    step();
    mouse("up", 320, 251, 0);
    step(2); // create intent → doc spawn → projection

    const after = stickies(engine);
    expect(after).toHaveLength(before.size + 1);

    const created = after.find((e) => !before.has(e as number)) as Entity;
    expect(created).toBeDefined();
    expect(engine.world.get(created, Position)).toBeDefined();
    expect(engine.world.get(created, Size)).toBeDefined();

    // The creation was ONE undo step.
    expect(engine.docs.undo()).toBe(true);
    step(2);
    expect(engine.world.isAlive(created)).toBe(false);

    engine.dispose();
  });
});
