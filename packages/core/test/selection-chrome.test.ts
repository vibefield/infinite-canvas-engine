/**
 * selectionChrome: the pooled selection-box + 8 resize-handle entities that
 * mirror the current selection (design-004 §5). Asserts the pool spawn/reap
 * lifecycle, the handle wiring (Position+Size+HandleSpec+VisualOf), and the
 * screen-constant handle world size (`10 / zoom`) at two zooms.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  createEngine,
  createSelectionChromeSystem,
  defineQuery,
  type Entity,
  ensureCanvasSurface,
  HandleSpec,
  Position,
  SelectionBox,
  setSelection,
  Size,
  VisualOf,
} from "../src";

const boxQ = defineQuery([SelectionBox]);
const handleQ = defineQuery([HandleSpec]);

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", always: false, flush: () => {} });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  ensureCanvasSurface(world); // chrome anchors on it (like spatialSync/marquee)
  engine.addSystems("derive", createSelectionChromeSystem(world));
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      engine.step(now);
    }
  };
  const entities = (q: ReturnType<typeof defineQuery>): Entity[] => {
    const out: Entity[] = [];
    world.query(q).each((b) => {
      for (const r of b) out.push(b.entity(r));
    });
    return out;
  };
  const spawnBox = (x: number, y: number, w: number, h: number) =>
    world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]] });
  return { world, engine, step, entities, spawnBox };
}

describe("selectionChrome pool", () => {
  it("spawns a box + 8 handles for a selection and reaps them when it empties", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(100, 100, 80, 60);
    setSelection(world, [a], "replace");
    step(); // chrome sees Selected → spawns the pool (placed at the derive boundary)

    expect(entities(boxQ)).toHaveLength(1);
    expect(entities(handleQ)).toHaveLength(8);

    // The box holds the selection bbox in its SelectionBox value (NOT Position/Size).
    const box = entities(boxQ)[0] as Entity;
    expect(world.read(box, SelectionBox)).toEqual({ x: 100, y: 100, w: 80, h: 60 });
    expect(world.has(box, Position)).toBe(false); // deliberately not indexed / not pickable

    // Every handle carries a world AABB + anchor + a VisualOf edge back to the box.
    for (const h of entities(handleQ)) {
      expect(world.has(h, Position)).toBe(true);
      expect(world.has(h, Size)).toBe(true);
      expect(world.getRelation(h, VisualOf)).toBe(box);
    }
    // All 8 anchors present, exactly once each.
    const anchors = entities(handleQ).map((h) => world.read(h, HandleSpec).anchor).sort();
    expect(anchors).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);

    setSelection(world, [], "replace"); // clear
    step(); // reap
    expect(entities(boxQ)).toHaveLength(0);
    expect(entities(handleQ)).toHaveLength(0);
  });

  it("places the SE handle centered on the bbox corner", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(0, 0, 100, 100);
    setSelection(world, [a], "replace");
    step();
    const se = entities(handleQ).find((h) => world.read(h, HandleSpec).anchor === "se") as Entity;
    // zoom 1 → world size 10, centered on (100,100) → top-left (95,95).
    expect(world.read(se, Position)).toEqual({ x: 95, y: 95 });
    expect(world.read(se, Size)).toEqual({ w: 10, h: 10 });
  });

  it("keeps handles screen-constant: world size = 10 / zoom", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(0, 0, 100, 100);
    setSelection(world, [a], "replace");
    step(); // zoom 1 → size 10
    const h1 = entities(handleQ)[0] as Entity;
    expect(world.read(h1, Size).w).toBe(10);

    world.setResource(Camera, { x: 0, y: 0, zoom: 2, gesturing: false });
    step(); // zoom 2 → size 5 (change-only rewrite)
    expect(world.read(h1, Size).w).toBe(5);

    world.setResource(Camera, { x: 0, y: 0, zoom: 0.5, gesturing: false });
    step(); // zoom 0.5 → size 20
    expect(world.read(h1, Size).w).toBe(20);
  });
});
