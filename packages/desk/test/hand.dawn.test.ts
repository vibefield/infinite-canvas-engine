// @vitest-environment node
// THE PEN ON DAWN (petition I59 — `pnpm dawn`, never CI's `test`): the kit's `hand` WGSL piece (shaders/kit/hand.wgsl) drawn on a
// real device — Dawn in Node, the `webgpu` package — over a run written into a kind's run store and a face's atlas made by the kit,
// every pixel's `hand_ink` read back from an `rgba32float` target and held to the CPU twin's (`handInkAt`, the same arithmetic):
//  1. a dense sheet at a crisp zoom: the coverage within a stated tolerance, the same pen, the same atlas samples and run loads at
//     (nearly) every pixel — and every pixel of an empty cell, or outside the grid's box, read NO atlas texel;
//  2. the pen mid-writing (glyphs in flight at their moments): the reveal and the wet ink, GPU against twin;
//  3. minified (a coarser mip at the LOD the device px asks): GPU against twin;
//  4. MEASURED: the per-fragment atlas samples and run loads on the dense sheet, where there is ink and over the whole box.
// The face is the tests' own (./hand-fixture — round-nibbed strokes whose distance and arrival are exact).
// Run with pnpm --filter @ice/desk dawn test/hand.dawn.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { createCardShared } from "../src/card/card";
import { acquire } from "../src/engine/device";
import { bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../src/engine/pipeline";
import { compile, compose } from "../src/engine/shader";
import { readback, Target, beginPass } from "../src/engine/target";
import { type HandAtlas, handMetricsOf, readHandAtlas } from "../src/kit/hand-atlas";
import { createHandRuns, HAND_BINDINGS, type HandRuns, handAtlasGpu, handSampler } from "../src/kit/hand-gpu";
import { HAND_RUN, type HandRun, handInkAt, handRun, penNow } from "../src/kit/hand-run";
import type { PenMoment } from "../src/kit/pen-clock";
import { HAND, type HandLayout, layoutText } from "../src/kit/text";
import { kitWgsl } from "../src/kit/wgsl";
import { fixtureFace, penProgram } from "./hand-fixture";

/** The probe's entry: each pixel's centre is a point of the run's units; mode 0 reads cover, wet, pen, samples; mode 1 the loads. */
const ENTRY = `
struct Probe { base: u32, mode: u32, aa: f32, scale: f32, origin: vec2f, now: vec2f }
@group(0) @binding(0) var<uniform> probe: Probe;
@group(0) @binding(1) var runs: texture_2d<f32>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let p = probe.origin + frag.xy * probe.scale;
  let ink = hand_ink(runs, atlas, samp, probe.base, p, probe.now, probe.aa);
  if (probe.mode == 1u) { return vec4f(f32(ink.loads), f32(ink.samples), 0.0, 1.0); }
  return vec4f(ink.cover, ink.wet, f32(ink.pen), f32(ink.samples));
}`;

const face = fixtureFace();
const metrics = handMetricsOf(face.atlas);
const W = 360;
const H = 240;

let device: GPUDevice;
let pipeline: GPURenderPipeline;
let layout: GPUBindGroupLayout;
let runs: HandRuns;

beforeAll(async () => {
  Object.assign(globalThis, globals);
  device = (await acquire({ gpu: create([]), label: "desk dawn: hand" })).device;
  layout = bindLayout(device, [
    { binding: 0, stages: ["fragment"], buffer: "uniform" },
    { binding: 1, ...HAND_BINDINGS.runs },
    { binding: 2, ...HAND_BINDINGS.atlas },
    { binding: 3, ...HAND_BINDINGS.sampler },
  ], "hand probe");
  const module = await compile(device, compose(kitWgsl(["hand"], { entry: { label: "hand probe", text: ENTRY } })));
  pipeline = await renderPipeline(device, { label: "hand probe", layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), module, format: "rgba32float" });
  runs = createHandRuns(device, { label: "dawn/hand runs" });
});
afterAll(() => { runs?.dispose(); device?.destroy(); });

interface Frame { readonly cover: Float32Array; readonly wet: Float32Array; readonly pen: Float32Array; readonly samples: Float32Array; readonly loads: Float32Array }

