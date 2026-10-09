// M24 LT1 (design-019 §3.1, §9): THE LIVE TEXTURE — the host's writer, the kind's reader, the mips made into the frame's encoder as
// deep as they are read, and a still's source of committed bytes — on a RECORDING device: every texture, view, group, copy, render
// pass and submit it is asked for, in order. What the calls are is held here; that they draw the right pixels is the Dawn witness's
// (test/live.dawn.test.ts) and the rig's (apps/desk rig:live).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chainBytes } from "../src/kit/arrays";
import { createLiveTexture, type LiveImage, liveDepth, stillLive } from "../src/kit/live";
import { generateMips, mipCount, mipsInto } from "../src/kit/mips";
import { installGpuFlags } from "./fake-gpu";

interface Device {
  readonly device: GPUDevice;
  /** What the device was asked, in order. */
  readonly calls: string[];
  /** Each texture's usage flags, in the order made. */
  readonly usages: number[];
}

/** A device that makes stubs and says what it was asked: textures carry their label, size, format and levels; a level's view its level. */
function recordingDevice(): Device {
  const calls: string[] = [];
  const usages: number[] = [];
  let made = 0;
  const device = {
    createTexture: (d: GPUTextureDescriptor) => {
      const id = ++made;
      const [w, h] = d.size as number[];
      calls.push(`texture ${id} "${d.label}" ${w}×${h} ${d.format} levels ${d.mipLevelCount ?? 1}`);
      usages.push(d.usage);
      return {
        label: d.label, width: w, height: h, format: d.format, mipLevelCount: d.mipLevelCount ?? 1, usage: d.usage,
        createView: (v?: GPUTextureViewDescriptor) => { const label = `${id}${v?.baseMipLevel !== undefined ? `.${v.baseMipLevel}` : ""}`; calls.push(`view ${label}`); return { label }; },
        destroy: () => calls.push(`destroy ${id}`),
      };
    },
    createShaderModule: (d: GPUShaderModuleDescriptor) => ({ label: d.label }),
    createSampler: () => ({ label: "sampler" }),
    createRenderPipeline: (d: GPURenderPipelineDescriptor) => ({ label: d.label, getBindGroupLayout: () => ({ label: "layout" }) }),
    createBindGroup: (d: GPUBindGroupDescriptor) => { calls.push(`group reads ${((d.entries as GPUBindGroupEntry[])[0]?.resource as { label: string }).label}`); return { label: "group" }; },
    createCommandEncoder: (d?: GPUCommandEncoderDescriptor) => ({
      label: d?.label,
      beginRenderPass: (p: GPURenderPassDescriptor) => {
        calls.push(`pass into ${((p.colorAttachments as GPURenderPassColorAttachment[])[0]?.view as { label: string }).label}`);
        return { setPipeline: () => {}, setBindGroup: () => {}, draw: () => {}, end: () => {} };
      },
      copyTextureToTexture: (s: GPUTexelCopyTextureInfo, t: GPUTexelCopyTextureInfo, size: number[]) => calls.push(`copyTextureToTexture from ${(s.texture as { label: string }).label} @${(s.origin as number[]).join(",")} to ${(t.texture as { label: string }).label} ${size.join("×")}`),
      finish: () => ({ label: d?.label }),
    }),
    queue: {
      writeTexture: (t: GPUTexelCopyTextureInfo, data: Uint8Array, layout: GPUTexelCopyBufferLayout, size: number[]) => calls.push(`writeTexture ${(t.texture as { label: string }).label} level ${t.mipLevel ?? 0} ${data.byteLength} B, ${layout.bytesPerRow} a row, ${size.join("×")}`),
      copyExternalImageToTexture: (s: { source: unknown; origin?: number[] }, t: GPUCopyExternalImageDestInfo, size: number[]) => calls.push(`copyExternal from ${(s.source as { name: string }).name} @${(s.origin ?? [0, 0]).join(",")} to ${(t.texture as { label: string }).label} level ${t.mipLevel ?? 0} ${size.join("×")}`),
      submit: (list: unknown[]) => calls.push(`submit ${list.length}`),
    },
  };
  return { device: device as unknown as GPUDevice, calls, usages };
}

/** An encoder of the recording device's — a frame's. */
const encoderOf = (d: GPUDevice): GPUCommandEncoder => d.createCommandEncoder({ label: "frame" });

/** A browser source by its shape: a canvas or a bitmap (`width`/`height`), or a VideoFrame (`codedWidth`, display size, `close`). */
function canvasLike(name: string, width: number, height: number): LiveImage & { readonly name: string } {
  return { name, width, height } as unknown as LiveImage & { readonly name: string };
}
function frameLike(name: string, width: number, height: number): LiveImage & { readonly name: string; closed: number } {
  const f = { name, codedWidth: width, codedHeight: height, displayWidth: width, displayHeight: height, closed: 0, close() { f.closed += 1; } };
  return f as unknown as LiveImage & { readonly name: string; closed: number };
}

