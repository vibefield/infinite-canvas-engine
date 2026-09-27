// THE GPU PROFILER (design-016 §4, K2; K-L5 "measured on real frames") — the desk's frames as the GPU saw them, armed on
// demand. It holds the three instruments together: the submit instrument (the queue: submits, writes, upload bytes by
// label), the pass instrument (the encoders: passes, draws by kind, pipelines, bind groups, every labelled pass timed) and,
// where the host kept one, the memory ledger (live bytes by label) — and turns each closed frame into ONE report:
//
//   { frame, span, sum, passes[{ label, begin, end }], counts{ draws, instances, pipelines, bindGroups, passes, submits,
//     writes, uploadBytes … }, byKind, uploads, cpu{ encode, flush }, memory, quantised }
//
// with rolling p50 / p95 / max over a window. THE HEADLINE IS THE SPAN — first begin → last end of the frame's timed passes:
// the Apple tiler keeps ~2 passes in flight, so a pass's own begin/end does not isolate it and a SUM of passes overstates the
// frame (`sum` is reported beside it to show exactly that). A frame whose every timestamp delta is a whole multiple of 100 µs
// is `quantised`: Dawn rounds timestamps unless Chrome runs with `--disable-dawn-features=timestamp_quantization`.
//
// THE FRAME (D-K2.3): a frame closes at the submit of its own encoder (`ground`, `hold` — the pass instrument); the host's
// boundary (`flushed`, the layer's flush) closes whatever GPU work came without one (a raster made between frames: a
// "loose" frame, reported but kept out of the rolling window) and gives the frame its `flush` ms. `encode` is the CPU from
// the frame's first command encoder to its close. K-L5: UNARMED it costs nothing (no instrument installed: the device and
// the queue are the natives; `flushed` returns at its first line); ARMED it adds no submit (the resolve rides the frame's
// own command buffers), never waits (a full readback ring drops the sample) and never schedules a frame — a report lands
// in a later task and only reports.
//
// `capture(n)` turns the next n frames into a Chrome trace-event JSON (Perfetto and chrome://tracing load it): the CPU
// spans (`desk flush`, `encode` — also as `performance.measure` entries, for the Performance panel's Timings track), the
// GPU passes each on a track of its own (overlapping passes cannot nest on one), the frame's span, and counters for draws,
// uploads and memory. The GPU spans are placed at the frame's first submit: the GPU's clock and `performance.now()` are not
// correlated, so their DURATIONS and relative offsets are the GPU's own, their placement the CPU's.

import type { GpuMemory, MemoryLedger } from "./gpu-memory";
import { instrumentPasses, type KindDraws, type PassCounts, type PassFrame, type PassInstrument, type PassTime, type PassTiming, UNQUANTISED_TIMESTAMPS_FLAG } from "./pass-instrument";
import type { SubmitInstrument, UploadTally } from "./submit-instrument";

export interface GpuFrameCounts extends PassCounts {
  /** `queue.submit` calls in the frame. */
  readonly submits: number;
  /** Uploads (`writeBuffer` + `writeTexture` + `copyExternalImageToTexture`) and their bytes. */
  readonly writes: number;
  readonly uploadBytes: number;
  /** The `copyExternalImageToTexture` uploads alone (a picture, a calendar tile). */
  readonly externals: number;
}

