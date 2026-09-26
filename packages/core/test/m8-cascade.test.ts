/**
 * THE M8 exit test `cascade` (nodeboard's, ported BY NAME at D5a — design-015 §11.6: an engine fact, on core
 * alone): the node board's headline — deleting a wired node cascades its wires away. `cascadeDestroy` inside a
 * store transaction walks the node's `ChildOf` subtree AND every wire bound to a destroyed endpoint (the reverse
 * `WireFrom`/`WireTo` lookup), so the seeded wire dies with its source node once the structural despawn lands at
 * sync. The same assertions as nodeboard's test, the nodes spawned through core's paved road (m8-rig.ts).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import { Wire, WireFrom, WireTo, cascadeDestroy, defineQuery } from "../src";
import { makeM8Rig, seedWire, spawnMathNode, spawnSumNode } from "./m8-rig";

const wireQ = defineQuery([Wire]);

function firstWire(world: World): Entity | undefined {
  let found: Entity | undefined;
  world.query(wireQ).each((b) => {
    for (const r of b) {
      found = b.entity(r);
      return;
    }
  });
  return found;
}

describe("M8 exit (core): deleting a wired node cascades its wire", () => {
  it("cascadeDestroy(source) in a store tx destroys the seeded wire too", () => {
    const rig = makeM8Rig();
    const math = spawnMathNode(rig.session.store, rig.world, 100, 100, 4);
    const sum = spawnSumNode(rig.session.store, rig.world, 450, 100);
    seedWire(rig.session.store, math, "out", sum, "in");
    rig.step(2); // project the nodes + wire into the runtime world

    const wire = firstWire(rig.world);
    expect(wire).toBeDefined();
    if (wire === undefined) return;
    expect(rig.world.isAlive(wire)).toBe(true);
    expect(rig.world.getRelation(wire, WireFrom)).toBe(math);
    expect(rig.world.getRelation(wire, WireTo)).toBe(sum);

    // Delete the source node inside a doc transaction — the cascade takes the wire.
    rig.session.store.transaction((tx) => {
      cascadeDestroy(tx, rig.world, math);
    });
    rig.step(2); // structural despawns land at sync

    expect(rig.world.isAlive(math)).toBe(false);
    expect(rig.world.isAlive(wire)).toBe(false); // the wire cascaded with its endpoint
    expect(firstWire(rig.world)).toBeUndefined();
    expect(rig.world.isAlive(sum)).toBe(true); // the other endpoint survives
  });
});
