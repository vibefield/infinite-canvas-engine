/**
 * Ops tests — selection tag-flips (design-003 §5.1) and the engine destroy
 * cascade over ChildOf + wires (design-001 §5.1/§5.3).
 *
 * Spawn inits are inlined as object literals on purpose: strata's `SpawnInitOf`
 * mapped-tuple inference does not flow through a pre-built/aliased init value.
 */
import { createWorld } from "@vibecook/strata-ecs";
import { attachDurable, createDurableStore } from "@vibecook/strata-ecs/durable";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { ChildOf, Position, Wire, WireFrom, WireTo } from "../src/catalog";
import { SelectionVersion } from "../src/helpers/version-stamps";
import { cascadeDestroy } from "../src/ops/cascade";
import { clearSelection, selectedEntities, setSelection } from "../src/ops/selection";

describe("selection ops (design-003 §5.1)", () => {
  it("replace selects exactly the given set", () => {
    const w = createWorld();
    const a = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    const b = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    const c = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    setSelection(w, [a, b], "replace");
    expect(new Set(selectedEntities(w))).toEqual(new Set([a, b]));
    setSelection(w, [c], "replace");
    expect(new Set(selectedEntities(w))).toEqual(new Set([c]));
  });

  it("toggle flips membership per entity", () => {
    const w = createWorld();
    const a = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    const b = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    setSelection(w, [a, b], "add");
    setSelection(w, [a], "toggle");
    expect(new Set(selectedEntities(w))).toEqual(new Set([b]));
    setSelection(w, [a], "toggle");
    expect(new Set(selectedEntities(w))).toEqual(new Set([a, b]));
  });

  it("add unions into the current selection", () => {
    const w = createWorld();
    const a = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    const b = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    setSelection(w, [a], "add");
    setSelection(w, [b], "add");
    expect(new Set(selectedEntities(w))).toEqual(new Set([a, b]));
  });

  it("clearSelection empties the selection", () => {
    const w = createWorld();
    const a = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    setSelection(w, [a], "replace");
    clearSelection(w);
    expect(selectedEntities(w)).toEqual([]);
  });

  it("onChange fires once on real change, never on a no-op", () => {
    const w = createWorld();
    const a = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    let n = 0;
    const bump = () => {
      n += 1;
    };
    setSelection(w, [a], "add", bump);
    expect(n).toBe(1);
    setSelection(w, [a], "add", bump); // already selected → no flip
    expect(n).toBe(1);
    clearSelection(w, bump);
    expect(n).toBe(2);
    clearSelection(w, bump); // nothing selected → no flip
    expect(n).toBe(2);
  });

  it("bumps SelectionVersion exactly once per changing call, never on a no-op", () => {
    const w = createWorld();
    const a = w.spawn({ components: [[Position, { x: 0, y: 0 }]] });
    const versionOf = () => w.getResource(SelectionVersion)?.v ?? 0;

    expect(versionOf()).toBe(0);
    setSelection(w, [a], "add");
    expect(versionOf()).toBe(1);
    setSelection(w, [a], "add"); // already selected → no flip
    expect(versionOf()).toBe(1);
    clearSelection(w);
    expect(versionOf()).toBe(2);
    clearSelection(w); // nothing selected → no flip
    expect(versionOf()).toBe(2);
  });
});

function makeAttached() {
  const doc = new LoroDoc();
  doc.setPeerId(1);
  const store = createDurableStore(doc);
  const w = createWorld();
  attachDurable(w, store);
  return { store, w };
}

describe("cascadeDestroy (design-001 §5.1/§5.3)", () => {
  it("destroys the ChildOf subtree + bound wires, spares everything else", () => {
    const { store, w } = makeAttached();

    const ents = store.transaction((tx) => {
      // 3-level tree, two branches under root
      const root = tx.spawn({ components: [[Position, { x: 0, y: 0 }]] });
      const childA = tx.spawn({ components: [[Position, { x: 1, y: 0 }]] });
      const grandchild = tx.spawn({ components: [[Position, { x: 2, y: 0 }]] });
      const childB = tx.spawn({ components: [[Position, { x: 3, y: 0 }]] });
      // survivors, not under root
      const outsider = tx.spawn({ components: [[Position, { x: 9, y: 9 }]] });
      const outsider2 = tx.spawn({ components: [[Position, { x: 8, y: 8 }]] });
      tx.setRelation(childA, ChildOf, root);
      tx.setRelation(grandchild, ChildOf, childA);
      tx.setRelation(childB, ChildOf, root);

      // wire fully inside the doomed subtree — found via WireFrom on grandchild
      const wireInside = tx.spawn({ components: [[Position, { x: 0, y: 0 }]], tags: [Wire] });
      tx.setRelation(wireInside, WireFrom, grandchild);
      tx.setRelation(wireInside, WireTo, childB);
      // wire crossing in: source survives, target dies — found via WireTo on grandchild
      const wireCrossing = tx.spawn({ components: [[Position, { x: 0, y: 0 }]], tags: [Wire] });
      tx.setRelation(wireCrossing, WireFrom, outsider);
      tx.setRelation(wireCrossing, WireTo, grandchild);
      // wire entirely outside — survives
      const wireOutside = tx.spawn({ components: [[Position, { x: 0, y: 0 }]], tags: [Wire] });
      tx.setRelation(wireOutside, WireFrom, outsider);
      tx.setRelation(wireOutside, WireTo, outsider2);

      return {
        root,
        childA,
        grandchild,
        childB,
        outsider,
        outsider2,
        wireInside,
        wireCrossing,
        wireOutside,
      };
    });
    w.sync();

    // everything placed
    for (const e of Object.values(ents)) expect(store.keyOf(e)).not.toBeUndefined();

    store.transaction((tx) => cascadeDestroy(tx, w, ents.root));
    w.sync();

    for (const e of [
      ents.root,
      ents.childA,
      ents.grandchild,
      ents.childB,
      ents.wireInside,
      ents.wireCrossing,
    ]) {
      expect(store.keyOf(e)).toBeUndefined();
    }
    for (const e of [ents.outsider, ents.outsider2, ents.wireOutside]) {
      expect(store.keyOf(e)).not.toBeUndefined();
    }
  });

  it("guards cycles in the ChildOf graph (no infinite recursion)", () => {
    const { store, w } = makeAttached();
    const ents = store.transaction((tx) => {
      const a = tx.spawn({ components: [[Position, { x: 0, y: 0 }]] });
      const b = tx.spawn({ components: [[Position, { x: 1, y: 1 }]] });
      tx.setRelation(a, ChildOf, b);
      tx.setRelation(b, ChildOf, a);
      return { a, b };
    });
    w.sync();

    expect(() => {
      store.transaction((tx) => cascadeDestroy(tx, w, ents.a));
      w.sync();
    }).not.toThrow();
    expect(store.keyOf(ents.a)).toBeUndefined();
    expect(store.keyOf(ents.b)).toBeUndefined();
  });
});
