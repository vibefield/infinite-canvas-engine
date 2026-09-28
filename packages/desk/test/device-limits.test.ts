// @vitest-environment node
// THE ONE LIMIT THE DESK ASKS (K9 R1; engine/device.ts `arrayLayerLimit`): a device asked for no limits gets WebGPU's floor —
// 256 texture array layers — whatever the adapter holds, and the kinds' shared thumbnail arrays stop there (the 257th
// whiteboard had no far-LOD thumbnail, the 257th picture no layer). `acquire` asks the adapter's own `maxTextureArrayLayers`;
// an adapter at the floor is asked for 256 (nothing changes); an adapter that reports none is asked for nothing.
import { describe, expect, it, vi } from "vitest";
import { acquire, arrayLayerLimit } from "../src/engine/device";

function fakeGpu(limits: Record<string, number> | undefined) {
  const device = { lost: new Promise<never>(() => {}), addEventListener: () => {} };
  const adapter = { features: new Set<string>(), limits, info: { vendor: "fake", architecture: "", description: "" }, requestDevice: vi.fn(async (_d?: GPUDeviceDescriptor) => device) };
  const gpu = { requestAdapter: vi.fn(async () => adapter) };
  return { gpu: gpu as unknown as GPU, adapter, device };
}

describe("the adapter's array-layer limit (K9 R1)", () => {
  it("arrayLayerLimit: the adapter's own count, 256 at the floor, nothing when the adapter says nothing", () => {
    expect(arrayLayerLimit({ limits: { maxTextureArrayLayers: 2048 } as unknown as GPUSupportedLimits })).toEqual({ maxTextureArrayLayers: 2048 });
    expect(arrayLayerLimit({ limits: { maxTextureArrayLayers: 256 } as unknown as GPUSupportedLimits })).toEqual({ maxTextureArrayLayers: 256 });
    expect(arrayLayerLimit({ limits: {} as unknown as GPUSupportedLimits })).toBeUndefined();
    expect(arrayLayerLimit({ limits: undefined as unknown as GPUSupportedLimits })).toBeUndefined();
  });

  it("acquire asks the device for the adapter's maxTextureArrayLayers — and for no limits from an adapter that reports none", async () => {
    const apple = fakeGpu({ maxTextureArrayLayers: 2048 });
    await acquire({ gpu: apple.gpu });
    expect(apple.adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(apple.adapter.requestDevice.mock.calls[0]?.[0]).toMatchObject({ requiredLimits: { maxTextureArrayLayers: 2048 } });
    const bare = fakeGpu(undefined);
    await acquire({ gpu: bare.gpu });
    expect(bare.adapter.requestDevice.mock.calls[0]?.[0]).not.toHaveProperty("requiredLimits");
  });
});