describe("the live texture (design-019 §3.1)", () => {
  let undo: () => void;
  beforeAll(() => { undo = installGpuFlags(); });
  afterAll(() => { undo(); });

  it("is ONE stable texture: the caller's label, rgba8unorm-srgb with a whole chain by default, usable as a binding, a copy's ends and a level's target", () => {
    const { device, calls, usages } = recordingDevice();
    const live = createLiveTexture(device, { label: "rig/live a-1", width: 640, height: 400 });
    expect(calls).toEqual([`texture 1 "rig/live a-1" 640×400 rgba8unorm-srgb levels ${mipCount(640, 400)}`]);
    expect(usages[0]).toBe(GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT);
    expect([live.face.width, live.face.height, live.face.format, live.face.revision, live.face.epoch]).toEqual([640, 400, "rgba8unorm-srgb", 0, 0]);
    expect(live.face.bytes).toBe(chainBytes(640, 400, mipCount(640, 400)));
    const flat = createLiveTexture(device, { label: "x/live b", width: 64, height: 32, format: "rgba8unorm", mips: false });
    expect(calls.at(-1)).toBe(`texture 2 "x/live b" 64×32 rgba8unorm levels 1`);
    expect(flat.face.bytes).toBe(64 * 32 * 4);
    expect(() => createLiveTexture(device, { label: "x", width: 0, height: 4 })).toThrow(/width must be a finite number ≥ 1/);
    expect(() => createLiveTexture(device, { label: "x", width: 4, height: 4, format: "bgra8unorm" as never })).toThrow(/format must be/);
  });

  it("each present is ONE copy into level 0 and moves the revision — bytes by writeTexture, a source by copyExternalImageToTexture (from its rect), a texture by copyTextureToTexture", () => {
    const { device, calls } = recordingDevice();
    const live = createLiveTexture(device, { label: "k/live a", width: 4, height: 2 });
    calls.length = 0;
    live.presentBytes(new Uint8Array(4 * 2 * 4), 4, 2);
    expect(calls).toEqual(["writeTexture k/live a level 0 32 B, 16 a row, 4×2"]);
    expect(live.face.revision).toBe(1);
    expect(() => live.presentBytes(new Uint8Array(31), 4, 2)).toThrow(/31 bytes for 4 × 2 RGBA8 rows \(32 wanted\)/);
    expect(live.face.revision).toBe(1);
    calls.length = 0;
    live.present(canvasLike("canvas", 4, 2));
    live.present(canvasLike("page", 10, 8), { x: 3, y: 2, width: 4, height: 2 });
    expect(calls).toEqual(["copyExternal from canvas @0,0 to k/live a level 0 4×2", "copyExternal from page @3,2 to k/live a level 0 4×2"]);
    calls.length = 0;
    live.presentTexture({ label: "producer", width: 4, height: 2 } as unknown as GPUTexture);
    expect(calls).toEqual(["copyTextureToTexture from producer @0,0 to k/live a 4×2", "submit 1"]);
    expect([live.face.revision, live.face.epoch]).toEqual([4, 0]);
  });

  it("a VideoFrame is CLOSED by the writer once its copy is asked — even when the copy throws, even after destroy; any other source stays the host's", () => {
    const { device } = recordingDevice();
    const live = createLiveTexture(device, { label: "k/live v", width: 8, height: 8 });
    const frame = frameLike("frame", 8, 8);
    live.present(frame);
    expect(frame.closed).toBe(1);
    const bitmap = { ...canvasLike("bitmap", 8, 8), closed: 0, close() { this.closed += 1; } };
    live.present(bitmap as unknown as LiveImage);
    expect(bitmap.closed).toBe(0);
    const throwing = { ...device, queue: { ...device.queue, copyExternalImageToTexture: () => { throw new Error("lost"); } } } as unknown as GPUDevice;
    const bad = createLiveTexture(throwing, { label: "k/live t", width: 8, height: 8 });
    const f2 = frameLike("frame 2", 8, 8);
    expect(() => bad.present(f2)).toThrow("lost");
    expect(f2.closed).toBe(1);
    live.destroy();
    const f3 = frameLike("frame 3", 8, 8);
    live.present(f3);
    expect(f3.closed).toBe(1);
    expect(live.face.revision).toBe(2);   // after destroy: ignored
  });

  it("a source of another size makes a new texture first — the epoch moves, the old one is destroyed, the view made again; resize to the same size does nothing", () => {
    const { device, calls } = recordingDevice();
    const live = createLiveTexture(device, { label: "k/live r", width: 16, height: 16 });
    const v0 = live.face.view();
    expect(live.face.view()).toBe(v0);
    calls.length = 0;
    live.presentBytes(new Uint8Array(32 * 8 * 4), 32, 8);
    expect(calls).toEqual(["destroy 1", `texture 2 "k/live r" 32×8 rgba8unorm-srgb levels ${mipCount(32, 8)}`, "writeTexture k/live r level 0 1024 B, 128 a row, 32×8"]);
    expect([live.face.width, live.face.height, live.face.epoch, live.face.revision]).toEqual([32, 8, 1, 1]);
    expect(live.face.view()).not.toBe(v0);
    calls.length = 0;
    live.resize(32, 8);
    expect(calls).toEqual([]);
    live.resize(20, 10);
    expect(calls).toEqual(["destroy 2", `texture 3 "k/live r" 20×10 rgba8unorm-srgb levels ${mipCount(20, 10)}`]);
    expect(live.face.epoch).toBe(2);
  });

  it("prepare makes the mips INTO the frame's encoder, as deep as asked, once per revision — a deeper ask only the missing levels; nothing before a present, past the chain or without one", () => {
    const { device, calls } = recordingDevice();
    const live = createLiveTexture(device, { label: "k/live m", width: 64, height: 64 });   // 7 levels: 0 … 6
    const passes = (): string[] => calls.filter((c) => c.startsWith("pass into") || c.startsWith("submit"));
    live.face.prepare(encoderOf(device), 3);
    expect(passes(), "nothing presented: nothing to make").toEqual([]);
    live.presentBytes(new Uint8Array(64 * 64 * 4), 64, 64);
    calls.length = 0;
    live.face.prepare(encoderOf(device), 2);
    expect(passes()).toEqual(["pass into 1.1", "pass into 1.2"]);
    calls.length = 0;
    live.face.prepare(encoderOf(device), 2);
    live.face.prepare(encoderOf(device), 1);
    expect(passes(), "the same revision and depth: nothing").toEqual([]);
    live.face.prepare(encoderOf(device), 4);
    expect(passes(), "deeper: the missing levels alone").toEqual(["pass into 1.3", "pass into 1.4"]);
    calls.length = 0;
    live.face.prepare(encoderOf(device), 99);
    expect(passes(), "clamped to the chain's last level").toEqual(["pass into 1.5", "pass into 1.6"]);
    calls.length = 0;
    live.presentBytes(new Uint8Array(64 * 64 * 4), 64, 64);
    live.face.prepare(encoderOf(device), 2);
    expect(passes(), "a new revision: owed again, from level 1").toEqual(["pass into 1.1", "pass into 1.2"]);
    expect(calls.some((c) => c.startsWith("submit")), "never a submit of its own").toBe(false);
    const flat = createLiveTexture(device, { label: "k/live f", width: 64, height: 64, mips: false });
    flat.presentBytes(new Uint8Array(64 * 64 * 4), 64, 64);
    calls.length = 0;
    flat.face.prepare(encoderOf(device), 3);
    expect(passes(), "no chain: nothing").toEqual([]);
  });
});