export interface GpuFrameReport {
  /** The profiler's frame number (monotonic across arms). */
  readonly frame: number;
  /** "frame": one the desk drew; "loose": GPU work the host's boundary closed with no frame in it — reported, never in the window. */
  readonly kind: "frame" | "loose";
  /** `performance.now()` at the frame's first command encoder. */
  readonly at: number;
  /** THE HEADLINE: GPU ms from the first timed pass's begin to the last one's end; null when untimed. */
  readonly span: number | null;
  /** The passes' own durations summed — NOT the frame's time (a tiler overlaps passes): beside the span to show it. */
  readonly sum: number | null;
  /** The timed passes, ms from the frame's earliest timestamp. */
  readonly passes: readonly PassTime[];
  readonly counts: GpuFrameCounts;
  /** Draws and instances by the kind that drew (the pipeline's label prefix). */
  readonly byKind: Readonly<Record<string, KindDraws>>;
  /** The frame's uploads by the written resource's label prefix. */
  readonly uploads: Readonly<Record<string, UploadTally>>;
  /** CPU ms: `encode` — the frame's first command encoder to its close; `flush` — the host's flush that held it (null: none, a tool's frame). */
  readonly cpu: { readonly encode: number; readonly flush: number | null };
  /** The ledger's live GPU memory as the frame completed; null when the host keeps no ledger. */
  readonly memory: GpuMemory | null;
  readonly timing: PassTiming;
  /** Every timestamp delta a whole multiple of 100 µs — Dawn's quantisation (`UNQUANTISED_TIMESTAMPS_FLAG` turns it off); null untimed. */
  readonly quantised: boolean | null;
}

/** Rolling percentiles over the window: nearest rank. */
export interface Rolling { readonly n: number; readonly p50: number; readonly p95: number; readonly max: number }

export interface GpuProfileStats {
  readonly armed: boolean;
  /** Drawn frames in the window (loose work never enters it). */
  readonly frames: number;
  /** The GPU span; null while no frame in the window was timed. */
  readonly span: Rolling | null;
  readonly encode: Rolling | null;
  readonly flush: Rolling | null;
  readonly draws: Rolling | null;
  readonly instances: Rolling | null;
  readonly pipelines: Rolling | null;
  readonly bindGroups: Rolling | null;
  readonly passes: Rolling | null;
  readonly submits: Rolling | null;
  readonly uploadBytes: Rolling | null;
  /** Most timed frames in the window read quantised → true (a real delta lands on a 100 µs multiple now and then, by chance — one frame is not the clock); else false; nothing timed → null. */
  readonly quantised: boolean | null;
  /** The switch that unquantises timestamps — what the dock says when `quantised`. */
  readonly unquantise: string;
  /** Samples dropped for a full readback ring, and readbacks in flight (this arming). */
  readonly dropped: number;
  readonly inFlight: number;
}

export interface TraceEvent {
  readonly name: string;
  readonly ph: "X" | "C" | "M";
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly cat?: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

/** A Chrome trace-event file (the JSON object format): Perfetto's and chrome://tracing's. */
export interface TraceJson {
  readonly traceEvents: readonly TraceEvent[];
  readonly displayTimeUnit: "ms";
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface GpuProfiler {
  /** The device has timestamp-query: frames are timed. */
  readonly supported: boolean;
  armed(): boolean;
  /** Arm — refcounted: the first arm installs the instruments; returns this arm's release (the last release takes them all off). */
  arm(): () => void;
  /** The frames completed since the last take (drained, oldest first) — a rig's reading. */
  take(): GpuFrameReport[];
  /** The last frame completed. */
  last(): GpuFrameReport | null;
  /** Rolling p50 / p95 / max over the window's drawn frames. */
  stats(): GpuProfileStats;
  /** Called with every frame completed while armed; returns the unsubscribe. */
  subscribe(listener: (report: GpuFrameReport) => void): () => void;
  /** The host's boundary — its flush ended after `ms`: work with no frame is closed as loose, and the frames it held are given its ms. */
  flushed(ms: number): void;
  /** The next `n` frames as a trace-event JSON (arming for as long as it takes); at `timeoutMs` (10 s) it answers with what came. */
  capture(n: number, opts?: { readonly timeoutMs?: number; readonly measure?: boolean }): Promise<TraceJson>;
  /** Disarm whatever holds it and stop. */
  dispose(): void;
}

export interface GpuProfilerOptions {
  readonly device: GPUDevice;
  /** The submit instrument, held while armed and released after — the host's (the layer's `submits()` may hold it for good). */
  readonly submits: { hold(): SubmitInstrument; release(): void };
  /** The host's memory ledger, if it keeps one. */
  readonly ledger?: () => MemoryLedger | undefined;
  /** Drawn frames in the rolling window (120). */
  readonly window?: number;
  /** The encoders whose submit closes a frame (the pass instrument's default: `ground`, `hold`). */
  readonly frameEncoders?: readonly string[];
}

/** Nearest-rank percentiles of `values`; null when empty. */
export function rolling(values: readonly number[]): Rolling | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] as number;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] as number };
}

