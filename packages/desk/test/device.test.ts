// @vitest-environment node
// ONE DEVICE PER ENGINE (design-015 D7, the surface review's #6): an app that passes `createCanvasEngine({ compositorDevice })`
// gets a desk that DRAWS WITH that device — the layer never acquires a second one, never destroys the app's, and the engine's
// `errors()` sees the desk's uncaptured GPU errors (they are the same device's). Until D7 the layer always acquired its own:
// an app following the facade's doc ran two devices, and `errors()` never saw the desk's. With no engine device the layer
// still acquires its own from `opts.gpu`, and destroys it at dispose.
import { acquireCompositorDevice, createCanvasEngine, type EngineGpu } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquire } from "../src/engine/device";
import { deskLayer } from "../src/host/layer";
import { deskPalette, deskTheme } from "../src/objects/palette";
import { fakePage } from "./fake-page";

/** A device as far as the layer and core's door touch one before the swap chain: its loss, its error events, its end. */
function fakeGpu() {
  const listeners: ((ev: unknown) => void)[] = [];
  const device = {
    label: "",
    features: new Set<string>(),
    lost: new Promise<never>(() => {}),
    queue: { submit: () => undefined, writeBuffer: () => undefined, writeTexture: () => undefined },
    destroyed: 0,
    addEventListener: (type: string, l: (ev: unknown) => void) => { if (type === "uncapturederror") listeners.push(l); },
    destroy() { this.destroyed += 1; },
    raise(message: string) { for (const l of listeners) l({ error: { message } }); },
  };
  const adapter = { features: new Set<string>(), info: { vendor: "fake", architecture: "", description: "" }, requestDevice: vi.fn(async () => device) };
  const gpu = { requestAdapter: vi.fn(async () => adapter), getPreferredCanvasFormat: () => "bgra8unorm" };
  return { gpu, adapter, device };
}

/** Mount a desk layer on a fake page over `ce` with `ctxGpu` in its context; resolve once its boot has settled. */
async function mount(ctxGpu: EngineGpu | undefined, own: ReturnType<typeof fakeGpu>) {
  const ce = createCanvasEngine({});
  ce.docs.create();
  const page = fakePage();
  const seen: GPUDevice[] = [];
  const { stack } = ce;
  const handle = deskLayer({ theme: deskTheme("light"), palette: deskPalette("light"), gpu: own.gpu as unknown as GPU, onDevice: (d) => seen.push(d) })({
    host: { container: page.container } as never, world: ce.world,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
    transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
    ...(ctxGpu !== undefined ? { gpu: ctxGpu } : {}),
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();   // the boot's microtasks: the device, onDevice, the swap chain's refusal
  return { ce, handle, seen };
}

describe("one device per engine (D7)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("the engine's device is the one the desk draws with: no second device, errors() sees the desk's, and the app's device outlives the layer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = fakeGpu();
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { gpu: app.gpu }, configurable: true, writable: true });
    let engineGpu: EngineGpu;
    try { engineGpu = await acquireCompositorDevice(); } finally { if (was) Object.defineProperty(globalThis, "navigator", was); else Reflect.deleteProperty(globalThis, "navigator"); }
    const own = fakeGpu();   // what the layer would acquire its own from
    const { ce, handle, seen } = await mount(engineGpu, own);
    expect(seen).toEqual([engineGpu.device]);
    expect(handle.device()).toBe(engineGpu.device);
    expect(own.gpu.requestAdapter).not.toHaveBeenCalled();   // no second device
    app.device.raise("out of memory on the desk's layer texture");
    expect(engineGpu.errors().map((e) => e.message)).toEqual(["out of memory on the desk's layer texture"]);
    handle.dispose();
    expect(app.device.destroyed).toBe(0);   // the app's: never the layer's to destroy
    ce.dispose();
  });

  it("with no engine device the layer acquires its OWN from opts.gpu — and destroys it at dispose", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const own = fakeGpu();
    const { ce, handle, seen } = await mount(undefined, own);
    expect(own.gpu.requestAdapter).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([own.device]);
    handle.dispose();
    expect(own.device.destroyed).toBe(1);
    ce.dispose();
  });
});

// THE PROFILER'S CLOCK (design-016 §4, K2): both device paths ask for `timestamp-query` whenever the adapter has it — a feature
// cannot be added to a device once made, and one unused costs nothing. Until K2 neither asked (D7 stopped asking for every
// advertised feature, and timestamp-query went with them), so `EngineGpu.hasTimestampQuery` was false on every device.
describe("the profiler's clock (K2)", () => {
  /** An adapter that has `features`, whose device has exactly what it was asked for. */
  function clockGpu(features: readonly string[]) {
    const requestDevice = vi.fn(async (d?: GPUDeviceDescriptor) => ({
      label: d?.label ?? "", features: new Set<string>(d?.requiredFeatures ?? []), lost: new Promise<never>(() => {}),
      queue: {}, addEventListener: () => {}, destroy: () => {},
    }));
    const adapter = { features: new Set<string>(features), info: { vendor: "fake", architecture: "", description: "" }, requestDevice };
    return { gpu: { requestAdapter: vi.fn(async () => adapter) }, requestDevice };
  }
  async function engineDevice(gpu: unknown, opts?: Parameters<typeof acquireCompositorDevice>[0]): Promise<EngineGpu> {
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { gpu }, configurable: true, writable: true });
    try { return await acquireCompositorDevice(opts); } finally { if (was) Object.defineProperty(globalThis, "navigator", was); else Reflect.deleteProperty(globalThis, "navigator"); }
  }

  it("the engine's device asks for timestamp-query where the adapter has it, beside the caller's own — and hasTimestampQuery is real", async () => {
    const c = clockGpu(["timestamp-query", "float32-filterable"]);
    const g = await engineDevice(c.gpu, { requiredFeatures: ["float32-filterable"] });
    expect(c.requestDevice.mock.calls[0]?.[0]?.requiredFeatures).toEqual(["float32-filterable", "timestamp-query"]);
    expect(g.hasTimestampQuery).toBe(true);
    expect(g.enabled).toContain("timestamp-query");
    const none = clockGpu(["timestamp-query"]);
    expect((await engineDevice(none.gpu)).hasTimestampQuery).toBe(true);   // asked for with no features named at all
    const twice = clockGpu(["timestamp-query"]);
    await engineDevice(twice.gpu, { requiredFeatures: ["timestamp-query"] });
    expect(twice.requestDevice.mock.calls[0]?.[0]?.requiredFeatures).toEqual(["timestamp-query"]);   // once, when the caller names it too
  });

  it("an adapter without it is never asked for it (a device request naming a missing feature is refused)", async () => {
    const c = clockGpu([]);
    const g = await engineDevice(c.gpu);
    expect(c.requestDevice.mock.calls[0]?.[0]?.requiredFeatures).toEqual([]);
    expect(g.hasTimestampQuery).toBe(false);
  });

  it("the desk's own device (engine/device.ts `acquire` — the layer's, the oracle's) asks for it too", async () => {
    const c = clockGpu(["timestamp-query"]);
    const g = await acquire({ gpu: c.gpu as unknown as GPU, label: "desk" });
    expect(c.requestDevice.mock.calls[0]?.[0]?.requiredFeatures).toEqual(["timestamp-query"]);
    expect(g.device.features.has("timestamp-query")).toBe(true);
    const bare = clockGpu([]);
    await acquire({ gpu: bare.gpu as unknown as GPU });
    expect(bare.requestDevice.mock.calls[0]?.[0]?.requiredFeatures).toEqual([]);
  });
});
