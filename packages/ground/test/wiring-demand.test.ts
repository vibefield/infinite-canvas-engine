/**
 * THE OLD LEG READS THE NEW FACTS (design-013 D10, A1b).
 *
 * `demand-parking.test.ts` grades the parking itself, one layer down, by
 * handing the binder a demand callback. The defect this file exists for is a
 * layer up and is a WIRING defect: the binder's `demand` option was optional
 * and, absent one, nothing was ever throttled — so an app that forgot the seam
 * got a compositor that re-copied a paused card's slot at its paint rate,
 * silently and forever. That is the "copied wiring" class again, and the fix is
 * that there is nothing left to wire: `createCompositorWiring` feeds the binder
 * from the `SurfaceDemand` component the Demand system writes.
 *
 * A caller that genuinely throttles from somewhere else still passes
 * `atlas.demand` and still wins — the seam is kept, not replaced.
 */
import {
  Camera,
  PAUSED_SURFACE_DEMAND,
  Position,
  Size,
  SurfaceDemand,
  Viewport,
  createCompositorSourceRegistry,
  createWorld,
  type Entity,
  type SurfaceDemandValue,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { createCompositorWiring } from "../src/compositor/wiring";

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
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBuffer: () => ({ destroy: () => {} }),
    createSampler: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        setVertexBuffer: () => {},
        draw: () => {},
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
    },
  };
  return self as unknown as GPUDevice & { submits: number };
}

const frame = { width: 1600, height: 1200, dpr: 2, camera: { x: 0, y: 0, zoom: 1 } };

function board(options: { demand?: (e: Entity) => SurfaceDemandValue | undefined } = {}) {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 800, h: 600, dpr: 2 });
  // Real geometry: the wiring builds its own facts from the world
  // (`createWorldQuadFacts`), so a card with no Position/Size has no slot to
  // copy into and the whole rig would measure nothing.
  const card = world.spawn({
    components: [
      [Position, { x: 0, y: 0 }],
      [Size, { w: 100, h: 60 }],
    ],
  });
  const registry = createCompositorSourceRegistry();
  const host = { id: 0 };
  registry.register(card, { kind: "dom", host });
  const wired = createCompositorWiring({
    world,
    device: fakeDevice(),
    registry,
    // A target, so the wiring reads its format instead of asking `navigator.gpu`
    // for the preferred one — headless has no adapter.
    target: {
      format: "bgra8unorm",
      getCurrentTexture: () => ({ createView: () => ({}) }) as unknown as GPUTexture,
      size: () => ({ width: 800, height: 600, dpr: 2 }),
    },
    atlas: {
      firstPageSize: { width: 1024, height: 1024 },
      ...(options.demand !== undefined ? { demand: options.demand } : {}),
    },
  });
  return { world, card, wired, host: host as unknown as Element };
}

describe("the binder's demand, when the caller wires none", () => {
  it("parks a card the CLAMP paused, with no callback anywhere", () => {
    const { world, card, wired, host } = board();
    world.addComponent(card, SurfaceDemand, PAUSED_SURFACE_DEMAND);
    wired.domSources.sync(frame); // a paused card still gets its first picture
    const settled = wired.domSources.copies();
    expect(settled).toBe(1);

    // The CSS-keyframe case: the card names its host over and over.
    for (let i = 0; i < 240; i++) wired.domSources.markDirtyHosts([host]);
    for (let i = 0; i < 30; i++) wired.domSources.sync(frame);
    expect(wired.domSources.copies()).toBe(settled); // nothing re-copied
    expect(wired.domSources.pending()).toBe(0); // and nothing owed
    expect(wired.domSources.throttled()).toBe(1);
  });

  it("re-copies a card the clamp says is live — the control", () => {
    // Without this the case above passes for a card nothing would copy anyway.
    const { world, card, wired, host } = board();
    world.addComponent(card, SurfaceDemand, { mode: "live", fpsBucket: 60, interactive: false });
    wired.domSources.sync(frame);
    const settled = wired.domSources.copies();
    wired.domSources.markDirtyHosts([host]);
    wired.domSources.sync(frame);
    expect(wired.domSources.copies()).toBe(settled + 1);
  });

  it("leaves an entity the clamp has never written at the binder's own default", () => {
    // `undefined` from the world means "no clamp has spoken", not "paused" —
    // an un-equipped entity keeps live-at-60, which is what it got before D10.
    const { wired, host } = board(); // no SurfaceDemand component at all
    wired.domSources.sync(frame);
    const settled = wired.domSources.copies();
    wired.domSources.markDirtyHosts([host]);
    wired.domSources.sync(frame);
    expect(wired.domSources.copies()).toBe(settled + 1);
  });

  it("still lets a caller's own callback win", () => {
    // The seam is kept: a host that throttles from somewhere else passes
    // `atlas.demand` and the world is not consulted.
    const { world, card, wired, host } = board({ demand: () => PAUSED_SURFACE_DEMAND });
    world.addComponent(card, SurfaceDemand, { mode: "live", fpsBucket: 60, interactive: false });
    wired.domSources.sync(frame);
    const settled = wired.domSources.copies();
    for (let i = 0; i < 30; i++) {
      wired.domSources.markDirtyHosts([host]);
      wired.domSources.sync(frame);
    }
    expect(wired.domSources.copies()).toBe(settled);
  });
});
