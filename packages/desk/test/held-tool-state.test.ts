// @vitest-environment node
// A HELD TOOL SAYS ITS STATE NOW (petition I49 — VibeField's browser pane: ‹ back with no history, ↻ reload → ✕ stop while a page
// loads): a tool's `state(ctx)`, declared with the kind's `open.tools`, is read with the anchor as the kind's `readout` is — off the
// object's props and the kind's state ON THIS DESK (`ctx.local`) — and surfaces on the anchor's tool rows: `enabled: false`, the glyph
// and the label it says now. `ops.useHeldTool` does nothing for a tool said disabled — through the pose seam, which reads the same
// state — a bar slot's press and a keys-only tool's key alike. A `state` that THROWS is caught at the call (said once a tool, never a
// strike, no frame fault): the tool stands as declared. Kinds of the test's own, as a plugin's, on the fake device.
import { createCanvasEngine, type HeldGlyph, type HeldToolDef, p, Viewport, type WidgetType } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindLocal, ObjectKind } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const STOP: HeldGlyph = { path: "M6 6 L18 18 M18 6 L6 18" };

/** The pane's desk state: what its "page" says now (a live face's `info()` — its history, its loading); the test moves it. */
interface PaneLocal extends KindLocal { back: boolean; loading: boolean; throws: boolean }
const ran: string[] = [];
const asked: string[] = [];
const info = (c: { readonly local: unknown }): PaneLocal => c.local as PaneLocal;
const TOOLS: readonly HeldToolDef[] = [
  { id: "back", label: "Back", kind: "action", keys: ["mod+["], hint: "⌘[", glyph: "chevron-left", run: () => { ran.push("back"); }, state: (c) => { asked.push("back"); return { enabled: info(c).back }; } },
  { id: "reload", label: "Reload", kind: "action", keys: ["mod+r"], glyph: "reload", run: (api) => { ran.push("reload"); api.setProps({ n: Number(api.props().n ?? 0) + 1 }); }, state: (c) => (info(c).loading ? { glyph: STOP, label: "Stop" } : undefined) },
  // a mode whose state reads the PROPS: live once the object's n is past 0
  { id: "zoom", label: "Zoom", kind: "mode", state: (c) => ({ enabled: Number(c.props().n ?? 0) > 0, label: `Zoom ${String(c.props().n)} of ${c.world.isAlive(c.entity) ? "a live object" : "nothing"}` }) },
  { id: "pen", label: "Pen", kind: "mode" },
  // keys only — no slot in the bar: its state is read when it is used
  { id: "find", label: "Find", kind: "action", keys: ["mod+f"], bar: false, run: () => { ran.push("find"); }, state: (c) => ({ enabled: !info(c).loading }) },
  { id: "odd", label: "Odd", kind: "action", run: () => { ran.push("odd"); }, state: (c) => { if (info(c).throws) throw new Error("no state today"); return undefined; } },
];

