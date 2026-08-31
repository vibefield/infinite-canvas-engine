/**
 * The compositor reflector's scheduling contract (design-012 §4).
 *
 * The load-bearing assertion in this file is the ORDERING one: a quiet frame
 * must return BEFORE `getCurrentTexture()`. Acquiring the swap-chain texture is
 * work and commits the frame to a present, so "check dirt, then acquire" and
 * "acquire, then check dirt" draw the same pixels and are not the same program.
 * A fake target counts acquisitions, which is the only way to see the
 * difference from a unit test.
 */
import {
  Camera,
  createCompositorSourceRegistry,
  createEngine,
  createWorld,
  Viewport,
  writeRuntimeResource,
  type CompositorSourceRegistry,
} from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { createCompositorReflector, type CompositeTarget } from "../src/compositor/compositor-reflector";
import { createWidgetQuadPass, type WidgetQuadPass } from "../src/compositor/widget-quad-pass";

/** A target that counts acquisitions; every call is a frame committed to present. */
function fakeTarget(): CompositeTarget & { acquired: number } {
  const self = {
    format: "bgra8unorm" as GPUTextureFormat,
    acquired: 0,
    getCurrentTexture() {
      self.acquired++;
      return { createView: () => ({}) } as unknown as GPUTexture;
    },
    size: () => ({ width: 800, height: 600, dpr: 2 }),
  };
  return self;
}

/** A device that records the encode/submit shape without a GPU. */
function fakeDevice(): GPUDevice & { submits: number; passes: number } {
  const self = {
    submits: 0,
    passes: 0,
    createCommandEncoder: () => ({
      beginRenderPass: () => {
        self.passes++;
        return { end: () => {} };
      },
      finish: () => ({}),
    }),
    queue: {
      submit: (buffers: unknown[]) => {
        self.submits += 1;
        void buffers;
      },
    },
  };
  return self as unknown as GPUDevice & { submits: number; passes: number };
}

function setup(opts: { withTarget?: boolean } = {}) {
  const world = createWorld();
  const engine = createEngine(world);
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });

  const registry: CompositorSourceRegistry = createCompositorSourceRegistry();
  const device = fakeDevice();
  const target = fakeTarget();
  const quadPass: WidgetQuadPass = createWidgetQuadPass({
    device,
    format: "bgra8unorm",
    registry,
  });
  const reflector = createCompositorReflector({
    world,
    registry,
    quadPass,
    device,
    ...(opts.withTarget === false ? {} : { target }),
  });
  engine.registerReflector(reflector);

  let now = 0;
  const step = () => {
    now += 16;
    engine.step(now);
  };
  return { world, engine, registry, device, target, quadPass, reflector, step };
}

describe("compositor reflector — idle-zero", () => {
  it("composites once at boot, then NOTHING on an idle scene", () => {
    const { reflector, device, target, step } = setup();
    step();
    expect(reflector.composites()).toBe(1); // first flush paints unconditionally
    expect(target.acquired).toBe(1);
    expect(device.submits).toBe(1);

    for (let i = 0; i < 60; i++) step();
    expect(reflector.composites()).toBe(1);
    expect(reflector.quiet()).toBe(60);
    expect(device.submits).toBe(1);
  });

  it("returns BEFORE getCurrentTexture on a quiet frame", () => {
    const { target, reflector, step } = setup();
    step(); // boot composite
    const afterBoot = target.acquired;
    for (let i = 0; i < 20; i++) step();
    // The whole law in one line: 20 quiet flushes acquired nothing.
    expect(target.acquired).toBe(afterBoot);
    expect(reflector.acquisitions()).toBe(afterBoot);
  });

  it("acquisitions equal composites exactly — no acquire without a submit", () => {
    const { reflector, target, device, world, step } = setup();
    step();
    for (let i = 1; i <= 5; i++) {
      writeRuntimeResource(world, Camera, { x: i * 10, y: 0, zoom: 1, gesturing: true });
      step();
      step(); // a quiet frame between each move
    }
    expect(reflector.acquisitions()).toBe(reflector.composites());
    expect(target.acquired).toBe(reflector.composites());
    expect(device.submits).toBe(reflector.composites());
  });
});

describe("compositor reflector — the dirty union", () => {
  it("wakes on camera dirt", () => {
    const { world, reflector, step } = setup();
    step();
    const before = reflector.composites();
    writeRuntimeResource(world, Camera, { x: 40, y: 0, zoom: 1, gesturing: false });
    step();
    expect(reflector.composites()).toBe(before + 1);
  });

  it("wakes on viewport dirt", () => {
    const { world, reflector, step } = setup();
    step();
    const before = reflector.composites();
    writeRuntimeResource(world, Viewport, { w: 1024, h: 768, dpr: 2 });
    step();
    expect(reflector.composites()).toBe(before + 1);
  });

  it("wakes on registry membership (promotion) without any world write", () => {
    const { registry, reflector, step } = setup();
    step();
    const before = reflector.composites();
    // The quad pass warns that no source kind composites yet (S1) — expected
    // here, and pinned by its own test; silenced so this file's output is clean.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const off = registry.register(1 as never, { kind: "dom", host: {} });
    step();
    expect(reflector.composites()).toBe(before + 1);
    off();
    step();
    expect(reflector.composites()).toBe(before + 2);
    warn.mockRestore();
  });

  it("wakes on each marked presentation source and NAMES the reason", () => {
    const sources = ["dom", "island", "video", "sibling-order", "promotion"] as const;
    for (const source of sources) {
      const { reflector, step } = setup();
      step();
      const before = reflector.composites();
      reflector.mark(source);
      expect(reflector.isDirty()).toBe(true);
      expect(reflector.pendingReasons()).toContain(source);
      step();
      expect(reflector.composites()).toBe(before + 1);
      // Reasons clear with the composite; a stale reason would misdiagnose the
      // next stuck-awake investigation.
      expect(reflector.pendingReasons()).toEqual([]);
    }
  });

  it("coalesces many marks in one frame into ONE composite", () => {
    const { world, reflector, device, step } = setup();
    step();
    const before = device.submits;
    reflector.mark("dom");
    reflector.mark("dom");
    reflector.mark("island");
    reflector.mark("video");
    writeRuntimeResource(world, Camera, { x: 5, y: 5, zoom: 1, gesturing: true });
    step();
    expect(device.submits).toBe(before + 1);
  });

  it("stops waking after dispose", () => {
    const { world, reflector, step } = setup();
    step();
    reflector.dispose();
    const before = reflector.composites();
    writeRuntimeResource(world, Camera, { x: 99, y: 0, zoom: 1, gesturing: false });
    reflector.mark("dom");
    step();
    expect(reflector.composites()).toBe(before);
  });
});

describe("compositor reflector — S1 without a target", () => {
  it("tracks dirt and submits nothing when no target exists yet", () => {
    const { reflector, device, step } = setup({ withTarget: false });
    step();
    expect(reflector.composites()).toBe(1);
    expect(reflector.acquisitions()).toBe(0);
    // The S1 exit in one assertion: the composited profile adds ZERO submits,
    // so ground alone is what reaches the screen and the pixel-compare against
    // the stratified render is a comparison of one renderer, not two.
    expect(device.submits).toBe(0);
  });
});
