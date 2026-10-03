// @vitest-environment node
// THE CAPTURE DOOR on the handle (petition I23; host/layer.ts `capture`): the desk as the LAST PRESENTED frame showed it, as an
// `ImageBitmap` of the view × dpr — or of a rect at a scale — made from the frame's inputs drawn once more (ground.ts
// `captureFrame`), never from a copy kept of every frame and never as a frame: no redraw, no flush, one submit of its own, the
// memory ledger's `capture` line while the still and its readback live and nothing after. Honest `undefined` — never a throw —
// before the first frame, while the desk is `degraded`, after the device is lost. The layer is mounted on a fake device, a fake
// canvas and a fake page, its reflector registered with the engine and a frame stepped through it; the page's `ImageData` and
// `createImageBitmap` are stubbed (Node has neither) so the bitmap's bytes — RGBA from the swap chain's BGRA, alpha 255 — are read.
import { createCanvasEngine, Viewport } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };

/** What the page's `createImageBitmap` was handed: the ImageData's bytes and size, the options. */
interface FakeBitmap { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray; readonly opts: unknown; close(): void }

/** A desk layer mounted on a fake device over an engine with no object kinds, its reflector registered; the device's loss and uncaptured errors at hand. */
async function mountDesk(view = { w: 300, h: 200, dpr: 2 }) {
  const { device, queue } = fakeDevice();
  const listeners: ((ev: { readonly error: unknown }) => void)[] = [];
  let lose: (info: { readonly reason: string; readonly message: string }) => void = () => {};
  Object.assign(device, {
    addEventListener: (type: string, fn: (ev: { readonly error: unknown }) => void) => { if (type === "uncapturederror") listeners.push(fn); },
    lost: new Promise((r) => { lose = r; }),
    destroy: () => {},
  });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: view.w, clientHeight: view.h, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const ce = createCanvasEngine({});
  ce.docs.create();
  const handle: DeskLayerHandle = deskLayer({ gpu, objects: [], theme: themeFrom("light", PALETTE), palette: PALETTE, gpuLedger: true })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog });
  const unregister = ce.engine.registerReflector(handle.reflector);
  const ready = async (): Promise<void> => { for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5)); };
  /** One engine step — the reflector flushes; with a viewport written, a frame is drawn. */
  const step = (): void => { ce.engine.step(performance.now()); };
  const frame = (): void => { ce.world.setResource(Viewport, { w: view.w, h: view.h, dpr: view.dpr }); step(); };
  return {
    ce, handle, queue, canvas, ready, step, frame, view,
    uncaptured: (name: string, message: string): void => { for (const fn of listeners) fn({ error: { message, constructor: { name } } }); },
    lost: (reason: string, message: string): void => lose({ reason, message }),
    dispose: () => { unregister(); handle.dispose(); ce.dispose(); },
  };
}

