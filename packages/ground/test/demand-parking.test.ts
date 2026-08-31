/**
 * A PAUSED SURFACE'S PAINT MUST NOT SPIN THE COMPOSITOR (design-012 §4's
 * demand doctrine; §6.2 "paused keeps the last good picture and uploads
 * nothing").
 *
 * The demand rig covers the live buckets (30/10/2), where every deferred mark
 * has a DUE DATE and `pending()` is what carries the compositor to it. Bucket
 * 0 and `paused` are a different animal: `demandIntervalMs` is `Infinity`, so
 * no clock ever makes the mark due. Counting a dateless mark as pending is
 * what turned one paint event on an off-screen card into a composite on every
 * rAF frame, forever — the reflector re-marks `dom` whenever `pending() > 0`,
 * and the mark it re-raises is the one nothing can clear.
 *
 * So the property under test is not "the upload is throttled" but "the
 * compositor goes back to sleep", which only shows up with a real reflector
 * driving a real frame loop. Both halves are checked here: the binder's own
 * bookkeeping, and the idle-zero it exists to preserve.
 */
import {
  Camera,
  createCompositorSourceRegistry,
  createEngine,
  createWorld,
  DEFAULT_SURFACE_DEMAND,
  PAUSED_SURFACE_DEMAND,
  Viewport,
  type CompositorSource,
  type Entity,
  type SurfaceDemand,
} from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { createCompositorReflector, type CompositeTarget } from "../src/compositor/compositor-reflector";
import { createDomSourceBinder } from "../src/compositor/dom-source-binder";
import { createWidgetQuadPass, type CompositeFrame } from "../src/compositor/widget-quad-pass";

/** Enough GPUDevice for the atlas: it allocates textures and encodes copies. */
function fakeDevice() {
  const self = {
    submits: 0,
    createTexture: ({ size }: { size: { width: number; height: number } }) => ({
      width: size.width,
      height: size.height,
      destroy: () => {},
      createView: () => ({}),
    }),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ end: () => {} }),
      copyTextureToTexture: () => {},
      finish: () => ({}),
    }),
    // No `copyElementImageToTexture`: the adapter degrades rather than
    // throwing, which is what a headless test needs — the SCHEDULING is under
    // test here, not the pixels.
    queue: {
      submit: () => {
        self.submits++;
      },
      writeBuffer: () => {},
    },
  };
  return self as unknown as GPUDevice & { submits: number };
}

const frame: CompositeFrame = {
  width: 1600,
  height: 1200,
  dpr: 2,
  camera: { x: 0, y: 0, zoom: 1 },
};

const entity = (n: number): Entity => n as unknown as Entity;

function board(demandOf: () => SurfaceDemand) {
  const registry = createCompositorSourceRegistry();
  const host = { id: 0 };
  registry.register(entity(0), { kind: "dom", host });
  const onDirt = vi.fn();
  let clock = 1000;
  const binder = createDomSourceBinder(fakeDevice(), registry, () => ({ w: 100, h: 60 }), {
    firstPageSize: { width: 1024, height: 1024 },
    demand: demandOf,
    now: () => clock,
    onDirt,
  });
  return {
    registry,
    binder,
    onDirt,
    host: host as unknown as Element,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("a paused surface's dirt is parked, not pending", () => {
  it("owes NOTHING after a paint on a paused card — and raises no wake", () => {
    const { binder, host, onDirt } = board(() => PAUSED_SURFACE_DEMAND);
    binder.sync(frame); // the first upload: a paused card still gets its picture
    expect(binder.copies()).toBe(1);
    expect(binder.pending()).toBe(0);
    onDirt.mockClear();

    // The CSS-keyframe case: an off-screen card names its host over and over.
    for (let i = 0; i < 240; i++) binder.markDirtyHosts([host]);

    // Nothing is owed and nothing was woken. Before the fix `pending()` read
    // 1 here forever, and every paint raised `onDirt`.
    expect(binder.pending()).toBe(0);
    expect(onDirt).not.toHaveBeenCalled();
    // Not dropped, though: the mark is parked and counted as throttled.
    expect(binder.throttled()).toBe(1);

    for (let i = 0; i < 30; i++) binder.sync(frame);
    expect(binder.pending()).toBe(0);
    expect(binder.copies()).toBe(1); // still no upload for a card nobody sees
  });

  it("flushes the parked dirt EXACTLY ONCE when demand returns to a live bucket", () => {
    let demand: SurfaceDemand = PAUSED_SURFACE_DEMAND;
    const { binder, host, advance } = board(() => demand);
    binder.sync(frame);
    const settled = binder.copies();
    for (let i = 0; i < 12; i++) binder.markDirtyHosts([host]);
    binder.sync(frame);
    expect(binder.copies()).toBe(settled);

    // The card scrolls back into view: `foldDemand` stops folding it to paused.
    demand = DEFAULT_SURFACE_DEMAND;
    advance(1000);
    binder.sync(frame);
    // The card re-uploads — once, however many paints were parked behind it.
    expect(binder.copies()).toBe(settled + 1);
    expect(binder.pending()).toBe(0);

    for (let i = 0; i < 30; i++) binder.sync(frame);
    expect(binder.copies()).toBe(settled + 1);
  });

  it("keeps idle-zero through a real reflector while an unseen card animates", () => {
    const world = createWorld();
    const engine = createEngine(world);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });

    const registry = createCompositorSourceRegistry();
    const host = { id: 0 };
    registry.register(entity(0), { kind: "dom", host });
    const device = fakeDevice();
    const target: CompositeTarget = {
      format: "bgra8unorm",
      getCurrentTexture: () => ({ createView: () => ({}) }) as unknown as GPUTexture,
      size: () => ({ width: 800, height: 600, dpr: 2 }),
    };
    // A holder, because the binder wakes the reflector and the reflector's
    // prepare drives the binder — the same knot `ground()` ties.
    const held: { compositor?: ReturnType<typeof createCompositorReflector> } = {};
    const binder = createDomSourceBinder(device, registry, () => ({ w: 100, h: 60 }), {
      firstPageSize: { width: 1024, height: 1024 },
      demand: () => PAUSED_SURFACE_DEMAND,
      onDirt: () => held.compositor?.mark("dom"),
    });
    const compositor = createCompositorReflector({
      world,
      registry,
      quadPass: createWidgetQuadPass({
        device,
        format: "bgra8unorm",
        registry,
        facts: () => ({ x: 0, y: 0, w: 100, h: 60 }),
        resolve: (e, source) => binder.resolve(e, source as CompositorSource),
      }),
      device,
      target,
      // ground()'s own prepare, verbatim in shape.
      prepare: (f) => {
        binder.sync(f);
        if (binder.pending() > 0) held.compositor?.mark("dom");
      },
    });
    held.compositor = compositor;
    engine.registerReflector(compositor);

    let now = 0;
    const step = () => {
      now += 16;
      engine.step(now);
    };
    step(); // boot composite
    const afterBoot = compositor.composites();

    // 60 frames of an off-screen keyframe animation naming its host.
    for (let i = 0; i < 60; i++) {
      binder.markDirtyHosts([host as unknown as Element]);
      step();
    }
    // THE PROPERTY. Before the fix this was 61 — one composite per frame, for
    // as long as the card kept animating out of sight.
    expect(compositor.composites()).toBe(afterBoot);
    expect(compositor.quiet()).toBe(60);
  });
});
