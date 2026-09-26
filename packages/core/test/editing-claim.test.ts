/**
 * The KEYBOARD's gesture claim (design-015 §6.1, D2c): the runtime `Editing` rider — the one
 * focused editor on an object — grants its doc cells divergence through the DEFAULT predicate, so
 * a typing session live-writes through the guarded live writer and commits once at its end. The
 * rider is the claim and nothing else: without it the same write is refused, and lifting it
 * revokes the grant.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetPrefabsForTests } from "../src/schema/prefab";
import { createLiveWriter } from "../src/guards/live-writer";
import { setDevGuards } from "../src/guards/dev";
import { makeDefaultMayDiverge } from "../src/ops/claims";
import { Editing } from "../src/catalog/desk";
import { attachWorld, defineStdPrefabs, makeDurableBox, mxPosition } from "./fixtures";

beforeEach(() => {
  __resetPrefabsForTests();
});
afterEach(() => {
  setDevGuards(true);
});

describe("the editing claim — makeDefaultMayDiverge (design-015 §6.1)", () => {
  it("an object carrying `Editing` may diverge; without it the live write is refused; lifting it revokes", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const e = makeDurableBox(world, store, box);
    const lw = createLiveWriter(world, { keyOf: (x) => store.keyOf(x), mayDiverge: makeDefaultMayDiverge(world) });
    expect(() => lw.set(e, mxPosition, { x: 1, y: 1 })).toThrow(/gesture claim/);
    world.addTag(e, Editing);
    expect(() => lw.set(e, mxPosition, { x: 2, y: 2 })).not.toThrow();
    expect(world.get(e, mxPosition)).toEqual({ x: 2, y: 2 });
    // the doc did not move: a live write is the runtime's alone until the session commits
    expect(store.getComponent(e, mxPosition)).not.toEqual({ x: 2, y: 2 });
    world.removeTag(e, Editing);
    expect(() => lw.set(e, mxPosition, { x: 3, y: 3 })).toThrow(/gesture claim/);
  });

  it("the claim is per object: `Editing` on one grants nothing to another", () => {
    const { world, store } = attachWorld();
    const { box } = defineStdPrefabs();
    const a = makeDurableBox(world, store, box);
    const b = makeDurableBox(world, store, box);
    const may = makeDefaultMayDiverge(world);
    world.addTag(a, Editing);
    expect(may(a)).toBe(true);
    expect(may(b)).toBe(false);
  });
});
