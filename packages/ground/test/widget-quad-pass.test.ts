/**
 * The `WidgetQuadPass` skeleton's S1 contract: an empty registry draws nothing
 * AND allocates nothing.
 *
 * The second half is what keeps the S1 pixel-compare honest. A compositor that
 * built a pipeline at boot would put GPU work on the composited path that the
 * stratified path never does, and a pixel comparison between them would then
 * be comparing two different renderers rather than one renderer on two devices.
 */
import { createCompositorSourceRegistry } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { createWidgetQuadPass, type CompositeFrame } from "../src/compositor/widget-quad-pass";
import type { Entity } from "@vibecook/strata-ecs";

/** A device that refuses to be touched: every allocation is a test failure. */
function tripwireDevice() {
  const touched: string[] = [];
  const trip =
    (name: string) =>
    (...args: unknown[]) => {
      touched.push(name);
      void args;
      return {};
    };
  return {
    touched,
    device: {
      createRenderPipeline: trip("createRenderPipeline"),
      createShaderModule: trip("createShaderModule"),
      createBuffer: trip("createBuffer"),
      createBindGroup: trip("createBindGroup"),
      createBindGroupLayout: trip("createBindGroupLayout"),
      createSampler: trip("createSampler"),
      createPipelineLayout: trip("createPipelineLayout"),
    } as unknown as GPUDevice,
  };
}

const frame: CompositeFrame = {
  width: 1600,
  height: 1200,
  dpr: 2,
  camera: { x: 0, y: 0, zoom: 1 },
};

function fakePass(): GPURenderPassEncoder & { draws: number } {
  const self = {
    draws: 0,
    setPipeline: () => {},
    setBindGroup: () => {},
    draw: () => {
      self.draws++;
    },
  };
  return self as unknown as GPURenderPassEncoder & { draws: number };
}

describe("widget quad pass — the S1 skeleton", () => {
  it("draws nothing on an empty registry", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = tripwireDevice();
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry });
    const encoder = fakePass();
    expect(pass.encode(encoder, frame)).toBe(0);
    expect(pass.drawn()).toBe(0);
    expect(encoder.draws).toBe(0);
  });

  it("allocates NOTHING on an empty registry — not even a pipeline", () => {
    const registry = createCompositorSourceRegistry();
    const { device, touched } = tripwireDevice();
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry });
    for (let i = 0; i < 10; i++) pass.encode(fakePass(), frame);
    expect(touched).toEqual([]);
    expect(pass.armed()).toBe(false);
  });

  it("says so, loudly, if a producer registers ahead of the leg that samples it", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = tripwireDevice();
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry });
    registry.register(1 as unknown as Entity, { kind: "dom", host: {} });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Better a named warning than a silently-skipped source or a wrong frame:
    // dom composites at S2, gl at S5, video at S7.
    expect(pass.encode(fakePass(), frame)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("no source kind composites yet");
    warn.mockRestore();
  });

  it("takes paint order from the injected seam, never from registration order", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = tripwireDevice();
    const order = vi.fn((): readonly Entity[] => []);
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry, order });
    registry.register(1 as unknown as Entity, { kind: "dom", host: {} });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pass.encode(fakePass(), frame);
    warn.mockRestore();
    // Registration order is emphatically NOT paint order — paint order is the
    // frame-parent sibling sequence (petition 8), and it arrives through here.
    expect(order).toHaveBeenCalled();
  });

  it("dispose resets its counters and stays safe to call twice", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = tripwireDevice();
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry });
    pass.encode(fakePass(), frame);
    pass.dispose();
    pass.dispose();
    expect(pass.drawn()).toBe(0);
    expect(pass.armed()).toBe(false);
  });
});
