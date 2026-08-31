/**
 * The video leg (design-012 §4 "video (live surface)", §6.4).
 *
 * The pixels are graded in Electron by `composited-app.mjs` — coverage,
 * liveness and the measured orientation all live there, against a real
 * `VideoFrame`. What is pinned HERE is everything the CPU half decides before
 * the shader sees anything, and above all the two rules that have no visible
 * symptom when broken:
 *
 *  - the import happens per composite and is never cached (a stale
 *    `GPUExternalTexture` is invalid, not merely old);
 *  - a video run never merges into its neighbour, because two video quads are
 *    never the same external texture.
 *
 * Both would pass a screenshot on the frame you looked at.
 */
import { createCompositorSourceRegistry, type Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { createWidgetQuadPass, type CompositeFrame } from "../src/compositor/widget-quad-pass";
import { resolveVideoSource } from "../src/compositor/video-source";

const entity = (n: number): Entity => n as unknown as Entity;

const texture = (width: number, height: number, label = "atlas"): GPUTexture =>
  ({ label, width, height, createView: () => ({ label }) }) as unknown as GPUTexture;

/** A stand-in `VideoFrame`: the leg reads only its display/coded size. */
const videoFrame = (displayWidth: number, displayHeight: number, label = "frame") =>
  ({ label, displayWidth, displayHeight }) as unknown as object;

describe("resolving a live surface", () => {
  it("resolves to NOTHING before the first frame", () => {
    // Not an error — a source with no frame yet, or a paused one declining to
    // hand one over. The pass skips it exactly as it skips an empty atlas slot.
    expect(resolveVideoSource({ kind: "video", frame: () => undefined })).toBeUndefined();
  });

  it("hands over the FRAME, never a texture — only the pass may import", () => {
    // `importExternalTexture` yields a handle valid for the importing task
    // alone, so this module must not hold one. If this ever resolves a
    // `texture`, someone has moved the import out of `encode`.
    const f = videoFrame(320, 240);
    const resolved = resolveVideoSource({ kind: "video", frame: () => f });
    expect(resolved?.external).toBe(f);
    expect(resolved?.texture).toBeUndefined();
  });

  it("RE-READS the getter every composite — retention is the source's", () => {
    // The whole §6.4 contract in one assertion: a surface is STATE. The
    // compositor asks for the latest each time and never caches an answer, so
    // the source is free to hold one frame forever (this fixture) or copy and
    // close immediately (a lease-bound consumer) without this file changing.
    const first = videoFrame(64, 64, "a");
    const second = videoFrame(64, 64, "b");
    let current = first;
    const source = { kind: "video" as const, frame: () => current };
    expect(resolveVideoSource(source)?.external).toBe(first);
    current = second;
    expect(resolveVideoSource(source)?.external).toBe(second);
  });

  it("takes the WHOLE frame as its rect — an external texture samples 0..1", () => {
    const resolved = resolveVideoSource({ kind: "video", frame: () => videoFrame(640, 360) });
    expect(resolved?.rect).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    expect(resolved?.textureWidth).toBe(640);
    expect(resolved?.textureHeight).toBe(360);
  });

  it("falls back to the CODED size when a frame declares no display size", () => {
    const coded = { codedWidth: 128, codedHeight: 96 } as unknown as object;
    const resolved = resolveVideoSource({ kind: "video", frame: () => coded });
    expect(resolved?.textureWidth).toBe(128);
    expect(resolved?.textureHeight).toBe(96);
  });

  it("declares no sRGB decode — an import arrives in the destination space", () => {
    const resolved = resolveVideoSource({ kind: "video", frame: () => videoFrame(8, 8) });
    expect(resolved?.srgb).toBe(false);
    expect(resolved?.premultiplied).toBe(true);
  });

  it("does NOT flip video — an imported frame arrives y-down, MEASURED", () => {
    // `composited-app.mjs` drives both arms against a fixture drawn bright-on-
    // top: as-is +201.1, flipped −201.1, and the window capture agrees at the
    // same coordinates (+200.9). So an external texture lands the same way up
    // as an island target, against the folklore that video is always y-up.
    expect(resolveVideoSource({ kind: "video", frame: () => videoFrame(8, 8) })?.flipY).toBe(false);
  });

  it("still CAN flip, because the answer is a fact about the producer", () => {
    // A camera, a decoder and a canvas need not agree; a consumer that knows
    // its own producer says so, and gets the gl leg's negative-height UV rect.
    const resolved = resolveVideoSource(
      { kind: "video", frame: () => videoFrame(8, 8) },
      { flipY: true },
    );
    expect(resolved?.flipY).toBe(true);
  });
});

/** A device that arms both pipeline variants and records what the pass asks of it. */
function recordingDevice() {
  const imports: object[] = [];
  const pipelines: string[] = [];
  const bindGroups: string[] = [];
  const shaders = new Map<string, string>();
  const writes: Array<{ label: string; data: Float32Array }> = [];
  const labels = new Map<object, string>();
  const device = {
    createShaderModule: (d: { label: string; code: string }) => {
      shaders.set(d.label, d.code);
      return { code: d.code };
    },
    createBindGroupLayout: (d: { label: string }) => ({ label: d.label }),
    createPipelineLayout: () => ({}),
    createRenderPipeline: (d: { label: string }) => {
      pipelines.push(d.label);
      return { label: d.label };
    },
    createSampler: () => ({}),
    createBuffer: (d: { label?: string }) => {
      const b = { destroy: () => {} };
      labels.set(b, d.label ?? "");
      return b;
    },
    createBindGroup: (d: { label: string }) => {
      bindGroups.push(d.label);
      return { label: d.label };
    },
    importExternalTexture: (d: { source: object }) => {
      imports.push(d.source);
      return { external: true };
    },
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
  return { device, imports, pipelines, bindGroups, shaders, uv };
}

const frame: CompositeFrame = { width: 800, height: 600, dpr: 1, camera: { x: 0, y: 0, zoom: 1 } };

/** Records the draw calls and pipeline switches a composite actually issues. */
function recordingEncoder() {
  const draws: Array<{ count: number; first: number }> = [];
  const setPipelines: string[] = [];
  const encoder = {
    setPipeline: (p: { label: string }) => setPipelines.push(p.label),
    setBindGroup: () => {},
    draw: (_v: number, count: number, _f: number, first: number) => draws.push({ count, first }),
  } as unknown as GPURenderPassEncoder;
  return { encoder, draws, setPipelines };
}

describe("a video quad inside the one pass", () => {
  const atlas = texture(256, 256);
  const domQuad = {
    texture: atlas,
    rect: { x: 0, y: 0, width: 128, height: 64 },
    textureWidth: 256,
    textureHeight: 256,
  };

  function passOver(kinds: Array<"dom" | "video">, frames: object[]) {
    const registry = createCompositorSourceRegistry();
    kinds.forEach((kind, i) => {
      registry.register(
        entity(i),
        kind === "dom"
          ? { kind: "dom", host: {} }
          : { kind: "video", frame: () => frames[i] as object },
      );
    });
    const rec = recordingDevice();
    const pass = createWidgetQuadPass({
      device: rec.device,
      format: "bgra8unorm",
      registry,
      order: () => kinds.map((_k, i) => entity(i)),
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: (_e, source) => {
        const s = source as { kind: string };
        return s.kind === "video" ? resolveVideoSource(s as never) : domQuad;
      },
    });
    return { pass, ...rec };
  }

  it("IMPORTS INSIDE ENCODE, once per composite, never cached", () => {
    // THE law of this leg. A cached external texture is not stale data, it is
    // an invalid handle — and the symptom is a validation error on some later
    // frame, nowhere near the code that kept it. Two composites, two imports.
    const f = videoFrame(64, 64);
    const { pass, imports } = passOver(["video"], [f]);
    const { encoder } = recordingEncoder();
    pass.encode(encoder, frame);
    expect(imports).toEqual([f]);
    pass.encode(encoder, frame);
    expect(imports).toEqual([f, f]);
  });

  it("builds a SEPARATE pipeline for external textures, and only on demand", () => {
    // `texture_external` is a different WGSL type, so it needs its own layout
    // and pipeline. A board with no live surface must never pay for one.
    const domOnly = passOver(["dom"], []);
    domOnly.pass.encode(recordingEncoder().encoder, frame);
    expect(domOnly.pipelines).toEqual(["widget-quads"]);

    const withVideo = passOver(["dom", "video"], [{}, videoFrame(64, 64)]);
    withVideo.pass.encode(recordingEncoder().encoder, frame);
    expect(withVideo.pipelines).toEqual(["widget-quads", "widget-quads-external"]);
  });

  it("samples an external texture with the WGSL builtin, not textureSample", () => {
    // The two variants are generated from ONE template so a video quad cannot
    // fade or round differently from the card beside it — but exactly two
    // things must differ, or the module would not compile: the binding type
    // and the sampling call.
    const p = passOver(["dom", "video"], [{}, videoFrame(8, 8)]);
    p.pass.encode(recordingEncoder().encoder, frame);
    const plain = p.shaders.get("widget-quads") as string;
    const external = p.shaders.get("widget-quads-external") as string;

    expect(plain).toContain("var src : texture_2d<f32>");
    expect(plain).toContain("textureSample(src, srcSampler, in.uv)");
    expect(external).toContain("var src : texture_external");
    expect(external).toContain("textureSampleBaseClampToEdge(src, srcSampler, in.uv)");
    // An external texture has no mip chain and cannot be sampled the plain way.
    expect(external).not.toContain("texture_2d<f32>");

    // And the REST is byte-identical: strip the two differing lines and the
    // variants must be the same program. A divergence here is a video card
    // that rounds its corners differently from a dom one.
    const skeleton = (code: string) =>
      code
        .split("\n")
        .filter((l) => !l.includes("var src :") && !l.includes("textureSample"))
        .join("\n");
    expect(skeleton(external)).toBe(skeleton(plain));
  });

  it("NEVER merges two video quads into one run", () => {
    // Adjacent same-texture quads batch. Two video quads are never the same
    // external texture — not even when they share a frame — so each is its own
    // draw with its own bind group. Merging them would draw one quad's pixels
    // twice at two positions.
    const shared = videoFrame(64, 64, "shared");
    const { pass, draws } = (() => {
      const p = passOver(["video", "video"], [shared, shared]);
      const rec = recordingEncoder();
      p.pass.encode(rec.encoder, frame);
      return { pass: p.pass, draws: rec.draws };
    })();
    expect(pass.batches()).toBe(2);
    expect(draws).toEqual([
      { count: 1, first: 0 },
      { count: 1, first: 1 },
    ]);
  });

  it("keeps paint order across dom and video, switching pipelines as it goes", () => {
    // dom, video, dom must be three draws in that order — the z contract — and
    // the pipeline flips back for the trailing card rather than sticking.
    const p = passOver(["dom", "video", "dom"], [{}, videoFrame(64, 64), {}]);
    const rec = recordingEncoder();
    expect(p.pass.encode(rec.encoder, frame)).toBe(3);
    expect(p.pass.batches()).toBe(3);
    expect(rec.draws).toEqual([
      { count: 1, first: 0 },
      { count: 1, first: 1 },
      { count: 1, first: 2 },
    ]);
    expect(rec.setPipelines).toEqual([
      "widget-quads",
      "widget-quads-external",
      "widget-quads",
    ]);
  });

  it("still batches adjacent DOM quads once a video quad is in the board", () => {
    // The video kind opts itself out of merging; it must not switch merging off
    // for everyone else and quietly cost a draw call per card.
    const p = passOver(["video", "dom", "dom"], [videoFrame(64, 64), {}, {}]);
    const rec = recordingEncoder();
    expect(p.pass.encode(rec.encoder, frame)).toBe(3);
    expect(rec.draws).toEqual([
      { count: 1, first: 0 },
      { count: 2, first: 1 },
    ]);
  });

  it("skips a surface with no frame without disturbing the others", () => {
    const registry = createCompositorSourceRegistry();
    registry.register(entity(0), { kind: "dom", host: {} });
    registry.register(entity(1), { kind: "video", frame: () => undefined });
    const rec = recordingDevice();
    const pass = createWidgetQuadPass({
      device: rec.device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0), entity(1)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: (_e, source) => {
        const s = source as { kind: string };
        return s.kind === "video" ? resolveVideoSource(s as never) : domQuad;
      },
    });
    expect(pass.encode(recordingEncoder().encoder, frame)).toBe(1);
    expect(pass.skipped()).toBe(1);
    // And nothing was imported for the frameless source.
    expect(rec.imports).toEqual([]);
  });

  it("packs an unflipped surface as a plain 0..1 rect", () => {
    const p = passOver(["video"], [videoFrame(320, 240)]);
    p.pass.encode(recordingEncoder().encoder, frame);
    expect(p.uv()).toEqual([0, 0, 1, 1]);
  });

  it("packs a FLIPPED surface bottom-origin with a negative height", () => {
    // The gl leg's mechanism, unchanged: no fragment branch, just the UV rect.
    const registry = createCompositorSourceRegistry();
    registry.register(entity(0), { kind: "video", frame: () => videoFrame(320, 240) });
    const rec = recordingDevice();
    const pass = createWidgetQuadPass({
      device: rec.device,
      format: "bgra8unorm",
      registry,
      order: () => [entity(0)],
      facts: () => ({ x: 0, y: 0, w: 100, h: 50 }),
      resolve: (_e, source) => resolveVideoSource(source as never, { flipY: true }),
    });
    pass.encode(recordingEncoder().encoder, frame);
    expect(rec.uv()).toEqual([0, 1, 1, -1]);
  });
});
