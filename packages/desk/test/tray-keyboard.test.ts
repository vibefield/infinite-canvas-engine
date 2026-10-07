// @vitest-environment node
// THE TRAY'S KEYBOARD PATH on the desk handle (petition I37; host/layer.ts `tray.focus` / `tray.lay`, `TrayAnchor.focused`): the
// board's focus walks the specimens in the lay's order (core's `focusTray`), and the anchor says where the focused one is DRAWN — its
// object as the last frame drew it, the rect a host rings (the desk draws no ring) — told through `subscribe`; `lay` makes the tray's
// own take (core's `ops.layFromTray` through the mount context's `ops`) centred at a point of the view (the view's centre by default)
// or of the world: what a drag-off makes, selected, ONE undo step, the board folding. The layer mounted as `createDeskHost` mounts it,
// on the fake device; kinds of the test's own, as a plugin's (`desk-never-imports-objects`). The drag-off equivalence itself is
// core's (packages/core/test/tray-focus.test.ts, through the real stack); here, the handle's doors and what they read.
import { Camera, createCanvasEngine, p, Position, PrefabId, Selected, Size, trayFocus, Viewport } from "@ice/core";
import { screenToWorld } from "@ice/kernel";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectKind, ObjectRect } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
const SHEET: ObjectKind<ObjectRect, object> = {
  name: "i37-sheet", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
  hit: (G, x, y) => (Math.abs(x - G.cx) <= G.w / 2 && Math.abs(y - G.cy) <= G.h / 2 ? "content" : null),
};
const SHEETS = [0, 1, 2].map((i) =>
  defineObject({
    type: `i37.sheet${i}`, version: 1, props: { word: p.string({ default: "" }) }, size: { w: 160, h: 120 }, kind: SHEET,
    tray: { label: `S${i}`, props: { word: "face" }, take: "face", category: "a", order: i, hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] } },
  }),
);
const TYPES = SHEETS.map((t) => t.type);

