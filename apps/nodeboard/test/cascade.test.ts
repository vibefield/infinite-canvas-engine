/**
 * M8 exit (node-board): the demo's headline — deleting a wired node cascades its
 * wires away. `cascadeDestroy` inside a store transaction walks the node's
 * `ChildOf` subtree AND any wire bound to a destroyed endpoint (reverse
 * `WireFrom`/`WireTo` lookup), so the seeded wire dies with its source node after
 * the structural despawn lands at sync.
 */
import { Wire, WireFrom, WireTo, cascadeDestroy, defineQuery } from "@ice/core";
import { describe, expect, it } from "vitest";
import { seedWire, spawnMathNode, spawnSumNode } from "../src/app";
import { makeRig } from "./rig";

const wireQ = defineQuery([Wire]);

function firstWire(world: import("@ice/core").World): import("@ice/core").Entity | undefined {
  let found: import("@ice/core").Entity | undefined;
  world.query(wireQ).each((b) => {
    for (const r of b) {
      found = b.entity(r);
      return;
    }
  });
  return found;
}

describe("node-board M8 exit: deleting a wired node cascades its wire", () => {
  it("cascadeDestroy(source) in a store tx destroys the seeded wire too", () => {
    const rig = makeRig();
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
    expect(rig.world.isAlive(wire)).toBe(false); // wire cascaded with its endpoint
    expect(firstWire(rig.world)).toBeUndefined();
    expect(rig.world.isAlive(sum)).toBe(true); // the other endpoint survives
  });
});
