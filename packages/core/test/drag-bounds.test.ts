/**
 * `DragBounds` — the heat's one world fact (design-013 §5 rev 6, GLOW.md §3),
 * written by `dropSystem` on the Drag recognizer.
 *
 * The overlap glow is CAST LIGHT: the lifted card's own SDF lights the target
 * beneath it, so the compose reflector needs the lifted set's rect. The claim
 * this suite has to hold up is that it is the SAME rect `dropSystem` already
 * computes for its spatial query — post-move, unioned over the dragged set —
 * and not a second one derived somewhere else a frame later. So every case
 * asserts the number against the widgets' own `Position + Size` at the moment
 * the recognizer carries it.
 *
 * Driven through the full interaction rig (`trace/rig-full.ts`) rather than by
 * calling the system: `Drags`, `Grab`, the routing tags and the in-phase order
 * (snap → move → drop) all have to be real for the bounds to be post-move at
 * all.
 */
import { describe, expect, it } from "vitest";
import { SpatialIndex } from "@ice/kernel";
import { createWorld } from "@vibecook/strata-ecs";
import {
  ClaimedBy,
  Drag,
  DragBounds,
  Drags,
  GestureActive,
  Position,
  RoutedMove,
  Size,
  createEngine,
  defineQuery,
  type Entity,
} from "../src";
import { createDropSystem } from "../src/systems/l3-drop";
import { createFullRig, type FullRig } from "./trace/rig-full";

const dragQ = defineQuery([Drag]);

/** The recognizer that claimed this pointer, or undefined. */
function recognizerFor(rig: FullRig, id: string): Entity | undefined {
  const pointer = rig.pointerEntity(id);
  return pointer === undefined ? undefined : rig.world.getRelation(pointer, ClaimedBy);
}

/** The live Drag recognizers, claimed or not — a down spawns one before it claims. */
function dragRecognizers(rig: FullRig): Entity[] {
  const found: Entity[] = [];
  rig.world.query(dragQ as never).each((b) => {
    for (const r of b) found.push(b.entity(r));
  });
  return found;
}

