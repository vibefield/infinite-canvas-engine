/**
 * design-015 D2a-core, item 5: paint order = pick order, strata first.
 *
 * `compareStackOrder` ranks by `Stratum.band` (pads 0 · sheets 1 · things 2;
 * absent = things) and only then by the existing sibling order, so a pad the
 * user brought to the top of the sequence still lies under every thing — in
 * paint AND in pick. An all-dom board carries no `Stratum`: it must rank
 * EXACTLY as before, which the first test proves against a verbatim copy of the
 * pre-desk comparator.
 */
import type { Component, Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { SpatialIndex } from "@ice/kernel";
import {
  Active,
  BoardRoot,
  Camera,
  ChildOf,
  Movable,
  NO_MODS,
  Pointer,
  Position,
  Selectable,
  Size,
  StackZ,
  Stratum,
  TouchesExact,
  Viewport,
  WidgetEquipped,
  compareStackOrder,
  createCanvasEngine,
  createSiblingOrderIndex,
  createWorld,
  defineQuery,
  defineWidget,
  pickTopAt,
  widgets,
  writeRuntimeResource,
} from "../src";

/** The comparator as it stood before design-015 (ops/sibling-order.ts at 5c3302c), verbatim. */
function preDeskCompare(
  reader: { get<S>(e: Entity, c: Component<S>): S | undefined },
  ordinals: ReadonlyMap<Entity, number>,
  a: Entity,
  b: Entity,
): number {
  const oa = ordinals.get(a);
  const ob = ordinals.get(b);
  if (oa !== undefined && ob !== undefined) return oa - ob;
  if (oa !== undefined) return -1;
  if (ob !== undefined) return 1;
  const za = reader.get(a, StackZ)?.z ?? 0;
  const zb = reader.get(b, StackZ)?.z ?? 0;
  return za !== zb ? za - zb : Number(a) - Number(b);
}

function boardWorld(): { world: World; root: Entity } {
  const world = createWorld();
  const root = world.spawn({});
  writeRuntimeResource(world, BoardRoot, { root });
  return { world, root };
}

/** A widget-shaped box over (x, y, 100, 100); `band` stamps a Stratum; `edge` hangs it last on the root. */
function box(world: World, root: Entity | undefined, x: number, y: number, extra: { band?: number; z?: number } = {}): Entity {
  const e = world.spawn({
    components: [
      [Position, { x, y }],
      [Size, { w: 100, h: 100 }],
      ...(extra.band === undefined ? [] : [[Stratum, { band: extra.band }] as const]),
      ...(extra.z === undefined ? [] : [[StackZ, { z: extra.z }] as const]),
    ],
    tags: [Selectable, Movable, WidgetEquipped, Active],
  });
  if (root !== undefined) world.setRelation(e, ChildOf, root, "last");
  return e;
}

function indexOf(world: World, entities: readonly Entity[]): SpatialIndex<Entity> {
  const index = new SpatialIndex<Entity>();
  for (const e of entities) {
    const p = world.read(e, Position);
    const s = world.read(e, Size);
    index.upsert(e, { minX: p.x, minY: p.y, maxX: p.x + s.w, maxY: p.y + s.h });
  }
  return index;
}

describe("compareStackOrder — an all-dom board ranks exactly as before (design-015 §4.2)", () => {
  it("the paint order and the pick winner of a board with no Stratum equal the pre-desk comparator's", () => {
    const { world, root } = boardWorld();
    // a sequence that is not spawn order (reorders), plus edge-less legacy boxes with StackZ
    const ordered = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => box(world, root, i * 7, i * 5));
    world.moveRelation(ordered[2] as Entity, ChildOf, "last");
    world.moveRelation(ordered[6] as Entity, ChildOf, "first");
    world.moveRelation(ordered[4] as Entity, ChildOf, { before: ordered[0] as Entity });
    const legacy = [3, 1, 3, -2].map((z, i) => box(world, undefined, 20 + i * 3, 20, { z }));
    const all = [...ordered, ...legacy];
    const ordinals = createSiblingOrderIndex(world).ordinals();

    const now = [...all].sort((a, b) => compareStackOrder(world, ordinals, a, b));
    const before = [...all].sort((a, b) => preDeskCompare(world, ordinals, a, b));
    expect(now).toEqual(before);
    // every pair, both ways — not just one sort's comparisons
    for (const a of all) for (const b of all) {
      expect(Math.sign(compareStackOrder(world, ordinals, a, b))).toBe(Math.sign(preDeskCompare(world, ordinals, a, b)));
    }
    // the pick at a point every box covers is the pre-desk comparator's maximum
    const index = indexOf(world, all);
    const top = pickTopAt(world, index, 60, 60, 0, undefined, ordinals);
    expect(top).toBe(before[before.length - 1]);
  });
});

