// @vitest-environment node
// THE MARKS ON DAWN (petition I60 — `pnpm dawn`, never CI's `test`): the kit's `marks` WGSL piece (shaders/kit/marks.wgsl —
// `ink_marks`) and the pen's re-ink (`hand_ink`'s `was` and `over`) drawn on a real device — Dawn in Node, the `webgpu` package —
// over a run built from an ink and written into a kind's run store: a sheet with a highlight, a strike, an underline, a re-inked
// word and the selection's wash, every pixel read back from an `rgba32float` target and held to the CPU twins (`inkMarksAt`,
// `handInkAt` — the same arithmetic):
//  1. at rest, every mark on the paper: the covers within P2's tolerance, the same highlighter and pen, the same loads;
//  2. the marks being made, driven by the pen's clock: strokes pulled through, a recolour, the re-ink's front — GPU against twin;
//  3. the wash rewritten alone in the store (`HandRuns.wash`), the run untouched: GPU against the twin's copy;
//  4. blank paper reads nothing: a run without an ink and an unmarked sheet — one load at every pixel, nothing laid;
//  5. MEASURED: the run texels the marks cost a fragment, where there are marks and over the sheet.
// The face is the tests' own (./hand-fixture). Run with pnpm --filter @ice/desk dawn test/marks.dawn.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { acquire } from "../src/engine/device";
import { bindGroup, bindLayout, renderPipeline, uniformBuffer } from "../src/engine/pipeline";
import { compile, compose } from "../src/engine/shader";
import { beginPass, readback, Target } from "../src/engine/target";
import { handMetricsOf } from "../src/kit/hand-atlas";
import { createHandRuns, HAND_BINDINGS, type HandRuns, handAtlasGpu, handSampler } from "../src/kit/hand-gpu";
import { type HandRun, handInkAt, handRun, penNow } from "../src/kit/hand-run";
import { findQuote, type InkValue, inkOf, mark, spansOf, strokesOf } from "../src/kit/ink";
import { inkMarksAt, inkWash, washRun } from "../src/kit/ink-marks";
import { createPenClock, type PenMarks } from "../src/kit/pen-clock";
import { HAND, type HandLayout, layoutText } from "../src/kit/text";
import { kitWgsl } from "../src/kit/wgsl";
import { fixtureFace } from "./hand-fixture";