/** The span of `passes`: first begin → last end; null when there are none. */
export function spanOf(passes: readonly PassTime[]): number | null {
  if (passes.length === 0) return null;
  let b = Number.POSITIVE_INFINITY;
  let e = Number.NEGATIVE_INFINITY;
  for (const p of passes) { if (p.begin < b) b = p.begin; if (p.end > e) e = p.end; }
  return e - b;
}

interface Snapshot { readonly submits: number; readonly writes: number; readonly bytes: number; readonly externals: number; readonly byLabel: Readonly<Record<string, UploadTally>> }

const snapshotOf = (s: SubmitInstrument): Snapshot => ({ submits: s.total(), writes: s.uploads().writes, bytes: s.uploads().bytes, externals: s.externals().writes, byLabel: s.uploadsByLabel() });

/** `now − before`, clamped at 0 (a `reset()` between the two reads starts the count again). */
function diff(now: Snapshot, before: Snapshot): Omit<Snapshot, "byLabel"> & { byLabel: Record<string, UploadTally> } {
  const byLabel: Record<string, UploadTally> = {};
  for (const [k, t] of Object.entries(now.byLabel)) {
    const b = before.byLabel[k];
    const writes = t.writes - (b?.writes ?? 0);
    const bytes = t.bytes - (b?.bytes ?? 0);
    if (writes > 0) byLabel[k] = { writes, bytes: Math.max(0, bytes) };
  }
  return {
    submits: Math.max(0, now.submits - before.submits), writes: Math.max(0, now.writes - before.writes),
    bytes: Math.max(0, now.bytes - before.bytes), externals: Math.max(0, now.externals - before.externals), byLabel,
  };
}