describe("compareStackOrder — strata rank before sibling order (design-015 §4.2, D-D4)", () => {
  it("pads under sheets under things, whatever the sequence; siblings order within a band", () => {
    const { world, root } = boardWorld();
    // sequence (bottom → top): thingA, thingB, sheet, pad — the pad was brought to the top
    const thingA = box(world, root, 0, 0); // no Stratum = things
    const thingB = box(world, root, 10, 10, { band: 2 });
    const sheet = box(world, root, 20, 20, { band: 1 });
    const pad = box(world, root, 30, 30, { band: 0 });
    const ordinals = createSiblingOrderIndex(world).ordinals();
    const paint = [pad, thingB, sheet, thingA].sort((a, b) => compareStackOrder(world, ordinals, a, b));
    expect(paint).toEqual([pad, sheet, thingA, thingB]);
    // pick = paint: at a point all four cover, the top thing wins over the pad above it in the sequence
    const index = indexOf(world, [thingA, thingB, sheet, pad]);
    expect(pickTopAt(world, index, 50, 50, 0, undefined, ordinals)).toBe(thingB);
    // where only the pad and the sheet overlap, the sheet wins; where the pad is alone, the pad
    expect(pickTopAt(world, index, 115, 115, 0, undefined, ordinals)).toBe(sheet);
    expect(pickTopAt(world, index, 125, 125, 0, undefined, ordinals)).toBe(pad);
  });
});

describe("the picking system — TouchesExact follows the strata (design-015 §4.2)", () => {
  const NOTE =
    widgets.get("so:note") ??
    defineWidget({ type: "so:note", object: { name: "paper" }, defaultSize: { w: 200, h: 200 } });
  const PAD =
    widgets.get("so:pad") ??
    defineWidget({
      type: "so:pad",
      object: { name: "calendar" },
      stratum: "pads",
      defaultSize: { w: 400, h: 300 },
    });
  const pointerQ = defineQuery([Pointer]);

  it("a pad spawned on top of a note is still picked under it: equip → Stratum → picking", () => {
    const ce = createCanvasEngine({ widgets: [NOTE, PAD] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1600, h: 900, dpr: 1 });
    ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    const note = ce.ops.spawnWidget(NOTE.type, { x: 100, y: 100, undoable: false });
    const pad = ce.ops.spawnWidget(PAD.type, { x: 0, y: 0, undoable: false }); // last = top of the sequence
    ce.world.sync();
    let now = 0;
    const step = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        now += 16;
        ce.step(now);
      }
    };
    step(3);
    expect(ce.world.get(pad, Stratum)).toEqual({ band: 0 });
    expect(ce.world.get(note, Stratum)).toEqual({ band: 2 });
    const exactAt = (x: number, y: number): Entity | undefined => {
      ce.stack.queue.enqueue({ kind: "move", pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons: 0, mods: NO_MODS });
      step();
      let hit: Entity | undefined;
      ce.world.query(pointerQ).each((b) => {
        for (const r of b) hit = ce.world.getRelation(b.entity(r), TouchesExact);
      });
      return hit;
    };
    expect(exactAt(150, 150)).toBe(note); // the overlap: the note, though the pad is later in the sequence
    expect(exactAt(350, 250)).toBe(pad); // the pad alone
    ce.dispose();
  });
});