/** The probe: each pixel's centre a point of the run's units; mode 0 the marks under the ink, 1 the lines over it and the ink, 2 the re-ink. */
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
  let mk = ink_marks(runs, probe.base, p, probe.now, probe.aa);
  if (probe.mode == 0u) { return vec4f(mk.marker, f32(mk.tint), mk.wash, f32(mk.loads)); }
  if (probe.mode == 1u) { return vec4f(mk.line, f32(mk.pen), ink.cover, f32(ink.pen)); }
  return vec4f(f32(ink.was), ink.over, f32(ink.loads), 0.0);
}`;

const face = fixtureFace();
const metrics = handMetricsOf(face.atlas);
const W = 360;
const H = 240;
/** P2's tolerance: Dawn's filtering weights and f32 against the twin's f64. */
const TOLERANCE = 0.03;

let device: GPUDevice;
let pipeline: GPURenderPipeline;
let layout: GPUBindGroupLayout;
let runs: HandRuns;

beforeAll(async () => {
  Object.assign(globalThis, globals);
  device = (await acquire({ gpu: create([]), label: "desk dawn: marks" })).device;
  layout = bindLayout(device, [
    { binding: 0, stages: ["fragment"], buffer: "uniform" },
    { binding: 1, ...HAND_BINDINGS.runs },
    { binding: 2, ...HAND_BINDINGS.atlas },
    { binding: 3, ...HAND_BINDINGS.sampler },
  ], "marks probe");
  const module = await compile(device, compose(kitWgsl(["marks"], { entry: { label: "marks probe", text: ENTRY } })));
  pipeline = await renderPipeline(device, { label: "marks probe", layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), module, format: "rgba32float" });
  runs = createHandRuns(device, { label: "dawn/marks runs" });
});
afterAll(() => { runs?.dispose(); device?.destroy(); });

interface View { readonly origin: readonly [number, number]; readonly scale: number }
interface Frame { readonly lanes: readonly Float32Array[] }

/** Every pixel of a `W × H` view whose top-left is `origin` (the run's units), `scale` units a px, as the store holds `key`'s run now. */
async function draw(key: string, view: View, now: number): Promise<Frame> {
  const base = runs.baseOf(key);
  const gpu = handAtlasGpu(device, face.atlas);
  const out: Float32Array[] = [];
  for (const mode of [0, 1, 2]) {
    const u = new ArrayBuffer(32);
    new Uint32Array(u, 0, 2).set([base, mode]);
    new Float32Array(u, 8, 6).set([view.scale, view.scale, view.origin[0], view.origin[1], ...penNow(now)]);
    const buf = uniformBuffer(device, 32, "marks probe");
    device.queue.writeBuffer(buf, 0, u);
    const target = new Target(device, { format: "rgba32float", readable: true }, W, H);
    try {
      const encoder = device.createCommandEncoder();
      const pass = beginPass(encoder, target.view, [0, 0, 0, 0]);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup(device, layout, [buf, runs.view, gpu.view, handSampler(device)], "marks probe"));
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      const bytes = await readback(device, target.texture, 16);
      out.push(new Float32Array(bytes.buffer, bytes.byteOffset, W * H * 4).slice());
    } finally {
      target.dispose();
      buf.destroy();
    }
  }
  return { lanes: out };
}

const lane = (f: Frame, mode: number, k: number, i: number): number => (f.lanes[mode] as Float32Array)[i * 4 + k] as number;

/**
 * The GPU's frame against the twins', pixel by pixel: the most each cover differs, how many pixels disagree on a value or a count,
 * and how many on the re-ink's `over` past the tolerance — `seams`: where the arrival field jumps between two texels (a ring's
 * closing point, a later stroke's edge over an earlier one), Dawn's bilinear weights move the field by a fraction of a byte from
 * the twin's exact ones, and the new pen's front, as steep as the glyph's path is long in device px, by a fraction of a px.
 */
function compare(gpu: Frame, run: HandRun, view: View, now: number) {
  const d = { marker: 0, wash: 0, line: 0, over: 0, seams: 0, values: 0, counts: 0, marked: 0, inked: 0, reinked: 0 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const px = view.origin[0] + (x + 0.5) * view.scale;
      const py = view.origin[1] + (y + 0.5) * view.scale;
      const m = inkMarksAt(run, px, py, now, view.scale);
      const h = handInkAt(run, face.atlas, px, py, now, view.scale);
      d.marker = Math.max(d.marker, Math.abs(m.marker - lane(gpu, 0, 0, i)));
      d.wash = Math.max(d.wash, Math.abs(m.wash - lane(gpu, 0, 2, i)));
      d.line = Math.max(d.line, Math.abs(m.line - lane(gpu, 1, 0, i)));
      if (m.marker > 0.05 && m.tint !== lane(gpu, 0, 1, i)) d.values += 1;
      if (m.line > 0.05 && m.pen !== lane(gpu, 1, 1, i)) d.values += 1;
      if (m.marker > 0.05 || m.line > 0.05 || m.wash > 0.05) d.marked += 1;
      if (m.loads !== lane(gpu, 0, 3, i) || h.loads !== lane(gpu, 2, 2, i)) d.counts += 1;
      if (h.cover > 0.05) {
        d.inked += 1;
        if (h.pen !== lane(gpu, 1, 3, i) || h.was !== lane(gpu, 2, 0, i)) d.values += 1;
        d.over = Math.max(d.over, Math.abs(h.over - lane(gpu, 2, 1, i)));
        if (Math.abs(h.over - lane(gpu, 2, 1, i)) > TOLERANCE) d.seams += 1;
        if (h.over > 0.05 && h.over < 0.95) d.reinked += 1;
      }
    }
  }
  return d;
}

/** The dawn sheet: four lines of the fixture's letters; a highlight, a strike in red, an underline in the words' own pen, a word in red. */
const TEXT = "lol xo. lox ool\nlx. xx lo ox lol\nxol lo. oxo ll\nlox ox. lol xo";
const lay = (ink: InkValue): HandLayout => layoutText(ink.text, { w: 260, h: 180 }, HAND, metrics, 11, ink.seeds);
function quote(ink: InkValue, q: string): readonly [number, number] {
  const r = findQuote(ink.text, q);
  if ("error" in r) throw new Error(`no "${q}"`);
  return [r.from, r.to];
}
function marked(ink: InkValue): InkValue {
  let out = mark(ink, ...quote(ink, "xo. lox"), { highlight: "yellow" });
  out = mark(out, ...quote(out, "lx. xx"), { strike: "red" });
  out = mark(out, ...quote(out, "lo ox"), { underline: true });
  out = mark(out, ...quote(out, "oxo ll"), { pen: "red" });
  return out;
}
const plain = inkOf({ text: TEXT }, 11);
const crisp: View = { origin: [-20, -10], scale: 0.8 };
const near: View = { origin: [10, 8], scale: 0.4 };

describe("ink_marks and the re-ink on Dawn against their CPU twins (petition I60)", () => {
  it("at rest — a highlight, a strike, an underline, a red word and a wash: the same covers within the tolerance, the same values and loads", async () => {
    const ink = marked(plain);
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink, wash: spansOf(L, ...quote(ink, "lox ool\nlx.")) });
    runs.write("rest", run);
    for (const view of [crisp, near]) {
      const d = compare(await draw("rest", view, 0), run, view, 0);
      console.log(`[marks.dawn] at rest ×${(1 / view.scale).toFixed(2)}: marker |Δ| ${d.marker.toFixed(4)}, wash ${d.wash.toFixed(4)}, line ${d.line.toFixed(4)}; values differ at ${d.values} px, counts at ${d.counts} of ${W * H}; ${d.marked} px marked, ${d.inked} inked`);
      expect(Math.max(d.marker, d.wash, d.line)).toBeLessThan(TOLERANCE);
      expect(d.marked).toBeGreaterThan(1500);
      expect(d.values / (d.marked + d.inked)).toBeLessThan(0.01);
      expect(d.counts / (W * H)).toBeLessThan(0.01);
    }
  });

  it("the marks being made, as the pen's clock draws them: strokes pulled through, a recolour, the re-ink's front — GPU against twin", async () => {
    const clock = createPenClock();
    const T = 200_000;
    const look = (ink: InkValue, now: number): { L: HandLayout; m: PenMarks } => {
      const L = lay(ink);
      clock.look("made", { layout: L, seeds: ink.seeds, atlas: face.atlas, now, how: "typed" });
      return { L, m: clock.marks("made", { layout: L, ink, strokes: strokesOf(L, ink), atlas: face.atlas, now }) };
    };
    look(mark(plain, ...quote(plain, "xo. lox"), { highlight: "green" }), T - 5000);   // a desk opening: all on the paper
    const ink = marked(plain);
    const { L, m } = look(ink, T);
    expect(m.strokes.every((s) => s.start >= T)).toBe(true);
    expect(m.strokes[0]?.was).toBe(2);   // green (HIGHLIGHTERS[1]), recoloured yellow
    const run = handRun(L, face.atlas, { ink, marked: m, epoch: T });
    runs.write("made", run);
    let reinked = 0;
    for (const now of [T + 60, T + 180, T + 900]) {
      const d = compare(await draw("made", crisp, now), run, crisp, now);
      reinked += d.reinked;
      console.log(`[marks.dawn] made, at +${now - T} ms: marker |Δ| ${d.marker.toFixed(4)}, line ${d.line.toFixed(4)}, re-ink over ${d.over.toFixed(4)} (past ${TOLERANCE} at ${d.seams} of ${d.inked} inked px — the arrival's seams); values differ at ${d.values} px, counts at ${d.counts}; ${d.reinked} px mid re-ink`);
      expect(Math.max(d.marker, d.line)).toBeLessThan(TOLERANCE);
      expect(d.seams / d.inked).toBeLessThan(0.002);
      expect(d.over).toBeLessThan(0.25);
      expect(d.values / (d.marked + d.inked)).toBeLessThan(0.01);
      expect(d.counts / (W * H)).toBeLessThan(0.01);
    }
    expect(reinked).toBeGreaterThan(10);
  });

  it("the wash rewritten alone in the store — the head and the lines, the run untouched: GPU against the twin's copy", async () => {
    const ink = marked(plain);
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink });
    runs.write("washed", run);
    const before = runs.stats().bytes;
    const w = inkWash(run, spansOf(L, ...quote(ink, "ool\nlx. xx lo")));
    expect(runs.wash("washed", w)).toBe(true);
    const wrote = runs.stats().bytes - before;
    expect(wrote).toBe(16 * (1 + L.lines.length));
    const d = compare(await draw("washed", crisp, 0), washRun(run, w), crisp, 0);
    console.log(`[marks.dawn] the wash rewritten alone (${wrote} bytes of a ${16 * run.length}-byte run): wash |Δ| ${d.wash.toFixed(4)}; counts differ at ${d.counts} px`);
    expect(d.wash).toBeLessThan(TOLERANCE);
    expect(d.counts / (W * H)).toBeLessThan(0.01);
  });

  it("blank paper reads nothing: a run without an ink, and a sheet unmarked and unselected — one load at every pixel, nothing laid", async () => {
    const L = lay(plain);
    runs.write("bare", handRun(L, face.atlas));
    runs.write("unmarked", handRun(L, face.atlas, { ink: plain }));
    for (const key of ["bare", "unmarked"]) {
      const f = await draw(key, crisp, 0);
      let other = 0;
      for (let i = 0; i < W * H; i++) {
        if (lane(f, 0, 3, i) !== 1) other += 1;
        expect(lane(f, 0, 0, i) + lane(f, 0, 2, i) + lane(f, 1, 0, i)).toBe(0);
      }
      console.log(`[marks.dawn] ${key}: ${W * H - other} of ${W * H} px read the marks in one load`);
      expect(other).toBe(0);
    }
  });

  it("measures what the marks cost a fragment: run loads where marks lie and over the sheet", async () => {
    const ink = marked(plain);
    const L = lay(ink);
    const run = handRun(L, face.atlas, { ink, wash: spansOf(L, ...quote(ink, "lox ool\nlx.")) });
    runs.write("cost", run);
    const view: View = { origin: [0, 0], scale: 0.75 };
    const f = await draw("cost", view, 0);
    let px = 0;
    let pxLoads = 0;
    let most = 0;
    let all = 0;
    let one = 0;
    for (let i = 0; i < W * H; i++) {
      const loads = lane(f, 0, 3, i);
      all += loads;
      if (loads === 1) one += 1;
      if (lane(f, 0, 0, i) > 0.05 || lane(f, 0, 2, i) > 0.05 || lane(f, 1, 0, i) > 0.05) { px += 1; pxLoads += loads; most = Math.max(most, loads); }
    }
    console.log(`[marks.dawn] the dawn sheet (${(run.marks as NonNullable<HandRun["marks"]>).strokes} strokes, ${L.lines.length} lines, a wash over two): where there are marks ${(pxLoads / px).toFixed(1)} run loads a fragment (most ${most}); over the view ${(all / (W * H)).toFixed(2)}, ${((100 * one) / (W * H)).toFixed(0)}% of it in one load`);
    expect(px).toBeGreaterThan(1000);
    expect(pxLoads / px).toBeLessThan(16);
  });
});
