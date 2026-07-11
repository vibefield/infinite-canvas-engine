/**
 * Boot smoke: the facade constructs, a doc attaches, the seed spawns N widgets,
 * the engine steps, and every seeded entity projects alive — all through the
 * published surface.
 */
import { Position, PrefabId, Size, defineQuery, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createMoodboardEngine } from "../src/engine";

const widgetQ = defineQuery([Position, Size, PrefabId]);

function widgetEntities(engine: { world: import("@ice/core").World }): Entity[] {
  const out: Entity[] = [];
  engine.world.query(widgetQ).each((b) => {
    for (const r of b) out.push(b.entity(r));
  });
  return out;
}

describe("moodboard boot", () => {
  it("seeds widgets and projects them alive after stepping", () => {
    const { engine, seeded } = createMoodboardEngine();
    expect(seeded).toBe(7); // 3 stickies + 4 swatches

    let now = 0;
    for (let i = 0; i < 3; i++) {
      now += 16;
      engine.step(now); // project + equip + membership
    }

    const widgets = widgetEntities(engine);
    expect(widgets).toHaveLength(seeded);
    for (const e of widgets) expect(engine.world.isAlive(e)).toBe(true);

    // Both declared types are present.
    const types = new Set(widgets.map((e) => engine.world.get(e, PrefabId)?.id));
    expect(types.has("sticky")).toBe(true);
    expect(types.has("swatch")).toBe(true);

    engine.dispose();
  });
});
