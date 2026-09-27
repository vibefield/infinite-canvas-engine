// The pass instrument — what the GPU was asked to do in a frame, and how long it took (design-016 §4.2, K2; K-L5 "measured
// on real frames"). Beside the submit instrument (which sees the QUEUE: submits, writes, uploads), this sees the ENCODERS:
// it wraps `device.createCommandEncoder`, and every encoder and pass it makes, so the desk's passes are measured without
// one of them being touched.
//
//   COUNTS   render and compute passes, draws (direct and indirect) and the instances they asked for, `setPipeline`,
//            `setBindGroup`, dispatches — per frame, and draws by the KIND that drew (the pipeline's label prefix:
//            `paper/notes` → `paper`), so "one instanced draw for a run of notes" is a count, not a claim.
//   TIMING   every LABELLED pass gets `timestampWrites` (unless it brought its own): a begin and an end timestamp in one
//            query set. The encoder resolves its own queries in its OWN command buffer at `finish()` — so the resolve rides
//            the frame's own submits and the submit count (the idle witness) is unchanged — each run resolved into offset 0
//            of a scratch buffer (`resolveQuerySet`'s destination offset must be a multiple of 256) and copied to its place
//            in the frame's readback slot. The frame closes at the submit of its own encoder (`frameEncoders`: the ground's
//            `ground` and `hold`) — or at a boundary its host cuts (`cut()`, the layer's flush: GPU work between frames, a
//            "loose" frame) — and its slot is mapped then. THE RING: three readback slots; a frame that finds all three
//            still in flight is not timed (`dropped`) — the instrument never waits, never stalls, never submits, never
//            wakes anything: a readback lands in a later task and only reports.
//   THE TRAPS it names rather than hides: the Apple tiler keeps passes in flight together, so a pass's begin/end do not
//   isolate it, and the GPU may wait between passes — the frame's SPAN (first begin → last end) is the headline, never a sum
//   (gpu-profiler.ts, D-K2.4); and Dawn rounds timestamps to 100 µs unless
//   Chrome runs with `--disable-dawn-features=timestamp_quantization` — a frame whose every delta is a whole multiple of
//   100 µs says `quantised`.
//
// Armed, it costs a closure per wrapped method per encoder and pass, and a counter per call; unarmed (detached) it is
// gone — `createCommandEncoder` is the device's own again and the submit tap has one listener fewer.

import { prefixOf, swapMethod } from "./gpu-wrap";
import { tapSubmits } from "./submit-instrument";

/** Dawn's timestamp quantum when quantisation is on: 100 µs, in the nanoseconds a timestamp query reads. */
export const TIMESTAMP_QUANTUM_NS = 100_000n;
/** The Chrome switch that turns the quantisation off (the rigs pass it — scripts/cdp.mjs). */
export const UNQUANTISED_TIMESTAMPS_FLAG = "--disable-dawn-features=timestamp_quantization";

export interface PassCounts {
  /** Command encoders made. */
  readonly encoders: number;
  /** Render and compute passes begun, and how many of them were timed. */
  readonly passes: number;
  readonly timed: number;
  /** `draw` + `drawIndexed` + `drawIndirect` + `drawIndexedIndirect`. */
  readonly draws: number;
  /** The instances the direct draws asked for (an indirect draw's count is the GPU's: counted in `indirect`, not here). */
  readonly instances: number;
  readonly indirect: number;
  readonly dispatches: number;
  /** `setPipeline` / `setBindGroup` calls — every call is a command, a rebind of the same object included. */
  readonly pipelines: number;
  readonly bindGroups: number;
  /** `executeBundles` calls (their draws are the bundles', unseen here). */
  readonly bundles: number;
}

export interface KindDraws { readonly draws: number; readonly instances: number }

/** A timed pass: its label, and its begin and end in ms from the frame's earliest timestamp. */
export interface PassTime { readonly label: string; readonly begin: number; readonly end: number }

export type PassTiming = "timed" | "unsupported" | "dropped" | "untimed" | "lost";

