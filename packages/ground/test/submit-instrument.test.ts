/**
 * The submit instrument (design-012 §1.2). It is the witness behind every
 * idle-zero claim, so its own failure modes matter: a double install would
 * double every count, a lost `this` would throw on a real native queue, and a
 * drained iterable would silently submit nothing.
 */
import { describe, expect, it } from "vitest";
import { instrumentSubmits } from "../src/compositor/submit-instrument";

function fakeDevice() {
  const received: unknown[][] = [];
  let receiver: unknown = null;
  const queue = {
    submit(this: unknown, buffers: GPUCommandBuffer[]) {
      receiver = this;
      received.push(buffers);
    },
  };
  return {
    device: { queue } as unknown as GPUDevice,
    queue,
    received,
    lastReceiver: () => receiver,
  };
}

describe("submit instrument", () => {
  it("counts submits and command buffers, and still submits them", () => {
    const host = fakeDevice();
    const i = instrumentSubmits(host.device);
    host.device.queue.submit([{} as GPUCommandBuffer]);
    host.device.queue.submit([{} as GPUCommandBuffer, {} as GPUCommandBuffer]);
    expect(i.total()).toBe(2);
    expect(i.buffers()).toBe(3);
    expect(host.received).toHaveLength(2);
    expect(host.received[1]).toHaveLength(2);
  });

  it("calls the original submit with its RECEIVER intact", () => {
    const host = fakeDevice();
    instrumentSubmits(host.device);
    host.device.queue.submit([{} as GPUCommandBuffer]);
    // A real GPUQueue.submit is native and receiver-checked: an unbound saved
    // reference throws "Illegal invocation" the first time three submits.
    expect(host.lastReceiver()).toBe(host.queue);
  });

  it("materialises a single-pass iterable before handing it on", () => {
    const host = fakeDevice();
    instrumentSubmits(host.device);
    function* buffers(): Generator<GPUCommandBuffer> {
      yield {} as GPUCommandBuffer;
      yield {} as GPUCommandBuffer;
    }
    host.device.queue.submit(buffers());
    // Counting by iterating and then passing the SAME generator on would hand
    // the real submit an already-drained iterator: two counted, zero submitted.
    expect(host.received[0]).toHaveLength(2);
  });

  it("installs once per queue — a second install must not double-count", () => {
    const host = fakeDevice();
    const first = instrumentSubmits(host.device);
    const second = instrumentSubmits(host.device);
    expect(second).toBe(first);
    host.device.queue.submit([{} as GPUCommandBuffer]);
    expect(first.total()).toBe(1);
  });

  it("counts submits in a trailing window and resets", () => {
    const host = fakeDevice();
    const i = instrumentSubmits(host.device);
    for (let n = 0; n < 5; n++) host.device.queue.submit([{} as GPUCommandBuffer]);
    expect(i.inWindow(10_000)).toBe(5);
    // The idle-zero shape: reset, do nothing, and the window reads zero.
    i.reset();
    expect(i.total()).toBe(0);
    expect(i.inWindow(10_000)).toBe(0);
  });

  it("detach restores the queue's own submit and is idempotent", () => {
    const host = fakeDevice();
    const i = instrumentSubmits(host.device);
    host.device.queue.submit([{} as GPUCommandBuffer]);
    i.detach();
    i.detach();
    host.device.queue.submit([{} as GPUCommandBuffer]);
    expect(i.total()).toBe(1); // the post-detach submit was not counted
    expect(host.received).toHaveLength(2); // but it still reached the queue
    // Detached means re-installable — otherwise a torn-down harness could
    // never re-arm on the same device.
    const again = instrumentSubmits(host.device);
    expect(again).not.toBe(i);
  });
});