export function createGpuProfiler(opts: GpuProfilerOptions): GpuProfiler {
  const { device } = opts;
  const windowSize = opts.window ?? 120;
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);
  const supported = device.features?.has("timestamp-query") === true;
  let holds = 0;
  let pass: PassInstrument | null = null;
  let submits: SubmitInstrument | null = null;
  let base = 0;          // frame numbers stay monotonic across arms
  let highest = 0;
  let epoch = 0;         // an arming's frames: a readback landing after its disarm is dropped
  let before: Snapshot | null = null;
  const closed = new Map<number, { uploads: ReturnType<typeof diff>; closedAt: number; flush: number | null; flushAt: number | null }>();
  let unflushed: number[] = [];
  const recent: GpuFrameReport[] = [];
  let taken: GpuFrameReport[] = [];
  let last: GpuFrameReport | null = null;
  const listeners = new Set<(r: GpuFrameReport) => void>();
  let disposed = false;

  // where each frame sat on the CPU clock, for a capture: its flush's start, its first submit
  const trace = new Map<number, { flushAt: number | null; firstSubmit: number }>();
  const report = (f: PassFrame, b: number, e: number): void => {
    if (e !== epoch || pass === null) return;
    const at = closed.get(f.serial);
    closed.delete(f.serial);
    const up = at?.uploads ?? { submits: 0, writes: 0, bytes: 0, externals: 0, byLabel: {} };
    const span = spanOf(f.passes);
    const r: GpuFrameReport = {
      frame: b + f.serial, kind: f.kind, at: f.t0, span,
      sum: f.passes.length > 0 ? f.passes.reduce((s, p) => s + (p.end - p.begin), 0) : null,
      passes: f.passes,
      counts: { ...f.counts, submits: up.submits, writes: up.writes, uploadBytes: up.bytes, externals: up.externals },
      byKind: f.byKind, uploads: up.byLabel,
      cpu: { encode: f.t1 - f.t0, flush: at?.flush ?? null },
      memory: opts.ledger?.()?.read() ?? null,
      timing: f.timing, quantised: f.quantised,
    };
    if (r.kind === "frame") { recent.push(r); if (recent.length > windowSize) recent.shift(); }
    taken.push(r);
    if (taken.length > 4 * windowSize) taken.splice(0, taken.length - 4 * windowSize);   // an untaken reading never grows without bound
    last = r;
    trace.set(r.frame, { flushAt: at?.flushAt ?? null, firstSubmit: f.firstSubmit });
    if (trace.size > 4 * windowSize) trace.delete(trace.keys().next().value as number);
    for (const l of [...listeners]) l(r);
  };

  const install = (): void => {
    submits = opts.submits.hold();
    before = snapshotOf(submits);
    const b = base;
    const e = ++epoch;
    pass = instrumentPasses(device, {
      ...(opts.frameEncoders !== undefined ? { frameEncoders: opts.frameEncoders } : {}),
      onClose(serial) {
        highest = Math.max(highest, serial);
        const s = submits;
        if (s === null || before === null) return;
        const snap = snapshotOf(s);
        closed.set(serial, { uploads: diff(snap, before), closedAt: now(), flush: null, flushAt: null });
        before = snap;
        unflushed.push(serial);
        if (unflushed.length > 4 * windowSize) unflushed.shift();
      },
      onFrame: (f) => report(f, b, e),
    });
  };
  const uninstall = (): void => {
    pass?.detach();
    pass = null;
    epoch += 1;
    if (submits !== null) { submits = null; opts.submits.release(); }
    base += highest;
    highest = 0;
    before = null;
    unflushed = [];
    closed.clear();
  };

  const profiler: GpuProfiler = {
    supported,
    armed: () => pass !== null,
    arm() {
      if (disposed) return () => {};
      holds += 1;
      if (holds === 1) install();
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        holds -= 1;
        if (holds === 0) uninstall();
      };
    },
    take() { const out = taken; taken = []; return out; },
    last: () => last,
    stats() {
      const timed = recent.filter((r) => r.span !== null);
      const pick = (f: (r: GpuFrameReport) => number): Rolling | null => rolling(recent.map(f));
      const flushes = recent.flatMap((r) => (r.cpu.flush !== null ? [r.cpu.flush] : []));
      const q = timed.filter((r) => r.quantised !== null);
      const st = pass?.stats();
      return {
        armed: pass !== null, frames: recent.length,
        span: rolling(timed.map((r) => r.span as number)),
        encode: pick((r) => r.cpu.encode), flush: rolling(flushes),
        draws: pick((r) => r.counts.draws), instances: pick((r) => r.counts.instances), pipelines: pick((r) => r.counts.pipelines),
        bindGroups: pick((r) => r.counts.bindGroups), passes: pick((r) => r.counts.passes), submits: pick((r) => r.counts.submits),
        uploadBytes: pick((r) => r.counts.uploadBytes),
        quantised: q.length === 0 ? null : 2 * q.filter((r) => r.quantised === true).length > q.length,
        unquantise: UNQUANTISED_TIMESTAMPS_FLAG,
        dropped: st?.dropped ?? 0, inFlight: st?.inFlight ?? 0,
      };
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    flushed(ms) {
      if (pass === null) return;
      pass.cut();   // work with no frame of its own: a loose frame, closed here
      if (unflushed.length === 0) return;
      const start = now() - ms;
      // the frames this flush held — closed inside it (a tool's batch renders outside any flush: no flush ms)
      for (const serial of unflushed) { const c = closed.get(serial); if (c !== undefined && c.closedAt >= start) { c.flush = ms; c.flushAt = start; } }
      unflushed = [];
    },
    capture(n, o = {}) {
      const release = profiler.arm();
      const frames: GpuFrameReport[] = [];
      const measure = o.measure !== false && typeof performance !== "undefined" && typeof performance.measure === "function";
      return new Promise<TraceJson>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          off();
          clearTimeout(timer);
          release();
          resolve(traceOf(frames, trace, { requested: n, supported }));
        };
        const off = profiler.subscribe((r) => {
          frames.push(r);
          if (measure) {
            const t = trace.get(r.frame);
            try {
              if (t?.flushAt != null && r.cpu.flush !== null) performance.measure(`desk flush #${r.frame}`, { start: t.flushAt, end: t.flushAt + r.cpu.flush });
              performance.measure(`encode #${r.frame}`, { start: r.at, end: r.at + r.cpu.encode });
            } catch { /* a clock the entry types refuse: the trace still has it */ }
          }
          if (frames.length >= n) finish();
        });
        const timer = setTimeout(finish, o.timeoutMs ?? 10_000);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      holds = 0;
      if (pass !== null) uninstall();
      listeners.clear();
    },
  };
  return profiler;
}

