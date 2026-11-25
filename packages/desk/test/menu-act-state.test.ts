// @vitest-environment node
// A MENU ACT SAYS ITS STATE NOW, AND MAY BE A CHOICE (petitions I61, I62 — VibeField's browser pane: Mute becomes Unmute, and its device
// is one of a list of presets with a Custom that asks for a width, a height and an agent; its phone: the finish shows the phone's
// colour). An act's `state(ctx)` and `choices(ctx)`, declared with the object's `menu`, are read with the anchor — over the selected
// objects of the declaring type, their props and the kind's state ON THIS DESK (`ctx.local`) — and surface on the anchor's menu slots
// as plain data. `ops.runMenuAction` does nothing for an act said disabled, reading the same desk state through the menu state seam the
// layer fills; a taken choice reaches the act's `run` only when it is one of its choices now and its values fit their fields. A held
// tool's choices surface on its slot the same way and are taken through `ops.useHeldTool`. A `state` or `choices` that THROWS is
// caught at the call and said once. Kinds of the test's own, as a plugin's, on the fake device.
import { type ActChoice, createCanvasEngine, type HeldToolDef, type MenuActionDef, p, Viewport, type WidgetType } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindLocal, ObjectKind } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const SOUND_OFF = { path: "M3 9h4l5-4v14l-5-4H3ZM16 9l6 6M22 9l-6 6" };

/** The pane's desk state: whether its page can sound at all now (the test moves it), and whether its acts throw today. */
interface PaneLocal extends KindLocal { silent: boolean; throws: boolean }
const local = (c: { readonly local: unknown }): PaneLocal => c.local as PaneLocal;
const ran: string[] = [];

/** The presets as choices: the current one by the props, Custom last with its three fields. */
const devicesOf = (device: string, width: number): readonly ActChoice[] => [
  { id: "laptop", label: "Laptop", hint: "1280 × 800", ...(device === "laptop" ? { current: true } : {}) },
  { id: "phone", label: "iPhone 17 Pro", hint: "402 × 874", ...(device === "phone" ? { current: true } : {}) },
  {
    id: "custom", label: "Custom…", hint: "your size and agent", group: "custom", ...(device === "custom" ? { current: true } : {}),
    fields: [
      { id: "width", label: "Width", kind: "number", value: width, min: 320, max: 8192, step: 1 },
      { id: "height", label: "Height", kind: "number", value: 800, min: 240, max: 8192, step: 1 },
      { id: "agent", label: "User agent", kind: "text", value: "", maxLength: 512, placeholder: "The browser's own" },
    ],
  },
];
const MENU: readonly MenuActionDef[] = [
  {
    id: "sound", label: "Mute", glyph: { path: "M3 9h4l5-4v14l-5-4H3Z" },
    run: (api) => { ran.push("sound"); for (const e of api.entities) api.setProps(e, { muted: api.props(e).muted !== true }); },
    state: (c) => {
      if (local(c).throws) throw new Error("no state today");
      if (local(c).silent) return { enabled: false };
      return c.entities.every((e) => c.props(e).muted === true) ? { label: "Unmute", glyph: SOUND_OFF } : undefined;
    },
  },
  {
    id: "device", label: "Device", glyph: { path: "M3 5H16V15H3Z" },
    run: (api, taken) => {
      ran.push(`device ${taken === undefined ? "-" : `${taken.id} ${JSON.stringify(taken.values ?? {})}`}`);
      if (taken !== undefined) for (const e of api.entities) api.setProps(e, { device: taken.id, width: Number(taken.values?.width ?? 1280) });
    },
    state: (c) => ({ label: String(c.props(c.entities[0] as never).device) }),
    choices: (c) => {
      if (local(c).throws) throw new Error("no choices today");
      const props = c.props(c.entities[0] as never);
      return devicesOf(String(props.device), Number(props.width));
    },
  },
];
const TOOLS: readonly HeldToolDef[] = [
  { id: "pen", label: "Pen", kind: "mode" },
  {
    id: "device", label: "Device", kind: "action",
    run: (api, taken) => { ran.push(`held device ${taken?.id ?? "-"}`); if (taken !== undefined) api.setProps({ device: taken.id }); },
    choices: (c) => devicesOf(String(c.props().device), Number(c.props().width)),
  },
];

