import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const rendererProbe = vi.hoisted(() => ({
  instances: [] as unknown[],
  defaultDeviceLossCalls: 0,
  initError: undefined as Error | undefined,
}));

vi.mock("three/webgpu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three/webgpu")>();
  class FakeWebGpuRenderer {
    readonly backend: {
      readonly isWebGPUBackend?: boolean;
      readonly isWebGLBackend?: boolean;
      readonly trackTimestamp?: boolean;
    };
    readonly info = {
      render: { drawCalls: 2, triangles: 4, points: 0, lines: 1 },
    };
    onDeviceLost = () => {
      rendererProbe.defaultDeviceLossCalls += 1;
    };

    constructor(opts: { forceWebGL?: boolean; trackTimestamp?: boolean }) {
      this.backend = opts.forceWebGL === true
        ? { isWebGLBackend: true, trackTimestamp: opts.trackTimestamp === true }
        : { isWebGPUBackend: true, trackTimestamp: opts.trackTimestamp === true };
      rendererProbe.instances.push(this);
    }

    init(): Promise<void> {
      return rendererProbe.initError === undefined
        ? Promise.resolve()
        : Promise.reject(rendererProbe.initError);
    }

    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    resolveTimestampsAsync(): Promise<number> {
      return Promise.resolve(0.25);
    }
    dispose(): void {}
  }
  return { ...actual, WebGPURenderer: FakeWebGpuRenderer };
});

import { createGroundRenderer } from "../src/renderer";
import { OrthographicCamera, Scene } from "three/webgpu";

type DeviceLostEmitter = {
  onDeviceLost(info: {
    api: "WebGL" | "WebGPU";
    message: string;
    reason: string | null;
    originalEvent: unknown;
  }): void;
};

const originalGpu = Object.getOwnPropertyDescriptor(globalThis.navigator, "gpu");

beforeEach(() => {
  rendererProbe.instances.length = 0;
  rendererProbe.defaultDeviceLossCalls = 0;
  rendererProbe.initError = undefined;
  Object.defineProperty(globalThis.navigator, "gpu", {
    configurable: true,
    value: {},
  });
});

afterAll(() => {
  if (originalGpu === undefined) {
    Reflect.deleteProperty(globalThis.navigator, "gpu");
  } else {
    Object.defineProperty(globalThis.navigator, "gpu", originalGpu);
  }
});

describe("ground renderer health", () => {
  it("promotes Three's WebGPU device-loss callback into permanent ground failure", async () => {
    const renderer = createGroundRenderer(document);
    await Promise.resolve();
    expect(renderer.status?.()).toEqual({
      backend: "webgpu",
      ready: true,
      failed: false,
    });

    const physical = rendererProbe.instances.at(-1) as DeviceLostEmitter;
    physical.onDeviceLost({
      api: "WebGPU",
      message: "device removed during navigation",
      reason: "unknown",
      originalEvent: {},
    });

    expect(renderer.ready()).toBe(false);
    expect(renderer.failed()).toBe(true);
    expect(renderer.status?.()).toEqual({
      backend: "webgpu",
      ready: false,
      failed: true,
      failure: {
        kind: "device-lost",
        backend: "webgpu",
        message: "device removed during navigation",
        api: "WebGPU",
        reason: "unknown",
      },
    });
    expect(rendererProbe.defaultDeviceLossCalls).toBe(1);
  });

  it("reports initialization failure and never fires retained ready callbacks", async () => {
    rendererProbe.initError = new Error("adapter request rejected");
    const renderer = createGroundRenderer(document);
    const ready = vi.fn();
    renderer.onReady(ready);
    await Promise.resolve();
    await Promise.resolve();

    expect(ready).not.toHaveBeenCalled();
    expect(renderer.status?.()).toEqual({
      backend: "pending",
      ready: false,
      failed: true,
      failure: {
        kind: "initialization",
        backend: "pending",
        message: "adapter request rejected",
      },
    });

    renderer.onReady(ready);
    renderer.dispose();
    expect(ready).not.toHaveBeenCalled();
  });

  it("collects CPU/draw/GPU samples only when evidence profiling is explicit", async () => {
    const normal = createGroundRenderer(document);
    const profiled = createGroundRenderer(document, { profile: true });
    await Promise.resolve();
    const scene = new Scene();
    const camera = new OrthographicCamera();
    normal.render(scene, camera);
    profiled.render(scene, camera);
    await Promise.resolve();

    expect(normal.profile?.()).toEqual({ enabled: false, samples: [] });
    expect(profiled.profile?.()).toMatchObject({
      enabled: true,
      timestampSupported: true,
      samples: [{ gpuMs: 0.25, drawCalls: 2, triangles: 4, points: 0, lines: 1 }],
    });
  });
});