export interface PassFrame {
  readonly serial: number;
  /** "frame": closed by the submit of a frame's own encoder — a frame drawn; "loose": GPU work a boundary closed with no frame in it. */
  readonly kind: "frame" | "loose";
  /** `performance.now()` at the frame's first command encoder, at its first submit, and at its close. */
  readonly t0: number;
  readonly firstSubmit: number;
  readonly t1: number;
  readonly counts: PassCounts;
  /** Draws and instances by the pipeline's label prefix — the kind that drew (`paper`, `photo`, `mat` …; `?` before any pipeline). */
  readonly byKind: Readonly<Record<string, KindDraws>>;
  /** The timed passes in the order begun. Empty unless `timing` is "timed". */
  readonly passes: readonly PassTime[];
  /**
   * "timed" — read back; "unsupported" — the device has no timestamp-query; "dropped" — every readback slot was still in flight
   * (never a stall); "untimed" — no labelled pass; "lost" — the readback failed (a lost device).
   */
  readonly timing: PassTiming;
  /** Every delta between the frame's timestamps is a whole multiple of 100 µs (Dawn's quantisation); null with fewer than two. */
  readonly quantised: boolean | null;
}

export interface PassInstrumentOptions {
  /** The labels of the encoders whose submit CLOSES a frame — the frame's last command buffer. Default: the ground's, `ground` and `hold`. */
  readonly frameEncoders?: readonly string[];
  /** Timed passes a frame may hold (64); the rest are counted, not timed. */
  readonly capacity?: number;
  /** Readback slots (3). */
  readonly ring?: number;
  /** At a frame's close, synchronously — before its timing is read (a reader of other counters diffs them here). */
  readonly onClose?: (serial: number, kind: "frame" | "loose") => void;
  /** A frame complete: its counts, and its timing once read back — always a later task than its close. */
  readonly onFrame?: (frame: PassFrame) => void;
}

export interface PassInstrument {
  /** The device has timestamp-query: labelled passes are timed. */
  readonly supported: boolean;
  /** Close the open frame now (the host's boundary — the layer's flush): whatever was encoded since the last close is a "loose" frame. */
  cut(): void;
  /** Frames closed, readbacks in flight, samples dropped for a full ring. */
  stats(): { readonly frames: number; readonly inFlight: number; readonly dropped: number };
  /** Put `createCommandEncoder` back and leave the submit tap; the query set and buffers go a task later (no encoder of this task then holds them). Idempotent. */
  detach(): void;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const zeroCounts = (): Mutable<PassCounts> => ({ encoders: 0, passes: 0, timed: 0, draws: 0, instances: 0, indirect: 0, dispatches: 0, pipelines: 0, bindGroups: 0, bundles: 0 });

interface Open {
  readonly serial: number;
  readonly t0: number;
  firstSubmit: number;
  readonly counts: Mutable<PassCounts>;
  readonly byKind: Map<string, { draws: number; instances: number }>;
  /** The readback slot: undefined until the first timed pass; −1 when the ring was full (the frame is not timed). */
  slot: number | undefined;
  next: number;
  readonly timed: { readonly label: string; readonly q: number; readonly enc: Enc }[];
  closed: boolean;
}
interface Enc { readonly frame: Open; readonly closes: boolean; readonly queries: number[]; submitted: boolean }

const FREE = 0;
const USED = 1;

/** A frame's timestamps → its passes and whether they are quantised. Passes with an unwritten (zero) stamp are left out. */
export function readTimestamps(stamps: BigUint64Array, timed: readonly { readonly label: string; readonly q: number }[]): { passes: PassTime[]; quantised: boolean | null } {
  const rows: { label: string; b: bigint; e: bigint }[] = [];
  for (const t of timed) {
    const b = stamps[t.q] ?? 0n;
    const e = stamps[t.q + 1] ?? 0n;
    if (b !== 0n && e !== 0n) rows.push({ label: t.label, b, e });
  }
  if (rows.length === 0) return { passes: [], quantised: null };
  let min = rows[0]?.b ?? 0n;
  for (const r of rows) { if (r.b < min) min = r.b; if (r.e < min) min = r.e; }
  let quantised = true;
  for (const r of rows) if ((r.b - min) % TIMESTAMP_QUANTUM_NS !== 0n || (r.e - min) % TIMESTAMP_QUANTUM_NS !== 0n) quantised = false;
  return { passes: rows.map((r) => ({ label: r.label, begin: Number(r.b - min) / 1e6, end: Number(r.e - min) / 1e6 })), quantised };
}

export function instrumentPasses(device: GPUDevice, opts: PassInstrumentOptions = {}): PassInstrument {
  const frameEncoders = new Set(opts.frameEncoders ?? ["ground", "hold"]);
  const capacity = 2 * (opts.capacity ?? 64);
  const ringSize = opts.ring ?? 3;
  const flags = globalThis as unknown as { GPUBufferUsage?: Record<string, number>; GPUMapMode?: Record<string, number> };
  const usage = (name: string, bit: number): number => flags.GPUBufferUsage?.[name] ?? bit;
  const supported = device.features?.has("timestamp-query") === true && typeof device.createQuerySet === "function";
  const querySet = supported ? device.createQuerySet({ label: "profiler/timestamps", type: "timestamp", count: capacity }) : null;
  const resolve = supported ? device.createBuffer({ label: "profiler/resolve", size: capacity * 8, usage: usage("QUERY_RESOLVE", 0x200) | usage("COPY_SRC", 0x4) }) : null;
  const readback = supported ? Array.from({ length: ringSize }, (_, i) => device.createBuffer({ label: `profiler/readback ${i}`, size: capacity * 8, usage: usage("MAP_READ", 0x1) | usage("COPY_DST", 0x8) })) : [];
  const slots = readback.map(() => FREE);
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : 0);

