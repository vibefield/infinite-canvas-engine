// @vitest-environment node
// THE CAPTURE WITHOUT THE SELECTION'S MARKS (petition I40; host/layer.ts `capture`, ground.ts `captureFrame`, marks/layout.ts
// `unselectedMarks`): `handle.capture({ marks: false })` draws THAT capture with the frame's marks less the selection's — no
// brackets, knobs, union, vellum, guides or rulers' extent; a taped object's tape stays — so a selected object comes out as it looks
// unselected, while the selection, the world and the presented frame are untouched (VibeField's "Send to…" cleared the selection,
// captured and restored it — a blink a peer could see). On the fake device the marks pass is watched: what it is handed for the
// capture is what the presented frame of the SAME desk, unselected, hands it — so the pixels are the unselected desk's (the Dawn
// oracle holds the bytes: packages/objects/oracle/render.mjs `captureCheck`). Kinds of the test's own, as a plugin's.
import { Camera, createCanvasEngine, type Entity, selectedEntities, Viewport } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectKind, ObjectRect } from "../src/kinds/world";
import type { MarksInput } from "../src/marks/layout";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
const inRect = (G: ObjectRect, x: number, y: number): boolean => Math.abs(x - G.cx) <= G.w / 2 && Math.abs(y - G.cy) <= G.h / 2;
/** A sheet — a note's stand-in, resizable (selected, it wears knobs). */
const SHEET: ObjectKind<ObjectRect, object> = {
  name: "i40-sheet", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
  hit: (G, x, y) => (inRect(G, x, y) ? "content" : null),
};
const Sheet = defineObject({ type: "i40.sheet", version: 1, props: {}, kind: SHEET, interaction: { resizable: true } });

interface FakeBitmap { readonly width: number; readonly height: number; close(): void }

