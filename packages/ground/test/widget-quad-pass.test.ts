/**
 * `WidgetQuadPass` — the S1 laziness contract, kept, plus the S2 instance
 * contract that the WGSL reads.
 *
 * The shader itself is validated against a pixel oracle in Electron
 * (`apps/widgetlab-desktop/scripts/quad-oracle.mjs`) because WGSL needs a GPU.
 * What CAN be pinned headlessly is everything the CPU half decides and hands
 * it: the camera→device-pixel rect, the UV crop from an atlas slot, the radius
 * scale, the sRGB lane, and the batching that keeps paint order. Those are the
 * numbers a wrong frame would come from, and they are checked here rather than
 * inferred from a screenshot.
 */
import { createCompositorSourceRegistry } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import {
  createWidgetQuadPass,
  type CompositeFrame,
  type QuadTexture,
} from "../src/compositor/widget-quad-pass";
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

const FLOATS_PER_QUAD = 12;

/** A device that lets the pass arm, and records what it writes. */
function recordingDevice() {
  const writes: Array<{ buffer: unknown; data: Float32Array }> = [];
  const buffers = new Map<object, string>();
  const device = {
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createSampler: () => ({}),
    createBuffer: (desc: { label?: string }) => {
      const b = { destroy: () => {} };
      buffers.set(b, desc.label ?? "");
      return b;
    },
    createBindGroup: (desc: unknown) => ({ desc }),
    queue: {
      writeBuffer: (
        buffer: object,
        _offset: number,
        data: ArrayBuffer | Float32Array,
        byteOffset?: number,
        byteLength?: number,
      ) => {
        const view =
          data instanceof Float32Array
            ? data
            : new Float32Array(data, byteOffset ?? 0, (byteLength ?? data.byteLength) / 4);
        writes.push({ buffer, data: Float32Array.from(view) });
      },
    },
  } as unknown as GPUDevice;
  /** The most recent instance-buffer write, decoded into per-quad records. */
  const quads = () => {
    for (let i = writes.length - 1; i >= 0; i--) {
      const w = writes[i] as { buffer: object; data: Float32Array };
      if (buffers.get(w.buffer) !== "widget-quads-instances") continue;
      const out: Array<{
        dst: number[];
        uv: number[];
        radius: number;
        opacity: number;
        encodeMode: number;
        premultiplied: number;
      }> = [];
      for (let q = 0; q * FLOATS_PER_QUAD < w.data.length; q++) {
        const b = q * FLOATS_PER_QUAD;
        out.push({
          dst: [w.data[b] as number, w.data[b + 1] as number, w.data[b + 2] as number, w.data[b + 3] as number],
          uv: [w.data[b + 4] as number, w.data[b + 5] as number, w.data[b + 6] as number, w.data[b + 7] as number],
          radius: w.data[b + 8] as number,
          opacity: w.data[b + 9] as number,
          encodeMode: w.data[b + 10] as number,
          premultiplied: w.data[b + 11] as number,
        });
      }
      return out;
    }
    return [];
  };
  return { device, quads };
}

const frame: CompositeFrame = {
  width: 1600,
  height: 1200,
  dpr: 2,
  camera: { x: 0, y: 0, zoom: 1 },
};

function fakePass() {
  const calls: Array<{ count: number; first: number }> = [];
  const self = {
    draws: 0,
    calls,
    setPipeline: () => {},
    setBindGroup: () => {},
    draw: (_v: number, count: number, _fv: number, first: number) => {
      self.draws++;
      calls.push({ count, first });
    },
  };
  return self as unknown as GPURenderPassEncoder & typeof self;
}

const entity = (n: number): Entity => n as unknown as Entity;
const texture = (label: string): GPUTexture =>
  ({ label, createView: () => ({ label }) }) as unknown as GPUTexture;