  let attached = true;
  let serial = 0;
  let frames = 0;
  let inFlight = 0;
  let dropped = 0;
  let open: Open | null = null;
  const commands = new WeakMap<GPUCommandBuffer, Enc>();

  const frame = (): Open => {
    if (open === null) open = { serial: ++serial, t0: now(), firstSubmit: Number.NaN, counts: zeroCounts(), byKind: new Map(), slot: undefined, next: 0, timed: [], closed: false };
    return open;
  };
  const emit = (f: Open, kind: "frame" | "loose", t1: number, timing: PassTiming, passes: PassTime[] = [], quantised: boolean | null = null): void => {
    const byKind: Record<string, KindDraws> = {};
    for (const [k, v] of f.byKind) byKind[k] = { draws: v.draws, instances: v.instances };
    opts.onFrame?.({ serial: f.serial, kind, t0: f.t0, firstSubmit: Number.isNaN(f.firstSubmit) ? t1 : f.firstSubmit, t1, counts: { ...f.counts }, byKind, passes, timing, quantised });
  };
  const close = (f: Open, kind: "frame" | "loose"): void => {
    if (f.closed) return;
    f.closed = true;
    if (open === f) open = null;
    frames += 1;
    opts.onClose?.(f.serial, kind);
    const t1 = now();
    const slot = f.slot;
    // only a pass whose command buffer reached the queue was written and resolved
    const timed = f.timed.filter((t) => t.enc.submitted);
    if (slot !== undefined && slot >= 0 && timed.length > 0) {
      const buf = readback[slot] as GPUBuffer;
      inFlight += 1;
      buf.mapAsync(flags.GPUMapMode?.READ ?? 1, 0, f.next * 8).then(
        () => {
          const stamps = new BigUint64Array(buf.getMappedRange(0, f.next * 8).slice(0));
          buf.unmap();
          slots[slot] = FREE;
          inFlight -= 1;
          const r = readTimestamps(stamps, timed);
          emit(f, kind, t1, "timed", r.passes, r.quantised);
        },
        () => { slots[slot] = FREE; inFlight -= 1; emit(f, kind, t1, "lost"); },
      );
      return;
    }
    if (slot !== undefined && slot >= 0) slots[slot] = FREE;   // a slot taken by passes that never reached the queue
    const why: PassTiming = !supported ? "unsupported" : slot === -1 ? "dropped" : "untimed";
    queueMicrotask(() => emit(f, kind, t1, why));   // never before the close's own task ends (the host's word on the frame lands first)
  };

