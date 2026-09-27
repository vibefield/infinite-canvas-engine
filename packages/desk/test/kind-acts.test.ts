// K8a (design-016 §5 · K-L2): a kind's acts in the selection menu are DECLARED with its object — `defineObject({ menu })`, onto the
// widget type core runs them from (`ops.runMenuAction`) — and the desk publishes, on the menu's anchor, the acts EVERY selected
// object's type declares, as plain data (`withKindActs`, which the layer's anchor applies). Fixture objects of the test's own.
import { createCanvasEngine, type Entity, type MenuActionDef } from "@ice/core";
import { describe, expect, it } from "vitest";
import { type SelectionAnchor, withKindActs } from "../src/compose/marks";
import type { KindPass } from "../src/kind";
import type { ObjectKind } from "../src/kinds/world";
import { defineObject } from "../src/object";

const kindOf = (name: string): ObjectKind => ({ name, stratum: "things", reach: 0, create: async () => ({}) as KindPass, resolve: () => ({}), record: () => ({}), hit: () => null });
const TICK: MenuActionDef = { id: "tick", label: "Tick", keys: "K", glyph: { path: "M5 12l4 4 10-10" }, run: () => {} };
const Clock = defineObject({ type: "test.clock-acts", version: 1, props: {}, kind: kindOf("clock-acts"), menu: [TICK, { id: "wind", label: "Wind", run: () => {} }] });
const Bell = defineObject({ type: "test.bell-acts", version: 1, props: {}, kind: kindOf("bell-acts"), menu: [{ id: "tick", label: "Ring", run: () => {} }] });
const Mute = defineObject({ type: "test.mute-acts", version: 1, props: {}, kind: kindOf("mute-acts") });

const ANCHOR: SelectionAnchor = { box: { x0: 0, y0: 0, x1: 10, y1: 10 }, count: 1, locked: false, gesturing: false, editing: false, view: { width: 100, height: 100 }, rulers: null };

describe("a kind's acts: declared with its object, published for a selection of that kind (K8a)", () => {
  it("defineObject hands its acts to the widget type — the one core runs them from", () => {
    expect(Clock.menu.map((a) => a.id)).toEqual(["tick", "wind"]);
    expect(Mute.menu).toEqual([]);
  });

  it("the anchor carries the acts every selected object's type declares, as plain data — none for a mixed selection, none with nothing selected", () => {
    const ce = createCanvasEngine({ widgets: [Clock, Bell, Mute] });
    ce.docs.create();
    try {
      const at = (type: string, x: number): Entity => ce.ops.spawnWidget(type, { x, y: 0, w: 10, h: 10, undoable: false });
      const [c1, c2, b, m] = [at(Clock.type, 0), at(Clock.type, 20), at(Bell.type, 40), at(Mute.type, 60)];
      const menuOf = (e: Entity): readonly MenuActionDef[] => (e === b ? Bell.menu : e === m ? Mute.menu : Clock.menu);
      const two = withKindActs({ ...ANCHOR, count: 2 }, [c1, c2], menuOf);
      expect(two.menu).toEqual([{ id: "tick", label: "Tick", keys: "K", glyph: { path: "M5 12l4 4 10-10" } }, { id: "wind", label: "Wind" }]);
      expect(JSON.parse(JSON.stringify(two.menu))).toEqual(two.menu);   // plain data: the op stays on the type
      expect(withKindActs({ ...ANCHOR, count: 2 }, [c1, b], menuOf).menu?.map((s) => s.label)).toEqual(["Tick"]);
      expect(withKindActs({ ...ANCHOR, count: 2 }, [c1, m], menuOf)).not.toHaveProperty("menu");
      expect(withKindActs({ ...ANCHOR, count: 0 }, [], menuOf)).not.toHaveProperty("menu");
    } finally {
      ce.dispose();
    }
  });
});
