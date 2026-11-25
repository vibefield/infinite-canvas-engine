// THE PEN ON THE GPU, its CPU half (petition I59 — kit/hand-gpu.ts), on a device that records what it is asked: a kind's RUN
// STORE hands back the base a record carries, rewrites a run in its own room while it fits, writes a run that crosses rows as a
// part row, whole rows and a part row, grows by copy when full (the old texels copied, the bases kept, the version moved), takes a
// freed room again, and says −1 when the device holds no more; the face's ATLAS is made once per device and atlas, every level
// written; the bindings are named under the kind's own prefix. The pixels are hand.dawn.test.ts's.
import { describe, expect, it } from "vitest";
import { cardShaders, planCards } from "../src/card/card";
import { compose } from "../src/engine/shader";
import { createHandRuns, HAND_BINDINGS, handAtlasGpu, handBindings, handSampler } from "../src/kit/hand-gpu";
import { HAND_RUN, type HandRun, handLevels, handMips } from "../src/kit/hand-run";
import { installGpuFlags } from "./fake-gpu";
import { fixtureFace, penProgram } from "./hand-fixture";

installGpuFlags();

interface Put { label: string; x: number; y: number; w: number; h: number; offset: number; bytesPerRow: number; level: number }

/** A device whose textures carry their size and whose queue records every texture write and copy. */
function device(rows = 8192) {
  const puts: Put[] = [];
  const copies: { from: string; to: string; size: number[] }[] = [];
  const destroyed: string[] = [];
  let made = 0;
  const dev = {
    limits: { maxTextureDimension2D: rows },
    createTexture: (d: GPUTextureDescriptor) => {
      const size = d.size as number[];
      const label = `${d.label ?? ""}#${made++}`;
      return { label, width: size[0], height: size[1], mipLevelCount: d.mipLevelCount ?? 1, format: d.format, createView: () => ({ label: `${label} view` }), destroy: () => destroyed.push(label) };
    },
    createSampler: (d: GPUSamplerDescriptor) => ({ label: d.label ?? "", ...d }),
    createCommandEncoder: () => ({
      copyTextureToTexture: (a: { texture: { label: string } }, b: { texture: { label: string } }, size: number[]) => copies.push({ from: a.texture.label, to: b.texture.label, size }),
      finish: () => ({}),
    }),
    queue: {
      writeTexture: (dst: { texture: { label: string }; origin?: { x: number; y: number }; mipLevel?: number }, _data: unknown, layout: GPUTexelCopyBufferLayout, size: number[]) =>
        puts.push({ label: dst.texture.label, x: dst.origin?.x ?? 0, y: dst.origin?.y ?? 0, w: size[0] as number, h: size[1] as number, offset: layout.offset ?? 0, bytesPerRow: layout.bytesPerRow ?? 0, level: dst.mipLevel ?? 0 }),
      submit: () => {},
    },
  };
  return { device: dev as unknown as GPUDevice, puts, copies, destroyed };
}

/** A run of `n` vec4s (only its length and data are read by the store). */
const runOf = (n: number): HandRun => ({ data: new Float32Array(n * 4).map((_, i) => i), length: n, glyphs: 0, missing: [], grid: { x0: 0, y0: 0, x1: 0, y1: 0, cell: 1, cols: 1, rows: 1, entries: 0 }, epoch: 0 });

describe("a kind's run store (petition I59)", () => {
  it("hands back the base a record carries, and rewrites a run in its own room while it fits", () => {
    const { device: d, puts } = device();
    const runs = createHandRuns(d, { label: "t/runs" });
    const a = runs.write(1, runOf(40));
    const b = runs.write(2, runOf(10));
    expect(a).toBe(0);
    expect(b).toBeGreaterThanOrEqual(40);
    expect(runs.baseOf(1)).toBe(a);
    // the same object again, a little longer (a keystroke): its own room, its own base
    expect(runs.write(1, runOf(44))).toBe(a);
    expect(runs.stats()).toMatchObject({ runs: 2, used: 54, capacity: HAND_RUN.row * 16, grown: 0 });
    expect(puts.every((p) => p.label.startsWith("t/runs"))).toBe(true);
    expect(runs.baseOf(3)).toBe(-1);
  });

  it("writes a run that crosses rows as a part row, the whole rows, and a part row — each at its origin, from its offset", () => {
    const { device: d, puts } = device();
    const runs = createHandRuns(d);
    runs.write(1, runOf(1000));   // 0 … 999, and its room past it
    const base = runs.write(2, runOf(3000));
    puts.length = 0;
    runs.write(2, runOf(3000));
    const W = HAND_RUN.row;
    const head = (W - (base % W)) % W;
    expect(puts.map((p) => [p.x, p.y, p.w, p.h, p.offset, p.bytesPerRow])).toEqual([
      [base % W, Math.floor(base / W), head, 1, 0, head * 16],
      [0, Math.floor(base / W) + 1, W, Math.floor((3000 - head) / W), head * 16, W * 16],
      [0, Math.floor(base / W) + 1 + Math.floor((3000 - head) / W), (3000 - head) % W, 1, (head + Math.floor((3000 - head) / W) * W) * 16, ((3000 - head) % W) * 16],
    ]);
    expect(puts.reduce((s, p) => s + p.w * p.h, 0)).toBe(3000);
  });

  it("grows by copy when full: the texture doubled, the old texels copied and it destroyed, every base kept, the version moved", () => {
    const { device: d, copies, destroyed } = device();
    const runs = createHandRuns(d, { label: "t/runs", rows: 2 });
    const first = runs.write(1, runOf(1500));
    const tex = runs.texture as unknown as { label: string };
    expect(runs.version).toBe(0);
    const second = runs.write(2, runOf(1500));   // past 2 rows: grown to 4
    expect(runs.version).toBe(1);
    expect(runs.stats()).toMatchObject({ capacity: HAND_RUN.row * 4, grown: 1 });
    expect(copies).toEqual([{ from: tex.label, to: (runs.texture as unknown as { label: string }).label, size: [HAND_RUN.row, 2, 1] }]);
    expect(destroyed).toEqual([tex.label]);
    expect(runs.baseOf(1)).toBe(first);
    expect(second).toBeGreaterThanOrEqual(1500);
  });

  it("takes a freed room again, its neighbours merged; −1 when the device holds no more", () => {
    const { device: d } = device(2);
    const runs = createHandRuns(d, { rows: 2 });
    const a = runs.write(1, runOf(300));
    runs.write(2, runOf(300));
    runs.free(1);
    expect(runs.baseOf(1)).toBe(-1);
    expect(runs.write(3, runOf(300))).toBe(a);
    runs.free(2);
    runs.free(3);
    expect(runs.stats()).toMatchObject({ runs: 0, given: 0 });
    expect(runs.write(4, runOf(1600))).toBe(0);   // the merged room, from the start
    expect(runs.write(5, runOf(900))).toBe(-1);   // two rows is the most this device holds
  });
});

