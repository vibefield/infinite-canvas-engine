// A UNIFORM WRITTEN ONLY WHEN IT CHANGED (design-016 K-L3 — a standing value costs a frame nothing). A kind's knobs — its
// law, its colours, the ring — stand still frame after frame while the camera moves, and the slot's view block carries
// what moves; so a pass keeps the bytes the GPU holds and writes a block only when they differ. The shader reads the same
// values either way: WebGPU zero-fills a new buffer, and `sent` starts as those zeros.

import type { StructBuffer } from "../engine/struct";

/** What a pass keeps beside a buffer it writes change-only: the bytes the GPU holds (sized to the buffer). */
export const sentBytes = (size: number): Uint8Array => new Uint8Array(size);

/**
 * Write `block` (its first `elements`, or all) into `buffer` at 0 only when its bytes differ from `sent` — which then holds
 * them. Returns whether it wrote.
 */
export function writeChanged(queue: GPUQueue, buffer: GPUBuffer, block: StructBuffer<string>, sent: Uint8Array, elements?: number): boolean {
  const bytes = block.view(elements);
  if (bytes.byteLength > sent.byteLength) throw new Error(`writeChanged: ${bytes.byteLength} bytes into a ${sent.byteLength}-byte record of what was sent`);
  let same = true;
  for (let i = 0; i < bytes.byteLength; i++) if (bytes[i] !== sent[i]) { same = false; break; }
  if (same) return false;
  queue.writeBuffer(buffer, 0, bytes);
  sent.set(bytes);
  return true;
}