/** Every pixel of a `W × H` view whose top-left is `origin` (the run's units), `scale` units a px, read by `hand_ink` on the GPU. */
async function draw(run: HandRun, key: number, view: { readonly origin: readonly [number, number]; readonly scale: number }, now: number, atlas: HandAtlas = face.atlas): Promise<Frame> {
  const base = runs.write(key, run);
  const gpu = handAtlasGpu(device, atlas);
  const out: Float32Array[] = [];
  for (const mode of [0, 1]) {
    const u = new ArrayBuffer(32);
    new Uint32Array(u, 0, 2).set([base, mode]);
    new Float32Array(u, 8, 6).set([view.scale, view.scale, view.origin[0], view.origin[1], ...penNow(now)]);
    const buf = uniformBuffer(device, 32, "hand probe");
    device.queue.writeBuffer(buf, 0, u);
    const target = new Target(device, { format: "rgba32float", readable: true }, W, H);
    try {
      const encoder = device.createCommandEncoder();
      const pass = beginPass(encoder, target.view, [0, 0, 0, 0]);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(device, layout, [buf, runs.view, gpu.view, handSampler(device)], "hand probe"));
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      const bytes = await readback(device, target.texture, 16);
      out.push(new Float32Array(bytes.buffer, bytes.byteOffset, W * H * 4));
    } finally {
      target.dispose();
      buf.destroy();
    }
  }
  const [a, b] = out as [Float32Array, Float32Array];
  const lane = (src: Float32Array, k: number): Float32Array => Float32Array.from({ length: W * H }, (_, i) => src[i * 4 + k] as number);
  return { cover: lane(a, 0), wet: lane(a, 1), pen: lane(a, 2), samples: lane(a, 3), loads: lane(b, 0) };
}

/** The GPU's frame against the twin's, pixel by pixel: the most each lane differs, and how many pixels disagree on the counts. */
function compare(gpu: Frame, run: HandRun, view: { readonly origin: readonly [number, number]; readonly scale: number }, now: number, atlas: HandAtlas = face.atlas) {
  let cover = 0;
  let wet = 0;
  let pens = 0;
  let counts = 0;
  let inked = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = handInkAt(run, atlas, view.origin[0] + (x + 0.5) * view.scale, view.origin[1] + (y + 0.5) * view.scale, now, view.scale);
      cover = Math.max(cover, Math.abs(t.cover - (gpu.cover[i] as number)));
      // the pen and the wet are the ink's: compared where there is some (a kind weighs the wet by the coverage)
      if (t.cover > 0.05) { inked += 1; if (t.pen !== gpu.pen[i]) pens += 1; wet = Math.max(wet, Math.abs(t.wet - (gpu.wet[i] as number))); }
      if (t.samples !== gpu.samples[i] || t.loads !== gpu.loads[i]) counts += 1;
    }
  }
  return { cover, wet, pens, counts, inked };
}

/** A sheet of the fixture's letters, laid by the desk's own hand (its jitter, its wander) in a 260 × 180 box. */
const TEXT = "lol xo. lox ool\nlx. xx lo ox lol\nxol lo. oxo ll\nlox ox. lol xo\nool lx xo. lo";
const sheet = (): HandLayout => layoutText(TEXT, { w: 260, h: 180 }, HAND, metrics, 11);
const pens = (L: HandLayout): number[] => L.glyphs.map((_, j) => (j % 3) + 1);

/** The coverage tolerance: Dawn's filtering weights and f32 against the twin's f64 (said in the hand-off with what was measured). */
const TOLERANCE = 0.03;

