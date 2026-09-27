// @vitest-environment node
// THE GPU PROFILER (design-016 §4.3–4.5, K2; K-L5): one report per frame — the span (first begin → last end) as the headline,
// the sum of passes beside it, the counts from the calls themselves (draws, pipelines, bind groups, passes, submits, writes,
// upload bytes), the CPU's encode and flush, the ledger's memory — rolling p50/p95/max over drawn frames, and a trace-event
// capture. UNARMED it installs nothing; ARMED it adds no submit and schedules nothing. Driven on the GPU simulator.
import { createCanvasEngine } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import type { GpuMemory } from "../src/gpu-memory";
import { createGpuProfiler, type GpuFrameReport, rolling, spanOf, type TraceEvent } from "../src/gpu-profiler";
import { deskLayer } from "../src/host/layer";
import { deskPalette, deskTheme } from "../src/objects/palette";
import { instrumentSubmits, type SubmitInstrument } from "../src/submit-instrument";
import { fakePage } from "./fake-page";
import { frame, settle, simGpu } from "./sim-gpu";

/** The submit instrument as a host lends it: held while armed, detached at the last release. */
function lend(device: GPUDevice) {
  let s: SubmitInstrument | undefined;
  let holds = 0;
  return { hold: () => { holds += 1; s ??= instrumentSubmits(device); return s; }, release: () => { holds -= 1; if (holds === 0) { s?.detach(); s = undefined; } } };
}
const MEMORY: GpuMemory = { byLabel: { paper: { bytes: 64, textures: 0, buffers: 1 } }, textures: 0, buffers: 64, total: 64, made: 1, destroyed: 0, collected: 0, guessed: 0 };