describe("the capture door (I23)", () => {
  const undo: (() => void)[] = [];
  const bitmaps: FakeBitmap[] = [];
  beforeAll(() => {
    undo.push(installGpuFlags());
    vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) { if (data.length !== width * height * 4) throw new Error("ImageData: the bytes do not fit the size"); } });
    vi.stubGlobal("createImageBitmap", async (img: { data: Uint8ClampedArray; width: number; height: number }, opts: unknown): Promise<FakeBitmap> => { const b: FakeBitmap = { width: img.width, height: img.height, data: img.data, opts, close() {} }; bitmaps.push(b); return b; });
  });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { bitmaps.length = 0; vi.restoreAllMocks(); });

  it("before the first frame — pending, then ready with nothing presented — undefined; after a drawn frame, the bitmap of the view × dpr", async () => {
    const d = await mountDesk();
    try {
      expect(await d.handle.capture()).toBeUndefined();   // pending: the device is not even here
      await d.ready();
      expect(d.handle.status()).toEqual({ state: "ready" });
      expect(d.handle.lastInputs()).toBeNull();
      expect(await d.handle.capture()).toBeUndefined();   // ready, but no frame has been presented (no viewport yet)
      expect(bitmaps).toHaveLength(0);
      d.frame();
      expect(d.handle.redraws()).toBe(1);
      const bmp = (await d.handle.capture()) as unknown as FakeBitmap;
      expect(bmp).toMatchObject({ width: 600, height: 400 });
      expect(bmp.opts).toEqual({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
      expect(bmp.data.length).toBe(600 * 400 * 4);
      // the bytes: the swap chain is bgra8unorm, the bitmap RGBA with alpha 255 — pixel (x, y)'s B,G,R are the still's row bytes (the fake's: each its own index)
      const rowBytes = Math.ceil((600 * 4) / 256) * 256;
      const at = (x: number, y: number): number[] => [...bmp.data.subarray((y * 600 + x) * 4, (y * 600 + x) * 4 + 4)];
      const src = (x: number, y: number, ch: number): number => (y * rowBytes + x * 4 + ch) & 255;
      for (const [x, y] of [[0, 0], [599, 399], [41, 317]] as const) expect(at(x, y)).toEqual([src(x, y, 2), src(x, y, 1), src(x, y, 0), 255]);
    } finally { d.dispose(); }
  });

  it("a rect at a quarter dpr: the rect at the view's dpr × 0.25", async () => {
    const d = await mountDesk();
    try {
      await d.ready();
      d.frame();
      const bmp = await d.handle.capture({ rect: { x: 50, y: 20, width: 100, height: 60 }, scale: 0.25 });
      expect(bmp).toMatchObject({ width: 50, height: 30 });
    } finally { d.dispose(); }
  });

  it("the ledger counts the capture and no extra frame: the still and the readback made and destroyed (a `capture` line while they live, none after), one submit, no redraw, no flush that drew", async () => {
    const d = await mountDesk();
    try {
      await d.ready();
      d.frame();
      const submits = d.handle.submits();
      expect(submits).toBeDefined();
      const made: string[] = [];
      const ledger = d.handle.gpuMemory();
      expect(ledger).toBeDefined();
      const dev = d.handle.device() as unknown as { createTexture: (x: GPUTextureDescriptor) => GPUTexture; createBuffer: (x: GPUBufferDescriptor) => GPUBuffer };
      const makeTexture = dev.createTexture.bind(dev);
      const makeBuffer = dev.createBuffer.bind(dev);
      /** The ledger's rows once both capture resources are made (the still first, then its readback) — while they live. */
      const seen: Record<string, unknown>[] = [];
      dev.createTexture = (x) => { made.push(x.label ?? ""); return makeTexture(x); };
      dev.createBuffer = (x) => { made.push(x.label ?? ""); const b = makeBuffer(x); seen.push(ledger?.read().byLabel ?? {}); return b; };
      const m0 = ledger?.read();
      const s0 = submits?.total() ?? 0;
      const redraws = d.handle.redraws();
      const perf = d.handle.perf();
      const steps = d.ce.engine.frame.sleepStats().steps;
      expect(await d.handle.capture()).toMatchObject({ width: 600, height: 400 });
      expect(made).toEqual(["capture/still", "capture/readback"]);
      expect(seen[0]?.capture).toMatchObject({ textures: 1, buffers: 1 });   // its own line while the still and its readback live
      const m1 = ledger?.read();
      expect((m1?.made ?? 0) - (m0?.made ?? 0)).toBe(2);
      expect((m1?.destroyed ?? 0) - (m0?.destroyed ?? 0)).toBe(2);
      expect(m1?.byLabel.capture).toBeUndefined();   // nothing left behind
      expect(m1?.total).toBe(m0?.total);
      expect((submits?.total() ?? 0) - s0).toBe(1);
      expect(d.handle.redraws()).toBe(redraws);
      expect(d.handle.perf().frames).toBe(perf.frames);
      expect(d.handle.perf().ticks).toBe(perf.ticks);
      expect(d.ce.engine.frame.sleepStats().steps).toBe(steps);
      expect(d.handle.dirty()).toBe(false);
    } finally { d.dispose(); }
  });

  it("after a forced device loss: undefined, no throw, no status change — and the same while the desk is degraded", async () => {
    const d = await mountDesk();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await d.ready();
      d.frame();
      d.uncaptured("GPUOutOfMemoryError", "Not enough memory left to allocate the texture");
      expect(d.handle.status().state).toBe("degraded");
      expect(await d.handle.capture()).toBeUndefined();
      expect(d.handle.status().state).toBe("degraded");
      d.lost("destroyed", "Device was destroyed.");
      await new Promise((r) => setTimeout(r, 0));
      const failed = d.handle.status();
      expect(failed.state).toBe("failed");
      const heard: string[] = [];
      d.handle.onStatus((s) => heard.push(s.state));
      await expect(d.handle.capture()).resolves.toBeUndefined();
      expect(d.handle.status()).toBe(failed);
      expect(heard).toEqual([]);
      expect(bitmaps).toHaveLength(0);
      expect(errors).toHaveBeenCalled();
    } finally { d.dispose(); }
  });

  it("captures serialize, and one asked for the same picture while another is in flight shares its bitmap; a different one is its own", async () => {
    const d = await mountDesk();
    try {
      await d.ready();
      d.frame();
      const a = d.handle.capture();
      const b = d.handle.capture();
      const c = d.handle.capture({ scale: 0.5 });
      expect(b).toBe(a);
      expect(c).not.toBe(a);
      const [ra, rb, rc] = await Promise.all([a, b, c]);
      expect(rb).toBe(ra);
      expect(ra).toMatchObject({ width: 600, height: 400 });
      expect(rc).toMatchObject({ width: 300, height: 200 });
      expect(bitmaps).toHaveLength(2);
      // a new frame since: the same options are a new picture
      d.frame();
      const e = d.handle.capture();
      expect(e).not.toBe(a);
      expect(await e).not.toBe(ra);
    } finally { d.dispose(); }
  });

  it("a malformed option throws at the call", async () => {
    const d = await mountDesk();
    try {
      await d.ready();
      d.frame();
      expect(() => d.handle.capture({ scale: 0 })).toThrow("capture: scale must be a positive finite number");
      expect(() => d.handle.capture({ rect: { x: 0, y: Number.NaN, width: 1, height: 1 } })).toThrow("rect.y");
    } finally { d.dispose(); }
  });
});