describe("hand_ink on Dawn against its CPU twin (petition I59)", () => {
  it("a dense sheet at a crisp zoom: the same coverage within the tolerance, the same pen and counts; an empty cell reads no atlas texel", async () => {
    const L = sheet();
    const run = handRun(L, face.atlas, { pens: pens(L) });
    const view = { origin: [-20, -10] as const, scale: 0.8 };
    const gpu = await draw(run, 1, view, 0);
    const d = compare(gpu, run, view, 0);
    console.log(`[hand.dawn] crisp: cover max |GPU − twin| ${d.cover.toFixed(4)}, wet ${d.wet.toFixed(4)}; pen differs at ${d.pens} of ${d.inked} inked px; counts differ at ${d.counts} of ${W * H} px`);
    expect(d.cover).toBeLessThan(TOLERANCE);
    expect(d.inked).toBeGreaterThan(2000);
    expect(d.pens / d.inked).toBeLessThan(0.01);
    expect(d.counts / (W * H)).toBeLessThan(0.01);
    // blank paper: every pixel in an empty cell, or outside the grid's box, took NO atlas sample and laid no ink — in one load (outside)
    // or three (the box, the grid, the cell); a pixel on a cell's edge may fall in its neighbour on the GPU's f32 (more loads, still no
    // sample: the slack keeps every glyph's box inside the cells that list it)
    const { x0, y0, cell, cols, rows } = run.grid;
    let blank = 0;
    let other = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = view.origin[0] + (x + 0.5) * view.scale;
        const py = view.origin[1] + (y + 0.5) * view.scale;
        const i = y * W + x;
        const outside = px < x0 || py < y0 || px >= run.grid.x1 || py >= run.grid.y1;
        const c = Math.min(Math.floor((py - y0) / cell), rows - 1) * cols + Math.min(Math.floor((px - x0) / cell), cols - 1);
        const empty = !outside && run.data[4 * (HAND_RUN.header + (c >> 1)) + (c & 1) * 2 + 1] === 0;
        if (!outside && !empty) continue;
        blank += 1;
        expect(gpu.samples[i], `px ${x},${y}`).toBe(0);
        expect(gpu.cover[i], `px ${x},${y}`).toBe(0);
        if (gpu.loads[i] !== (outside ? 1 : 3)) other += 1;
      }
    }
    console.log(`[hand.dawn] blank paper: ${blank} px in an empty cell or outside the box — every one 0 atlas samples; ${other} on a cell's edge loaded otherwise`);
    expect(blank).toBeGreaterThan(5000);
    expect(other / blank).toBeLessThan(0.01);
  });

  it("the pen mid-writing: each glyph at its own moment — the reveal and the wet ink, GPU against twin", async () => {
    const L = sheet();
    const T = 100_000;
    // the glyphs written one after another from T, 120 ms each, a new one every 60 ms: the frame at T + 600 catches ten in flight
    const moments: PenMoment[] = L.glyphs.map((_, j) => ({ start: T + 60 * j, dur: 120 }));
    const run = handRun(L, face.atlas, { moments, epoch: T - 5 });
    const view = { origin: [-20, -10] as const, scale: 0.8 };
    for (const now of [T + 300, T + 640, T + 1910]) {
      const gpu = await draw(run, 2, view, now);
      const d = compare(gpu, run, view, now);
      console.log(`[hand.dawn] writing at +${now - T} ms: cover max |GPU − twin| ${d.cover.toFixed(4)}, wet ${d.wet.toFixed(4)}; counts differ at ${d.counts} px`);
      expect(d.cover).toBeLessThan(TOLERANCE);
      expect(d.wet).toBeLessThan(TOLERANCE);
      expect(d.counts / (W * H)).toBeLessThan(0.01);
      // while glyphs are in flight some ink is wet; once all are whole, none is
      const wettest = gpu.wet.reduce((m, v) => Math.max(m, v), 0);
      if (now < T + 60 * L.glyphs.length + 120) expect(wettest).toBeGreaterThan(0.3);
      else expect(wettest).toBe(0);
    }
  });

  it("minified — a coarser level at the LOD the device px asks: GPU against twin", async () => {
    const L = sheet();
    const run = handRun(L, face.atlas);
    const view = { origin: [-40, -40] as const, scale: 4 };   // 4 units a px: 32/24 × 4 ≈ 5.3 texels a px, level ≈ 2.4
    const gpu = await draw(run, 3, view, 0);
    const d = compare(gpu, run, view, 0);
    console.log(`[hand.dawn] minified ×1/4: cover max |GPU − twin| ${d.cover.toFixed(4)}; counts differ at ${d.counts} px; ${d.inked} inked px`);
    expect(d.cover).toBeLessThan(TOLERANCE);
    expect(d.inked).toBeGreaterThan(100);
  });

  it("two kinds that write with the pen compile into ONE flat-card program on the device, neither left out", async () => {
    const card = await createCardShared(device, "rgba8unorm", [penProgram("note"), penProgram("pad")]);
    expect(card?.kinds).toEqual(["note", "pad"]);
    expect(card?.left).toEqual([]);
  });

  it("measures the per-fragment reads on a dense sheet: atlas samples and run loads, where there is ink and over the writing's box", async () => {
    const L = sheet();
    const run = handRun(L, face.atlas);
    const view = { origin: [run.grid.x0, run.grid.y0] as const, scale: 0.75 };
    const m = reads(await draw(run, 4, view, 0), run, view);
    console.log(`[hand.dawn] the fixture's dense sheet (${L.glyphs.length} glyphs): ${m.said}`);
    expect(m.inkSamples).toBeLessThanOrEqual(4);
    expect(m.inkSamples).toBeGreaterThanOrEqual(1);
    expect(m.most).toBeLessThanOrEqual(8);
  });
});