describe("the face's atlas on the GPU (petition I59)", () => {
  const face = fixtureFace();

  it("is made once per device and atlas — every kind and every slot binds the one texture — with every level written", () => {
    const one = device();
    const two = device();
    const a = handAtlasGpu(one.device, face.atlas);
    expect(handAtlasGpu(one.device, face.atlas)).toBe(a);
    expect(handAtlasGpu(two.device, face.atlas)).not.toBe(a);
    expect(handAtlasGpu(one.device, fixtureFace().atlas)).not.toBe(a);   // another atlas, another texture
    expect(a.levels).toBe(handLevels(face.atlas));
    const chain = handMips(face.atlas);
    expect([a.width, a.height]).toEqual([chain[0]?.w, chain[0]?.h]);
    expect((a.texture as unknown as { format: string }).format).toBe("rg8unorm");
    expect((a.texture as unknown as { label: string }).label).toMatch(/^hand\/Fixture 400#/);
    expect(one.puts.filter((p) => p.label === (a.texture as unknown as { label: string }).label).map((p) => [p.level, p.w, p.h, p.bytesPerRow])).toEqual(chain.map((m, l) => [l, m.w, m.h, m.w * 2]));
    expect(a.bytes).toBe(chain.reduce((s, m) => s + m.bytes.byteLength, 0));
  });

  it("its sampler is one a device: linear, linear between the levels, clamped", () => {
    const { device: d } = device();
    const s = handSampler(d) as unknown as GPUSamplerDescriptor;
    expect(handSampler(d)).toBe(s);
    expect([s.magFilter, s.minFilter, s.mipmapFilter, s.addressModeU, s.addressModeV]).toEqual(["linear", "linear", "linear", "clamp-to-edge", "clamp-to-edge"]);
  });

  it("two kinds that write with the pen share ONE card program: neither is left out, the piece composed once, each over its own bindings", () => {
    const LIMITS = { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxUniformBuffersPerShaderStage: 12, maxBindingsPerBindGroup: 1000 };
    const plan = planCards([penProgram("note"), penProgram("pad")], LIMITS);
    expect(plan.kinds.map((k) => k.name)).toEqual(["note", "pad"]);
    expect(plan.left).toEqual([]);
    const program = cardShaders(plan.kinds);
    expect((program.modules ?? []).filter((m) => m.label === "kit/hand.wgsl").length).toBe(1);
    const code = compose(program).code;
    expect(code).toContain("hand_ink(note_hand_runs, note_hand_atlas, note_hand_samp");
    expect(code).toContain("hand_ink(pad_hand_runs, pad_hand_atlas, pad_hand_samp");
    expect([...code.matchAll(/^fn hand_ink\(/gm)].length).toBe(1);
  });

  it("names the pen's three bindings under the kind's own prefix, with their layouts", () => {
    const [runs, atlas, samp] = handBindings("pad");
    expect([runs.wgsl, atlas.wgsl, samp.wgsl]).toEqual(["var pad_hand_runs: texture_2d<f32>", "var pad_hand_atlas: texture_2d<f32>", "var pad_hand_samp: sampler"]);
    expect([runs.entry, atlas.entry, samp.entry]).toEqual([HAND_BINDINGS.runs, HAND_BINDINGS.atlas, HAND_BINDINGS.sampler]);
    expect(HAND_BINDINGS.runs).toEqual({ stages: ["fragment"], texture: "unfilterable-float" });
    expect(() => handBindings("9lives")).toThrow(/no WGSL name/);
  });
});