describe("widget quad pass — the S1 laziness contract", () => {
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

  it("says so, loudly, if a producer registers ahead of the wiring that samples it", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = tripwireDevice();
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry });
    registry.register(entity(1), { kind: "dom", host: {} });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Better a named warning than a silently-skipped source or a wrong frame.
    expect(pass.encode(fakePass(), frame)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("without a resolve/facts seam");
    warn.mockRestore();
  });

  it("takes paint order from the injected seam, never from registration order", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = tripwireDevice();
    const order = vi.fn((): readonly Entity[] => []);
    const pass = createWidgetQuadPass({ device, format: "bgra8unorm", registry, order });
    registry.register(entity(1), { kind: "dom", host: {} });
    pass.encode(fakePass(), frame);
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

describe("widget quad pass — the S2 instance contract", () => {
  /** One dom source per entity, all sampling one atlas page. */
  function board(
    n: number,
    slot: (i: number) => QuadTexture,
    facts?: (e: Entity) => { x: number; y: number; w: number; h: number; opacity?: number; radius?: number } | undefined,
  ) {
    const registry = createCompositorSourceRegistry();
    for (let i = 0; i < n; i++) registry.register(entity(i), { kind: "dom", host: { i } });
    const { device, quads } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      order: () => Array.from({ length: n }, (_, i) => entity(i)),
      facts: facts ?? ((e) => ({ x: (e as unknown as number) * 100, y: 0, w: 80, h: 40 })),
      resolve: (e) => slot(e as unknown as number),
    });
    return { registry, pass, quads };
  }

  const page = texture("page-0");
  const fullSlot: QuadTexture = {
    texture: page,
    rect: { x: 0, y: 0, width: 160, height: 80 },
    textureWidth: 320,
    textureHeight: 160,
  };

  it("places a quad in DEVICE px through the camera, exactly as the plane transform would", () => {
    const { pass, quads } = board(1, () => fullSlot, () => ({ x: 10, y: 20, w: 80, h: 40 }));
    pass.encode(fakePass(), { width: 1600, height: 1200, dpr: 2, camera: { x: 4, y: 5, zoom: 3 } });
    // scale = zoom × dpr = 6; origin = (world − camera) × scale.
    expect(quads()[0]?.dst).toEqual([(10 - 4) * 6, (20 - 5) * 6, 80 * 6, 40 * 6]);
  });

  it("crops UVs to the atlas slot, normalized by the PAGE size", () => {
    const { pass, quads } = board(1, () => ({
      texture: page,
      rect: { x: 64, y: 32, width: 160, height: 80 },
      textureWidth: 320,
      textureHeight: 160,
    }));
    pass.encode(fakePass(), frame);
    // Float32 in the buffer, float64 here — compare per component.
    const uv = quads()[0]?.uv as number[];
    for (const [i, want] of [64 / 320, 32 / 160, 160 / 320, 80 / 160].entries()) {
      expect(uv[i]).toBeCloseTo(want, 6);
    }
  });

  it("scales the corner radius with zoom×dpr, like a CSS radius under the plane", () => {
    const { pass, quads } = board(1, () => fullSlot, () => ({ x: 0, y: 0, w: 80, h: 40, radius: 12 }));
    pass.encode(fakePass(), { width: 1600, height: 1200, dpr: 2, camera: { x: 0, y: 0, zoom: 1.5 } });
    expect(quads()[0]?.radius).toBeCloseTo(12 * 1.5 * 2, 5);
  });

  /**
   * The sRGB law (design-012 §4), read from ACTUAL formats on both sides.
   * 0 = passthrough · 1 = linear→sRGB · 2 = sRGB→linear.
   */
  it.each([
    ["bgra8unorm", false, 0, "plain source onto a plain target"],
    ["bgra8unorm", true, 1, "an -srgb source (auto-decoded) onto a plain target must be re-encoded"],
    ["bgra8unorm-srgb", false, 2, "a plain source onto an -srgb target must be decoded first"],
    ["bgra8unorm-srgb", true, 0, "both -srgb: the hardware does both halves"],
  ] as const)("picks the sRGB lane for %s / srgb=%s → %i (%s)", (format, srgb, mode, _why) => {
    const registry = createCompositorSourceRegistry();
    registry.register(entity(0), { kind: "dom", host: {} });
    const { device, quads } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format,
      registry,
      order: () => [entity(0)],
      facts: () => ({ x: 0, y: 0, w: 80, h: 40 }),
      resolve: () => ({ ...fullSlot, srgb }),
    });
    pass.encode(fakePass(), frame);
    expect(quads()[0]?.encodeMode).toBe(mode);
  });

  it("declares premultiplication rather than assuming it", () => {
    const { pass, quads } = board(1, () => ({ ...fullSlot, premultiplied: false }));
    pass.encode(fakePass(), frame);
    expect(quads()[0]?.premultiplied).toBe(0);
  });

  it("SKIPS a source whose pixels are not resident, and counts it", () => {
    // An `empty` atlas slot resolves to undefined: its rect holds whatever used
    // to live there, so drawing it would show another card's pixels.
    const { pass } = board(3, (i) => (i === 1 ? (undefined as unknown as QuadTexture) : fullSlot));
    const encoder = fakePass();
    expect(pass.encode(encoder, frame)).toBe(2);
    expect(pass.skipped()).toBe(1);
  });

  it("batches by texture WITHOUT reordering — runs follow paint order", () => {
    const a = texture("page-a");
    const b = texture("page-b");
    // Paint order a,a,b,a — three runs, never two, because merging the two `a`
    // runs would paint entity 3 under entity 2 instead of over it.
    const pages = [a, a, b, a];
    const { pass } = board(4, (i) => ({ ...fullSlot, texture: pages[i] as GPUTexture }));
    const encoder = fakePass();
    expect(pass.encode(encoder, frame)).toBe(4);
    expect(pass.batches()).toBe(3);
    expect(encoder.calls).toEqual([
      { count: 2, first: 0 },
      { count: 1, first: 2 },
      { count: 1, first: 3 },
    ]);
  });

  it("culls quads that are entirely off-screen", () => {
    const { pass } = board(2, () => fullSlot, (e) =>
      // entity 0 on screen, entity 1 far to the left of it
      (e as unknown as number) === 0
        ? { x: 0, y: 0, w: 80, h: 40 }
        : { x: -10_000, y: 0, w: 80, h: 40 },
    );
    expect(pass.encode(fakePass(), frame)).toBe(1);
    // A cull is not a skip: nothing is owed for an off-screen card.
    expect(pass.skipped()).toBe(0);
  });

  it("draws nothing for an entity with no facts", () => {
    const { pass } = board(2, () => fullSlot, (e) =>
      (e as unknown as number) === 0 ? { x: 0, y: 0, w: 80, h: 40 } : undefined,
    );
    expect(pass.encode(fakePass(), frame)).toBe(1);
  });
});