/** A desk layer on the fake device, mounted as `createDeskHost` mounts it, its reflector registered, the camera at the origin. */
async function mountDesk() {
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 800, clientHeight: 600, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const ce = createCanvasEngine({ widgets: [Sheet] });
  ce.docs.create();
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const { stack } = ce;
  const handle: DeskLayerHandle = deskLayer({ gpu, objects: [Sheet], theme: themeFrom("light", PALETTE), palette: PALETTE })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: stack.framePick, pickAt: stack.pickAt, navGeometry: stack.navGeometry,
    heldPose: stack.heldPose, trayPose: stack.trayPose, spatial: stack.index, readMarquee: () => stack.marqueeBuffer,
  });
  const unregister = ce.engine.registerReflector(handle.reflector);
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
  const spawn = (x: number, y: number): Entity => ce.ops.spawnWidget(Sheet.type, { x, y, w: 160, h: 120, undoable: false });
  /** The marks pass, watched: every `MarksInput` it is handed, in order (undefined: a frame with none). */
  const ground = handle.ground();
  if (ground === null || ground.marks === null) throw new Error("the layer made no marks pass");
  const handed: (MarksInput | undefined)[] = [];
  const marks = ground.marks;
  const prepare = marks.prepare.bind(marks);
  vi.spyOn(marks, "prepare").mockImplementation((input, tray) => { handed.push(input); return prepare(input, tray); });
  return { ce, handle, step, spawn, handed, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

/** The marks' facts a still is drawn from (the view and the night aside): what a selection lays, and the tape. */
const factsOf = (m: MarksInput | undefined) =>
  m === undefined ? null : { tape: m.tape, objects: m.objects, union: m.union, marquee: m.marquee, guides: m.guides, bars: m.bars, ruler: m.ruler };

describe("capture({ marks: false }) — the objects without the selection's marks (I40)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => {
    undo.push(installGpuFlags());
    vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
    vi.stubGlobal("createImageBitmap", async (img: { width: number; height: number }): Promise<FakeBitmap> => ({ width: img.width, height: img.height, close() {} }));
  });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("a selected object's capture is the unselected desk's marks — the tape kept — and the selection and the presented frame stand", async () => {
    const d = await mountDesk();
    try {
      const a = d.spawn(100, 100);
      const taped = d.spawn(400, 300);
      d.step(2);   // members of the frame now (the tape is the frame's objects' — `setLocked` scopes to them)
      d.ce.ops.setLocked([taped], true);
      d.ce.ops.setSelection([a]);
      d.step(40);   // the lock-on and the tape's press run their clocks out: the desk at rest, selected
      const presented = d.handle.lastInputs();
      const shown = presented?.marks;
      expect(shown?.objects.length).toBeGreaterThan(0);   // the brackets the presented frame wears
      expect(shown?.tape.length).toBe(1);   // the taped object's tape
      const selected = selectedEntities(d.ce.world);
      const redraws = d.handle.redraws();
      const steps = d.ce.engine.frame.sleepStats().steps;
      const submits = d.handle.submits()?.total() ?? 0;

      // the default: the frame as presented — the brackets drawn
      d.handed.length = 0;
      expect(await d.handle.capture()).toMatchObject({ width: 1600, height: 1200 });
      expect(factsOf(d.handed.at(-1))).toEqual(factsOf(shown));

      // marks: false — the selection's marks gone, the tape kept
      d.handed.length = 0;
      expect(await d.handle.capture({ marks: false })).toMatchObject({ width: 1600, height: 1200 });
      const unmarked = d.handed.at(-1);
      expect(unmarked?.objects).toEqual([]);
      expect(unmarked?.union).toBeNull();
      expect(unmarked?.ruler).toBeNull();
      expect(unmarked?.tape).toEqual(shown?.tape);

      // nothing moved: the selection, the presented frame's inputs (the same object, its marks as they were), no frame drawn
      expect(selectedEntities(d.ce.world)).toEqual(selected);
      expect(d.handle.lastInputs()).toBe(presented);
      expect(presented?.marks).toBe(shown);
      expect(shown?.objects.length).toBeGreaterThan(0);
      expect(d.handle.redraws()).toBe(redraws);
      expect(d.ce.engine.frame.sleepStats().steps).toBe(steps);
      expect((d.handle.submits()?.total() ?? 0) - submits).toBe(2);   // the two captures' own, no frame's

      // …and it is what the SAME desk hands the marks pass unselected, at rest
      d.ce.ops.clearSelection();
      d.step(40);
      expect(factsOf(d.handle.lastInputs()?.marks)).toEqual(factsOf(unmarked));
    } finally { d.dispose(); }
  });

  it("asked together, a marks-on and a marks-off capture are two pictures — never one shared bitmap", async () => {
    const d = await mountDesk();
    try {
      d.ce.ops.setSelection([d.spawn(100, 100)]);
      d.step(40);
      d.handed.length = 0;
      const on = d.handle.capture();
      const off = d.handle.capture({ marks: false });
      const offToo = d.handle.capture({ marks: false });
      expect(off).not.toBe(on);
      expect(offToo).toBe(off);   // the same picture in flight: shared, as ever
      const [bOn, bOff] = await Promise.all([on, off, offToo]);
      expect(bOff).not.toBe(bOn);
      expect(d.handed.map((m) => (m?.objects.length ?? 0) > 0)).toEqual([true, false]);
    } finally { d.dispose(); }
  });

  it("`marks: true` is the default's picture; a malformed `marks` throws at the call", async () => {
    const d = await mountDesk();
    try {
      d.ce.ops.setSelection([d.spawn(100, 100)]);
      d.step(40);
      d.handed.length = 0;
      await d.handle.capture({ marks: true });
      expect(d.handed.at(-1)?.objects.length).toBeGreaterThan(0);
      expect(() => d.handle.capture({ marks: "no" as unknown as boolean })).toThrow("capture: marks must be a boolean");
    } finally { d.dispose(); }
  });
});
