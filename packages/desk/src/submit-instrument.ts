// The submit instrument — the idle-zero witness (design-012 §1.2's law, design-015 §2.4;
// `packages/ground/src/submit-instrument.ts`, ported to the desk at D2a-world: the two legs share
// no code, so a copy). Idle-zero is a LAW — no dirt ⇒ return before `getCurrentTexture()` ⇒ zero
// submits — and a law nobody measures is folklore. The only place that sees EVERY submission is
// `device.queue.submit` itself, so this wraps it: install right after acquiring the device and
// BEFORE building any consumer; anything submitted before the install is invisible, and a
// "0 submits over 240 frames" claim rests on a boot-time count. Dev-only by intent (one array
// push and two increments per submit). One instrument per queue: a second install would
// double-count.
//
// D6 — THE UPLOADS TOO (design-015 §4.3, §11.4: "records written, bytes uploaded per kind per
// frame"): the same wrapper takes `queue.writeBuffer` and `queue.writeTexture`, counting calls and
// bytes, attributed by the LABEL of the buffer or texture written — every one of the desk's is
// named `<kind>/<what>` (`paper/notes`, `minimat/chips`, `board/boards`, `mat/uniforms`,
// `marks/records`, `notebook/ink` …), so a per-kind upload tally falls out of the names the
// passes already give their resources, and no pass is touched to be measured. A camera move that
// writes NOTHING per record is proven here: the `paper` bucket's bytes stand still over a pan.

export interface UploadTally {
  /** `writeBuffer` + `writeTexture` calls. */
  readonly writes: number;
  /** The bytes those calls carried (a texture write counts what was handed to it). */
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
  /** Every `writeBuffer`/`writeTexture` since install or the last `reset`, and the bytes they carried. */
  uploads(): UploadTally;
  /** The uploads by the written resource's label prefix (the text before its `/`; `?` for an unlabelled one). A fresh copy. */
  uploadsByLabel(): Readonly<Record<string, UploadTally>>;
  reset(): void;
  /** Restore the queue's own `submit`, `writeBuffer` and `writeTexture`. Idempotent. */
  detach(): void;
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

/** A resource's label prefix — `paper/notes` → `paper`; no label → `?`. */
const prefixOf = (label: string | undefined): string => {
  if (label === undefined || label.length === 0) return "?";
  const slash = label.indexOf("/");
  return slash < 0 ? label : label.slice(0, slash);
};

export function instrumentSubmits(device: GPUDevice): SubmitInstrument {
  const queue = device.queue;
  const existing = installed.get(queue);
  if (existing !== undefined) return existing;

  // Bound to its owner: `submit` is a native method with a receiver check, so the saved reference must carry the queue with it.
  const original = queue.submit.bind(queue);
  const originalWriteBuffer = queue.writeBuffer.bind(queue);
  const originalWriteTexture = queue.writeTexture.bind(queue);
  let total = 0;
  let buffers = 0;
  let stamps: number[] = [];
  let writes = 0;
  let bytes = 0;
  let byLabel = new Map<string, { writes: number; bytes: number }>();
  let attached = true;

  const now = (): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0);
  const tally = (label: string | undefined, n: number): void => {
    writes += 1;
    bytes += n;
    const key = prefixOf(label);
    const t = byLabel.get(key);
    if (t === undefined) byLabel.set(key, { writes: 1, bytes: n });
    else { t.writes += 1; t.bytes += n; }
  };

  queue.submit = (list: Iterable<GPUCommandBuffer>) => {
    // Iterables are single-pass: materialise ONCE and hand the array on.
    const array = Array.from(list);
    total++;
    buffers += array.length;
    stamps.push(now());
    if (stamps.length > RING) stamps.splice(0, RING / 2);
    return original(array);
  };
  queue.writeBuffer = ((buffer: GPUBuffer, bufferOffset: number, data: BufferSource | SharedArrayBuffer, dataOffset?: number, size?: number) => {
    tally(buffer.label, writeBufferBytes(data, dataOffset, size));
    // the arguments as given: an explicit `undefined` in a trailing slot is not the same call to the native method
    if (dataOffset === undefined) return originalWriteBuffer(buffer, bufferOffset, data);
    if (size === undefined) return originalWriteBuffer(buffer, bufferOffset, data, dataOffset);
    return originalWriteBuffer(buffer, bufferOffset, data, dataOffset, size);
  }) as GPUQueue["writeBuffer"];
  queue.writeTexture = ((destination: GPUTexelCopyTextureInfo, data: BufferSource | SharedArrayBuffer, dataLayout: GPUTexelCopyBufferLayout, size: GPUExtent3DStrict) => {
    tally(destination.texture.label, data.byteLength - (dataLayout.offset ?? 0));
    return originalWriteTexture(destination, data, dataLayout, size);
  }) as GPUQueue["writeTexture"];

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
    reset() { total = 0; buffers = 0; stamps = []; writes = 0; bytes = 0; byLabel = new Map(); },
    detach() {
      if (!attached) return;
      attached = false;
      queue.submit = original;
      queue.writeBuffer = originalWriteBuffer;
      queue.writeTexture = originalWriteTexture;
      installed.delete(queue);
    },
  };
  installed.set(queue, instrument);
  return instrument;
}
