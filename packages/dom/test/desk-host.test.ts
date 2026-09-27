// ONE DEVICE PER ENGINE (design-015 D7): `createDeskHost` hands the engine's device (`createCanvasEngine({ compositorDevice })`)
// to the layer through its context, so the desk draws with it instead of acquiring a second one; an engine with none hands none.
// THE DEVICE'S RATIO (ICE M21 K1): a ratio change that resizes nothing still reaches the viewport, before the next step.
import { createCanvasEngine, type EngineGpu, Viewport } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createDeskHost, type LayerContext, type LayerHandle } from "../src/desk-host";

function mountWith(compositorDevice: EngineGpu | undefined): LayerContext | undefined {
  const engine = createCanvasEngine(compositorDevice !== undefined ? { compositorDevice } : {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  let seen: LayerContext | undefined;
  const layer = (ctx: LayerContext): LayerHandle => {
    seen = ctx;
    return { reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {} };
  };
  createDeskHost({ container, engine, layer }).dispose();
  engine.dispose();
  container.remove();
  return seen;
}

describe("createDeskHost · the engine's device (D7)", () => {
  it("hands `engine.compositorDevice` to the layer as `ctx.gpu`", () => {
    const gpu = { adapter: {}, device: {}, enabled: [], hasTimestampQuery: false, errors: () => [], destroy() {} } as unknown as EngineGpu;
    expect(mountWith(gpu)?.gpu).toBe(gpu);
  });

  it("hands none when the engine has none — the layer acquires its own", () => {
    const ctx = mountWith(undefined);
    expect(ctx).toBeDefined();
    expect(ctx !== undefined && "gpu" in ctx).toBe(false);
  });
});

describe("createDeskHost · the device's ratio (ICE M21 K1)", () => {
  it("a ratio change with no resize re-syncs the viewport before the next step — the desk draws at the new ratio", () => {
    const frames: FrameRequestCallback[] = [];
    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    const had = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    globalThis.cancelAnimationFrame = () => {};
    const setRatio = (r: number): void => { Object.defineProperty(window, "devicePixelRatio", { value: r, configurable: true }); };
    try {
      setRatio(2);
      const engine = createCanvasEngine();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const layer = (): LayerHandle => ({ reflector: { name: "fake-desk", always: true, flush() {}, available: () => true }, dispose() {} });
      const mount = createDeskHost({ container, engine, layer });
      expect(engine.world.getResource(Viewport)?.dpr).toBe(2);
      frames.shift()?.(16);
      setRatio(1); // another display, the browser's zoom, an emulated ratio: nothing resizes
      expect(engine.world.getResource(Viewport)?.dpr).toBe(2);
      frames.shift()?.(32);
      expect(engine.world.getResource(Viewport)?.dpr).toBe(1);
      mount.dispose();
      engine.dispose();
      container.remove();
    } finally {
      globalThis.requestAnimationFrame = raf;
      globalThis.cancelAnimationFrame = caf;
      if (had !== undefined) Object.defineProperty(window, "devicePixelRatio", had);
      else Reflect.deleteProperty(window, "devicePixelRatio");
    }
  });
});
