// The submit instrument — the idle-zero witness (design-012 §1.2's law, design-015 §2.4;
// `packages/ground/src/submit-instrument.ts`, ported to the desk at D2a-world: the two legs share
// no code, so a copy). Idle-zero is a LAW — no dirt ⇒ return before `getCurrentTexture()` ⇒ zero
// submits — and a law nobody measures is folklore. The only place that sees EVERY submission is
// `device.queue.submit` itself, so this wraps it. A count covers what was submitted after the
// install, so a "0 submits over 240 frames" claim needs the instrument armed before its window
// opens — which asking for it does (below). One instrument per queue: asking twice returns the one.
//
// D6 — THE UPLOADS TOO (design-015 §4.3, §11.4: "records written, bytes uploaded per kind per
// frame"): the same wrapper takes `queue.writeBuffer` and `queue.writeTexture`, counting calls and
// bytes, attributed by the LABEL of the buffer or texture written — every one of the desk's is
// named `<kind>/<what>` (`paper/notes`, `minimat/chips`, `board/boards`, `mat/uniforms`,
// `marks/records`, `notebook/ink` …), so a per-kind upload tally falls out of the names the
// passes already give their resources, and no pass is touched to be measured. A camera move that
// writes NOTHING per record is proven here: the `paper` bucket's bytes stand still over a pan.
//
// K2 (design-016 §4) — ARMED ON DEMAND, AND THE PICTURES. Until K2 the layer installed this at boot
// on every desk, though this header said "dev-only by intent": a product paid an array push and a
// wrapper call per submit and per write for a witness nobody read. Now nothing wraps the queue until
// something asks — the layer's `submits()` (the rigs' door) installs it on first ask, the GPU
// profiler holds it while armed — and `detach()` puts back EXACTLY what was there: the queue's own
// property if it had one, else none (the prototype's method shows through again), so an unarmed
// queue carries no wrapper at all (D-K2.1). Submits are shared through ONE tap per queue
// (`tapSubmits`): every instrument that listens to submits hooks the same wrapper, so any of them
// can leave in any order and the last one out restores the native. And `copyExternalImageToTexture`
// — a print's picture (photo/photo-pass.ts), the calendar's printed tiles (calendar/pass.ts) — is an
// upload: it carries no byte length, so its bytes are its texels in the destination's format
// (gpu-memory.ts `regionBytes`); counted with the writes and on its own (`externals`).

import { regionBytes } from "./gpu-memory";
import { prefixOf, swapMethod } from "./gpu-wrap";

export interface UploadTally {
  /** `writeBuffer` + `writeTexture` + `copyExternalImageToTexture` calls. */
  readonly writes: number;
  /** The bytes those calls carried (a texture write counts what was handed to it; an external copy its texels). */
  readonly bytes: number;
}

export interface SubmitInstrument {
  /** Every `queue.submit` since install or the last `reset`, whoever made it. */
  total(): number;
  /** Command buffers passed across all those submits. */
  buffers(): number;
  /** Submits in the trailing `windowMs`, from the stamp ring. */
  inWindow(windowMs: number): number;
  /** Timestamps of the retained submits (newest last), for tail inspection. */
  stamps(): readonly number[];
  /** Every upload since install or the last `reset` — `writeBuffer`, `writeTexture`, `copyExternalImageToTexture` — and the bytes they carried. */
  uploads(): UploadTally;
  /** The uploads by the written resource's label prefix (the text before its `/`; `?` for an unlabelled one). A fresh copy. */
  uploadsByLabel(): Readonly<Record<string, UploadTally>>;
  /** The `copyExternalImageToTexture` uploads alone (a picture decoded onto the GPU, a calendar tile printed) — also inside `uploads`. */
  externals(): UploadTally;
  reset(): void;
  /** Put back what the queue had before the install — its own `writeBuffer`/`writeTexture`/`copyExternalImageToTexture`, and its `submit` once no other listener taps it. Idempotent. */
  detach(): void;
}

/** One listener on a queue's submits: `before` sees the list as handed in (materialised once), `after` runs once the native submit returned. */
export interface SubmitHook {
  before?(list: readonly GPUCommandBuffer[]): void;
  after?(list: readonly GPUCommandBuffer[]): void;
}

interface Tap { readonly hooks: SubmitHook[]; readonly undo: () => void }
const taps = new WeakMap<GPUQueue, Tap>();

/**
 * THE SUBMIT TAP (K2): ONE wrapper on `queue.submit`, shared by every instrument that listens to submits — installed with the first
 * hook, removed with the last (the queue's own `submit` back). Returns the hook's removal; idempotent.
 */
export function tapSubmits(queue: GPUQueue, hook: SubmitHook): () => void {
  let tap = taps.get(queue);
  if (tap === undefined) {
    const native = queue.submit;   // called with the queue as its receiver: a native method checks it
    const hooks: SubmitHook[] = [];
    const wrapper = (list: Iterable<GPUCommandBuffer>): undefined => {
      // Iterables are single-pass: materialise ONCE and hand the array on.
      const array = Array.from(list);
      for (const h of hooks) h.before?.(array);
      native.call(queue, array);
      for (const h of hooks) h.after?.(array);
    };
    tap = { hooks, undo: swapMethod(queue, "submit", wrapper as GPUQueue["submit"]) };
    taps.set(queue, tap);
  }
  const t = tap;
  t.hooks.push(hook);
  let on = true;
  return () => {
    if (!on) return;
    on = false;
    const i = t.hooks.indexOf(hook);
    if (i >= 0) t.hooks.splice(i, 1);
    if (t.hooks.length === 0 && taps.get(queue) === t) { taps.delete(queue); t.undo(); }
  };
}