/** An openable object of the test's own with the pane's tools: a pass that draws nothing, a desk state the test moves. */
function pane(name: string, tools: readonly HeldToolDef[] = TOOLS): WidgetType {
  const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
  const kind: ObjectKind = {
    name, stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}), hit: () => "content",
    local: (): PaneLocal => ({ back: false, loading: false, throws: false }),
    open: { extent: (c) => c.rect, tools, tool: () => "pen" },
  };
  return defineObject({ type: `state.${name}`, version: 1, props: { n: p.number({ default: 0 }) }, kind });
}
const PANE = pane("pane");

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
  /** A frame drawn again in hand (a live face's arrival asks one — `KindHost.redraw`): the anchor recomposed and published. */
  const redraw = (): void => { handle.desk.wake("ink"); step(); };
  const local = (name: string): PaneLocal => handle.local(name) as PaneLocal;
  const slots = () => handle.selection.anchor().held?.tools ?? [];
  const slot = (id: string) => slots().find((t) => t.id === id);
  return { ce, handle, faults, step, pickUp, redraw, local, slots, slot, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

describe("a held tool says its state now (petition I49)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); ran.length = 0; asked.length = 0; });

  it("is read with the anchor off the kind's desk state and the props: a tool said disabled is carried `enabled: false`, a glyph and a label said now replace the declared ones — and the tool as declared when it says nothing", async () => {
    const d = await mountDesk([PANE]);
    try {
      d.pickUp("state.pane");
      // the bar's slots (the keys-only `find` takes none): back disabled (no history), reload as declared, zoom disabled by the props
      expect(d.slots()).toEqual([
        { id: "back", label: "Back", kind: "action", hint: "⌘[", glyph: "chevron-left", enabled: false },
        { id: "reload", label: "Reload", kind: "action", glyph: "reload" },
        { id: "zoom", label: "Zoom 0 of a live object", kind: "mode", enabled: false },
        { id: "pen", label: "Pen", kind: "mode" },
        { id: "odd", label: "Odd", kind: "action" },
      ]);
      // the page gains a history and starts loading: heard by the subscription in the frame drawn for it, once
      const heard: unknown[] = [];
      const off = d.handle.selection.subscribe(() => { heard.push([d.slot("back"), d.slot("reload")]); });
      d.local("pane").back = true;
      d.local("pane").loading = true;
      d.redraw();
      expect(heard).toEqual([[
        { id: "back", label: "Back", kind: "action", hint: "⌘[", glyph: "chevron-left" },
        { id: "reload", label: "Stop", kind: "action", glyph: STOP },
      ]]);
      d.step(4);
      expect(heard).toHaveLength(1);   // a state that stands is not told again
      d.local("pane").loading = false;
      d.redraw();
      expect(d.slot("reload")).toEqual({ id: "reload", label: "Reload", kind: "action", glyph: "reload" });
      off();
      expect(d.faults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a disabled tool's use does NOTHING — its op never runs, its mode never becomes the tool in hand, a keys-only tool's key alike — by the kind's state on this desk, read through the pose seam; live again, it is used", async () => {
    const d = await mountDesk([PANE]);
    try {
      const e = d.pickUp("state.pane");
      expect(d.ce.ops.useHeldTool("back")).toBe(false);   // no history
      expect(d.ce.ops.useHeldTool("zoom")).toBe(false);   // n is 0
      expect(d.handle.selection.anchor().held?.active).toBe("pen");
      d.local("pane").loading = true;
      expect(d.ce.ops.useHeldTool("find")).toBe(false);   // keys only, disabled while the page loads — no slot said so, the use does
      expect(ran).toEqual([]);
      d.local("pane").back = true;
      d.local("pane").loading = false;
      expect(d.ce.ops.useHeldTool("back")).toBe(true);    // read when it is USED: no frame needed between the page's word and the press
      expect(d.ce.ops.useHeldTool("find")).toBe(true);
      expect(d.ce.ops.useHeldTool("reload")).toBe(true);  // its act writes n = 1…
      d.step();
      expect(d.slot("zoom")).toEqual({ id: "zoom", label: "Zoom 1 of a live object", kind: "mode" });   // …and the frame that draws it says zoom is live
      expect(d.ce.ops.useHeldTool("zoom")).toBe(true);
      d.step();
      expect(d.handle.selection.anchor().held?.active).toBe("zoom");
      expect(ran).toEqual(["back", "find", "reload"]);
      expect(d.ce.world.isAlive(e)).toBe(true);
    } finally { d.dispose(); }
  });

  it("a `state` that THROWS is caught at the call: the tool stands as declared — live, its own glyph and label — said once a tool, never a strike, nothing thrown out of the anchor, the use or the frame", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = await mountDesk([PANE]);
    try {
      d.pickUp("state.pane");
      d.local("pane").throws = true;
      for (let i = 0; i < 6; i++) { d.handle.selection.anchor(); d.redraw(); }   // twelve throws and more: never a strike
      expect(d.slot("odd")).toEqual({ id: "odd", label: "Odd", kind: "action" });
      expect(d.ce.ops.useHeldTool("odd")).toBe(true);   // as declared: live
      expect(ran).toEqual(["odd"]);
      expect(d.handle.status()).toEqual({ state: "ready" });
      expect(warned.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("strike"))).toEqual([]);
      expect(d.faults).toEqual([]);
      const told = said.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("threw in its `state`"));
      expect(told).toHaveLength(1);
      expect(told[0]).toContain('the kind "pane"\'s held tool "odd"');
      // the other tools' states are read as ever beside it
      expect(d.slot("back")).toEqual({ id: "back", label: "Back", kind: "action", hint: "⌘[", glyph: "chevron-left", enabled: false });
    } finally { d.dispose(); }
  });

  it("a tool with no `state` is never asked, and nothing is asked while nothing is held", async () => {
    const d = await mountDesk([PANE]);
    try {
      const e = d.ce.ops.spawnWidget("state.pane", { x: 300, y: 200, undoable: false });
      d.step(3);
      d.handle.selection.anchor();
      expect(asked).toEqual([]);   // on the desk: no anchor's tools, no state read
      d.ce.ops.open(e);
      d.step();
      expect(asked.length).toBeGreaterThan(0);
      expect(d.slot("pen")).toEqual({ id: "pen", label: "Pen", kind: "mode" });
    } finally { d.dispose(); }
  });
});
