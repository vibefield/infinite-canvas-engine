/**
 * The GL leg (design-012 §4 "island (gl)").
 *
 * The pixels themselves are graded in Electron by the composited-island rig;
 * what is pinned here is everything the CPU half decides before the shader
 * sees anything — the getter being re-read, the sRGB lane, and the y-flip's
 * exact UV packing, which is where an off-by-one would hide behind an image
 * that merely looks upside-down-correct.
 */
import { createCompositorSourceRegistry, type Entity } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { resolveGlSource } from "../src/compositor/gl-source";
import { createWidgetQuadPass, type CompositeFrame } from "../src/compositor/widget-quad-pass";

const texture = (width: number, height: number, label = "island"): GPUTexture =>
  ({ label, width, height, createView: () => ({ label }) }) as unknown as GPUTexture;

const entity = (n: number): Entity => n as unknown as Entity;

describe("resolving a published island", () => {
  it("takes the WHOLE texture as its rect — an island owns its target", () => {
    const t = texture(512, 256);
    const resolved = resolveGlSource({ kind: "gl", texture: () => t, srgb: () => false });
    expect(resolved?.rect).toEqual({ x: 0, y: 0, width: 512, height: 256 });
    expect(resolved?.textureWidth).toBe(512);
    expect(resolved?.textureHeight).toBe(256);
  });

  it("resolves to NOTHING before three's first paint", () => {
    // The getter returns undefined until three has rendered into the target.
    // The quad pass then skips the source rather than drawing a stale handle.
    const resolved = resolveGlSource({ kind: "gl", texture: () => undefined, srgb: () => false });
    expect(resolved).toBeUndefined();
  });

  it("RE-READS the getter every time, because targets are reallocated", () => {
    // A zoom-band or paint-DPR change reallocates the island's target. A handle
    // captured once would then be a frame of the wrong pixels with nothing to
    // catch it — which is why the contract publishes a getter at all.
    const first = texture(256, 256, "band-0");
    const second = texture(512, 512, "band-1");
    let current = first;
    const source = { kind: "gl" as const, texture: () => current, srgb: () => false };
    expect(resolveGlSource(source)?.texture).toBe(first);
    current = second;
    const after = resolveGlSource(source);
    expect(after?.texture).toBe(second);
    expect(after?.rect.width).toBe(512);
  });

  it("passes the source's OWN sRGB answer through, never a guess", () => {
    const t = texture(64, 64);
    expect(resolveGlSource({ kind: "gl", texture: () => t, srgb: () => true })?.srgb).toBe(true);
    expect(resolveGlSource({ kind: "gl", texture: () => t, srgb: () => false })?.srgb).toBe(false);
  });

  it("declares islands premultiplied — MSAA resolve scales colour by coverage", () => {
    const t = texture(64, 64);
    expect(resolveGlSource({ kind: "gl", texture: () => t, srgb: () => false })?.premultiplied).toBe(
      true,
    );
  });

  it("does NOT flip islands — three already delivers the compositor's row order", () => {
    // The brief said to flip, citing S5's "513 vs 9,531 px". After S5's own
    // reader normalisation (WebGL bottom-up vs WebGPU top-down) 513 IS the
    // unflipped arm, and the rig's own PASS line says so. Re-measured through
    // this pass in `composited-app.mjs`: unflipped puts the scene's bright bar
    // on top (+51.4) and agrees with the island's own pixels as-is (32.99 vs
    // 99.32); flipped inverts both. See gl-source.ts's orientation note.
    const t = texture(64, 64);
    expect(resolveGlSource({ kind: "gl", texture: () => t, srgb: () => false })?.flipY).toBe(false);
  });
});

