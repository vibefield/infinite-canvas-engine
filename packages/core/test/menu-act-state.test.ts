// @vitest-environment node
// A MENU ACT SAYS ITS STATE NOW (petition I61 — I49's word for the held bar's tools, given to the selection menu's acts; VibeField's
// browser pane: Mute becomes Unmute; its simulator: the finish act shows the phone's colour): an act's `state(ctx)` is read safely
// (`readMenuActionState` keeps only what is well-formed, and a throw leaves the act as declared), `defineWidget` refuses a `state` that
// is not a function, and `ops.runMenuAction` does NOTHING for an act its kind says is disabled — per declaring type, reading the kind's
// state on its desk through the menu state seam (`stack.menuState`) where a renderer filled it. Fixture types of the test's own.
import { describe, expect, it } from "vitest";
import { createCanvasEngine, defineWidget, type Entity, type MenuActionDef, type MenuActionStateContext, p, readMenuActionState } from "../src";

const ran: string[] = [];
const ctxOf = (over: Partial<MenuActionStateContext> = {}): MenuActionStateContext => ({
  world: undefined as never, entities: [], props: () => ({}), local: undefined, ...over,
});
const act = (state: MenuActionDef["state"]): MenuActionDef => ({ id: "a", label: "A", run: () => {}, ...(state !== undefined ? { state } : {}) });

/** Mute → Unmute by the props: every selected object muted says Unmute, with its own glyph. */
const SOUND: MenuActionDef = {
  id: "sound", label: "Mute", glyph: { path: "M3 9h4l5-4v14l-5-4H3Z" },
  run: (api) => {
    ran.push(`sound ${api.entities.length}`);
    const all = api.entities.every((e) => api.props(e).muted === true);
    for (const e of api.entities) api.setProps(e, { muted: !all });
  },
  state: (c) => (c.entities.length > 0 && c.entities.every((e) => c.props(e).muted === true) ? { label: "Unmute", glyph: { path: "M3 9h4l5-4v14l-5-4H3ZM16 9l6 6M22 9l-6 6" } } : undefined),
};
/** Disabled while the kind's desk state says so (`local.busy`), as a renderer's word. */
const SPIN: MenuActionDef = { id: "spin", label: "Spin", run: (api) => { ran.push(`spin ${api.entities.length}`); }, state: (c) => ({ enabled: (c.local as { busy?: boolean } | undefined)?.busy !== true }) };
const PANE = defineWidget({ type: "mas:pane", props: { muted: p.boolean({ default: false }) }, menu: [SOUND, SPIN] });
/** A second type that also declares `spin`, and is never disabled. */
const TOP = defineWidget({ type: "mas:top", props: {}, menu: [{ id: "spin", label: "Spin too", run: (api) => { ran.push(`top spin ${api.entities.length}`); } }] });

function engine() {
  const ce = createCanvasEngine({ widgets: [PANE, TOP] });
  ce.docs.create();
  const at = (type: string, x: number): Entity => ce.ops.spawnWidget(type, { x, y: 0, w: 40, h: 40, undoable: false });
  const panes = [at("mas:pane", 0), at("mas:pane", 100)];
  const top = at("mas:top", 200);
  ce.step(16);
  return { ce, panes, top };
}

describe("a menu act says its state now (petition I61)", () => {
  it("readMenuActionState keeps only what is well-formed — disabled, a glyph, a label, a swatch — and nothing for an act that says nothing", () => {
    expect(readMenuActionState(act(undefined), ctxOf())).toBeUndefined();
    expect(readMenuActionState(act(() => undefined), ctxOf())).toBeUndefined();
    expect(readMenuActionState(act(() => ({})), ctxOf())).toBeUndefined();
    expect(readMenuActionState(act(() => ({ enabled: true })), ctxOf())).toBeUndefined();   // live is as declared
    expect(readMenuActionState(act(() => ({ enabled: false })), ctxOf())).toEqual({ enabled: false });
    expect(readMenuActionState(act(() => ({ label: "Unmute", glyph: "check", swatch: "#e0692a" })), ctxOf())).toEqual({ label: "Unmute", glyph: "check", swatch: "#e0692a" });
    // what is not one is dropped: an empty label, a drawing with no path, a swatch that is no word or too long a word
    expect(readMenuActionState(act(() => ({ label: "", glyph: { path: "" } as never, swatch: "" })), ctxOf())).toBeUndefined();
    expect(readMenuActionState(act(() => ({ swatch: "x".repeat(65) })), ctxOf())).toBeUndefined();
    expect(readMenuActionState(act(() => ({ swatch: 7 as never, label: "Seven" })), ctxOf())).toEqual({ label: "Seven" });
    expect(readMenuActionState(act(() => "on" as never), ctxOf())).toBeUndefined();
  });

  it("a `state` that THROWS leaves the act as declared, and is told to the caller once a call", () => {
    const told: unknown[] = [];
    expect(readMenuActionState(act(() => { throw new Error("no state today"); }), ctxOf(), (err) => { told.push(err); })).toBeUndefined();
    expect(told).toHaveLength(1);
    expect(String(told[0])).toContain("no state today");
  });

  it("defineWidget refuses a `state` that is not a function", () => {
    expect(() => defineWidget({ type: "mas:bad", menu: [{ id: "a", label: "A", run: () => {}, state: "off" as never }] })).toThrow(/`state` is a function/);
  });

  it("reads the selected objects of the declaring type and their props: Mute while any is sounding, Unmute once every one is muted", () => {
    const { ce, panes } = engine();
    try {
      const propsOf = (e: Entity) => ({ muted: (ce.world.get(e, PANE.groups[0]?.component as never) as { muted?: boolean } | undefined)?.muted === true });
      const read = () => readMenuActionState(SOUND, { world: ce.world, entities: panes, props: propsOf, local: undefined });
      expect(read()).toBeUndefined();
      ce.ops.setSelection(panes, "replace");
      expect(ce.ops.runMenuAction("sound")).toBe(true);
      ce.step(32);
      expect(read()).toEqual({ label: "Unmute", glyph: { path: "M3 9h4l5-4v14l-5-4H3ZM16 9l6 6M22 9l-6 6" } });
      expect(ran).toEqual(["sound 2"]);
    } finally {
      ran.length = 0;
      ce.dispose();
    }
  });

  it("ops.runMenuAction does NOTHING for an act its kind says is disabled — by the kind's desk state through the menu state seam — and each declaring type is asked alone", () => {
    const { ce, panes, top } = engine();
    try {
      let busy = true;
      expect(ce.stack.menuState.current).toBeNull();   // no renderer yet: states are read with no desk state
      ce.stack.menuState.current = { local: () => ({ busy }) };
      ce.ops.setSelection(panes, "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(false);
      expect(ran).toEqual([]);
      // the second type's spin says nothing of its state: it runs, the disabled one does not, and the op says something ran
      ce.ops.setSelection([...panes, top], "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(true);
      expect(ran).toEqual(["top spin 1"]);
      // the desk's word changes: read when the act is RUN, no frame needed between the word and the press
      ran.length = 0;
      busy = false;
      ce.ops.setSelection(panes, "replace");
      expect(ce.ops.runMenuAction("spin")).toBe(true);
      expect(ran).toEqual(["spin 2"]);
      // the renderer gone: read with no desk state, so this act is live
      ran.length = 0;
      ce.stack.menuState.current = null;
      busy = true;
      expect(ce.ops.runMenuAction("spin")).toBe(true);
      expect(ran).toEqual(["spin 2"]);
    } finally {
      ran.length = 0;
      ce.dispose();
    }
  });
});
