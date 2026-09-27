// @vitest-environment node
// THE PASS INSTRUMENT (design-016 §4.2, K2): what a frame asked of the GPU — passes, draws and instances by the kind that drew,
// pipelines, bind groups — and, on a device with timestamp-query, how long its labelled passes took, read back through a
// ring that never waits. The resolve rides the frame's OWN command buffers (the idle witness counts submits: a profiler that
// submitted would break it), each run resolved at offset 0 (WebGPU's 256-byte rule) and copied to its place. Until K2 nothing
// read the GPU: no draw counter, no pipeline counter, no timestamp anywhere (design-016 §1.2).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Ground, type KindPass, type KindProgram, type StratumName, instrumentPasses, type PassFrame, readTimestamps } from "@ice/desk";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { shaderText } from "../src/shaders";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "../../desk/test/fake-gpu";
import { frame, settle, simGpu } from "./sim-gpu";

const VIEW = { camX: 5, camY: 7, zoom: 1, width: 1200, height: 800, dpr: 2 };


describe("the pass instrument (K2)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("counts through the REAL ground's runs: a run of N notes is ONE draw of N instances; prints between notes split the run", async () => {
    const log: string[] = [];
    const { device, queue } = fakeDevice(log);
    // stub passes that record what the real ones do: the note one instanced draw per run (paper-pass.ts:193-199), a print one per object (photo-pass.ts:226-233)
    const kindPass = (name: string, perObject: boolean): KindPass => ({
      spawn: () => kindPass(name, perObject),
      prepare: (_e, _s, records) => records.length,
      drawRange: (p, first, end) => {
        p.setPipeline({ label: `${name}/pipe` } as GPURenderPipeline);
        p.setBindGroup(0, { label: `${name}/group` } as GPUBindGroup);
        if (perObject) for (let i = first; i < end; i++) { p.setBindGroup(1, { label: `${name}/picture` } as GPUBindGroup); p.draw(6, 1, 0, i); }
        else p.draw(6, end - first, 0, first);
      },
      dispose: () => {},
    });
    const program = (name: string, stratum: StratumName, perObject = false): KindProgram => ({ name, stratum, create: async () => kindPass(name, perObject) });
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [program("paper", "things"), program("photo", "things", true)] });
    const frames: PassFrame[] = [];
    const inst = instrumentPasses(device, { onFrame: (f) => frames.push(f) });
    const o = (kind: string, id: string) => ({ kind, record: { id } });
    const N = 12;
    ground.render({ view: VIEW, theme: THEMES.light, objects: Array.from({ length: N }, (_, i) => o("paper", `n${i}`)) });
    ground.render({ view: VIEW, theme: THEMES.light, objects: [o("paper", "a"), o("paper", "b"), o("photo", "p"), o("paper", "c"), o("paper", "d"), o("paper", "e"), o("photo", "q"), o("photo", "r")] });
    await settle();
    expect(queue.submits).toBe(2);   // one per frame: the instrument submitted nothing
    expect(frames.map((f) => [f.kind, f.timing])).toEqual([["frame", "unsupported"], ["frame", "unsupported"]]);
    const [one, mixed] = frames as [PassFrame, PassFrame];
    const drawsOf = (f: PassFrame) => Object.values(f.byKind).reduce((s, k) => s + k.draws, 0);
    const mat = (f: PassFrame) => f.byKind.mat?.draws ?? 0;   // the mat's own draws (its wind pass the first frame, then the mat)
    expect(one.byKind.paper).toEqual({ draws: 1, instances: N });
    expect(Object.keys(one.byKind).sort()).toEqual(["mat", "paper"]);
    expect(mat(one)).toBeGreaterThan(0);
    expect(one.counts.draws).toBe(drawsOf(one));   // every draw is some kind's
    expect(one.counts.pipelines).toBe(mat(one) + 1);   // the mat's, then ONE for the run
    expect(mixed.byKind.paper).toEqual({ draws: 2, instances: 5 });   // [a b] [c d e]: the print between cut the run
    expect(mixed.byKind.photo).toEqual({ draws: 3, instances: 3 });   // one quad each
    expect(mixed.counts.draws).toBe(drawsOf(mixed));
    expect(mixed.counts.pipelines).toBe(mat(mixed) + 4);   // then one per run: paper, photo, paper, photo
    expect(mixed.counts.bindGroups).toBe(mat(mixed) + 4 + 3);   // …a group per run, and each print its picture
    inst.detach();
    ground.dispose();
  });

  it("times every LABELLED pass; the resolve rides the frame's own command buffers (no submit added); the slot is mapped after the frame's own submit", async () => {
    const g = simGpu();
    const frames: PassFrame[] = [];
    const closes: string[] = [];
    const inst = instrumentPasses(g.device, { onClose: (s, k) => closes.push(`${s} ${k}`), onFrame: (f) => frames.push(f) });
    expect(inst.supported).toBe(true);
    expect(g.made).toEqual(["queryset profiler/timestamps ×128", "buffer profiler/resolve", "buffer profiler/readback 0", "buffer profiler/readback 1", "buffer profiler/readback 2"]);
    // a notebook-like layer on its own encoder, submitted first; then the frame's own encoder: the wind, an unlabelled pass, the ground
    frame(g.device, [["notebook", ["notebook/shadow 0", "notebook/layer"]], ["ground", ["mat/wind", "", "ground"]]]);
    expect(g.submits).toEqual([
      { label: "notebook", cmds: ["pass notebook/shadow 0 timed", "pass notebook/layer timed", "resolve", "copy"] },
      { label: "ground", cmds: ["pass mat/wind timed", "pass ", "pass ground timed", "resolve", "copy"] },
    ]);
    expect(g.maps).toEqual(["profiler/readback 0 after 2 submits"]);   // mapped once the frame's own encoder was on the queue
    expect(closes).toEqual(["1 frame"]);
    expect(frames).toEqual([]);   // the readback is a later task
    await settle();
    const [f] = frames as [PassFrame];
    expect(f.timing).toBe("timed");
    expect(f.counts).toMatchObject({ encoders: 2, passes: 5, timed: 4, draws: 5, instances: 15 });
    expect(f.passes.map((p) => p.label)).toEqual(["notebook/shadow 0", "notebook/layer", "mat/wind", "ground"]);
    // each pass 0.4 ms, each overlapping the next by 0.15 ms (a tiler's): the span is first begin → last end, never the sum
    expect(f.passes.map((p) => [p.begin, p.end])).toEqual([[0, 0.4], [0.25, 0.65], [0.5, 0.9], [0.75, 1.15]]);
    expect(f.quantised).toBe(false);
    expect(inst.stats()).toEqual({ frames: 1, inFlight: 0, dropped: 0 });
    inst.detach();
  });

  it("the ring never waits: a fourth frame while three readbacks are in flight is counted but not timed (dropped); a readback frees its slot", async () => {
    const g = simGpu();
    const frames: PassFrame[] = [];
    const inst = instrumentPasses(g.device, { onFrame: (f) => frames.push(f) });
    for (let i = 0; i < 4; i++) frame(g.device, [["ground", ["ground"]]]);
    expect(inst.stats()).toEqual({ frames: 4, inFlight: 3, dropped: 1 });
    expect(g.submits.map((s) => s.cmds.join(","))).toEqual(["pass ground timed,resolve,copy", "pass ground timed,resolve,copy", "pass ground timed,resolve,copy", "pass ground"]);
    await settle();
    expect(frames.map((f) => [f.serial, f.timing, f.counts.draws])).toEqual([[4, "dropped", 1], [1, "timed", 1], [2, "timed", 1], [3, "timed", 1]]);
    frame(g.device, [["ground", ["ground"]]]);
    await settle();
    expect(frames.at(-1)?.timing).toBe("timed");   // the slots came back
    inst.detach();
  });

  it("cut(): GPU work encoded with no frame of its own closes as a LOOSE frame at the host's boundary", async () => {
    const g = simGpu();
    const frames: PassFrame[] = [];
    const inst = instrumentPasses(g.device, { onFrame: (f) => frames.push(f) });
    frame(g.device, [["board/replay", ["board/stamp"]]]);
    expect(inst.stats().frames).toBe(0);   // no frame encoder: still open
    inst.cut();
    inst.cut();   // nothing open: nothing
    await settle();
    expect(frames.map((f) => [f.kind, f.timing, f.passes.map((p) => p.label)])).toEqual([["loose", "timed", ["board/stamp"]]]);
    inst.detach();
  });

  it("a device without timestamp-query is counted, never timed — no query set, nothing resolved", async () => {
    const g = simGpu({ timestamps: false });
    const frames: PassFrame[] = [];
    const inst = instrumentPasses(g.device, { onFrame: (f) => frames.push(f) });
    expect(inst.supported).toBe(false);
    expect(g.made).toEqual([]);
    frame(g.device, [["ground", ["ground"]]]);
    await settle();
    expect(g.submits).toEqual([{ label: "ground", cmds: ["pass ground"] }]);
    expect(frames.map((f) => [f.timing, f.counts.draws])).toEqual([["unsupported", 1]]);
    inst.detach();
  });

  it("detached, createCommandEncoder is the device's own and the submit tap is gone; its query set and buffers go a task later", async () => {
    const g = simGpu();
    const own = g.raw.createCommandEncoder;
    const inst = instrumentPasses(g.device);
    expect(g.raw.createCommandEncoder).not.toBe(own);
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(true);
    inst.detach();
    expect(g.raw.createCommandEncoder).toBe(own);
    expect(Object.hasOwn(g.raw.queue, "submit")).toBe(false);
    const before = g.submits.length;
    frame(g.device, [["ground", ["ground"]]]);
    expect(g.submits.slice(before)).toEqual([{ label: "ground", cmds: ["pass ground"] }]);   // untouched
    await settle();
  });

  it("the quantisation detector, both ways: every delta a whole multiple of 100 µs → quantised; nanosecond deltas → not", () => {
    const timed = [{ label: "a", q: 0 }, { label: "b", q: 2 }];
    const q = readTimestamps(new BigUint64Array([7_000_000_000n, 7_000_300_000n, 7_000_100_000n, 7_000_500_000n]), timed);
    expect(q.quantised).toBe(true);
    expect(q.passes).toEqual([{ label: "a", begin: 0, end: 0.3 }, { label: "b", begin: 0.1, end: 0.5 }]);
    expect(readTimestamps(new BigUint64Array([7_000_000_000n, 7_000_312_417n, 7_000_104_166n, 7_000_498_958n]), timed).quantised).toBe(false);
    expect(readTimestamps(new BigUint64Array([0n, 0n, 0n, 0n]), timed)).toEqual({ passes: [], quantised: null });   // never written
    vi.restoreAllMocks();
  });
});