  const kindOf = (f: Open, k: string): { draws: number; instances: number } => {
    let row = f.byKind.get(k);
    if (row === undefined) { row = { draws: 0, instances: 0 }; f.byKind.set(k, row); }
    return row;
  };
  /** The pass's draw calls counted, by the kind of the pipeline set last. */
  const wrapRender = (pass: GPURenderPassEncoder, f: Open): GPURenderPassEncoder => {
    // the kind drawing: the prefix of the pipeline set last — its row made at its first draw (`?` for a draw before any pipeline)
    let name = "?";
    let row: { draws: number; instances: number } | undefined;
    const drew = (instances: number): void => { row ??= kindOf(f, name); row.draws += 1; row.instances += instances; };
    const c = f.counts;
    const { setPipeline, setBindGroup, draw, drawIndexed, drawIndirect, drawIndexedIndirect, executeBundles } = pass;
    pass.setPipeline = (p) => { c.pipelines += 1; name = prefixOf(p.label); row = undefined; return setPipeline.call(pass, p); };
    pass.setBindGroup = ((...a: Parameters<GPURenderPassEncoder["setBindGroup"]>) => { c.bindGroups += 1; return (setBindGroup as (...x: unknown[]) => undefined).apply(pass, a); }) as GPURenderPassEncoder["setBindGroup"];
    pass.draw = (...a: Parameters<GPURenderPassEncoder["draw"]>) => { const n = a[1] ?? 1; c.draws += 1; c.instances += n; drew(n); return draw.apply(pass, a); };
    pass.drawIndexed = (...a: Parameters<GPURenderPassEncoder["drawIndexed"]>) => { const n = a[1] ?? 1; c.draws += 1; c.instances += n; drew(n); return drawIndexed.apply(pass, a); };
    if (typeof drawIndirect === "function") pass.drawIndirect = (...a: Parameters<GPURenderPassEncoder["drawIndirect"]>) => { c.draws += 1; c.indirect += 1; drew(0); return drawIndirect.apply(pass, a); };
    if (typeof drawIndexedIndirect === "function") pass.drawIndexedIndirect = (...a: Parameters<GPURenderPassEncoder["drawIndexedIndirect"]>) => { c.draws += 1; c.indirect += 1; drew(0); return drawIndexedIndirect.apply(pass, a); };
    if (typeof executeBundles === "function") pass.executeBundles = (...a: Parameters<GPURenderPassEncoder["executeBundles"]>) => { c.bundles += 1; return executeBundles.apply(pass, a); };
    return pass;
  };
  const wrapCompute = (pass: GPUComputePassEncoder, f: Open): GPUComputePassEncoder => {
    const c = f.counts;
    const { setPipeline, setBindGroup, dispatchWorkgroups, dispatchWorkgroupsIndirect } = pass;
    pass.setPipeline = (p) => { c.pipelines += 1; return setPipeline.call(pass, p); };
    pass.setBindGroup = ((...a: Parameters<GPUComputePassEncoder["setBindGroup"]>) => { c.bindGroups += 1; return (setBindGroup as (...x: unknown[]) => undefined).apply(pass, a); }) as GPUComputePassEncoder["setBindGroup"];
    pass.dispatchWorkgroups = (...a: Parameters<GPUComputePassEncoder["dispatchWorkgroups"]>) => { c.dispatches += 1; return dispatchWorkgroups.apply(pass, a); };
    if (typeof dispatchWorkgroupsIndirect === "function") pass.dispatchWorkgroupsIndirect = (...a: Parameters<GPUComputePassEncoder["dispatchWorkgroupsIndirect"]>) => { c.dispatches += 1; c.indirect += 1; return dispatchWorkgroupsIndirect.apply(pass, a); };
    return pass;
  };
  /** A labelled pass's timestamp writes — a query pair in the frame's set — or none (unsupported, a full ring, a full set, its own). */
  const stampsFor = (d: { readonly label?: string; readonly timestampWrites?: unknown }, enc: Enc): GPURenderPassTimestampWrites | undefined => {
    const f = enc.frame;
    if (querySet === null || f.closed || d.label === undefined || d.label.length === 0 || d.timestampWrites !== undefined) return undefined;
    if (f.slot === undefined) {
      const free = slots.indexOf(FREE);
      if (free < 0) { f.slot = -1; dropped += 1; }
      else { f.slot = free; slots[free] = USED; }
    }
    if (f.slot === -1 || f.next + 2 > capacity) return undefined;
    const q = f.next;
    f.next += 2;
    f.timed.push({ label: d.label, q, enc });
    enc.queries.push(q);
    f.counts.timed += 1;
    return { querySet, beginningOfPassWriteIndex: q, endOfPassWriteIndex: q + 1 };
  };
  /** At `finish()`: this encoder's queries resolved and copied into the frame's slot, in ITS command buffer — run by run. */
  const resolveInto = (encoder: GPUCommandEncoder, enc: Enc): void => {
    const f = enc.frame;
    if (enc.queries.length === 0 || resolve === null || f.closed || f.slot === undefined || f.slot < 0) return;
    const dst = readback[f.slot] as GPUBuffer;
    const qs = [...enc.queries].sort((a, b) => a - b);
    let first = qs[0] as number;
    let end = first + 2;
    const flush = (): void => {
      encoder.resolveQuerySet(querySet as GPUQuerySet, first, end - first, resolve, 0);
      encoder.copyBufferToBuffer(resolve, 0, dst, first * 8, (end - first) * 8);
    };
    for (let i = 1; i < qs.length; i++) {
      const q = qs[i] as number;
      if (q === end) { end += 2; continue; }
      flush();
      first = q;
      end = q + 2;
    }
    flush();
  };

