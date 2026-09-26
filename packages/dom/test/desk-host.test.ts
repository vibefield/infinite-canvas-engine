// ONE DEVICE PER ENGINE (design-015 D7): `createDeskHost` hands the engine's device (`createCanvasEngine({ compositorDevice })`)
// to the layer through its context, so the desk draws with it instead of acquiring a second one; an engine with none hands none.
import { createCanvasEngine, type EngineGpu } from "@ice/core";
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
