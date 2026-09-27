// @vitest-environment node
// A KIND'S MENU ACTIONS (design-016 §5 · K-L2, K8a — widget/menu-actions.ts): a widget type declares the acts the selection menu offers
// for its objects (`defineWidget({ menu })`, the desk's `defineObject` passes them through) and the engine runs one (`ops.runMenuAction`)
// — each declaring type's `run` over its OWN selected objects, one transaction a write, false when nothing selected declares it. The
// menu shows an act only when every selected object's type declares it (`menuActionsFor`). Until K8a a kind's act was app code over a
// type name (the mini mat's vinyl, apps/desk's `t`). Fixture types of the test's own throughout.
import { describe, expect, it } from "vitest";
import { createCanvasEngine, defineWidget, type Entity, type MenuActionDef, menuActionsFor, p } from "../src";

const ran: string[] = [];
const SPIN: MenuActionDef = { id: "spin", label: "Spin it", glyph: { path: "M4 12a8 8 0 1 0 16 0" }, keys: "S", run: (api) => { ran.push(`spin ${api.entities.length}`); for (const e of api.entities) api.setProps(e, { turns: Number(api.props(e).turns ?? 0) + 1 }); } };
const TOP = defineWidget({ type: "ma:top", props: { turns: p.number({ default: 0 }) }, menu: [SPIN, { id: "shared", label: "Shared", run: () => { ran.push("top shared"); } }] });
const DIE = defineWidget({ type: "ma:die", props: {}, menu: [{ id: "shared", label: "Shared too", run: (api) => { ran.push(`die shared ${api.entities.length}`); } }] });
const PLAIN = defineWidget({ type: "ma:plain", props: {} });

function engine() {
  const ce = createCanvasEngine({ widgets: [TOP, DIE, PLAIN] });
  ce.docs.create();
  const at = (type: string, x: number): Entity => ce.ops.spawnWidget(type, { x, y: 0, w: 40, h: 40, undoable: false });
  const tops = [at("ma:top", 0), at("ma:top", 100)];
  const die = at("ma:die", 200);
  const plain = at("ma:plain", 300);
  ce.step(16);
  return { ce, tops, die, plain };
}

describe("a type's menu acts, run through the engine (K8a)", () => {
  it("defineWidget keeps a type's acts on the type, and refuses a nameless, labelless, op-less or repeated one", () => {
    expect(TOP.menu.map((a) => a.id)).toEqual(["spin", "shared"]);
    expect(PLAIN.menu).toEqual([]);
    expect(() => defineWidget({ type: "ma:bad-1", menu: [{ id: "", label: "x", run: () => {} }] })).toThrow(/every act needs an id/);
    expect(() => defineWidget({ type: "ma:bad-2", menu: [{ id: "a", label: "", run: () => {} }] })).toThrow(/needs a label/);
    expect(() => defineWidget({ type: "ma:bad-3", menu: [{ id: "a", label: "A" } as unknown as MenuActionDef] })).toThrow(/declare `run`/);
    expect(() => defineWidget({ type: "ma:bad-4", menu: [SPIN, SPIN] })).toThrow(/repeats "spin"/);
    expect(() => defineWidget({ type: "ma:bad-5", menu: [{ id: "a", label: "A", glyph: { path: "" }, run: () => {} }] })).toThrow(/a glyph is a name/);
  });

  it("ops.runMenuAction runs the act on the selected objects whose type declares it — each type its own `run`, its own objects", () => {
    const { ce, tops, die, plain } = engine();
    try {
      ran.length = 0;
      ce.ops.setSelection([...tops, plain], "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(true);
      expect(ran).toEqual(["spin 2"]);   // the plain one declares none: not handed
      ce.step(32);
      for (const t of tops) expect((ce.world.get(t, TOP.groups[0]?.component as never) as { turns: number }).turns).toBe(1);
      // an act two types declare: each type's own run, once, over its own objects
      ran.length = 0;
      ce.ops.setSelection([...tops, die], "replace");
      expect(ce.ops.runMenuAction("shared")).toBe(true);
      expect(ran.sort()).toEqual(["die shared 1", "top shared"]);
      // nothing selected declares it: false, nothing run
      ran.length = 0;
      ce.ops.setSelection([plain], "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(false);
      ce.ops.setSelection([], "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(false);
      expect(ran).toEqual([]);
    } finally {
      ce.dispose();
    }
  });

  it("menuActionsFor: the acts EVERY selected object's type declares, in the first type's order — none for a mixed or empty selection", () => {
    const { ce, tops, die, plain } = engine();
    try {
      const menuOf = (e: Entity) => (e === die ? DIE.menu : e === plain ? PLAIN.menu : TOP.menu);
      expect(menuActionsFor(tops, menuOf).map((a) => a.id)).toEqual(["spin", "shared"]);
      expect(menuActionsFor([...tops, die], menuOf).map((a) => a.label)).toEqual(["Shared"]);
      expect(menuActionsFor([tops[0] as Entity, plain], menuOf)).toEqual([]);
      expect(menuActionsFor([], menuOf)).toEqual([]);
    } finally {
      ce.dispose();
    }
  });
});
