/**
 * The GPU slot (design-016 §4.5, K2): the WebGPU desk's frames in the dock — fed through the STRUCTURAL MIRROR
 * `GpuPanelFrame` (devtools cannot import desk), mounted on the first push, reporting the host lanes `desk flush` / `encode` /
 * `gpu` beside strata's. Until K2 the dock had no GPU reading at all (the "ice gl" panel left with r3f at D5b).
 */
import { createCanvasEngine } from "@ice/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachDevtools, createGpuPanel, type GpuPanelFrame, type GpuPanelStats } from "../src";

const FRAME: GpuPanelFrame = {
  frame: 47,
  span: 2.938871,
  sum: 4.01727,
  busy: 2.938871,
  passes: [
    { label: "mat/wind", begin: 0, end: 0.40966 },
    { label: "notebook/layer", begin: 0.303371, end: 1.439478 },
    { label: "ground", begin: 0.644573, end: 2.938871 },
  ],
  counts: { draws: 7, instances: 18, pipelines: 7, bindGroups: 6, passes: 4, submits: 1, writes: 15, uploadBytes: 7696 },
  byKind: { mat: { draws: 2, instances: 2 }, notebook: { draws: 4, instances: 4 }, paper: { draws: 1, instances: 12 } },
  uploads: { mat: { writes: 1, bytes: 864 }, paper: { writes: 2, bytes: 896 } },
  cpu: { encode: 0.31, flush: 0.49 },
  memory: { byLabel: { paper: { bytes: 16 * 1048576, textures: 1, buffers: 2 }, mat: { bytes: 3 * 1048576, textures: 4, buffers: 1 } }, textures: 18 * 1048576, buffers: 1048576, total: 19 * 1048576 },
  quantised: false,
};
const STATS: GpuPanelStats = {
  frames: 45,
  span: { n: 45, p50: 2.938871, p95: 4.510904, max: 4.925966 },
  busy: { n: 45, p50: 2.6, p95: 3.9, max: 4.4 },
  encode: { n: 47, p50: 0.355, p95: 0.58, max: 1.355 },
  flush: { n: 47, p50: 0.555, p95: 0.865, max: 1.715 },
  quantised: false,
  unquantise: "--disable-dawn-features=timestamp_quantization",
  dropped: 2,
};
const text = (sel: string): string => document.querySelector(sel)?.textContent ?? "";
const texts = (sel: string): string[] => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent ?? "");

