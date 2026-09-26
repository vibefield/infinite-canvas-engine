// @vitest-environment node
// ONE DEVICE PER ENGINE (design-015 D7, the surface review's #6): an app that passes `createCanvasEngine({ compositorDevice })`
// gets a desk that DRAWS WITH that device — the layer never acquires a second one, never destroys the app's, and the engine's
// `errors()` sees the desk's uncaptured GPU errors (they are the same device's). Until D7 the layer always acquired its own:
// an app following the facade's doc ran two devices, and `errors()` never saw the desk's. With no engine device the layer
// still acquires its own from `opts.gpu`, and destroys it at dispose.
import { acquireCompositorDevice, createCanvasEngine, type EngineGpu } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
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
