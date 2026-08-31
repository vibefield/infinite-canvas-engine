/**
 * The submit instrument (design-012 §1.2 "idle-zero", plan §5 S1.3).
 *
 * Idle-zero is a LAW of this design — no dirt ⇒ return before
 * `getCurrentTexture()` ⇒ zero submits — and a law nobody measures is folklore.
 * The only place that sees EVERY submission, including the ones three makes
 * internally for its own uploads and passes, is `device.queue.submit` itself.
 * Counting composites in our own reflector would prove nothing about three.
 *
 * ORDERING. Install this immediately after acquiring the device and BEFORE
 * building any consumer. three reads `device.queue` per call rather than
 * caching the method, so a later install still counts three's submits — but
 * anything submitted in the window before installation is invisible, and a
 * boot-time count is exactly what a "0 submits in 4 s" claim rests on.
 *
 * Dev-only by intent. It costs one array push and two increments per submit;
 * ship it behind the same switch as any other instrument.
 */

export interface SubmitInstrument {
  /** Every `queue.submit` since install or the last `reset`, whoever made it. */
  total(): number;
  /** Command buffers passed across all those submits. */
  buffers(): number;
  /** Submits in the trailing `windowMs`, from the stamp ring. */
  inWindow(windowMs: number): number;
  /** Timestamps of the retained submits (newest last), for tail inspection. */
  stamps(): readonly number[];
  reset(): void;
  /** Restore the queue's own `submit`. Idempotent. */
  detach(): void;
}

/** One instrument per queue: a second install would double-count every submit. */
const installed = new WeakMap<GPUQueue, SubmitInstrument>();

const RING = 512;

export function instrumentSubmits(device: GPUDevice): SubmitInstrument {
  const queue = device.queue;
  const existing = installed.get(queue);
  if (existing !== undefined) return existing;

  // Bound to its owner: `submit` is a native method with a receiver check, so
  // the saved reference must carry the queue with it.
  const original = queue.submit.bind(queue);
  let total = 0;
  let buffers = 0;
  let stamps: number[] = [];
  let attached = true;

  const now = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0;

  queue.submit = (list: Iterable<GPUCommandBuffer>) => {
    // Iterables are single-pass: materialise ONCE and hand the array on, or a
    // generator argument would arrive at the real submit already drained.
    const array = Array.from(list);
    total++;
    buffers += array.length;
    stamps.push(now());
    if (stamps.length > RING) stamps.splice(0, RING / 2);
    return original(array);
  };

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
    reset() {
      total = 0;
      buffers = 0;
      stamps = [];
    },
    detach() {
      if (!attached) return;
      attached = false;
      queue.submit = original;
      installed.delete(queue);
    },
  };
  installed.set(queue, instrument);
  return instrument;
}
