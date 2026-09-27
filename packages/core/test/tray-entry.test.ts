// @vitest-environment node
// THE TRAY ENTRY (design-017 §8; K5a — K-L2): `defineWidget({ tray })` is how any kind — a built-in or a plugin's — puts a specimen on
// the pegboard tray. Compiled once, frozen, on the widget type; refused unless it can be laid and drawn: an object's only, a name tag,
// props the widget declares (each valid), a hang the lattice law can lay, a finite order, a string category.
import { describe, expect, it } from "vitest";
import { defineWidget, p, widgets } from "../src";

const hang = { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] } as const;
const props = { text: p.string({ default: "" }), seed: p.number({ default: 0 }) };

describe("the tray entry", () => {
  it("compiles onto the widget type, frozen, its props kept", () => {
    const t = widgets.get("entry:ok") ?? defineWidget({ type: "entry:ok", object: { name: "ok" }, props, tray: { label: "Note", props: { seed: 3 }, hang, category: "paper", order: 2 } });
    expect(t.tray).toEqual({ label: "Note", props: { seed: 3 }, hang: { w: 120, h: 120, accessory: "hook", pegs: [[-1, -0.5], [1, -0.5]] }, category: "paper", order: 2 });
    expect(Object.isFrozen(t.tray)).toBe(true);
    expect(Object.isFrozen(t.tray?.hang)).toBe(true);
    expect(Object.isFrozen(t.tray?.hang.pegs[0])).toBe(true);
    // a widget without one hangs nothing
    const none = widgets.get("entry:none") ?? defineWidget({ type: "entry:none", object: { name: "none" } });
    expect(none.tray).toBeUndefined();
  });

  it("is refused where it could not be laid or drawn", () => {
    const bad = (type: string, tray: unknown, object: unknown = { name: type }) => () => defineWidget({ type, object, props, tray: tray as never });
    expect(bad("entry:faceless", { label: "X", hang }, null)).toThrow(/only an object hangs on the tray/);
    expect(bad("entry:label", { label: "  ", hang })).toThrow(/label/);
    expect(bad("entry:unknown", { label: "X", hang, props: { colour: "red" } })).toThrow(/does not declare/);
    expect(bad("entry:invalid", { label: "X", hang, props: { seed: "three" } })).toThrow(/prop "seed" is invalid/);
    expect(bad("entry:hang", { label: "X", hang: { ...hang, pegs: [[0, 0], [0.5, 0]] } })).toThrow(/its hang: .*stagger/);
    expect(bad("entry:size", { label: "X", hang: { ...hang, w: -1 } })).toThrow(/its hang: .*size/);
    expect(bad("entry:accessory", { label: "X", hang: { ...hang, accessory: "nail" } })).toThrow(/its hang: .*accessory/);
    expect(bad("entry:order", { label: "X", hang, order: Number.POSITIVE_INFINITY })).toThrow(/order/);
    expect(bad("entry:category", { label: "X", hang, category: 3 })).toThrow(/category/);
    // nothing refused was registered
    for (const t of ["entry:faceless", "entry:label", "entry:unknown", "entry:invalid", "entry:hang", "entry:size", "entry:accessory", "entry:order", "entry:category"]) expect(widgets.get(t)).toBeUndefined();
  });
});