/** What a frame's fragments read: where there is ink (cover > 0.05) and over the writing's box — atlas samples and run loads. */
function reads(gpu: Frame, run: HandRun, view: { readonly origin: readonly [number, number]; readonly scale: number }) {
  let inked = 0;
  let inkS = 0;
  let inkL = 0;
  let most = 0;
  let boxed = 0;
  let boxS = 0;
  let boxL = 0;
  let none = 0;
  for (let i = 0; i < W * H; i++) {
    const px = view.origin[0] + ((i % W) + 0.5) * view.scale;
    const py = view.origin[1] + (Math.floor(i / W) + 0.5) * view.scale;
    if (px < run.grid.x0 || py < run.grid.y0 || px >= run.grid.x1 || py >= run.grid.y1) continue;
    boxed += 1;
    boxS += gpu.samples[i] as number;
    boxL += gpu.loads[i] as number;
    if (gpu.samples[i] === 0) none += 1;
    if ((gpu.cover[i] as number) > 0.05) { inked += 1; inkS += gpu.samples[i] as number; inkL += gpu.loads[i] as number; most = Math.max(most, gpu.samples[i] as number); }
  }
  const g = run.grid;
  return {
    inkSamples: inkS / inked, most,
    said: `cells ${g.cols}×${g.rows} (${(g.entries / (g.cols * g.rows)).toFixed(2)} listed a cell); where there is ink ${(inkS / inked).toFixed(2)} atlas samples a fragment (most ${most}) and ${(inkL / inked).toFixed(1)} run loads; over the box ${(boxS / boxed).toFixed(2)} samples and ${(boxL / boxed).toFixed(1)} loads, ${((100 * none) / boxed).toFixed(0)}% of its fragments sampling nothing`,
  };
}

describe("hand_ink on Dawn over the desk's own face: Caveat 500, as baked (apps/desk/assets/hand)", () => {
  const dir = resolve(import.meta.dirname, "../../../apps/desk/assets/hand");
  const read = readHandAtlas(JSON.parse(readFileSync(resolve(dir, "caveat-500.hand.json"), "utf8")), new Uint8Array(readFileSync(resolve(dir, "caveat-500.hand.bin"))));
  if ("error" in read) throw new Error(read.error);
  const caveat = read;
  const text = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! Sphinx of black quartz, judge my vow.";
  const L = layoutText(text, { w: 260, h: 220 }, HAND, handMetricsOf(caveat), 3);

  it("a dense sheet of real letters: GPU against twin — the coverage, the pen, the counts — and its reads measured", async () => {
    const run = handRun(L, caveat, { pens: pens(L) });
    expect(run.missing).toEqual([]);
    const crisp = { origin: [run.grid.x0, run.grid.y0] as const, scale: 0.75 };
    const gpu = await draw(run, 5, crisp, 0, caveat);
    const d = compare(gpu, run, crisp, 0, caveat);
    const m = reads(gpu, run, crisp);
    console.log(`[hand.dawn] Caveat 500 (${L.glyphs.length} glyphs): cover max |GPU − twin| ${d.cover.toFixed(4)}; pen differs at ${d.pens} of ${d.inked} inked px; counts differ at ${d.counts} px — ${m.said}`);
    expect(d.cover).toBeLessThan(TOLERANCE);
    expect(d.pens / d.inked).toBeLessThan(0.01);
    expect(d.counts / (W * H)).toBeLessThan(0.01);
    expect(m.inkSamples).toBeLessThanOrEqual(4);
    // …and minified ×1/3, a coarser level
    const far = { origin: [run.grid.x0 - 20, run.grid.y0 - 20] as const, scale: 3 };
    const fd = compare(await draw(run, 5, far, 0, caveat), run, far, 0, caveat);
    console.log(`[hand.dawn] Caveat 500 minified ×1/3: cover max |GPU − twin| ${fd.cover.toFixed(4)}; counts differ at ${fd.counts} px`);
    expect(fd.cover).toBeLessThan(TOLERANCE);
  });
});
