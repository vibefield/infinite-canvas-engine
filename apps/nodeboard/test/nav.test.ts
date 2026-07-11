/**
 * M8 exit (node-board): nested-canvas membership. At the root frame, root nodes
 * and the group are Active while the group's CONTENT is not (Culled). Entering
 * the group flips its two children Active and leaves the root nodes behind;
 * exiting restores. The membership stamper ships inside the widget runtime, so
 * these flips happen with no extra wiring beyond the enter/exit ops.
 */
import { Active, ChildOf, Culled } from "@ice/core";
import { describe, expect, it } from "vitest";
import { spawnGroupNode, spawnMathNode, spawnSumNode } from "../src/app";
import { makeRig } from "./rig";

describe("node-board M8 exit: enter/exit a group flips membership", () => {
  it("root nodes Active at root; the group's children Active only inside it", () => {
    const rig = makeRig();
    const store = rig.session.store;
    const root = spawnMathNode(store, rig.world, 100, 100, 1);
    const group = spawnGroupNode(store, rig.world, 350, 100, "G");
    const innerA = spawnMathNode(store, rig.world, 380, 130, 2);
    const innerB = spawnSumNode(store, rig.world, 380, 240);
    store.transaction((tx) => {
      tx.setRelation(innerA, ChildOf, group);
      tx.setRelation(innerB, ChildOf, group);
    });
    rig.step(2);

    // Root frame: root + group Active; the group's content is Culled (not a member).
    expect(rig.world.hasTag(root, Active)).toBe(true);
    expect(rig.world.hasTag(group, Active)).toBe(true);
    expect(rig.world.hasTag(innerA, Active)).toBe(false);
    expect(rig.world.hasTag(innerA, Culled)).toBe(true);
    expect(rig.world.hasTag(innerB, Active)).toBe(false);

    rig.nav.enterContainer(group);
    rig.step(2);
    expect(rig.nav.depth()).toBe(1);
    expect(rig.world.hasTag(innerA, Active)).toBe(true);
    expect(rig.world.hasTag(innerB, Active)).toBe(true);
    expect(rig.world.hasTag(root, Active)).toBe(false); // root content left behind
    expect(rig.world.hasTag(root, Culled)).toBe(true);

    rig.nav.exitContainer();
    rig.step(2);
    expect(rig.nav.depth()).toBe(0);
    expect(rig.world.hasTag(root, Active)).toBe(true);
    expect(rig.world.hasTag(innerA, Active)).toBe(false);
  });
});
