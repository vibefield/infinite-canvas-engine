import { describe, expect, it } from "vitest";
import { createGpuAllocationLedger } from "../src/engine/gpu-allocation-ledger";

describe("shared GPU allocation ledger", () => {
  it("reclaims eligible allocator bytes before admitting a bounded reservation", () => {
    const ledger = createGpuAllocationLedger(100);
    let poolBytes = 70;
    let reclaimCalls = 0;
    const pool = ledger.registerAllocator({
      id: "r3f",
      usedBytes: () => poolBytes,
      reclaim(bytes) {
        reclaimCalls += 1;
        const freed = Math.min(bytes, 20);
        poolBytes -= freed;
        return freed;
      },
    });
    const reservation = ledger.reserve("ground", 50);
    expect(reclaimCalls).toBe(1);
    expect(reservation).toBeDefined();
    expect(ledger.stats()).toMatchObject({ usedBytes: 100, reservedBytes: 50 });
    expect(pool.limitBytes()).toBe(50);
    reservation?.release();
    reservation?.release();
    expect(ledger.stats()).toMatchObject({ usedBytes: 50, reservations: 0 });
  });

  it("refuses rather than temporarily exceeding the total budget", () => {
    const ledger = createGpuAllocationLedger(64);
    ledger.registerAllocator({
      id: "hot-pool",
      usedBytes: () => 48,
      reclaim: () => 0,
    });
    expect(ledger.reserve("snapshot", 32)).toBeUndefined();
    expect(ledger.stats()).toMatchObject({ usedBytes: 48, reservations: 0 });
  });

  it("computes each allocator limit against every other owner", () => {
    const ledger = createGpuAllocationLedger(100);
    let aBytes = 20;
    let bBytes = 30;
    const a = ledger.registerAllocator({ id: "a", usedBytes: () => aBytes, reclaim: () => 0 });
    const b = ledger.registerAllocator({ id: "b", usedBytes: () => bBytes, reclaim: () => 0 });
    const reservation = ledger.reserve("transition", 10);
    expect(a.limitBytes()).toBe(60);
    expect(b.limitBytes()).toBe(70);
    aBytes = 25;
    bBytes = 35;
    expect(ledger.stats().usedBytes).toBe(70);
    reservation?.release();
    a.unregister();
    b.unregister();
    ledger.dispose();
    expect(ledger.reserve("late", 1)).toBeUndefined();
  });
});