describe("mipsInto (design-019 §3.1 · gap 19)", () => {
  let undo: () => void;
  beforeAll(() => { undo = installGpuFlags(); });
  afterAll(() => { undo(); });
  const texture = (device: GPUDevice, w: number, h: number): GPUTexture => device.createTexture({ label: "t", size: [w, h], format: "rgba8unorm-srgb", mipLevelCount: mipCount(w, h), usage: 0 });

  it("draws levels from … to into the caller's encoder, each reading the level above it; the views and groups are kept per texture — made once, never per call", () => {
    const { device, calls } = recordingDevice();
    const t = texture(device, 32, 32);   // levels 0 … 5
    calls.length = 0;
    mipsInto(device, encoderOf(device), t, 1, 3);
    expect(calls).toEqual(["view 1.0", "group reads 1.0", "view 1.1", "pass into 1.1", "group reads 1.1", "view 1.2", "pass into 1.2", "group reads 1.2", "view 1.3", "pass into 1.3"]);
    calls.length = 0;
    mipsInto(device, encoderOf(device), t, 1, 3);
    expect(calls, "the second time: the passes alone").toEqual(["pass into 1.1", "pass into 1.2", "pass into 1.3"]);
    calls.length = 0;
    mipsInto(device, encoderOf(device), t, 4, 40);
    expect(calls, "clamped to the last level; only the new level's view and group are made").toEqual(["group reads 1.3", "view 1.4", "pass into 1.4", "group reads 1.4", "view 1.5", "pass into 1.5"]);
    calls.length = 0;
    mipsInto(device, encoderOf(device), t, 3, 2);
    mipsInto(device, encoderOf(device), t, 0, 0);
    expect(calls, "an empty range records nothing (level 0 is never drawn)").toEqual([]);
    expect(calls.some((c) => c.startsWith("submit"))).toBe(false);
  });

  it("generateMips keeps its own-submit form: the whole chain, views and groups made each call, ONE submit of its own", () => {
    const { device, calls } = recordingDevice();
    const t = texture(device, 8, 8);   // levels 0 … 3
    calls.length = 0;
    generateMips(device, t);
    expect(calls.filter((c) => c.startsWith("pass into"))).toEqual(["pass into 1.1", "pass into 1.2", "pass into 1.3"]);
    expect(calls.filter((c) => c.startsWith("submit"))).toEqual(["submit 1"]);
    calls.length = 0;
    generateMips(device, t);
    expect(calls.filter((c) => c.startsWith("view")).length).toBe(6);
  });
});

