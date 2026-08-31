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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("compositor reflector — external-frame arrival (S8)", () => {
  // Every test here registers a source, and the quad pass warns that this
  // file's fake has no resolve seam — expected, and pinned by its own test.
  let warn: { mockRestore: () => void };
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  /**
   * A producer with a subscribable arrival signal, and a count of how many
   * subscriptions it is holding — which is the half that catches a leak.
   */
  function fakeProducer() {
    const listeners = new Set<() => void>();
    return {
      subscribers: () => listeners.size,
      produce() {
        for (const cb of [...listeners]) cb();
      },
      source: {
        kind: "video" as const,
        frame: () => ({}),
        onArrival: (cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      },
    };
  }

  it("a PRODUCING surface wakes the compositor by itself", () => {
    // §4's last unbuilt dirty source. Without it the rig had to mark dirt by
    // hand, and a real board would composite a live surface only while
    // something ELSE was moving — right-looking on a panning board, frozen on
    // a still one.
    const { registry, reflector, device, step } = setup();
    const producer = fakeProducer();
    registry.register(1 as never, producer.source);
    step(); // drains the registration's own membership dirt
    const before = device.submits;

    producer.produce();
    expect(reflector.pendingReasons()).toContain("video");
    step();
    expect(device.submits).toBe(before + 1);
  });

  it("a PAUSED surface goes back to idle-zero, still registered", () => {
    // Registered and quiet, never merely absent: an unregistered source costs
    // zero submits for the uninteresting reason.
    const { registry, reflector, device, step } = setup();
    const producer = fakeProducer();
    registry.register(1 as never, producer.source);
    step();
    producer.produce();
    step();
    const after = device.submits;

    for (let i = 0; i < 30; i++) step(); // the producer stops; nothing else moves
    expect(device.submits).toBe(after);
    expect(registry.has(1 as never)).toBe(true);
  });

  it("drops the hook when the source is UNREGISTERED", () => {
    const { registry, reflector, device, step } = setup();
    const producer = fakeProducer();
    const unregister = registry.register(1 as never, producer.source);
    step();
    expect(producer.subscribers()).toBe(1);

    unregister();
    step(); // membership dirt from the unregistration itself
    const before = device.submits;
    producer.produce(); // the producer keeps running — cameras do
    step();
    expect(producer.subscribers()).toBe(0);
    expect(device.submits).toBe(before);
    expect(reflector.pendingReasons()).not.toContain("video");
  });

  it("swaps the hook when a source is REPLACED on the same entity", () => {
    // `register` replaces, and the subscriptions are keyed by SOURCE OBJECT
    // for exactly this: an entity-keyed map would keep listening to the old
    // producer and never hear the new one.
    const { registry, device, step } = setup();
    const first = fakeProducer();
    const second = fakeProducer();
    registry.register(1 as never, first.source);
    step();
    registry.register(1 as never, second.source);
    step();

    expect(first.subscribers()).toBe(0);
    expect(second.subscribers()).toBe(1);
    const before = device.submits;
    first.produce(); // the evicted producer wakes nobody
    step();
    expect(device.submits).toBe(before);
    second.produce();
    step();
    expect(device.submits).toBe(before + 1);
  });

  it("subscribes to sources registered BEFORE the reflector existed", () => {
    // An app that builds its board and then its compositor is the ordinary
    // case: those registrations raised their onChange before anyone listened.
    const world = createWorld();
    const engine = createEngine(world);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
    const registry = createCompositorSourceRegistry();
    const producer = fakeProducer();
    registry.register(1 as never, producer.source); // BEFORE the reflector

    const device = fakeDevice();
    const reflector = createCompositorReflector({
      world,
      registry,
      quadPass: createWidgetQuadPass({ device, format: "bgra8unorm", registry }),
      device,
      target: fakeTarget(),
    });
    engine.registerReflector(reflector);
    engine.step(16);
    expect(producer.subscribers()).toBe(1);

    const before = device.submits;
    producer.produce();
    engine.step(32);
    expect(device.submits).toBe(before + 1);
  });

  it("tolerates a source that offers no arrival signal at all", () => {
    // Every S7-era source is this shape, and the downstream consumer may be
    // too: a source that cannot wake anyone still composites correctly.
    const { registry, device, step } = setup();
    registry.register(1 as never, { kind: "video", frame: () => ({}) });
    step();
    const before = device.submits;
    for (let i = 0; i < 10; i++) step();
    expect(device.submits).toBe(before);
  });

  it("releases every hook on dispose", () => {
    const { registry, reflector, step } = setup();
    const producer = fakeProducer();
    registry.register(1 as never, producer.source);
    step();
    expect(producer.subscribers()).toBe(1);
    reflector.dispose();
    // A producer outliving the compositor is normal; one still holding a
    // callback into a disposed compositor is not.
    expect(producer.subscribers()).toBe(0);
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