describe("the GPU profiler (K2)", () => {
  it("unarmed it installs nothing and its boundary returns at once; the first arm installs, the last release takes everything off", async () => {
    const g = simGpu();
    const own = g.raw.createCommandEncoder;
    const p = createGpuProfiler({ device: g.device, submits: lend(g.device) });
    expect([p.supported, p.armed()]).toEqual([true, false]);
    expect(g.made).toEqual([]);   // no query set, no buffer
    expect(g.raw.createCommandEncoder).toBe(own);
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(false);
    p.flushed(3);   // unarmed: nothing
    frame(g.device, [["ground", ["ground"]]]);
    await settle();
    expect(p.take()).toEqual([]);
    const a = p.arm();
    const b = p.arm();
    expect(p.armed()).toBe(true);
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(true);
    a();
    a();   // a release is idempotent
    expect(p.armed()).toBe(true);   // still held by b
    b();
    expect(p.armed()).toBe(false);
    expect(g.raw.createCommandEncoder).toBe(own);
    expect(Object.hasOwn(g.raw.queue, "submit") || Object.hasOwn(g.raw.queue, "writeBuffer")).toBe(false);
    await settle();
  });

  it("a frame's report: the SPAN is the headline (the sum beside it, larger — the passes overlap), the counts from the calls, encode and flush, memory", async () => {
    const g = simGpu();
    const p = createGpuProfiler({ device: g.device, submits: lend(g.device), ledger: () => ({ read: () => MEMORY, top: () => [], detach: () => {} }) });
    const off = p.arm();
    const submitsBefore = g.submits.length;
    g.device.queue.writeBuffer({ label: "paper/notes" } as GPUBuffer, 0, new Float32Array(4));
    frame(g.device, [["notebook", ["notebook/shadow 0", "notebook/layer"]], ["ground", ["mat/wind", "ground"]]]);
    p.flushed(1.5);
    expect(g.submits.length - submitsBefore).toBe(2);   // the frame's own two: the profiler added none
    await settle();
    const [r] = p.take() as [GpuFrameReport];
    expect(p.take()).toEqual([]);   // drained
    expect(r.kind).toBe("frame");
    expect(r.timing).toBe("timed");
    expect(r.passes.map((x) => x.label)).toEqual(["notebook/shadow 0", "notebook/layer", "mat/wind", "ground"]);
    expect(r.span).toBeCloseTo(1.15, 9);   // 0 → 1.15 ms: four 0.4 ms passes, each overlapping the next by 0.15
    expect(r.sum).toBeCloseTo(1.6, 9);
    expect(r.span as number).toBeLessThan(r.sum as number);
    expect(r.counts).toMatchObject({ passes: 4, timed: 4, draws: 4, instances: 12, pipelines: 4, submits: 2, writes: 1, uploadBytes: 16, externals: 0 });
    expect(r.byKind).toEqual({ notebook: { draws: 2, instances: 6 }, mat: { draws: 1, instances: 3 }, ground: { draws: 1, instances: 3 } });
    expect(r.uploads).toEqual({ paper: { writes: 1, bytes: 16 } });
    expect(r.cpu.flush).toBe(1.5);
    expect(r.cpu.encode).toBeGreaterThanOrEqual(0);
    expect(r.memory).toEqual(MEMORY);
    expect(r.quantised).toBe(false);
    off();
    await settle();
  });

  it("rolling p50 / p95 / max over DRAWN frames; loose work is reported but never enters the window; a tool's frame gets no flush ms", async () => {
    const g = simGpu({ pass: 400_123n });
    const p = createGpuProfiler({ device: g.device, submits: lend(g.device) });
    const off = p.arm();
    const shapes = [1, 2, 3, 1, 1, 2];   // timed passes a frame
    for (const n of shapes) {
      frame(g.device, [["ground", Array.from({ length: n }, (_, i) => `ground ${i}`)]]);
      p.flushed(2);
      await settle();   // one readback at a time
    }
    frame(g.device, [["board/replay", ["board/stamp"]]]);   // GPU work with no frame of its own
    p.flushed(0.5);
    frame(g.device, [["ground", ["ground"]]]);   // a tool's render outside any flush
    await settle();
    const reports = p.take();
    expect(reports.map((r) => r.kind)).toEqual(["frame", "frame", "frame", "frame", "frame", "frame", "loose", "frame"]);
    expect(reports.at(-1)?.cpu.flush).toBeNull();
    const st = p.stats();
    expect(st.frames).toBe(7);
    expect(st.span?.n).toBe(7);   // n passes, each starting 250 123 ns after the last: (n − 1) · 0.250123 + 0.400123 ms
    expect(st.span?.p50).toBeCloseTo(0.400123, 9);
    expect(st.span?.p95).toBeCloseTo(0.900369, 9);
    expect(st.span?.max).toBeCloseTo(0.900369, 9);
    expect(st.draws).toEqual({ n: 7, p50: 1, p95: 3, max: 3 });
    expect(st.flush).toEqual({ n: 6, p50: 2, p95: 2, max: 2 });
    expect(st.quantised).toBe(false);
    expect(st.unquantise).toBe("--disable-dawn-features=timestamp_quantization");
    off();
    await settle();
  });

  it("the quantisation flag: a device whose timestamps are 100 µs multiples raises it in the report and the stats", async () => {
    const g = simGpu({ pass: 300_000n, overlap: 100_000n });
    const p = createGpuProfiler({ device: g.device, submits: lend(g.device) });
    const off = p.arm();
    frame(g.device, [["ground", ["mat/wind", "ground"]]]);
    await settle();
    expect(p.last()?.quantised).toBe(true);
    expect(p.stats().quantised).toBe(true);
    off();
    await settle();
  });

  it("armed at rest it adds nothing: no submit, no frame; a readback landing after the disarm is dropped", async () => {
    const g = simGpu();
    const p = createGpuProfiler({ device: g.device, submits: lend(g.device) });
    const off = p.arm();
    for (let i = 0; i < 240; i++) p.flushed(0.01);   // 240 idle flushes
    await settle();
    expect([g.submits.length, p.take().length]).toEqual([0, 0]);
    frame(g.device, [["ground", ["ground"]]]);
    off();   // disarmed before its readback lands
    await settle();
    expect(p.take()).toEqual([]);
    expect(p.last()).toBeNull();
  });

  it("capture(n): a trace-event JSON — CPU spans, each GPU pass on a track of its own, the frame's span, counters — and performance.measure entries", async () => {
    const g = simGpu();
    const p = createGpuProfiler({ device: g.device, submits: lend(g.device) });
    const measure = vi.spyOn(performance, "measure");
    const done = p.capture(2, { timeoutMs: 1000 });
    expect(p.armed()).toBe(true);   // armed for as long as it takes
    for (let i = 0; i < 2; i++) { frame(g.device, [["ground", ["mat/wind", "ground"]]]); p.flushed(1); await settle(); }
    const trace = await done;
    expect(p.armed()).toBe(false);
    const ev = trace.traceEvents;
    const names = (pred: (e: TraceEvent) => boolean) => ev.filter(pred).map((e) => e.name);
    expect(names((e) => e.ph === "X" && e.pid === 1)).toEqual(["desk flush", "encode", "desk flush", "encode"]);
    expect(names((e) => e.ph === "X" && e.pid === 2)).toEqual(["frame 1", "mat/wind", "ground", "frame 2", "mat/wind", "ground"]);
    const tracks = new Map(ev.filter((e) => e.ph === "M" && e.name === "thread_name" && e.pid === 2).map((e) => [e.args?.name, e.tid]));
    expect([...tracks.keys()]).toEqual(["frame span", "mat/wind", "ground"]);   // overlapping passes never share a track
    expect(ev.filter((e) => e.name === "ground" && e.ph === "X").every((e) => e.tid === tracks.get("ground"))).toBe(true);
    expect(names((e) => e.ph === "C")).toEqual(["draws", "uploads", "draws", "uploads"]);
    const span = ev.find((e) => e.name === "frame 1");
    expect(span?.dur).toBe(650);   // µs
    expect(trace.displayTimeUnit).toBe("ms");
    expect(measure.mock.calls.map((c) => String(c[0]).replace(/ #\d+$/, ""))).toEqual(["desk flush", "encode", "desk flush", "encode"]);
    measure.mockRestore();
    // at rest a capture answers at its timeout with what came
    const idle = await p.capture(3, { timeoutMs: 20 });
    expect(idle.traceEvents.filter((e) => e.ph === "X")).toEqual([]);
    expect(idle.metadata.frames).toBe(0);
  });

  it("the layer's profiler: made on first ask, unarmed; arming holds the submit instrument, the last release takes it off — unless the rigs' door asked for it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const g = simGpu();
    const adapter = { features: new Set<string>(), info: { vendor: "sim", architecture: "", description: "" } };
    Object.assign(g.raw, { label: "", lost: new Promise<never>(() => {}), addEventListener: () => {}, destroy: () => {} });
    const ce = createCanvasEngine({});
    const page = fakePage();
    const { stack } = ce;
    const handle = deskLayer({ theme: deskTheme("light"), palette: deskPalette("light") })({
      host: { container: page.container } as never, world: ce.world,
      framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
      transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
      gpu: { adapter: adapter as unknown as GPUAdapter, device: g.device },
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const p = handle.profiler();
    expect(p).toBeDefined();
    expect(handle.profiler()).toBe(p);
    expect(p?.armed()).toBe(false);
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(false);
    const off = p?.arm();
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(true);
    off?.();
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(false);   // nobody else held it
    const s = handle.submits();   // the rigs' door
    const again = p?.arm();
    again?.();
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(true);   // the door keeps it
    expect(handle.submits()).toBe(s);
    handle.dispose();
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(false);
    ce.dispose();
    vi.restoreAllMocks();
    await settle();
  });

  it("rolling and spanOf: nearest rank; the span is first begin → last end, whatever the order", () => {
    expect(rolling([])).toBeNull();
    expect(rolling([5, 1, 4, 2, 3])).toEqual({ n: 5, p50: 3, p95: 5, max: 5 });
    expect(rolling(Array.from({ length: 100 }, (_, i) => i + 1))).toEqual({ n: 100, p50: 50, p95: 95, max: 100 });
    expect(spanOf([{ label: "b", begin: 0.3, end: 0.5 }, { label: "a", begin: 0, end: 0.4 }])).toBeCloseTo(0.5, 9);
    expect(spanOf([])).toBeNull();
  });
});