/** A desk layer on the fake device as `createDeskHost` mounts it — the stack's seams and, unless `ops: false`, the engine's ops. */
async function mountDesk(opts: { readonly ops?: false } = {}) {
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1200, clientHeight: 800, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const ce = createCanvasEngine({ widgets: SHEETS });
  ce.docs.create();
  ce.world.setResource(Camera, { x: -300, y: -100, zoom: 1.25, gesturing: false });
  const { stack } = ce;
  const handle: DeskLayerHandle = deskLayer({ gpu, objects: SHEETS, theme: themeFrom("light", PALETTE), palette: PALETTE })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: stack.framePick, pickAt: stack.pickAt, navGeometry: stack.navGeometry, heldPose: stack.heldPose, trayPose: stack.trayPose,
    spatial: stack.index, readMarquee: () => stack.marqueeBuffer, ...(opts.ops === false ? {} : { ops: ce.ops }),
  });
  const unregister = ce.engine.registerReflector(handle.reflector);
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  step(2);
  // the drawer out and pinned at its full slide (a still's door): the board laid and drawn
  handle.tray.open();
  handle.tray.pin({ p: 1 });
  step(4);
  return { ce, handle, step, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

describe("the tray's keyboard path on the desk handle (petition I37)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("`focus` walks the lay's order; the anchor's `focused` is the specimen's object as last drawn — told through `subscribe` — and null with nothing focused", async () => {
    const d = await mountDesk();
    try {
      expect(d.handle.tray.state().specimens.map((s) => s.type)).toEqual(TYPES);   // laid and drawn, in the lay's order
      expect(d.handle.tray.anchor().focused).toBeNull();
      const heard = vi.fn();
      d.handle.tray.subscribe(heard);
      expect(d.handle.tray.focus("next")).toBe(TYPES[0]);
      d.step(2);
      const drawn = (type: string) => d.handle.tray.state().specimens.find((s) => s.type === type)?.object;
      expect(d.handle.tray.anchor().focused).toEqual({ id: TYPES[0], rect: drawn(TYPES[0] as string) });
      expect(heard).toHaveBeenCalled();
      heard.mockClear();
      expect(d.handle.tray.focus("last")).toBe(TYPES[2]);
      d.step(2);
      expect(d.handle.tray.anchor().focused).toEqual({ id: TYPES[2], rect: drawn(TYPES[2] as string) });
      expect(heard).toHaveBeenCalled();
      expect(d.handle.tray.focus("prev")).toBe(TYPES[1]);
      expect(d.handle.tray.focus("i37.nothing")).toBe(TYPES[1]);
      // the drawer shut: the focus stands, nothing of it is drawn
      d.handle.tray.pin(null);
      d.handle.tray.close();
      d.step(40);
      expect(d.handle.tray.anchor().focused).toEqual({ id: TYPES[1], rect: null });
    } finally { d.dispose(); }
  });

  it("`lay()` lays the FOCUSED specimen's take at the view's centre — selected, the board folded, ONE undo step; `lay(id, { at, space: \"world\" })` at a world point", async () => {
    const d = await mountDesk();
    try {
      d.handle.tray.focus(TYPES[1] as string);
      const e = d.handle.tray.lay();
      if (e === undefined) throw new Error("refused");
      d.step(2);
      const cam = d.ce.world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
      const centre = screenToWorld(600, 400, cam);   // the view's centre (1200 × 800), through the camera
      expect(d.ce.world.read(e, PrefabId).id).toBe(TYPES[1]);
      expect(d.ce.world.read(e, Size)).toEqual({ w: 160, h: 120 });
      expect(d.ce.world.read(e, Position)).toEqual({ x: centre.x - 80, y: centre.y - 60 });
      expect(d.ce.world.hasTag(e, Selected)).toBe(true);
      expect(d.handle.tray.isOpen()).toBe(false);   // the board folded, as a handed take's
      const props = SHEETS[1]?.groups.find((g) => g.name === "props")?.component;
      expect((d.ce.world.get(e, props as never) as { word?: string } | undefined)?.word).toBe("face");   // the entry's take
      expect(d.ce.docs.undo()).toBe(true);
      d.step(2);
      expect(d.ce.world.isAlive(e)).toBe(false);
      expect(d.ce.docs.undo()).toBe(false);   // ONE step, and nothing before it
      // by id, at a world point, the drawer shut: the take is the tray's whatever the drawer's slide
      const w = d.handle.tray.lay(TYPES[0], { at: { x: 1000, y: -40 }, space: "world" });
      if (w === undefined) throw new Error("refused");
      d.step(2);
      expect(d.ce.world.read(w, Position)).toEqual({ x: 1000 - 80, y: -40 - 60 });
      expect(trayFocus(d.ce.world)).toBe(TYPES[1]);   // laying by id leaves the focus where it was
    } finally { d.dispose(); }
  });

  it("refuses with nothing focused and no id; throws without the engine's ops, on another space or a malformed point", async () => {
    const d = await mountDesk();
    try {
      expect(d.handle.tray.lay()).toBeUndefined();
      expect(d.handle.tray.isOpen()).toBe(true);   // nothing laid, nothing folded
      expect(() => d.handle.tray.lay(TYPES[0], { space: "page" as never })).toThrow(/space is "screen" or "world"/);
      expect(() => d.handle.tray.lay(TYPES[0], { at: { x: 1, y: Number.POSITIVE_INFINITY } })).toThrow(/two finite numbers/);
    } finally { d.dispose(); }
    const bare = await mountDesk({ ops: false });
    try {
      expect(bare.handle.tray.focus("first")).toBe(TYPES[0]);   // the focus is the world's: it needs no ops
      expect(() => bare.handle.tray.lay()).toThrow(/no engine ops/);
    } finally { bare.dispose(); }
  });
});