describe("liveDepth — how deep a face is read (design-019 §3.1)", () => {
  it("0 at its size or larger; ⌈log2 of the larger minification⌉ below it", () => {
    expect(liveDepth({ width: 1024, height: 512 }, [1024, 512])).toBe(0);
    expect(liveDepth({ width: 1024, height: 512 }, [2048, 1024])).toBe(0);
    expect(liveDepth({ width: 1024, height: 512 }, [512, 256])).toBe(1);
    expect(liveDepth({ width: 1024, height: 512 }, [500, 256])).toBe(2);
    expect(liveDepth({ width: 1024, height: 512 }, [128, 64])).toBe(3);
    expect(liveDepth({ width: 1024, height: 512 }, [1024, 100])).toBe(3);
    expect(liveDepth({ width: 1024, height: 512 }, [0, 0])).toBeGreaterThan(20);
  });
});

describe("stillLive — a still's source of committed bytes (design-019 §9)", () => {
  let undo: () => void;
  beforeAll(() => { undo = installGpuFlags(); });
  afterAll(() => { undo(); });
  const still = { width: 4, height: 2, bytes: new Uint8Array(32).fill(7), info: { title: "a still" } };

  it("a face's FIRST take presents its bytes through presentBytes — labelled live/still <key> — and answers true once; it is live, its info the still's", () => {
    const { device, calls } = recordingDevice();
    const face = stillLive(device, { "p-1": still }).open("p-1", {}, () => {});
    expect(face.key).toBe("p-1");
    expect(face.texture()).toBeUndefined();
    expect(face.state()).toEqual({ is: "live" });
    expect(face.info()).toEqual({ title: "a still" });
    expect(face.input).toBeUndefined();
    expect(face.take()).toBe(true);
    expect(calls).toEqual([`texture 1 "live/still p-1" 4×2 rgba8unorm-srgb levels ${mipCount(4, 2)}`, "writeTexture live/still p-1 level 0 32 B, 16 a row, 4×2"]);
    expect(face.texture()?.revision).toBe(1);
    expect(face.take()).toBe(false);
    face.demand({ mode: "live", fps: 30, raster: [4, 2], interactive: false });   // a still ignores it
    face.close();
    expect(calls.at(-1)).toBe("destroy 1");
    expect(face.texture()).toBeUndefined();
    expect(face.state()).toEqual({ is: "closed" });
  });

  it("frames are read when a face OPENS — a record a stage fills after the source is made, or a function of the key and the host's spec; a key with none is starting and takes nothing", () => {
    const { device } = recordingDevice();
    const record: Record<string, typeof still> = {};
    const sources = stillLive(device, record);
    record["k-2"] = still;   // a stage's spawn read its key back after the source was lent
    expect(sources.open("k-2", {}, () => {}).take()).toBe(true);
    const none = sources.open("k-3", {}, () => {});
    expect(none.state()).toEqual({ is: "starting" });
    expect(none.take()).toBe(false);
    const asked: string[] = [];
    const bySpec = stillLive(device, (key, spec) => { asked.push(`${key} ${String(spec.url)}`); return spec.url === "fixture://a" ? still : undefined; });
    expect(bySpec.open("k-4", { url: "fixture://a" }, () => {}).take()).toBe(true);
    expect(bySpec.open("k-5", { url: "fixture://b" }, () => {}).take()).toBe(false);
    expect(asked).toEqual(["k-4 fixture://a", "k-5 fixture://b"]);
  });

  it("one face per key: a key opened twice while open throws, naming it; closed, it opens again", () => {
    const { device } = recordingDevice();
    const sources = stillLive(device, { a: still });
    const first = sources.open("a", {}, () => {});
    expect(() => sources.open("a", {}, () => {})).toThrow(/the face "a" is open twice/);
    first.close();
    expect(sources.open("a", {}, () => {}).take()).toBe(true);
  });
});