/** A device that lets the pass arm and records the instance buffer it writes. */
function recordingDevice() {
  const writes: Array<{ label: string; data: Float32Array }> = [];
  const labels = new Map<object, string>();
  const device = {
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createSampler: () => ({}),
    createBuffer: (d: { label?: string }) => {
      const b = { destroy: () => {} };
      labels.set(b, d.label ?? "");
      return b;
    },
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (
        buffer: object,
        _o: number,
        data: ArrayBuffer | Float32Array,
        byteOffset?: number,
        byteLength?: number,
      ) => {
        const view =
          data instanceof Float32Array
            ? data
            : new Float32Array(data, byteOffset ?? 0, (byteLength ?? data.byteLength) / 4);
        writes.push({ label: labels.get(buffer) ?? "", data: Float32Array.from(view) });
      },
    },
  } as unknown as GPUDevice;
  const uv = () => {
    for (let i = writes.length - 1; i >= 0; i--) {
      const w = writes[i] as { label: string; data: Float32Array };
      if (w.label !== "widget-quads-instances") continue;
      return [w.data[4], w.data[5], w.data[6], w.data[7]] as number[];
    }
    return [];
  };
  return { device, uv };
}

const frame: CompositeFrame = { width: 800, height: 600, dpr: 1, camera: { x: 0, y: 0, zoom: 1 } };
const fakePass = () =>
  ({ setPipeline: () => {}, setBindGroup: () => {}, draw: () => {} }) as unknown as GPURenderPassEncoder;

describe("the y-flip, as the shader actually receives it", () => {
  function packUv(flipY: boolean) {
    const registry = createCompositorSourceRegistry();
    registry.register(entity(0), { kind: "dom", host: {} });
    const { device, uv } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: () => ({
        texture: texture(200, 100),
        rect: { x: 0, y: 0, width: 200, height: 100 },
        textureWidth: 200,
        textureHeight: 100,
        flipY,
      }),
    });
    pass.encode(fakePass(), frame);
    return uv();
  }

  it("packs an unflipped source as a plain top-down rect", () => {
    expect(packUv(false)).toEqual([0, 0, 1, 1]);
  });

  it("packs a flipped source as bottom-origin with a NEGATIVE height", () => {
    // `uv.xy + corner * uv.zw` then walks the source upward: corner.y = 0 lands
    // on the source's bottom edge, corner.y = 1 on its top.
    expect(packUv(true)).toEqual([0, 1, 1, -1]);
  });

  it("keeps a flipped tap on TEXEL CENTRES at a 1:1 mapping", () => {
    // The property that matters, worked through the packing the shader gets:
    // for a destination row j of H, uv.y = 1 - (j+0.5)/H = (H-j-0.5)/H, which is
    // the centre of source row H-1-j. Exactly the mirrored row, no half-texel
    // drift — a flip that was off by half a texel would still look upside-down
    // correct while blurring every island.
    const [, y, , h] = packUv(true) as [number, number, number, number];
    const H = 100;
    for (const j of [0, 1, 49, 98, 99]) {
      const uvY = y + ((j + 0.5) / H) * h;
      const sourceRow = uvY * H - 0.5;
      expect(sourceRow).toBeCloseTo(H - 1 - j, 6);
    }
  });

  it("flips a CROPPED rect about its own edges, not the texture's", () => {
    const registry = createCompositorSourceRegistry();
    registry.register(entity(0), { kind: "dom", host: {} });
    const { device, uv } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: () => ({
        texture: texture(200, 100),
        rect: { x: 40, y: 20, width: 80, height: 40 },
        textureWidth: 200,
        textureHeight: 100,
        flipY: true,
      }),
    });
    pass.encode(fakePass(), frame);
    // origin = the rect's BOTTOM edge (20+40)/100, height = −40/100.
    const [x, y, w, h] = uv() as [number, number, number, number];
    expect(x).toBeCloseTo(40 / 200, 6);
    expect(y).toBeCloseTo(60 / 100, 6);
    expect(w).toBeCloseTo(80 / 200, 6);
    expect(h).toBeCloseTo(-40 / 100, 6);
  });
});