/** Frames → a trace-event JSON: CPU spans on the main thread, each GPU pass on a track of its own, the span, counters. µs throughout. */
export function traceOf(frames: readonly GpuFrameReport[], where: ReadonlyMap<number, { readonly flushAt: number | null; readonly firstSubmit: number }>, meta: Readonly<Record<string, unknown>> = {}): TraceJson {
  const us = (ms: number): number => Math.round(ms * 1000);
  const CPU = 1;
  const GPU = 2;
  const events: TraceEvent[] = [
    { name: "process_name", ph: "M", ts: 0, pid: CPU, tid: 0, args: { name: "desk — CPU" } },
    { name: "thread_name", ph: "M", ts: 0, pid: CPU, tid: 1, args: { name: "main thread" } },
    { name: "process_name", ph: "M", ts: 0, pid: GPU, tid: 0, args: { name: "desk — GPU (timestamp queries)" } },
    { name: "thread_name", ph: "M", ts: 0, pid: GPU, tid: 1, args: { name: "frame span" } },
  ];
  const tracks = new Map<string, number>();
  const trackOf = (label: string): number => {
    let tid = tracks.get(label);
    if (tid === undefined) {
      tid = 2 + tracks.size;
      tracks.set(label, tid);
      events.push({ name: "thread_name", ph: "M", ts: 0, pid: GPU, tid, args: { name: label } });
    }
    return tid;
  };
  for (const r of [...frames].sort((a, b) => a.frame - b.frame)) {
    const w = where.get(r.frame);
    if (w?.flushAt != null && r.cpu.flush !== null) events.push({ name: "desk flush", cat: "cpu", ph: "X", ts: us(w.flushAt), dur: us(r.cpu.flush), pid: CPU, tid: 1, args: { frame: r.frame } });
    events.push({ name: "encode", cat: "cpu", ph: "X", ts: us(r.at), dur: us(r.cpu.encode), pid: CPU, tid: 1, args: { frame: r.frame, kind: r.kind } });
    const anchor = w?.firstSubmit ?? r.at;
    if (r.span !== null) events.push({ name: `frame ${r.frame}`, cat: "gpu", ph: "X", ts: us(anchor), dur: us(r.span), pid: GPU, tid: 1, args: { span: r.span, sum: r.sum, quantised: r.quantised } });
    for (const p of r.passes) events.push({ name: p.label, cat: "gpu", ph: "X", ts: us(anchor + p.begin), dur: us(p.end - p.begin), pid: GPU, tid: trackOf(p.label), args: { frame: r.frame } });
    events.push({ name: "draws", ph: "C", ts: us(r.at), pid: CPU, tid: 1, args: { draws: r.counts.draws, instances: r.counts.instances, pipelines: r.counts.pipelines, bindGroups: r.counts.bindGroups } });
    events.push({ name: "uploads", ph: "C", ts: us(r.at), pid: CPU, tid: 1, args: { bytes: r.counts.uploadBytes, writes: r.counts.writes } });
    if (r.memory !== null) events.push({ name: "gpu memory", ph: "C", ts: us(r.at), pid: GPU, tid: 1, args: { textures: r.memory.textures, buffers: r.memory.buffers } });
  }
  return {
    traceEvents: events,
    displayTimeUnit: "ms",
    metadata: { source: "@ice/desk GPU profiler (design-016 §4)", frames: frames.length, clock: "CPU spans on performance.now(); GPU spans placed at each frame's first submit — their durations and offsets are the GPU's own", ...meta },
  };
}