const installed = new WeakMap<GPUQueue, SubmitInstrument>();

const RING = 512;

/** The byte count a `writeBuffer` call carries: `size` is in ELEMENTS of a typed view and in bytes of a bare buffer (the WebGPU rule). */
function writeBufferBytes(data: BufferSource | SharedArrayBuffer, dataOffset: number | undefined, size: number | undefined): number {
  if (ArrayBuffer.isView(data)) {
    const elem = (data as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    return size !== undefined ? size * elem : data.byteLength - (dataOffset ?? 0) * elem;
  }
  return size ?? data.byteLength - (dataOffset ?? 0);
}

export function instrumentSubmits(device: GPUDevice): SubmitInstrument {
  const queue = device.queue;
  const existing = installed.get(queue);
  if (existing !== undefined) return existing;

  // Called with the queue as receiver: `writeBuffer` & co. are native methods with a receiver check.
  const originalWriteBuffer = queue.writeBuffer;
  const originalWriteTexture = queue.writeTexture;
  const originalCopyExternal = queue.copyExternalImageToTexture as GPUQueue["copyExternalImageToTexture"] | undefined;
  let total = 0;
  let buffers = 0;
  let stamps: number[] = [];
  let writes = 0;
  let bytes = 0;
  let externals = { writes: 0, bytes: 0 };
  let byLabel = new Map<string, { writes: number; bytes: number }>();
  let attached = true;

  const now = (): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0);
  const tally = (label: string | undefined, n: number): void => {
    if (!attached) return;   // detached beneath another's wrapper: a pass-through, counting nothing
    writes += 1;
    bytes += n;
    const key = prefixOf(label);
    const t = byLabel.get(key);
    if (t === undefined) byLabel.set(key, { writes: 1, bytes: n });
    else { t.writes += 1; t.bytes += n; }
  };

  const untap = tapSubmits(queue, {
    before(list) {
      total++;
      buffers += list.length;
      stamps.push(now());
      if (stamps.length > RING) stamps.splice(0, RING / 2);
    },
  });
  const undo = [
    swapMethod(queue, "writeBuffer", ((buffer: GPUBuffer, bufferOffset: number, data: BufferSource | SharedArrayBuffer, dataOffset?: number, size?: number) => {
      tally(buffer.label, writeBufferBytes(data, dataOffset, size));
      // the arguments as given: an explicit `undefined` in a trailing slot is not the same call to the native method
      if (dataOffset === undefined) return originalWriteBuffer.call(queue, buffer, bufferOffset, data);
      if (size === undefined) return originalWriteBuffer.call(queue, buffer, bufferOffset, data, dataOffset);
      return originalWriteBuffer.call(queue, buffer, bufferOffset, data, dataOffset, size);
    }) as GPUQueue["writeBuffer"]),
    swapMethod(queue, "writeTexture", ((destination: GPUTexelCopyTextureInfo, data: BufferSource | SharedArrayBuffer, dataLayout: GPUTexelCopyBufferLayout, size: GPUExtent3DStrict) => {
      tally(destination.texture.label, data.byteLength - (dataLayout.offset ?? 0));
      return originalWriteTexture.call(queue, destination, data, dataLayout, size);
    }) as GPUQueue["writeTexture"]),
  ];
  // (a queue without it — a test's stub — has nothing to count)
  if (typeof originalCopyExternal === "function") {
    undo.push(swapMethod(queue, "copyExternalImageToTexture", ((source: GPUCopyExternalImageSourceInfo, destination: GPUCopyExternalImageDestInfo, copySize: GPUExtent3DStrict) => {
      const n = regionBytes(destination.texture.format ?? "rgba8unorm", copySize);
      tally(destination.texture.label, n);
      if (attached) externals = { writes: externals.writes + 1, bytes: externals.bytes + n };
      return originalCopyExternal.call(queue, source, destination, copySize);
    }) as GPUQueue["copyExternalImageToTexture"]));
  }

  const instrument: SubmitInstrument = {
    total: () => total,
    buffers: () => buffers,
    inWindow(windowMs) {
      const cutoff = now() - windowMs;
      let n = 0;
      for (let i = stamps.length - 1; i >= 0; i--) {
        if ((stamps[i] ?? 0) < cutoff) break;
        n++;
      }
      return n;
    },
    stamps: () => stamps,
    uploads: () => ({ writes, bytes }),
    uploadsByLabel() {
      const out: Record<string, UploadTally> = {};
      for (const [k, t] of byLabel) out[k] = { writes: t.writes, bytes: t.bytes };
      return out;
    },
    externals: () => externals,
    reset() { total = 0; buffers = 0; stamps = []; writes = 0; bytes = 0; externals = { writes: 0, bytes: 0 }; byLabel = new Map(); },
    detach() {
      if (!attached) return;
      attached = false;
      untap();
      for (const u of undo) u();
      installed.delete(queue);
    },
  };
  installed.set(queue, instrument);
  return instrument;
}