describe("the GPU slot (K2)", () => {
  beforeEach(() => { localStorage.clear(); });
  // a row that fails before its dispose leaves no panel behind for the next to read
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const e of Array.from(document.querySelectorAll(".ice-dock, .ice-gpu"))) e.remove(); });

  it("mounts in the dock's gpu slot on the first push — never before — and reads: the span's p50 as the headline, each pass on the span, the calls, kinds, uploads, memory", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce, { observer: false, profiler: false });
    expect(document.querySelector(".ice-gpu")).toBeNull();
    expect(document.querySelector(".ice-dock")).toBeNull();   // nothing to show yet: no dock
    handle.gpuFrame(FRAME, STATS);
    const slot = document.querySelector<HTMLElement>('.ice-dock-slot[data-slot="gpu"]');
    expect(slot?.querySelector(".ice-gpu")).not.toBeNull();
    expect(text(".ice-gpu-span")).toBe("2.94 ms");
    expect(text(".ice-gpu-tail")).toBe("p95 4.51 ms · max 4.93 ms");
    expect(texts(".ice-gpu-sect")).toContain("passes · frame 47 · span 2.94 ms · busy 2.94 ms · sum 4.02 ms");
    const labels = texts(".ice-gpu-label");
    expect(labels.slice(0, 4)).toEqual(["gpu span", "gpu busy", "encode", "desk flush"]);
    expect(labels).toEqual(expect.arrayContaining(["mat/wind", "notebook/layer", "ground", "paper", "notebook"]));
    // a pass sits on the span where it ran: the ground from 21.9 % to the end
    const ground = Array.from(document.querySelectorAll(".ice-gpu-row")).find((r) => r.querySelector(".ice-gpu-label")?.textContent === "ground");
    const fill = ground?.querySelector<HTMLElement>(".ice-gpu-bar > i");
    expect(Number.parseFloat(fill?.style.left ?? "")).toBeCloseTo((0.644573 / 2.938871) * 100, 3);
    expect(Number.parseFloat(fill?.style.width ?? "")).toBeCloseTo(((2.938871 - 0.644573) / 2.938871) * 100, 3);
    expect(texts(".ice-gpu-cell b")).toEqual(["7", "18", "7", "6", "4", "1", "15", "7.5 KB"]);
    expect(texts(".ice-gpu-stat")).toEqual(expect.arrayContaining(["1 draw · 12 inst", "896 B · 2×", "16.0 MB"]));
    expect(texts(".ice-gpu-sect")).toContain("memory · 19.0 MB live · textures 18.0 MB · buffers 1.0 MB");
    expect(text(".ice-gpu-foot")).toContain("2 dropped");
    expect(document.querySelector(".ice-gpu-warn.on")).toBeNull();
    handle.detach();
    expect(document.querySelector(".ice-gpu")).toBeNull();
    ce.dispose();
  });

  it("configured (`gpu: {…}`) it mounts at once and says it waits for a frame — the desk draws nothing at rest; the first frame replaces the line", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce, { observer: false, profiler: false, gpu: { budgetMs: 8.33 } });
    expect(document.querySelector('.ice-dock-slot[data-slot="gpu"] .ice-gpu')).not.toBeNull();
    expect(text(".ice-gpu-body")).toContain("waiting for a frame — at rest the desk draws nothing (idle-zero); move the camera");
    expect(text(".ice-gpu-tail")).toBe("no frame yet");
    handle.gpuFrame(FRAME, STATS);
    expect(text(".ice-gpu-body")).not.toContain("waiting for a frame");
    expect(document.querySelectorAll(".ice-gpu").length).toBe(1);   // the same panel, not a second
    handle.detach();
    ce.dispose();
  });

  it("quantised timestamps raise the warning with the Chrome switch that turns them off; an untimed frame says so", () => {
    const panel = createGpuPanel({ container: document.body });
    panel.push({ ...FRAME, span: null, sum: null, busy: null, passes: [], quantised: null }, { ...STATS, span: null, busy: null, quantised: true });
    expect(text(".ice-gpu-warn.on")).toBe("⚠ timestamps quantised to 100 µs — launch Chrome with --disable-dawn-features=timestamp_quantization");
    expect(text(".ice-gpu-span")).toBe("–");
    expect(text(".ice-gpu-tail")).toBe("untimed");
    expect(texts(".ice-gpu-sect")).toContain("passes — untimed (no timestamp-query, or the readback ring was full)");
    panel.dispose();
  });

  it("each push reports the host lanes desk flush / encode / gpu beside strata's; gpu: false mounts nothing and reports nothing", () => {
    const ce = createCanvasEngine();
    const handle = attachDevtools(ce, { observer: false });
    const lanes: string[] = [];
    const profiler = handle.profiler;
    if (profiler === null) throw new Error("no profiler");
    profiler.lane = (name, ms) => { lanes.push(`${name} ${ms}`); };
    handle.gpuFrame(FRAME, STATS);
    handle.gpuFrame({ ...FRAME, span: null, cpu: { encode: 0.2, flush: null } });
    expect(lanes).toEqual(["desk flush 0.49", "encode 0.31", "gpu 2.938871", "encode 0.2"]);
    handle.detach();
    const off = attachDevtools(ce, { observer: false, gpu: false });
    const offLanes: string[] = [];
    if (off.profiler !== null) off.profiler.lane = (name) => { offLanes.push(name); };
    off.gpuFrame(FRAME, STATS);
    expect(document.querySelector(".ice-gpu")).toBeNull();
    expect(offLanes).toEqual([]);
    off.detach();
    ce.dispose();
  });

  it("the capture button: the host's capture of N frames, saved as a JSON file", async () => {
    const blobs: Blob[] = [];
    const created = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:trace"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
    const capture = vi.fn(async (n: number) => ({ traceEvents: [{ name: "ground", ph: "X", ts: 0, dur: n, pid: 2, tid: 2 }], displayTimeUnit: "ms" }));
    const panel = createGpuPanel({ container: document.body, capture, captureFrames: 30 });
    panel.push(FRAME, STATS);
    const btn = document.querySelector<HTMLButtonElement>(".ice-gpu-btn");
    expect(btn?.textContent).toBe("capture 30 frames");
    btn?.click();
    expect(btn?.disabled).toBe(true);
    await vi.waitFor(() => expect(btn?.disabled).toBe(false));
    expect(capture).toHaveBeenCalledWith(30);
    expect(created).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await (blobs[0] as Blob).text())).toEqual({ traceEvents: [{ name: "ground", ph: "X", ts: 0, dur: 30, pid: 2, tid: 2 }], displayTimeUnit: "ms" });
    expect(clicks[0]).toMatch(/^desk-gpu-.*\.json$/);
    expect(btn?.textContent).toBe("saved — capture 30 frames");
    panel.dispose();
  });

  it("throttled to ~8 Hz, the LAST push always shows (at rest the frames stop; the panel must not keep an older one)", () => {
    vi.useFakeTimers();
    const panel = createGpuPanel({ container: document.body });
    panel.push(FRAME, STATS);
    expect(text(".ice-gpu-cell b")).toBe("7");
    panel.push({ ...FRAME, counts: { ...FRAME.counts, draws: 9 } }, STATS);   // inside the throttle window
    expect(text(".ice-gpu-cell b")).toBe("7");
    vi.advanceTimersByTime(130);
    expect(text(".ice-gpu-cell b")).toBe("9");
    panel.dispose();
  });
});