  const originalCreate = device.createCommandEncoder;
  const undoCreate = swapMethod(device, "createCommandEncoder", ((d?: GPUCommandEncoderDescriptor) => {
    const encoder = originalCreate.call(device, d);
    if (!attached) return encoder;
    const f = frame();
    f.counts.encoders += 1;
    const enc: Enc = { frame: f, closes: frameEncoders.has(d?.label ?? ""), queries: [], submitted: false };
    const { beginRenderPass, beginComputePass, finish } = encoder;
    encoder.beginRenderPass = (pd) => {
      f.counts.passes += 1;
      const tw = stampsFor(pd, enc);
      return wrapRender(beginRenderPass.call(encoder, tw !== undefined ? { ...pd, timestampWrites: tw } : pd), f);
    };
    if (typeof beginComputePass === "function") {
      encoder.beginComputePass = (pd) => {
        f.counts.passes += 1;
        const tw = pd !== undefined ? stampsFor(pd, enc) : undefined;
        return wrapCompute(beginComputePass.call(encoder, tw !== undefined ? { ...pd, timestampWrites: tw } : pd), f);
      };
    }
    encoder.finish = (fd) => {
      resolveInto(encoder, enc);
      const cb = finish.call(encoder, fd);
      commands.set(cb, enc);
      return cb;
    };
    return encoder;
  }) as GPUDevice["createCommandEncoder"]);
  // after the native submit: the frame's command buffers are on the queue; its own encoder's closes it (its slot mapped then)
  const untap = tapSubmits(device.queue, {
    after(list) {
      let closing: Open | null = null;
      for (const cb of list) {
        const enc = commands.get(cb);
        if (enc === undefined) continue;
        enc.submitted = true;
        if (Number.isNaN(enc.frame.firstSubmit)) enc.frame.firstSubmit = now();
        if (enc.closes) closing = enc.frame;
      }
      if (closing !== null) close(closing, "frame");
    },
  });

  return {
    supported,
    cut() { if (open !== null) close(open, "loose"); },
    stats: () => ({ frames, inFlight, dropped }),
    detach() {
      if (!attached) return;
      attached = false;
      undoCreate();
      untap();
      // a task later no encoder of this one can still reference them (a pending map is rejected by the destroy: its frame reads "lost")
      setTimeout(() => { querySet?.destroy(); resolve?.destroy(); for (const b of readback) b.destroy(); }, 0);
    },
  };
}