/**
 * GROUND AS THE FIRST QUAD (design-012 §4, S6b).
 *
 * Route (a) of the one-present question: ground renders its own programs —
 * GroundHost, the magnet TSL, the whole pass registry — into an offscreen
 * target, and the compositor draws that target before any widget. What is
 * pinned here is the ordering and the coordinate handling, because both are
 * silent when wrong: a ground quad drawn last hides the board, and a ground
 * quad given the camera twice slides the grid at double rate under a pan.
 */
describe("ground as the compositor's first quad", () => {
  const groundTexture = texture("ground-target");
  const groundQuad: QuadTexture = {
    texture: groundTexture,
    rect: { x: 0, y: 0, width: 2560, height: 1616 },
    textureWidth: 2560,
    textureHeight: 1616,
  };

  it("draws ground FIRST, before every widget", () => {
    const registry = createCompositorSourceRegistry();
    registry.register(entity(0), { kind: "dom", host: {} });
    const { device } = recordingDevice();
    const encoder = fakePass();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: () => ({
        texture: texture("atlas"),
        rect: { x: 0, y: 0, width: 128, height: 64 },
        textureWidth: 256,
        textureHeight: 256,
      }),
      background: () => groundQuad,
    });
    expect(pass.encode(encoder, frame)).toBe(2);
    expect(pass.drewBackground()).toBe(true);
    // Instance 0 is ground; the widget follows. Painter's order IS the
    // ordering contract, so ground last would simply hide the board.
    expect(encoder.calls).toEqual([
      { count: 1, first: 0 },
      { count: 1, first: 1 },
    ]);
  });

  it("gives ground the WHOLE viewport and does NOT apply the camera twice", () => {
    // The grid was drawn at this camera when ground rendered into the target.
    // Applying the camera again here would move it a second time — a pan would
    // slide the grid at double rate against the cards sitting on it.
    const registry = createCompositorSourceRegistry();
    const { device, quads } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      background: () => groundQuad,
    });
    pass.encode(fakePass(), { width: 1600, height: 1200, dpr: 2, camera: { x: 900, y: 400, zoom: 3 } });
    expect(quads()[0]?.dst).toEqual([0, 0, 1600, 1200]);
    expect(quads()[0]?.radius).toBe(0);
    expect(quads()[0]?.opacity).toBe(1);
  });

  it("draws ground even with an EMPTY registry — a board with no widgets is still a board", () => {
    const registry = createCompositorSourceRegistry();
    const { device } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      background: () => groundQuad,
    });
    expect(pass.encode(fakePass(), frame)).toBe(1);
    expect(pass.drewBackground()).toBe(true);
  });

  it("still allocates NOTHING when there is neither ground nor a widget", () => {
    // The S1 laziness law survives the new seam: a background getter that
    // returns undefined must not arm the pipeline.
    const registry = createCompositorSourceRegistry();
    const { device, touched } = tripwireDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      background: () => undefined,
    });
    for (let i = 0; i < 5; i++) pass.encode(fakePass(), frame);
    expect(touched).toEqual([]);
    expect(pass.armed()).toBe(false);
    expect(pass.drewBackground()).toBe(false);
  });

  it("guards ground's sRGB on its ACTUAL format, like any other source", () => {
    const registry = createCompositorSourceRegistry();
    const { device, quads } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      background: () => ({ ...groundQuad, srgb: true }),
    });
    pass.encode(fakePass(), frame);
    expect(quads()[0]?.encodeMode).toBe(1); // linear -> sRGB
  });
});
