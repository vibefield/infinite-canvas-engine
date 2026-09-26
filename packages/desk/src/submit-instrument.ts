// The submit instrument — the idle-zero witness (design-012 §1.2's law, design-015 §2.4;
// `packages/ground/src/submit-instrument.ts`, ported to the desk at D2a-world: the two legs share
// no code, so a copy). Idle-zero is a LAW — no dirt ⇒ return before `getCurrentTexture()` ⇒ zero
// submits — and a law nobody measures is folklore. The only place that sees EVERY submission is
// `device.queue.submit` itself, so this wraps it: install right after acquiring the device and
// BEFORE building any consumer; anything submitted before the install is invisible, and a
// "0 submits over 240 frames" claim rests on a boot-time count. Dev-only by intent (one array
// push and two increments per submit). One instrument per queue: a second install would
// double-count.

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

const installed = new WeakMap<GPUQueue, SubmitInstrument>();

const RING = 512;

export function instrumentSubmits(device: GPUDevice): SubmitInstrument {
  const queue = device.queue;
  const existing = installed.get(queue);
  if (existing !== undefined) return existing;

  // Bound to its owner: `submit` is a native method with a receiver check, so the saved reference must carry the queue with it.
  const original = queue.submit.bind(queue);
  let total = 0;
  let buffers = 0;
  let stamps: number[] = [];
  let attached = true;

  const now = (): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0);

  queue.submit = (list: Iterable<GPUCommandBuffer>) => {
    // Iterables are single-pass: materialise ONCE and hand the array on.
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
    reset() { total = 0; buffers = 0; stamps = []; },
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
