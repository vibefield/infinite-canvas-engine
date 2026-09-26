/**
 * selectionChrome: the pooled selection-box + 8 resize-handle entities that
 * mirror the current selection (design-004 §5). Asserts the pool spawn/reap
 * lifecycle, the handle wiring (Position+Size+HandleSpec+VisualOf), and the
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

  it("box policy (2026-07-17): multi-select shares ONE bounding box regardless of resizability", () => {
    const { world, step, entities } = rig();
    const spawnPlain = (x: number, y: number, w: number, h: number) =>
      world.spawn({ components: [[Position, { x, y }], [Size, { w, h }]] }); // NOT Resizable
    const a = spawnPlain(0, 0, 100, 100);
    const b = spawnPlain(200, 0, 100, 50);

    // Single non-resizable: NO engine chrome (v1 parity — the app owns the look).
    setSelection(world, [a], "replace");
    step();
    expect(entities(boxQ)).toHaveLength(0);
    expect(entities(handleQ)).toHaveLength(0);

    // Two non-resizable: the group box appears, grips stay gated off.
    setSelection(world, [a, b], "replace");
    step();
    expect(entities(boxQ)).toHaveLength(1);
    expect(entities(handleQ)).toHaveLength(0);
    const box = entities(boxQ)[0] as Entity;
    expect(world.read(box, SelectionBox)).toEqual({ x: 0, y: 0, w: 300, h: 100 });

    // Back to a single non-resizable: the box reaps again.
    setSelection(world, [a], "replace");
    step();
    expect(entities(boxQ)).toHaveLength(0);
  });

  it("mixed selection keeps the box but reaps grips; all-resizable again re-spawns them", () => {
    const { world, step, entities, spawnBox } = rig();
    const a = spawnBox(0, 0, 100, 100); // Resizable
    const c = world.spawn({ components: [[Position, { x: 200, y: 0 }], [Size, { w: 50, h: 50 }]] });

    setSelection(world, [a], "replace");
    step();
    expect(entities(boxQ)).toHaveLength(1);
    expect(entities(handleQ)).toHaveLength(8);

    setSelection(world, [a, c], "replace"); // mixed → box only
    step();
    expect(entities(boxQ)).toHaveLength(1);
    expect(entities(handleQ)).toHaveLength(0);

    setSelection(world, [a], "replace"); // all-resizable again → grips return
    step(2); // spawn frame + placement boundary
    expect(entities(boxQ)).toHaveLength(1);
    expect(entities(handleQ)).toHaveLength(8);
  });

  it("a Grab-bed member inflates the box by ChromeSettings.liftScale (wraps the lifted card)", () => {
    const { world, step, entities } = rig();
    world.setResource(ChromeSettings, { liftScale: 1.2 });
    const a = world.spawn({ components: [[Position, { x: 0, y: 0 }], [Size, { w: 100, h: 100 }]] });
    const b = world.spawn({
      components: [
        [Position, { x: 200, y: 0 }],
        [Size, { w: 100, h: 50 }],
        [Grab, { x: 200, y: 0, w: 100, h: 50, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 }], // mid-drag lift
      ],
    });
    setSelection(world, [a, b], "replace");
    step();
    const box = entities(boxQ)[0] as Entity;
    // b inflates ×1.2 about its center → (190, −5, 120, 60); union with a → (0, −5, 310, 105).
    const bb = world.read(box, SelectionBox);
    expect(bb.x).toBeCloseTo(0, 5);
    expect(bb.y).toBeCloseTo(-5, 5); // f32 liftScale ⇒ ~1e-7 noise
    expect(bb.w).toBeCloseTo(310, 4);
    expect(bb.h).toBeCloseTo(105, 4);
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
    // Only the member counts: sole all-resizable selection → box + grips at a.
    expect(entities(boxQ)).toHaveLength(1);
    expect(world.read(entities(boxQ)[0] as Entity, SelectionBox)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(entities(handleQ)).toHaveLength(8);
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