/** The union of the given widgets' CURRENT rects — the answer, computed independently. */
function unionOf(rig: FullRig, widgets: readonly Entity[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const w of widgets) {
    const p = rig.world.read(w, Position);
    const s = rig.world.read(w, Size);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOf(rig: FullRig, rec: Entity) {
  const cell = rig.world.get(rec, DragBounds);
  return cell === undefined
    ? undefined
    : { minX: cell.minX, minY: cell.minY, maxX: cell.maxX, maxY: cell.maxY };
}

describe("DragBounds is the post-move union dropSystem already computes", () => {
  it("is on the recognizer from SPAWN, zeroed — writers never race an attach", () => {
    // The SnapState discipline. A recognizer that had to grow the component on
    // its first move would give the compose reflector one frame of "absent",
    // which is the class §7 calls "absent for a frame", and silent.
    const rig = createFullRig();
    rig.spawnBox({ x: 100, y: 100, w: 80, h: 60 });
    rig.down("mouse", 130, 130);
    rig.step();
    // A down SPAWNS the recognizer; the claim comes later, at arbitration. The
    // component has to be there for the whole of that window.
    const [rec] = dragRecognizers(rig);
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(recognizerFor(rig, "mouse")).toBeUndefined(); // not claimed yet
    expect(boundsOf(rig, rec)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("tracks a single card's rect as it moves, POST-move", () => {
    const rig = createFullRig();
    const card = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60 });
    rig.down("mouse", 130, 130);
    rig.step();
    rig.move("mouse", 145, 130); // slop exit → Active, RoutedMove
    rig.step();
    rig.move("mouse", 245, 190);
    rig.step(); // move applies, THEN dropSystem reads the new rect
    const rec = recognizerFor(rig, "mouse");
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(boundsOf(rig, rec)).toEqual(unionOf(rig, [card]));
    // …and it really moved, so this is not the spawn zeros agreeing with a
    // card that never left the origin.
    expect(rig.world.read(card, Position).x).toBeGreaterThan(100);
  });

  it("unions a MULTI-card drag — the lifted SET is what casts the light", () => {
    const rig = createFullRig();
    const a = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60, selected: true });
    const b = rig.spawnBox({ x: 300, y: 260, w: 60, h: 40, selected: true });
    rig.down("mouse", 130, 130); // grabbing one of a selected pair claims both
    rig.step();
    rig.move("mouse", 145, 130);
    rig.step();
    rig.move("mouse", 205, 170);
    rig.step();
    const rec = recognizerFor(rig, "mouse");
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    const want = unionOf(rig, [a, b]);
    expect(boundsOf(rig, rec)).toEqual(want);
    // The union genuinely spans both, not just the grabbed one.
    const only = unionOf(rig, [a]);
    expect(want.maxX).toBeGreaterThan(only.maxX);
    expect(want.maxY).toBeGreaterThan(only.maxY);
  });

  it("holds the same numbers across a STILL frame — change-only, no rewrite", () => {
    const rig = createFullRig();
    rig.spawnBox({ x: 100, y: 100, w: 80, h: 60 });
    rig.down("mouse", 130, 130);
    rig.step();
    rig.move("mouse", 145, 130);
    rig.step();
    rig.move("mouse", 245, 190);
    rig.step();
    const rec = recognizerFor(rig, "mouse");
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    const settled = boundsOf(rig, rec);

    // Count the writes a reader would see: a value write journals the entity,
    // and a still drag must journal none.
    const collector = rig.world.changes.collect({ components: [DragBounds], coarse: false });
    collector.drain();
    rig.step(4); // the pointer does not move; the drag stays Active
    expect(collector.drain().changed).toEqual([]);
    collector.dispose();
    expect(boundsOf(rig, rec)).toEqual(settled);
  });

  it("a RESIZE drag leaves the zeros — there is no lifted set to cast light", () => {
    // dropSystem's query is RoutedMove-only, and a resize never populates
    // `Drags`. The recognizer keeps its spawn value, which is the honest
    // answer rather than a stale rect from some other gesture.
    const rig = createFullRig();
    rig.spawnBox({ x: 100, y: 100, w: 80, h: 60, resizable: true, selected: true });
    rig.spawnHandle({ anchor: "se", x: 176, y: 156, w: 10, h: 10 });
    rig.down("mouse", 181, 161); // on the handle
    rig.step();
    rig.move("mouse", 196, 161); // slop exit → RoutedResize
    rig.step();
    rig.move("mouse", 250, 200);
    rig.step();
    const rec = recognizerFor(rig, "mouse");
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(boundsOf(rig, rec)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("survives a despawn mid-drag with its last good rect", () => {
    // A remote peer deleting the dragged card is what `Drags` auto-clearing
    // exists for. Integrity cancels the recognizer on that edge loss, so the
    // recognizer leaves dropSystem's Active-termed query — and the bounds it
    // carries stay the last real rect rather than becoming anything else.
    const rig = createFullRig();
    const card = rig.spawnBox({ x: 100, y: 100, w: 80, h: 60 });
    rig.down("mouse", 130, 130);
    rig.step();
    rig.move("mouse", 145, 130);
    rig.step();
    rig.move("mouse", 245, 190);
    rig.step();
    const rec = recognizerFor(rig, "mouse");
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    const lastGood = boundsOf(rig, rec);
    expect(lastGood).toEqual(unionOf(rig, [card]));

    rig.world.destroy(card);
    rig.step();
    expect(rig.world.getRelations(rec, Drags)).toEqual([]);
    const after = boundsOf(rig, rec);
    expect(after).toEqual(lastGood);
    for (const v of Object.values(after ?? {})) expect(Number.isFinite(v)).toBe(true);
  });

  it("dies with the recognizer — nothing has to clear it", () => {
    // The recognizer is reaped at terminal + 1 (`systems/cleanup.ts`), and the
    // component goes with the entity. That is the "entity-keyed store
    // outliving the entity" class closed by construction (§7).
    const rig = createFullRig();
    rig.spawnBox({ x: 100, y: 100, w: 80, h: 60 });
    rig.down("mouse", 130, 130);
    rig.step();
    rig.move("mouse", 145, 130);
    rig.step();
    rig.move("mouse", 245, 190);
    rig.step();
    const rec = recognizerFor(rig, "mouse");
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(boundsOf(rig, rec)).not.toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    rig.up("mouse", 245, 190);
    rig.step(3); // Ended, then the reap window
    expect(rig.world.isAlive(rec)).toBe(false);
  });
});

describe("the `any` gate — an empty dragged set publishes nothing", () => {
  it("leaves the zeros rather than writing ±Infinity", () => {
    // The union accumulators start at ±Infinity, and with no live dragged
    // widget the walk leaves them there. Publishing that would put a number in
    // the world no reader could tell from a real rect.
    //
    // Driven against `createDropSystem` directly, because the real pipeline
    // cannot reach this state: integrity CANCELS a recognizer whose dragged
    // set empties (see the despawn case above), which takes it out of the
    // Active-termed query before dropSystem ever sees it. The branch is a
    // guard against a caller the engine does not currently have — and a guard
    // nothing exercises is a guard nobody knows is there, so it is exercised
    // here at the seam instead of left to a rig that structurally cannot.
    const world = createWorld();
    const engine = createEngine(world);
    engine.addSystems("ctl:behave", createDropSystem(world, new SpatialIndex<Entity>()));
    // A RoutedMove drag with NO `Drags` relations at all.
    const rec = world.spawn({
      components: [
        [Drag, { startX: 0, startY: 0, totalX: 0, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 }],
        [DragBounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 }],
      ],
      tags: [GestureActive, RoutedMove],
    });
    engine.step(16);
    expect(world.get(rec, DragBounds)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
