/**
 * BOTH FACTORIES BUILD THE SAME COMPOSITOR (design-012 §4; program-host's own
 * "the same options `ground()` takes" promise).
 *
 * Two defects lived in the gap between the promise and the wiring, and both
 * are invisible to a rig that hand-assembles its own compositor — which is
 * what every rig in this repo does, and why they held green:
 *
 *  1. `groundHost` built its quad pass with no facts, no resolve, no order and
 *     no background, and never built a dom binder at all. A registered source
 *     warned once per composite and NOTHING was ever drawn. The shipping
 *     widgetlab app takes exactly this path.
 *  2. `ground({ lift })` plumbed the LiftDriver into its display facts but
 *     never called `advance()`, so the Grab query, the retarget and the ease
 *     never ran: the seam was inert through the public factory. Nothing
 *     re-marked dirt while easing either, so even an externally advanced
 *     driver would have frozen after one frame.
 *
 * These tests therefore go through the FACTORIES, not the parts.
 */
import {
  Camera,
  createCompositorSourceRegistry,
  createEngine,
  createWorld,
  Grab,
  NO_ENTITY,
  Position,
  Size,
  Viewport,
  type World,
} from "@ice/core";
import { LIFT_DURATION_MS } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { ground } from "../src/index";
import { createLiftDriver } from "../src/compositor/lift";
import { groundHost } from "../src/program-host";
import type { CompositeTarget } from "../src/compositor/compositor-reflector";
import type { GroundRendererLike } from "../src/renderer";
import type { GroundProgramDefinition } from "../src/program";
import { Object3D } from "three/webgpu";

const GRAB = { x: 0, y: 0, w: 10, h: 10, parent: NO_ENTITY, prev: NO_ENTITY, ord: 0 };

/** A device that lets the whole compositor arm, and counts what it draws. */
function fakeDevice() {
  const self = {
    draws: [] as Array<{ count: number; first: number }>,
    submits: 0,
    createTexture: ({ size }: { size: { width: number; height: number } }) => ({
      width: size.width,
      height: size.height,
      format: "rgba8unorm",
      destroy: () => {},
      createView: () => ({}),
    }),
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createSampler: () => ({}),
    createBuffer: () => ({ destroy: () => {} }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        draw: (_vertices: number, count: number, _fv: number, first: number) => {
          self.draws.push({ count, first });
        },
        end: () => {},
      }),
      copyTextureToTexture: () => {},
      finish: () => ({}),
    }),
    queue: {
      submit: () => {
        self.submits++;
      },
      writeBuffer: () => {},
      copyElementImageToTexture: () => {},
    },
  };
  return self as unknown as GPUDevice & { draws: Array<{ count: number; first: number }>; submits: number };
}

function fakeTarget(): CompositeTarget {
  return {
    format: "bgra8unorm",
    getCurrentTexture: () => ({ createView: () => ({}) }) as unknown as GPUTexture,
    size: () => ({ width: 800, height: 600, dpr: 2 }),
  };
}

/** The narrowest GroundRendererLike that satisfies both layers. */
function stubRenderer(): GroundRendererLike {
  return {
    canvas: document.createElement("canvas"),
    ready: () => true,
    failed: () => false,
    onReady: (cb) => cb(),
    setSize: () => {},
    render: () => {},
    dispose: () => {},
  };
}

function host() {
  const container = document.createElement("div");
  const contentPlane = document.createElement("div");
  container.appendChild(contentPlane);
  document.body.appendChild(container);
  return { container, contentPlane };
}

/** One card, in the world and in the registry. */
function card(world: World) {
  const entity = world.spawn({
    components: [
      [Position, { x: 10, y: 20 }],
      [Size, { w: 200, h: 120 }],
    ],
  });
  return { entity, element: { id: "host" } as unknown as Element };
}

