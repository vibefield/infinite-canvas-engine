// @vitest-environment node
// THE WORD IN HAND (petition I22 — MC-D9's readouts): a kind's `open.readout`, declared with its held tools, surfaces on the selection's
// anchor as `held.readout` — a string, or read off what the held tools' acts read (the world, the object, its props now) and the kind's
// desk state, each time the anchor is recomposed: at the pickup and after a held tool's act, in the frame that draws what it wrote. A
// kind with none, or one that has no word now, yields an anchor without it (0.14.0's). A readout that THROWS is caught at the kind's
// boundary: the anchor keeps the tools and carries no word, nothing reaches the frame (no reflector fault), and the desk says so once.
// Kinds of the test's own, as a plugin's, on the fake device; the reference six's words are packages/objects/test/held-readout.test.ts's.
import { createCanvasEngine, type HeldToolDef, p, Viewport, type WidgetType } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindLocal, ObjectKind, OpenBinding } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const TOOLS: readonly HeldToolDef[] = [{ id: "more", label: "One more", kind: "action", run: (api) => { api.setProps({ n: Number(api.props().n ?? 0) + 1 }); } }];

/** An openable object of the test's own: a pass that draws nothing, a desk state that says it is one, a `readout` as given. */
function reading(name: string, readout: NonNullable<OpenBinding["readout"]> | "absent"): WidgetType {
  const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
  const kind: ObjectKind = {
    name, stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}), hit: () => "content",
    local: () => ({ desk: `${name}'s desk state` }) as KindLocal,
    open: { extent: (c) => c.rect, tools: TOOLS, ...(readout !== "absent" ? { readout } : {}) },
  };
  return defineObject({ type: `read.${name}`, version: 1, props: { n: p.number({ default: 0 }) }, kind });
}

const COUNTING = reading("counting", (c) => `N ${String(c.props().n)} · ${(c.local as { desk: string }).desk} · ${c.world.isAlive(c.entity)}`);
const STATIC = reading("static", "Static");
const NONE = reading("none", "absent");
const EMPTY = reading("empty", () => "");
const NOT_A_WORD = reading("odd", (() => 42) as unknown as NonNullable<OpenBinding["readout"]>);
const THROWING = reading("throwing", () => { throw new Error("no word today"); });

/** A desk layer on the fake device over the test's objects, its reflector registered, stepped on a frame clock of its own. */
async function mountDesk(objects: WidgetType[]) {
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1200, clientHeight: 800, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const faults: string[] = [];
  const ce = createCanvasEngine({ widgets: objects, onReflectorFault: (name, err) => { faults.push(`${name}: ${String(err)}`); } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const handle: DeskLayerHandle = deskLayer({ gpu, objects, theme: themeFrom("light", PALETTE), palette: PALETTE })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog, heldPose: ce.stack.heldPose });
  const unregister = ce.engine.registerReflector(handle.reflector);
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  /** Spawn one of `type`, pick it up, and draw the pickup's first frame. */
  const pickUp = (type: string) => {
    const e = ce.ops.spawnWidget(type, { x: 300, y: 200, undoable: false });
    step(2);
    ce.ops.open(e);
    step();
    return e;
  };
  return { ce, handle, faults, step, pickUp, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

describe("the word in hand (petition I22)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("is read off the props now and the kind's desk state at the pickup — and again after a held tool's act, in the frame that draws its write, heard by the subscription", async () => {
    const d = await mountDesk([COUNTING]);
    try {
      d.pickUp("read.counting");
      const held = d.handle.selection.anchor().held;
      expect(held?.readout).toBe("N 0 · counting's desk state · true");
      expect(held?.tools.map((t) => t.id)).toEqual(["more"]);
      const heard: (string | undefined)[] = [];
      const off = d.handle.selection.subscribe(() => { heard.push(d.handle.selection.anchor().held?.readout); });
      expect(d.ce.ops.useHeldTool("more")).toBe(true);   // the act commits its transaction: n = 1
      d.step();                                          // …and the next frame draws it, the anchor recomposed with it
      expect(heard).toEqual(["N 1 · counting's desk state · true"]);
      d.step(4);
      expect(heard).toHaveLength(1);                     // a word that stands is not told again
      off();
      expect(d.faults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a string is the word as it is; a kind with none, or with none to say now (\"\", not a string), yields the anchor 0.14.0 published", async () => {
    const d = await mountDesk([STATIC, NONE, EMPTY, NOT_A_WORD]);
    try {
      d.pickUp("read.static");
      expect(d.handle.selection.anchor().held?.readout).toBe("Static");
      d.ce.ops.putDown();
      d.step(60);
      for (const type of ["read.none", "read.empty", "read.odd"]) {
        d.pickUp(type);
        const held = d.handle.selection.anchor().held;
        expect(held === undefined ? [] : Object.keys(held).sort(), type).toEqual(["active", "landing", "settled", "tools"]);
        d.ce.ops.putDown();
        d.step(60);
      }
    } finally { d.dispose(); }
  });

  it("a readout that THROWS is caught at the kind's boundary: no word, the tools kept, nothing thrown out of the anchor or the frame — and said once", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mountDesk([THROWING]);
    try {
      d.pickUp("read.throwing");
      const held = d.handle.selection.anchor().held;
      expect(held).toBeDefined();
      expect(held).not.toHaveProperty("readout");
      expect(held?.tools.map((t) => t.id)).toEqual(["more"]);
      d.ce.ops.useHeldTool("more");
      d.step(5);
      expect(() => d.handle.selection.anchor()).not.toThrow();
      expect(d.faults).toEqual([]);   // the frame never saw it: no reflector skipped a frame
      const told = said.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("`open.readout` threw"));
      expect(told).toHaveLength(1);
      expect(told[0]).toContain('the kind "throwing"');
    } finally { d.dispose(); }
  });
});
