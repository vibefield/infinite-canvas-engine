/**
 * selectionChrome: the pooled 8 resize-handle entities that mirror the current
 * selection (design-004 §5) — ONLY what picking reads since design-015 D7 (the
 * selection box and its `VisualOf` edges left: nothing read them after the P4 DOM
 * chrome, and the box was rewritten every drag frame). Asserts the pool spawn/reap
 * lifecycle spawns the handles and NOTHING else, the handle wiring
 * (Position+Size+HandleSpec), a drag frame moving the handles and birthing nothing, and the
 * screen-constant handle world size (`10 / zoom`) at two zooms.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Resizable,
  Camera,
  ChromeSettings,
  Culled,
  createEngine,
  createSelectionChromeSystem,
  defineQuery,
  type Entity,
  ensureCanvasSurface,
  Grab,
  HandleSpec,
  NO_ENTITY,
  Position,
  setSelection,
  Size,
} from "../src";

const handleQ = defineQuery([HandleSpec]);

function rig() {
  const world = createWorld();
  const engine = createEngine(world);
  engine.registerReflector({ name: "armed", observe: { resources: [Camera] }, flush: () => {} });
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
    world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]], tags: [Resizable] });
  return { world, engine, step, entities, spawnBox };
}

describe("selectionChrome pool", () => {
  it("spawns the 8 handles for a resizable selection — and NOTHING else — and reaps them when it empties", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(100, 100, 80, 60);
    const spawned: Entity[] = [];
    world.observe({ onSpawn: (e) => spawned.push(e) });
    setSelection(world, [a], "replace");
    step(); // chrome sees Selected → spawns the pool (placed at the derive boundary)

    expect(entities(handleQ)).toHaveLength(8);
    // the pool is the handles alone: no box entity rides beside them (D7)
    expect(spawned.filter((e) => world.isAlive(e) && !world.has(e, HandleSpec))).toEqual([]);
    expect(spawned).toHaveLength(8);
    // Every handle carries a world AABB + an anchor.
    for (const h of entities(handleQ)) {
      expect(world.has(h, Position)).toBe(true);
      expect(world.has(h, Size)).toBe(true);
    }
    // All 8 anchors present, exactly once each.
    const anchors = entities(handleQ).map((h) => world.read(h, HandleSpec).anchor).sort();
    expect(anchors).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);

    setSelection(world, [], "replace"); // clear
    step(); // reap
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

  it("a non-resizable selection — single or multi — gets no engine chrome; a mixed one drops the grips and all-resizable brings them back", () => {
    const { world, step, entities, spawnBox } = rig();
    const spawnPlain = (x: number, y: number, w: number, h: number) =>
      world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]] }); // NOT Resizable
    const p = spawnPlain(0, 0, 100, 100);
    const q = spawnPlain(200, 0, 100, 50);
    const spawned: Entity[] = [];
    world.observe({ onSpawn: (e) => spawned.push(e) });
    setSelection(world, [p], "replace");
    step();
    setSelection(world, [p, q], "replace");
    step();
    expect(spawned).toEqual([]); // nothing for either (the group box left at D7)

    const a = spawnBox(400, 0, 100, 100); // Resizable
    setSelection(world, [a], "replace");
    step();
    expect(entities(handleQ)).toHaveLength(8);
    setSelection(world, [a, q], "replace"); // mixed → no grips
    step();
    expect(entities(handleQ)).toHaveLength(0);
    setSelection(world, [a], "replace"); // all-resizable again → grips return
    step(2); // spawn frame + placement boundary
    expect(entities(handleQ)).toHaveLength(8);
  });

  it("a drag frame moves the handles with the union and births nothing", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(0, 0, 100, 100);
    setSelection(world, [a], "replace");
    step(2);
    const handles = new Set(entities(handleQ));
    const written = new Set<Entity>();
    world.observe({ onSpawn: (e) => written.add(e) });
    world.edit(a).set(Position, { x: 40, y: 0 }); // the union moves, as on every drag frame
    step();
    expect(written.size).toBe(0); // no entity born to carry the union
    const se = [...handles].find((h) => world.read(h, HandleSpec).anchor === "se") as Entity;
    expect(world.read(se, Position)).toEqual({ x: 135, y: 95 });
  });

  it("a Grab-bed member's lift (ChromeSettings.liftScale) moves the handles to wrap the card the user sees", () => {
    const { world, step, entities } = rig();
    world.setResource(ChromeSettings, { liftScale: 1.2 });
    const b = world.spawn({
      components: [
        [Position, { x: 200, y: 0 }],
        [Size, { w: 100, h: 50 }],
        [Grab, { x: 200, y: 0, w: 100, h: 50, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 }], // mid-drag lift
      ],
      tags: [Resizable],
    });
    setSelection(world, [b], "replace");
    step();
    // b inflates ×1.2 about its center → (190, −5, 120, 60): the SE handle centres on (310, 55)
    const se = entities(handleQ).find((h) => world.read(h, HandleSpec).anchor === "se") as Entity;
    const at = world.read(se, Position);
    expect(at.x + 5).toBeCloseTo(310, 4);
    expect(at.y + 5).toBeCloseTo(55, 4); // f32 liftScale ⇒ ~1e-7 noise
  });

  it("scope filter: a non-member (Culled ∧ ¬Active) selected widget contributes no chrome", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(0, 0, 100, 100); // Resizable, in scope
    // Another nav frame's widget (folder field bug 2026-07-17): membership
    // left it Culled without Active; its coords are frame-local elsewhere.
    const ghost = world.spawn({
      components: [[Position, { x: 500, y: 0 }], [Size, { w: 50, h: 50 }]],
      tags: [Culled],
    });
    setSelection(world, [a, ghost], "replace");
    step();
    // Only the member counts: sole all-resizable selection → grips at a.
    expect(entities(handleQ)).toHaveLength(8);
    const se = entities(handleQ).find((h) => world.read(h, HandleSpec).anchor === "se") as Entity;
    expect(world.read(se, Position)).toEqual({ x: 95, y: 95 });
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