const NOOP_PROGRAM: GroundProgramDefinition = {
  id: "parity:noop",
  transition: "procedural",
  sources: [],
  create: () => ({
    object: new Object3D(),
    activate: () => [],
    collect: () => {},
    deactivate: () => {},
    estimateBytes: () => 0,
    dispose: () => {},
  }),
};

describe("groundHost's composited profile draws, exactly as ground()'s does", () => {
  it("composites a registered dom source through the FACTORY the app wires", () => {
    const world = createWorld();
    const engine = createEngine(world);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
    const device = fakeDevice();
    const sources = createCompositorSourceRegistry();
    const { entity, element } = card(world);
    sources.register(entity, { kind: "dom", host: element });

    const layer = groundHost({
      programs: [NOOP_PROGRAM],
      fallback: NOOP_PROGRAM.id,
      rendererOverride: stubRenderer(),
      device,
      sources,
      target: fakeTarget(),
    })({ host: host(), world });

    // The binder is part of the layer at all — it was absent entirely before.
    expect(layer.domSources).toBeDefined();
    expect(layer.compositorReflector).toBeDefined();

    engine.registerReflector(layer.compositorReflector as never);
    engine.step(16);

    // THE WITNESS: a quad reached the pass. Before the fix this path logged
    // "1 source(s) registered without a resolve/facts seam — nothing drawn"
    // and drew zero, every composite, forever.
    expect(device.draws.length).toBeGreaterThan(0);
    expect(device.draws[0]?.count).toBe(1);
    expect(layer.domSources?.copies()).toBe(1);
    layer.dispose();
  });
});

describe("ground({ lift }) actually drives the lift", () => {
  function liftRig() {
    const world = createWorld();
    const engine = createEngine(world);
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
    let clock = 0;
    const lift = createLiftDriver(world, { scale: 1.08, now: () => clock });
    const device = fakeDevice();
    const sources = createCompositorSourceRegistry();
    const { entity, element } = card(world);

    const layer = ground({
      rendererOverride: stubRenderer(),
      device,
      sources,
      target: fakeTarget(),
      lift,
    })({ host: host(), world });
    const compositor = layer.compositorReflector as NonNullable<typeof layer.compositorReflector>;
    engine.registerReflector(compositor);

    return {
      world,
      entity,
      lift,
      compositor,
      layer,
      /** Pick the card up: Grab is the lift signal, promotion is the wake. */
      grab: () => {
        world.addComponent(entity, Grab, GRAB);
        sources.register(entity, { kind: "dom", host: element });
      },
      step: (ms = 16) => {
        clock += ms;
        engine.step(clock);
      },
    };
  }

  it("advances the ease across frames and keeps the compositor awake until it settles", () => {
    const { entity, lift, compositor, layer, grab, step } = liftRig();
    step(); // boot composite, nothing lifted
    expect(lift.factsFor(entity).scale).toBe(1);

    grab();
    step(); // the promotion's composite: the ease starts here, still at 1
    step();
    const first = lift.factsFor(entity).scale;
    step();
    const second = lift.factsFor(entity).scale;

    // THE SEAM IS LIVE. Before the fix `advance()` was never called through
    // this factory, so the scale sat at 1 for the whole gesture and the card
    // never lifted at all.
    expect(first).toBeGreaterThan(1);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(1.08);

    // …and the ease keeps itself moving: an ease writes no ECS cell, so if
    // nothing re-marked dirt it would render one frame and freeze.
    const easing = compositor.composites();
    step();
    step();
    expect(compositor.composites()).toBe(easing + 2);

    // It settles, and then the board is idle again — the lift must not become
    // a permanent wake source (idle-zero, design-012 §4).
    step(LIFT_DURATION_MS);
    expect(lift.factsFor(entity).scale).toBeCloseTo(1.08, 5);
    const settled = compositor.composites();
    for (let i = 0; i < 20; i++) step();
    expect(compositor.composites()).toBe(settled);
    expect(compositor.quiet()).toBeGreaterThanOrEqual(20);
    layer.dispose();
  });
});