/** An openable object of the test's own with the pane's acts and tools: a pass that draws nothing, a desk state the test moves. */
function pane(name: string): WidgetType {
  const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
  const kind: ObjectKind = {
    name, stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}), hit: () => "content",
    local: (): PaneLocal => ({ silent: false, throws: false }),
    open: { extent: (c) => c.rect, tools: TOOLS, tool: () => "pen" },
  };
  return defineObject({
    type: `acts.${name}`, version: 1, kind, menu: [...MENU],
    props: { muted: p.boolean({ default: false }), device: p.string({ default: "laptop" }), width: p.number({ default: 1280 }) },
  });
}
const PANE = pane("pane");

/** A desk layer on the fake device over the test's objects, the menu state seam handed to it, stepped on a frame clock of its own. */
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
  const handle: DeskLayerHandle = deskLayer({ gpu, objects, theme: themeFrom("light", PALETTE), palette: PALETTE })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog, heldPose: ce.stack.heldPose, menuState: ce.stack.menuState });
  const unregister = ce.engine.registerReflector(handle.reflector);
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  const spawn = (x: number) => ce.ops.spawnWidget(PANE.type, { x, y: 200, undoable: false });
  const redraw = (): void => { handle.desk.wake("ink"); step(); };
  const paneLocal = (): PaneLocal => handle.local("pane") as PaneLocal;
  const slot = (id: string) => handle.selection.anchor().menu?.find((m) => m.id === id);
  return { ce, handle, faults, step, spawn, redraw, paneLocal, slot, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

describe("a menu act says its state now, and may be a choice (petitions I61, I62)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); ran.length = 0; });

  it("the anchor's menu slots carry what the kind says now — a label and glyph, disabled — and the act's choices, as plain data", async () => {
    const d = await mountDesk([PANE]);
    try {
      const [a, b] = [d.spawn(100), d.spawn(500)];
      d.step(2);
      d.ce.ops.setSelection([a, b], "replace");
      d.step();
      expect(d.slot("sound")).toEqual({ id: "sound", label: "Mute", glyph: { path: "M3 9h4l5-4v14l-5-4H3Z" } });
      const device = d.slot("device");
      expect(device?.label).toBe("laptop");
      expect(device?.choices?.map((c) => [c.id, c.current === true])).toEqual([["laptop", true], ["phone", false], ["custom", false]]);
      expect(device?.choices?.[2]?.fields?.map((f) => f.id)).toEqual(["width", "height", "agent"]);
      expect(JSON.parse(JSON.stringify(d.handle.selection.anchor().menu))).toEqual(d.handle.selection.anchor().menu);
      // every selected pane muted: the act says Unmute, heard in the frame drawn for it
      expect(d.ce.ops.runMenuAction("sound")).toBe(true);
      d.step(2);
      expect(d.slot("sound")).toEqual({ id: "sound", label: "Unmute", glyph: SOUND_OFF });
      // the page cannot sound now (the desk's word): disabled, and its press does nothing
      d.paneLocal().silent = true;
      d.redraw();
      expect(d.slot("sound")).toEqual({ id: "sound", label: "Mute", glyph: { path: "M3 9h4l5-4v14l-5-4H3Z" }, enabled: false });
      ran.length = 0;
      expect(d.ce.ops.runMenuAction("sound")).toBe(false);
      expect(ran).toEqual([]);
      expect(d.faults).toEqual([]);
    } finally { d.dispose(); }
  });

  it("a taken choice reaches the act's run only when it is one of its choices now and its values fit their fields", async () => {
    const d = await mountDesk([PANE]);
    try {
      const e = d.spawn(100);
      d.step(2);
      d.ce.ops.setSelection([e], "replace");
      d.step();
      expect(d.ce.ops.runMenuAction("device", { id: "tablet" })).toBe(false);   // not one of its choices
      expect(d.ce.ops.runMenuAction("device", { id: "custom", values: { width: 100 } })).toBe(false);   // under the width's floor
      expect(d.ce.ops.runMenuAction("device", { id: "custom", values: { agent: "x".repeat(513) } })).toBe(false);   // too long an agent
      expect(ran).toEqual([]);
      // a choice with no fields: its id alone; one with fields: every value, the given ones and the others as they stand
      expect(d.ce.ops.runMenuAction("device", { id: "phone" })).toBe(true);
      expect(d.ce.ops.runMenuAction("device", { id: "custom", values: { width: "1024", agent: "Mozilla/5.0 (Test)" } })).toBe(true);
      expect(ran).toEqual(["device phone {}", 'device custom {"width":1024,"height":800,"agent":"Mozilla/5.0 (Test)"}']);
      d.step(2);
      expect(d.slot("device")?.choices?.find((c) => c.current === true)?.id).toBe("custom");
      // run with no choice: the act's plain op
      ran.length = 0;
      expect(d.ce.ops.runMenuAction("device")).toBe(true);
      expect(ran).toEqual(["device -"]);
    } finally { d.dispose(); }
  });

  it("a held tool's choices surface on its slot and are taken through ops.useHeldTool, held to what it offers now", async () => {
    const d = await mountDesk([PANE]);
    try {
      const e = d.spawn(100);
      d.step(2);
      d.ce.ops.open(e);
      d.step();
      const slot = d.handle.selection.anchor().held?.tools.find((t) => t.id === "device");
      expect(slot?.choices?.map((c) => c.id)).toEqual(["laptop", "phone", "custom"]);
      expect(d.handle.selection.anchor().held?.tools.find((t) => t.id === "pen")).not.toHaveProperty("choices");
      expect(d.ce.ops.useHeldTool("device", { id: "tablet" })).toBe(false);
      expect(d.ce.ops.useHeldTool("pen", { id: "phone" })).toBe(false);   // a mode takes no choice
      expect(d.ce.ops.useHeldTool("device", { id: "phone" })).toBe(true);
      expect(ran).toEqual(["held device phone"]);
    } finally { d.dispose(); }
  });

  it("a `state` or `choices` that THROWS is caught at the call: the act stands as declared and as one op, said once each, never a strike", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = await mountDesk([PANE]);
    try {
      const e = d.spawn(100);
      d.step(2);
      d.ce.ops.setSelection([e], "replace");
      d.paneLocal().throws = true;
      for (let i = 0; i < 6; i++) { d.handle.selection.anchor(); d.redraw(); }
      expect(d.slot("sound")).toEqual({ id: "sound", label: "Mute", glyph: { path: "M3 9h4l5-4v14l-5-4H3Z" } });
      expect(d.slot("device")).not.toHaveProperty("choices");
      expect(d.ce.ops.runMenuAction("sound")).toBe(true);   // as declared: live
      expect(d.handle.status()).toEqual({ state: "ready" });
      expect(warned.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("strike"))).toEqual([]);
      const told = said.mock.calls.map((c) => String(c[0]));
      expect(told.filter((m) => m.includes('menu act "sound" threw in its `state`'))).toHaveLength(1);
      expect(told.filter((m) => m.includes('act "device" threw in its `choices`'))).toHaveLength(1);
    } finally { d.dispose(); }
  });

  it("the layer fills core's menu state seam at mount and clears it at dispose", async () => {
    const d = await mountDesk([PANE]);
    const seam = d.ce.stack.menuState;
    const e = d.spawn(100);
    d.step(2);
    expect(seam.current?.local(e)).toEqual({ silent: false, throws: false });
    d.dispose();
    expect(seam.current).toBeNull();
  });
});