describe("gl and dom quads in ONE pass", () => {
  it("keeps paint order across kinds, batching only adjacent same-texture runs", () => {
    // The point of the unified compositor: a dom card can pass under a GL
    // widget at its true sibling ordinal. If the pass reordered to group by
    // kind, that z would be wrong — so dom, gl, dom must be three draws.
    const registry = createCompositorSourceRegistry();
    const domHost = {};
    const islandTex = texture(64, 64, "island");
    const atlasTex = texture(256, 256, "atlas");
    registry.register(entity(0), { kind: "dom", host: domHost });
    registry.register(entity(1), { kind: "gl", texture: () => islandTex, srgb: () => true });
    registry.register(entity(2), { kind: "dom", host: domHost });

    const { device } = recordingDevice();
    const calls: Array<{ count: number; first: number }> = [];
    const encoder = {
      setPipeline: () => {},
      setBindGroup: () => {},
      draw: (_v: number, count: number, _f: number, first: number) => calls.push({ count, first }),
    } as unknown as GPURenderPassEncoder;

    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0), entity(1), entity(2)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: (_e, source) => {
        const s = source as { kind: string };
        if (s.kind === "gl") {
          return resolveGlSource(s as never);
        }
        return {
          texture: atlasTex,
          rect: { x: 0, y: 0, width: 128, height: 64 },
          textureWidth: 256,
          textureHeight: 256,
        };
      },
    });
    expect(pass.encode(encoder, frame)).toBe(3);
    expect(pass.batches()).toBe(3);
    expect(calls).toEqual([
      { count: 1, first: 0 },
      { count: 1, first: 1 },
      { count: 1, first: 2 },
    ]);
  });

  it("skips an island that has not painted yet without disturbing the others", () => {
    const registry = createCompositorSourceRegistry();
    const atlasTex = texture(256, 256, "atlas");
    registry.register(entity(0), { kind: "dom", host: {} });
    registry.register(entity(1), { kind: "gl", texture: () => undefined, srgb: () => false });
    const { device } = recordingDevice();
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0), entity(1)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: (_e, source) => {
        const s = source as { kind: string };
        if (s.kind === "gl") return resolveGlSource(s as never);
        return {
          texture: atlasTex,
          rect: { x: 0, y: 0, width: 128, height: 64 },
          textureWidth: 256,
          textureHeight: 256,
        };
      },
    });
    expect(pass.encode(fakePass(), frame)).toBe(1);
    expect(pass.skipped()).toBe(1);
  });

  it("gives an -srgb island the re-encode lane a plain atlas page does not get", () => {
    const registry = createCompositorSourceRegistry();
    const islandTex = texture(64, 64);
    registry.register(entity(0), { kind: "gl", texture: () => islandTex, srgb: () => true });
    const { device } = recordingDevice();
    const seen: number[] = [];
    const pass = createWidgetQuadPass({
      device,
      format: "bgra8unorm", // the swap chain cannot be -srgb
      registry,
      order: () => [entity(0)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: (_e, source) => {
        const r = resolveGlSource(source as never);
        if (r !== undefined) seen.push(r.srgb === true ? 1 : 0);
        return r;
      },
    });
    pass.encode(fakePass(), frame);
    expect(seen).toEqual([1]);
  });
});

describe("the island paint-dirt seam", () => {
  it("a repaint into the SAME texture changes nothing the registry can see", () => {
    // Which is exactly why r3f's binder carries `onPaint`: membership dirt
    // cannot stand in for paint dirt, and a compositor watching only the
    // registry would show an animating island's first frame forever.
    const registry = createCompositorSourceRegistry();
    const t = texture(64, 64);
    const changed = vi.fn();
    registry.onChange(changed);
    registry.register(entity(0), { kind: "gl", texture: () => t, srgb: () => false });
    expect(changed).toHaveBeenCalledTimes(1);
    const revision = registry.revision();

    // "three painted into the same target again" — no registry event at all.
    resolveGlSource(registry.get(entity(0)) as never);
    expect(registry.revision()).toBe(revision);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
