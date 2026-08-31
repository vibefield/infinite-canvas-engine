import { SRGBColorSpace } from "three";
import { describe, expect, it, vi } from "vitest";
import { RenderTargetPool, renderTargetBytes } from "../src/pool";

// A deterministic clock the tests advance by hand so `lastUsedMs` assertions do
// not depend on wall time (design-004 §3 — the pool takes an injected `now`).
function fixedClock(start = 0): { now: () => number; set: (v: number) => void } {
  let t = start;
  return { now: () => t, set: (v) => { t = v; } };
}

describe("RenderTargetPool", () => {
  it("allocates a target sized to rounded world × dpr pixels", () => {
    const pool = new RenderTargetPool(() => 0);
    const rt = pool.acquire(1, 100.4, 60.6, 2);
    // round(100.4 × 2) = 201, round(60.6 × 2) = 121.
    expect(rt.width).toBe(201);
    expect(rt.height).toBe(121);
  });

  it("clamps degenerate sizes to at least 1 pixel", () => {
    const pool = new RenderTargetPool(() => 0);
    const rt = pool.acquire(1, 0.1, 0.1, 1);
    expect(rt.width).toBe(1);
    expect(rt.height).toBe(1);
  });

  it("uses MSAA samples = 4 and the sRGB colour space", () => {
    const pool = new RenderTargetPool(() => 0);
    const rt = pool.acquire(1, 50, 50, 1);
    expect(rt.samples).toBe(4);
    expect(rt.texture.colorSpace).toBe(SRGBColorSpace);
  });

  it("reuses the same target instance for a same-size acquire", () => {
    const pool = new RenderTargetPool(() => 0);
    const a = pool.acquire(1, 100, 100, 1);
    const b = pool.acquire(1, 100, 100, 1);
    expect(b).toBe(a);
    expect(pool.size()).toBe(1);
  });

  it("reallocates and disposes the old target when the pixel size changes", () => {
    const pool = new RenderTargetPool(() => 0);
    const a = pool.acquire(1, 100, 100, 1);
    const disposeSpy = vi.spyOn(a, "dispose");
    const b = pool.acquire(1, 200, 100, 1);
    expect(b).not.toBe(a);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(b.width).toBe(200);
    expect(pool.size()).toBe(1);
  });

  it("never destroys a PINNED target on a resize — it retires it until the pin drops", () => {
    // The mirror of the WebGPU pool's rule, and for the same reason: a pinned
    // row is being sampled by an outgoing retained quad, so a resize must not
    // dispose it under the reader. `release()` already refused a pinned row;
    // this path did not.
    const pool = new RenderTargetPool(() => 0);
    const before = pool.acquire(1, 100, 100, 1);
    const disposed = vi.spyOn(before, "dispose");
    const pin = pool.pin([1]);

    const after = pool.acquire(1, 100, 100, 2);
    expect(after).not.toBe(before);
    expect(disposed).not.toHaveBeenCalled();
    expect(pool.size()).toBe(1);
    // The live island still gets its new resolution; the clone keeps the old
    // pixels. Returning the pinned target instead would pass "not disposed"
    // and strand the island at the old size (see acquire's note).
    expect(after.width).toBe(200);
    expect(before.width).toBe(100);
    expect(pool.bytesUsed()).toBe(renderTargetBytes(100, 100) + renderTargetBytes(200, 200));

    pin.release();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(pool.bytesUsed()).toBe(renderTargetBytes(200, 200));
  });

  it("charges the real MSAA allocation: 36 bytes/px (4 resolve + 16 colour + 16 depth) for a 4-sample RGBA8+depth target", () => {
    const pool = new RenderTargetPool(() => 0);
    pool.acquire(1, 1, 1, 1); // 1 × 1 px → 4×1 + 4×4 (colour) + 4×4 (depth) = 36
    expect(pool.bytesUsed()).toBe(36);
  });

  it("sums bytesUsed across entries as w × h × 36 (MSAA real-allocation model)", () => {
    const pool = new RenderTargetPool(() => 0);
    pool.acquire(1, 100, 60, 2); // 200 × 120 → 200*120*36 = 864000
    pool.acquire(2, 10, 10, 1); //  10 ×  10 →  10*10*36   =   3600
    expect(pool.bytesUsed()).toBe(864000 + 3600);
  });

  it("get() returns the target or null when absent", () => {
    const pool = new RenderTargetPool(() => 0);
    const rt = pool.acquire(7, 10, 10, 1);
    expect(pool.get(7)).toBe(rt);
    expect(pool.get(999)).toBeNull();
  });

  it("touch() refreshes lastUsedMs from the injected clock", () => {
    const clock = fixedClock(100);
    const pool = new RenderTargetPool(clock.now);
    pool.acquire(1, 10, 10, 1);
    expect(pool.entryInfos()[0]?.lastUsedMs).toBe(100);
    clock.set(500);
    pool.touch(1);
    expect(pool.entryInfos()[0]?.lastUsedMs).toBe(500);
  });

  it("entryInfos() reports { key, bytes, lastUsedMs } per entry", () => {
    const clock = fixedClock(42);
    const pool = new RenderTargetPool(clock.now);
    pool.acquire(5, 10, 10, 1);
    const infos = pool.entryInfos();
    expect(infos).toEqual([{ key: 5, bytes: 3600, lastUsedMs: 42, pinned: false }]);
  });

  it("pins retained targets against release until the exact inverse runs", () => {
    const pool = new RenderTargetPool(() => 42);
    const target = pool.acquire(5, 10, 10, 1);
    const pin = pool.pin([5, 5, 99]);
    expect(pin.keys).toEqual([5]);
    expect(pool.entryInfos()[0]?.pinned).toBe(true);
    expect(pool.release(5)).toBe(false);
    expect(pool.get(5)).toBe(target);
    pin.release();
    pin.release();
    expect(pool.release(5)).toBe(true);
  });

  it("release() disposes the target, removes it, and decrements bytesUsed", () => {
    const pool = new RenderTargetPool(() => 0);
    const rt = pool.acquire(1, 10, 10, 1);
    const disposeSpy = vi.spyOn(rt, "dispose");
    expect(pool.release(1)).toBe(true);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(pool.get(1)).toBeNull();
    expect(pool.size()).toBe(0);
    expect(pool.bytesUsed()).toBe(0);
  });

  it("release() returns false for an unknown key", () => {
    const pool = new RenderTargetPool(() => 0);
    expect(pool.release(123)).toBe(false);
  });

  it("dispose() frees every target, flips isDisposed, and blocks reuse", () => {
    const pool = new RenderTargetPool(() => 0);
    const a = pool.acquire(1, 10, 10, 1);
    const b = pool.acquire(2, 10, 10, 1);
    const sa = vi.spyOn(a, "dispose");
    const sb = vi.spyOn(b, "dispose");
    pool.dispose();
    expect(sa).toHaveBeenCalledTimes(1);
    expect(sb).toHaveBeenCalledTimes(1);
    expect(pool.isDisposed()).toBe(true);
    expect(pool.bytesUsed()).toBe(0);
    expect(pool.size()).toBe(0);
    // Post-dispose contract (matches v1): acquire throws, release is a no-op.
    expect(() => pool.acquire(1, 10, 10, 1)).toThrow(/after dispose/);
    expect(pool.release(1)).toBe(false);
  });
});
